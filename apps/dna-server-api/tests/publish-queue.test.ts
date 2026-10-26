import assert from "node:assert/strict";
import { test } from "node:test";
import type { Deps } from "../src/deps.ts";
import { pickKey } from "../src/db/repos/ledger.ts";
import { DAILY_CAP, fakeX, Publisher } from "../src/publishing/publisher.ts";
import { tempStore, until } from "./helpers.ts";

const MIN = 60_000;
const BODY = "正文。\n\n原文链接在评论区。";
const REPLY = "原文：https://example.com/a";
const beijingDay = (t: number) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(new Date(t));

/** A publisher on a temp store, the offline poster, and a pinned random (0 gives 30 minute gaps, 0.5 gives 45). */
function setup(random = () => 0) {
  const t = tempStore();
  const notes: string[] = [];
  const quiet = () => {};
  const deps = {
    store: t.store,
    log: { info: quiet, warn: quiet, error: quiet, debug: quiet },
    config: { dataDir: t.dir },
    bus: { publish: quiet },
  } as unknown as Deps;
  const publisher = new Publisher(deps, fakeX, {
    notify: (title, text) => notes.push(`${title}|${text}`),
    random,
  });
  const ready = (title = "t") => {
    const pick = t.store.picks.create("quote", [], title);
    t.store.drafts.add({
      pickId: pick.id,
      body: BODY,
      reply: REPLY,
      quoteUrl: "https://x.com/a/status/1",
      author: "writer",
    });
    return t.store.picks.update(pick.id, { status: "ready" })!;
  };
  const posted = (key: string) => t.store.ledger.append({ draftKey: key, status: "ok" });
  return { ...t, publisher, ready, notes, posted };
}

const near = (iso: string | undefined, want: number, label: string) => {
  assert.ok(iso, `${label}: no time`);
  assert.ok(
    Math.abs(Date.parse(iso) - want) < 5_000,
    `${label}: ${iso} is not near ${new Date(want).toISOString()}`,
  );
};

const refused = (fn: () => unknown, pattern: RegExp) =>
  assert.throws(fn, (e: unknown) => e instanceof Error && pattern.test(e.message));

test("the queue takes a slot 30 to 60 minutes after the last post, clear of every other slot", () => {
  const s = setup(() => 0.5);
  try {
    const now = Date.now();
    s.posted("old");
    const a = s.ready("a");
    const b = s.ready("b");
    const c = s.ready("c");
    const first = s.publisher.schedule(a.id, undefined, now);
    assert.equal(first.pick.scheduleMode, "queue");
    near(first.pick.scheduledAt, now + 45 * MIN, "first slot");
    const second = s.publisher.schedule(b.id, undefined, now);
    near(second.pick.scheduledAt, now + 90 * MIN, "second slot");
    // A chosen time 50 minutes out sits within 30 minutes of both slots: it moves past them, exactly 30 after.
    const asked = new Date(now + 50 * MIN).toISOString();
    const third = s.publisher.schedule(c.id, asked, now);
    assert.equal(third.pick.scheduleMode, "time");
    near(third.pick.scheduledAt, now + 120 * MIN, "chosen time, moved");
    assert.equal(third.requested, asked);
    assert.deepEqual(
      s.store.picks.scheduled().map((p) => p.id),
      [a.id, b.id, c.id],
    );
  } finally {
    s.cleanup();
  }
});

test("only a clean ready pick goes in line, and not at a time that has passed", () => {
  const s = setup();
  try {
    const now = Date.now();
    const pick = s.ready();
    refused(
      () => s.publisher.schedule(pick.id, new Date(now - 10 * MIN).toISOString(), now),
      /has passed/,
    );
    refused(() => s.publisher.schedule(pick.id, "tomorrow", now), /not a time/);
    s.store.picks.update(pick.id, { status: "drafting" });
    refused(() => s.publisher.schedule(pick.id, undefined, now), /only a pick in 待发布/);
    s.store.picks.update(pick.id, { status: "ready" });
    s.store.drafts.add({
      pickId: pick.id,
      body: "看 https://example.com/x 原文链接在评论区",
      reply: REPLY,
      quoteUrl: "https://x.com/a/status/1",
      author: "reader",
    });
    refused(() => s.publisher.schedule(pick.id, undefined, now), /not ready/);
  } finally {
    s.cleanup();
  }
});

test("a due pick is posted by the timer, its reply follows, and the desktop hears about it", async () => {
  const s = setup();
  try {
    const now = Date.now();
    const pick = s.ready("排队测试");
    s.publisher.schedule(pick.id, new Date(now + MIN).toISOString(), now);
    assert.equal(await s.publisher.tick(now), undefined, "not due yet");
    assert.equal(await s.publisher.tick(now + 2 * MIN), pick.id);
    const after = s.store.picks.get(pick.id)!;
    assert.equal(after.status, "published");
    assert.equal(after.scheduledAt, undefined, "out of the line");
    assert.equal(s.store.ledger.state(pickKey(pick.id))?.status, "ok");
    assert.equal(s.store.ledger.state(`${pickKey(pick.id)}:reply`)?.status, "ok");
    assert.match(s.notes.join("\n"), /已发出\|排队测试，首条回复也发了/);
  } finally {
    s.cleanup();
  }
});

test("a due pick inside the spacing moves later instead of posting", async () => {
  const s = setup(() => 0);
  try {
    const now = Date.now();
    const pick = s.ready();
    s.store.picks.setSchedule(pick.id, new Date(now - MIN).toISOString(), "queue");
    s.posted("by-hand");
    assert.equal(await s.publisher.tick(now), pick.id);
    const moved = s.store.picks.get(pick.id)!;
    assert.equal(moved.status, "ready");
    near(moved.scheduledAt, now + 30 * MIN, "moved past the spacing");
    assert.equal(s.store.ledger.state(pickKey(pick.id)), undefined, "nothing posted");
  } finally {
    s.cleanup();
  }
});

test("the queue posts at most 15 a Beijing day; later slots go to the next day", () => {
  const s = setup();
  try {
    const now = Date.now();
    for (let i = 0; i < DAILY_CAP; i++) s.posted(`old-${i}`);
    const pick = s.ready();
    const result = s.publisher.schedule(pick.id, undefined, now);
    assert.ok(beijingDay(Date.parse(result.pick.scheduledAt!)) > beijingDay(now), "the next day");
    assert.equal(s.publisher.state(undefined, now).today?.posts, DAILY_CAP);
    // A chosen time later today (when today has an hour left) is refused rather than moved to another day.
    const later = now + 40 * MIN;
    if (beijingDay(later) === beijingDay(now))
      refused(
        () => s.publisher.schedule(s.ready().id, new Date(later).toISOString(), now),
        /already has 15/,
      );
  } finally {
    s.cleanup();
  }
});

test("a due pick the checks refuse is held with why; scheduling it again clears the hold", async () => {
  const s = setup();
  try {
    const now = Date.now();
    const pick = s.ready("被拦下");
    s.store.picks.setSchedule(pick.id, new Date(now - MIN).toISOString(), "queue");
    s.store.drafts.add({
      pickId: pick.id,
      body: "看 https://example.com/x 原文链接在评论区",
      reply: REPLY,
      quoteUrl: "https://x.com/a/status/1",
      author: "reader",
    });
    assert.equal(await s.publisher.tick(now), pick.id);
    const held = s.store.picks.get(pick.id)!;
    assert.match(held.scheduleHold ?? "", /发布前检查/);
    assert.match(s.notes.join("\n"), /没发出去\|被拦下：稿子没过发布前检查/);
    assert.equal(await s.publisher.tick(now + MIN), undefined, "a held pick waits for the reader");
    s.store.drafts.add({
      pickId: pick.id,
      body: BODY,
      reply: REPLY,
      quoteUrl: "https://x.com/a/status/1",
      author: "reader",
    });
    const again = s.publisher.schedule(pick.id, undefined, now);
    assert.equal(again.pick.scheduleHold, undefined);
  } finally {
    s.cleanup();
  }
});

test("a pick moved out of 待发布 leaves the line; publishing by hand takes it out too", async () => {
  const s = setup();
  try {
    const now = Date.now();
    const a = s.ready();
    s.store.picks.setSchedule(a.id, new Date(now - MIN).toISOString(), "queue");
    s.store.picks.update(a.id, { status: "drafting" });
    assert.equal(await s.publisher.tick(now), a.id);
    assert.equal(s.store.picks.get(a.id)!.scheduledAt, undefined);

    const b = s.ready();
    s.publisher.schedule(b.id, new Date(now + 3 * 3_600_000).toISOString(), now);
    s.publisher.publish(b.id, { now });
    assert.equal(s.store.picks.get(b.id)!.scheduledAt, undefined);
    await until(() => !s.publisher.state().running, 5_000, "the publish to finish");
  } finally {
    s.cleanup();
  }
});

test("taking a pick out of the line keeps it in 待发布", () => {
  const s = setup();
  try {
    const pick = s.ready();
    s.publisher.schedule(pick.id);
    const out = s.publisher.unschedule(pick.id);
    assert.equal(out.status, "ready");
    assert.equal(out.scheduledAt, undefined);
    assert.equal(out.scheduleMode, undefined);
  } finally {
    s.cleanup();
  }
});
