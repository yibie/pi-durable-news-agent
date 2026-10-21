import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { DnaError, FeedModel, type Card } from "@dna/sdk";
import { bootServer, idle, settledSweep, type Booted } from "./server.ts";

let s: Booted;
let cards: Card[];
before(async () => {
  s = await bootServer();
  const started = await s.cron.newsSweep({ requestId: "picks:1" });
  await settledSweep(s.client, started.data.sweep!.id);
  await idle(s.client);
  cards = (await s.client.feed()).items;
  assert.ok(cards.length >= 3, "the faux sweep presents at least three cards");
});
after(() => s.cleanup());

const fails = async (p: Promise<unknown>, status: number, pattern: RegExp) => {
  await assert.rejects(
    p,
    (e: unknown) => e instanceof DnaError && e.status === status && pattern.test(e.message),
  );
};

test("picking a card keeps its url and title, counts as show me more once, and holds the card", async () => {
  const [card] = cards;
  const pick = await s.client.pick({ cardIds: [card.id], genre: "single" });
  assert.equal(pick.genre, "single");
  assert.equal(pick.status, "selected");
  assert.deepEqual(
    pick.items.map((i) => ({ cardId: i.cardId, url: i.url, title: i.title })),
    [{ cardId: card.id, url: card.url, title: card.title }],
  );
  assert.equal((await s.client.card(card.id)).card.feedback?.signal, "more");
  assert.ok((await s.client.picks()).some((p) => p.id === pick.id));
  await fails(s.client.pick({ cardIds: [card.id], genre: "tool" }), 400, /already in pick/);
  await s.client.updatePick(pick.id, { status: "dropped" });
});

test("a roundup grows and shrinks, keeps one genre rule, and a dropped pick releases its cards", async () => {
  const [a, b, c] = cards;
  const roundup = await s.client.pick({ cardIds: [a.id, b.id], genre: "roundup", title: "Evals" });
  assert.deepEqual(
    roundup.items.map((i) => i.cardId),
    [a.id, b.id],
  );
  const grown = await s.client.updatePick(roundup.id, { addCardId: c.id });
  assert.deepEqual(
    grown.items.map((i) => i.cardId),
    [a.id, b.id, c.id],
  );
  await fails(s.client.updatePick(roundup.id, { genre: "single" }), 400, /holds one card/);
  const shrunk = await s.client.updatePick(roundup.id, { removeCardId: b.id });
  assert.deepEqual(
    shrunk.items.map((i) => i.cardId),
    [a.id, c.id],
  );
  const dropped = await s.client.updatePick(roundup.id, { status: "dropped" });
  assert.equal(dropped.status, "dropped");
  assert.ok(!(await s.client.picks()).some((p) => p.id === roundup.id));
  assert.ok((await s.client.picks("all")).some((p) => p.id === roundup.id));
  const again = await s.client.pick({ cardIds: [a.id], genre: "quote" });
  assert.equal(again.items[0].cardId, a.id);
  await s.client.updatePick(again.id, { status: "dropped" });
});

test("removing the last card drops the pick", async () => {
  const pick = await s.client.pick({ cardIds: [cards[1].id], genre: "tool" });
  const after = await s.client.updatePick(pick.id, { removeCardId: cards[1].id });
  assert.equal(after.status, "dropped");
  assert.equal(after.items.length, 0);
});

test("bad bodies are 400 and unknown ids are 404", async () => {
  await fails(s.client.pick({ cardIds: [cards[0].id], genre: "essay" as never }), 400, /genre/);
  await fails(s.client.pick({ cardIds: [], genre: "single" }), 400, /cardIds/);
  await fails(
    s.client.pick({ cardIds: [cards[0].id, cards[1].id], genre: "single" }),
    400,
    /holds one card/,
  );
  await fails(s.client.pick({ cardIds: [999_999], genre: "single" }), 404, /No card/);
  await fails(s.client.updatePick(999_999, { status: "dropped" }), 404, /No pick/);
  const pick = await s.client.pick({ cardIds: [cards[2].id], genre: "single" });
  await fails(s.client.updatePick(pick.id, {}), 400, /Send genre/);
  await fails(s.client.updatePick(pick.id, { removeCardId: cards[0].id }), 400, /is not in pick/);
  await s.client.updatePick(pick.id, { status: "dropped" });
});

test("pick frames reach the feed model: a new pick shows, a dropped one leaves", async () => {
  const feed = new FeedModel();
  const stop = new AbortController();
  const reading = (async () => {
    try {
      for await (const frame of s.client.stream(stop.signal)) feed.apply(frame);
    } catch {}
  })();
  const until = async (check: () => boolean, what: string, ms = 10_000) => {
    const end = Date.now() + ms;
    while (!check()) {
      if (Date.now() > end) throw new Error(`Timed out waiting for ${what}`);
      await new Promise((r) => setTimeout(r, 25));
    }
  };
  await new Promise((r) => setTimeout(r, 200));
  const pick = await s.client.pick({ cardIds: [cards[0].id], genre: "single" });
  await until(() => feed.state.picks.some((p) => p.id === pick.id), "the pick frame");
  assert.equal(feed.pickOf(cards[0].id)?.id, pick.id);
  await s.client.updatePick(pick.id, { status: "dropped" });
  await until(() => !feed.state.picks.some((p) => p.id === pick.id), "the dropped frame");
  stop.abort();
  await reading;
});
