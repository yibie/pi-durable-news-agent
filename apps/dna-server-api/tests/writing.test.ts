import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { DnaError, type Card } from "@dna/sdk";
import { lineDiff } from "../src/writing/edit-notice.ts";
import { loadConfig } from "../src/config.ts";
import { lintPost } from "../src/writing/lint.ts";
import { writerPrompt } from "../src/writing/rules.ts";
import { bootServer, idle, settledSweep, type Booted } from "./server.ts";
import { until } from "./helpers.ts";

let s: Booted;
let cards: Card[];
before(async () => {
  s = await bootServer();
  const started = await s.cron.newsSweep({ requestId: "writing:1" });
  await settledSweep(s.client, started.data.sweep!.id);
  await idle(s.client);
  cards = (await s.client.feed()).items;
});
after(() => s.cleanup());

const fails = async (p: Promise<unknown>, status: number, pattern: RegExp) => {
  await assert.rejects(
    p,
    (e: unknown) => e instanceof DnaError && e.status === status && pattern.test(e.message),
  );
};

test("the lint finds Markdown, tables and the weighted length", () => {
  const lint = lintPost("标题\n## 小节\n- 一项\n**粗**\n|a|b|\n|c|d|\n    - 缩进代码不算\n中文");
  assert.deepEqual(
    lint.markdown.map((h) => h.line),
    [2, 3, 4, 5, 6],
  );
  assert.equal(lintPost("中文ab").weighted, 6);
});

test("a pick's writer drafts with an image, takes a revision, and the pick goes to ready", async () => {
  const [card] = cards;
  const pick = await s.client.pick({ cardIds: [card.id], genre: "single" });
  await fails(s.client.updatePick(pick.id, { status: "ready" }), 400, /还没有稿子/);
  const started = await s.client.write(pick.id);
  assert.ok(started.conversationId);
  assert.equal(started.pick.status, "drafting");
  await until(async () => (await s.client.drafts(pick.id)).length === 1, 20_000, "first draft");
  const [first] = await s.client.drafts(pick.id);
  assert.equal(first.author, "writer");
  assert.equal(first.layout, "flow");
  assert.ok(first.imageId);
  assert.deepEqual(first.lint.markdown, []);
  assert.match(first.body, /原文链接在评论区/);
  assert.deepEqual(first.lint.links, [], "no link in the post itself");
  assert.match(first.reply ?? "", /^原文：https?:\/\//, "the links go in the first reply");

  const again = await s.client.write(pick.id);
  assert.equal(again.conversationId, started.conversationId, "writing starts once");

  await s.client.write(pick.id, { message: "开头再直接一点" });
  await until(async () => (await s.client.drafts(pick.id)).length === 2, 20_000, "revision");
  const [second] = await s.client.drafts(pick.id);
  assert.equal(second.revision, 2);
  assert.equal(second.imageId, first.imageId, "a text revision keeps the image");

  const edited = await s.client.saveDraft(pick.id, { body: `${second.body}\n**加粗**` });
  assert.equal(edited.author, "reader");
  assert.equal(edited.lint.markdown.length, 1);
  await fails(s.client.updatePick(pick.id, { status: "ready" }), 400, /Markdown/);
  await s.client.saveDraft(pick.id, { body: second.body });
  const ready = await s.client.updatePick(pick.id, { status: "ready" });
  assert.equal(ready.status, "ready");
  assert.equal(ready.draftRevision, 4);
  await fails(s.client.updatePick(pick.id, { status: "published" }), 400, /by publishing it/);
});

test("requirements given at the start go into the brief, not after the first draft", async () => {
  const [, card] = cards;
  const pick = await s.client.pick({ cardIds: [card.id], genre: "single" });
  const note = "面向不写代码的读者，重点讲它怎么省钱";
  const started = await s.client.write(pick.id, { message: note });
  assert.equal(started.pick.note, note);
  await until(async () => (await s.client.drafts(pick.id)).length === 1, 20_000, "first draft");
  const { items = [] } = await s.client.transcript({
    conversationId: Number(started.conversationId),
    format: "json",
  });
  const asked = items.flatMap((i) => (i.kind === "user" ? [i.text] : []));
  assert.equal(asked.length, 1, "one brief, no follow-up message");
  assert.ok(asked[0].includes(`READER_NOTE: ${note}`));
});

test("a quote post needs the post it quotes", async () => {
  const [, , card] = cards;
  const pick = await s.client.pick({ cardIds: [card.id], genre: "quote" });
  await s.client.saveDraft(pick.id, {
    body: "我的判断：这条值得看。\n\n原文链接在评论区。",
    reply: "原文：https://example.com",
  });
  await fails(s.client.updatePick(pick.id, { status: "ready" }), 400, /被引推文/);
});

/** A card no active pick holds; drops the newest pick when every card is taken. */
async function freeCard(): Promise<Card> {
  const active = await s.client.picks();
  const held = new Set(active.flatMap((p) => p.items.map((i) => i.cardId)));
  const free = cards.find((c) => !held.has(c.id));
  if (free) return free;
  const [newest] = [...active].sort((a, b) => b.id - a.id);
  await s.client.updatePick(newest.id, { status: "dropped" });
  return cards.find((c) => c.id === newest.items[0].cardId)!;
}

test("the line diff shows what the reader removed and added, blank lines aside", () => {
  assert.deepEqual(lineDiff("甲\n\n乙\n丙", "甲\n乙改\n\n丙\n丁"), ["- 乙", "+ 乙改", "+ 丁"]);
  assert.deepEqual(lineDiff("甲\n乙", "甲\n\n乙\n"), []);
});

test("the reader's own edit goes to the writer with the next message, once", async () => {
  const pick = await s.client.pick({ cardIds: [(await freeCard()).id], genre: "single" });
  const started = await s.client.write(pick.id);
  await until(async () => (await s.client.drafts(pick.id)).length === 1, 20_000, "first draft");
  const [first] = await s.client.drafts(pick.id);
  const lines = first.body.split("\n");
  await s.client.saveDraft(pick.id, { body: ["读者自己改的开头。", ...lines.slice(1)].join("\n") });

  await s.client.write(pick.id, { message: "再短一点" });
  await until(async () => (await s.client.drafts(pick.id)).length === 3, 20_000, "revision");
  await s.client.write(pick.id, { message: "好" });
  await until(async () => (await s.client.drafts(pick.id)).length === 4, 20_000, "second revision");

  const { items = [] } = await s.client.transcript({
    conversationId: Number(started.conversationId),
    format: "json",
  });
  const asked = items.flatMap((i) => (i.kind === "user" ? [i.text] : []));
  assert.equal(asked.length, 3, "the brief and two messages");
  const notice = asked[1];
  assert.ok(notice.startsWith("【读者手改了稿子】"), notice);
  assert.match(notice, /你最后交的是第 1 版/);
  assert.match(notice, /现在最新的是第 2 版/);
  assert.ok(notice.includes(`- ${lines[0]}`), "the writer's line it replaced");
  assert.ok(notice.includes("+ 读者自己改的开头。"), "the reader's line");
  assert.ok(notice.endsWith("【读者这次的话】\n再短一点"), notice);
  assert.equal(asked[2], "好", "told once: the next message goes as it is");
});

test("the writer's rules are edited from the workbench, kept as versions, and read on the next turn", async () => {
  const [rules, argmap] = await s.client.writerRules();
  assert.deepEqual([rules.name, argmap.name], ["RULES", "ARGMAP"]);
  assert.equal(rules.custom, false, "the tests read the shipped defaults");
  assert.equal(rules.versions.length, 1, "the text before any edit is the first version");
  assert.equal(rules.versions[0].source, "initial");
  assert.ok(!rules.file.includes(join("config", "writer")), "a save never rewrites the defaults");

  const edit = `${rules.body}\n- 测试加的一条：结尾不要用问句。\n`;
  const saved = await s.client.saveWriterRule("RULES", { body: edit });
  assert.equal(saved.custom, true);
  assert.equal(saved.versions.length, 2);
  assert.equal(saved.versions[0].source, "edit");
  assert.ok(readFileSync(saved.file, "utf8").includes("结尾不要用问句"));
  const config = loadConfig([], { DNA_DATA_DIR: s.dir, DNA_CONFIG_DIR: "", DNA_PROVIDER: "faux" });
  assert.equal(join(config.rulesDir, "RULES.md"), saved.file);
  assert.ok(writerPrompt(config).includes("结尾不要用问句"), "the writer reads the edit");
  const same = await s.client.saveWriterRule("RULES", { body: `${edit}\n\n` });
  assert.equal(same.versions.length, 2, "saving the same text adds no version");

  writeFileSync(saved.file, `${edit}- 在别的编辑器里加的一条。\n`);
  const back = await s.client.saveWriterRule("RULES", {
    body: rules.body,
    restoredFrom: rules.versions[0].id,
  });
  assert.deepEqual(
    back.versions.map((v) => v.source),
    ["restore", "outside", "edit", "initial"],
    "the outside change is kept before the restore overwrites it",
  );
  assert.equal(back.versions[0].restoredFrom, rules.versions[0].id);
  assert.equal(back.body, rules.body);
  const outside = await s.client.writerRuleVersion(back.versions[1].id);
  assert.match(outside.body, /在别的编辑器里加的一条/);

  await fails(s.client.saveWriterRule("RULES", { body: "  \n" }), 400, /non empty/);
  await fails(
    s.client.saveWriterRule("ARGMAP", { body: "x", restoredFrom: rules.versions[0].id }),
    400,
    /不是 ARGMAP 的版本/,
  );
  await fails(s.client.saveWriterRule("NOPE" as never, { body: "x" }), 404, /RULES or ARGMAP/);
  assert.ok(!existsSync(join(config.rulesDir, "ARGMAP.md")), "an untouched rule stays default");
});

test("a link in the post blocks 待发布: the links belong in the first reply", async () => {
  const pick = await s.client.pick({ cardIds: [(await freeCard()).id], genre: "single" });
  await s.client.write(pick.id);
  await until(async () => (await s.client.drafts(pick.id)).length === 1, 20_000, "first draft");
  const [first] = await s.client.drafts(pick.id);
  const linked = await s.client.saveDraft(pick.id, {
    body: `${first.body}\nhttps://example.com/a`,
  });
  assert.deepEqual(linked.lint.links, ["https://example.com/a"]);
  assert.equal(linked.reply, first.reply, "an edit without a reply keeps the reply");
  await fails(s.client.updatePick(pick.id, { status: "ready" }), 400, /正文里有链接/);
  await s.client.saveDraft(pick.id, { body: first.body, reply: "参考资料见上" });
  await fails(s.client.updatePick(pick.id, { status: "ready" }), 400, /首条回复/);
  await s.client.saveDraft(pick.id, { body: first.body, reply: first.reply });
  assert.equal((await s.client.updatePick(pick.id, { status: "ready" })).status, "ready");
});
