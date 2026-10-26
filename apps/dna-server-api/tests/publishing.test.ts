import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { DnaError, type Card } from "@dna/sdk";
import { until } from "./helpers.ts";
import { bootServer, idle, settledSweep, type Booted } from "./server.ts";

let s: Booted;
let cards: Card[];
const tmp = mkdtempSync(join(tmpdir(), "dna-publish-"));
const archive = join(tmp, "published");
const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();

before(async () => {
  // The old ledger: a post 10 minutes ago (spacing blocks), and pick 2's publish left unknown.
  writeFileSync(
    join(tmp, "ledger.jsonl"),
    [
      { at: minutesAgo(10), draft: "2026-10-21-old.md", status: "ok", backend: "cdp-image" },
      { at: minutesAgo(120), draft: "pick:2", status: "unknown", note: "crashed" },
      "not json",
    ]
      .map((l) => (typeof l === "string" ? l : JSON.stringify(l)))
      .join("\n"),
  );
  s = await bootServer({
    DNA_LEDGER_IMPORT: join(tmp, "ledger.jsonl"),
    DNA_PUBLISHED_DIR: archive,
  });
  const started = await s.cron.newsSweep({ requestId: "publishing:1" });
  await settledSweep(s.client, started.data.sweep!.id);
  await idle(s.client);
  cards = (await s.client.feed()).items;
});
after(async () => {
  await s.cleanup();
  rmSync(tmp, { recursive: true, force: true });
});

const fails = async (p: Promise<unknown>, status: number, pattern: RegExp) => {
  await assert.rejects(
    p,
    (e: unknown) => e instanceof DnaError && e.status === status && pattern.test(e.message),
  );
};

async function readyPick(card: Card) {
  const pick = await s.client.pick({ cardIds: [card.id], genre: "single" });
  await s.client.write(pick.id);
  await until(async () => (await s.client.drafts(pick.id)).length > 0, 20_000, "draft");
  await s.client.updatePick(pick.id, { status: "ready" });
  return pick;
}

test("the old ledger is imported once and spacing counts it", async () => {
  const ledger = await s.client.ledger();
  assert.equal(ledger.filter((e) => e.imported).length, 2);
  const state = await s.client.publishState();
  assert.ok(state.earliestAt && Date.parse(state.earliestAt) > Date.now());
  assert.equal(state.last?.draftKey, "2026-10-21-old.md");
});

test("rehearse, then publish with a reason inside the spacing; the pick is published and archived", async () => {
  const pick = await readyPick(cards[0]!);
  assert.equal(pick.id, 1);
  await s.client.publish(pick.id, { rehearsal: true });
  await until(async () => !!(await s.client.publishState(pick.id)).rehearsal, 10_000, "rehearsal");
  const rehearsed = await s.client.publishState(pick.id);
  assert.equal(rehearsed.rehearsal?.wouldPost, true);
  assert.equal(rehearsed.rehearsal?.clean, true);
  assert.equal(rehearsed.pick, undefined, "a rehearsal writes nothing to the ledger");

  await fails(s.client.publish(pick.id), 400, /minutes apart/);
  await s.client.publish(pick.id, { override: "测试插队" });
  await until(
    async () => (await s.client.picks()).find((p) => p.id === pick.id)?.status === "published",
    10_000,
    "published",
  );
  const mine = (await s.client.ledger()).filter((e) => e.draftKey === "pick:1");
  assert.deepEqual(
    mine.map((e) => e.status),
    ["ok", "pending"],
  );
  assert.match(mine[1]!.note ?? "", /测试插队/);
  await until(
    async () => (await s.client.publishState(pick.id)).reply?.status === "ok",
    10_000,
    "first reply",
  );
  const after = await s.client.publishState(pick.id);
  assert.deepEqual(
    (await s.client.ledger()).filter((e) => e.draftKey === "pick:1:reply").map((e) => e.status),
    ["ok", "pending"],
    "the first reply goes out right after the post, on its own ledger key",
  );
  assert.equal(after.last?.draftKey, "pick:1", "the first reply does not count toward spacing");
  assert.match(after.postUrl ?? "", /status\/\d+/);
  assert.equal(after.replyDue, undefined);
  await fails(s.client.replyAgain(pick.id), 400, /already went out/);
  const files = readdirSync(archive);
  assert.ok(
    files.some((f) => f.endsWith("-pick-1.md")) && files.some((f) => f.endsWith("-pick-1.png")),
  );
  assert.match(
    readFileSync(
      join(
        archive,
        files.find((f) => f.endsWith(".md"))!,
      ),
      "utf8",
    ),
    /published: true[\s\S]*原文链接在评论区[\s\S]*首条回复：\n原文：https?:\/\//,
    "the archive keeps the 原文 links, so selfPromotion's scout still sees them",
  );
  await fails(s.client.publish(pick.id, { override: "again" }), 400, /published/);
});

test("an unknown publish blocks the pick until a person acks it", async () => {
  const pick = await readyPick(cards[1]!);
  assert.equal(pick.id, 2);
  await fails(s.client.publish(pick.id, { override: "x" }), 400, /may have posted/);
  await fails(s.client.ack(1, { note: "nothing" }), 400, /nothing to ack/);
  await fails(s.client.replyAgain(pick.id), 400, /has not gone out/);
  const ack = await s.client.ack(pick.id, { note: "看过主页，没发出去" });
  assert.equal(ack.status, "ack");
  await s.client.publish(pick.id, { override: "测试" });
  await until(
    async () => (await s.client.publishState(pick.id)).pick?.status === "ok",
    10_000,
    "ok",
  );
  assert.ok(existsSync(archive));
});

test("a published pick moved back to 待发布 can be posted again; the ledger keeps both posts", async () => {
  await fails(s.client.updatePick(1, { status: "drafting" }), 400, /only go back to 待发布/);
  const reopened = await s.client.updatePick(1, { status: "ready" });
  assert.equal(reopened.status, "ready");
  assert.ok(reopened.reopenedAt);
  await s.client.publish(1, { override: "重发测试" });
  await until(
    async () => (await s.client.picks()).find((p) => p.id === 1)?.status === "published",
    10_000,
    "published again",
  );
  const oks = (await s.client.ledger()).filter((e) => e.draftKey === "pick:1" && e.status === "ok");
  assert.equal(oks.length, 2);
  await fails(s.client.publish(1, { override: "a third time" }), 400, /only a pick in 待发布/);
});

test("a ready pick goes in the publish line and out again over HTTP; leaving 待发布 drops its slot", async () => {
  const pick = await readyPick(cards[2]!);
  const { pick: queued } = await s.client.schedulePublish(pick.id);
  assert.equal(queued.scheduleMode, "queue");
  // Posts just went out above: the slot is at least 30 minutes away.
  assert.ok(Date.parse(queued.scheduledAt!) >= Date.now() + 29 * 60_000);
  const state = await s.client.publishState(pick.id);
  assert.ok(state.today && state.today.posts >= 1 && state.today.cap === 15);
  const out = await s.client.unschedulePublish(pick.id);
  assert.equal(out.scheduledAt, undefined);
  await fails(
    s.client.schedulePublish(pick.id, { at: new Date(Date.now() - 3_600_000).toISOString() }),
    400,
    /has passed/,
  );
  const at = new Date(Date.now() + 5 * 3_600_000).toISOString();
  const timed = await s.client.schedulePublish(pick.id, { at });
  assert.equal(timed.pick.scheduleMode, "time");
  const back = await s.client.updatePick(pick.id, { status: "drafting" });
  assert.equal(back.scheduledAt, undefined, "back to writing: out of the line");
});
