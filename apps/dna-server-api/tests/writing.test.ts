import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { DnaError, type Card } from "@dna/sdk";
import { lintPost } from "../src/writing/lint.ts";
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
  assert.match(first.body, /原文：/);

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
    body: "我的判断：这条值得看。\n\n原文：https://example.com",
  });
  await fails(s.client.updatePick(pick.id, { status: "ready" }), 400, /被引推文/);
});
