import assert from "node:assert/strict";
import { test } from "node:test";
import { join } from "node:path";
import type { Logger } from "@dna/sdk/node";
import { FeedModel } from "@dna/sdk";
import { Bus } from "../src/events.ts";
import { Judge } from "../src/news/hfs.ts";
import { fixtureDecide } from "../src/news/fixtures.ts";
import { StoryMatcher } from "../src/news/stories.ts";
import { shortlist, storyAction, type StoryVerdict } from "../src/news/story-policy.ts";
import { PROMPTS_DIR, tempStore } from "./helpers.ts";

const duplicate: StoryVerdict = {
  same: 0.98,
  covered: 0.98,
  development: 0.02,
  addition: 0.02,
  sufficient: 0.98,
};
const evidence: StoryVerdict = { ...duplicate, covered: 0.02, addition: 0.98 };
const development: StoryVerdict = { ...evidence, development: 0.98 };

test("story policy requires affirmative coverage and rejects ambiguity, missing evidence and conflicting answers", () => {
  assert.equal(storyAction(duplicate), "duplicate");
  assert.equal(storyAction(evidence), "evidence");
  assert.equal(storyAction(development), "development");
  assert.equal(storyAction({ ...duplicate, same: 0.1 }), "different");
  for (const partial of [
    { covered: 0.5 },
    { sufficient: 0.5 },
    { same: 0.5 },
    { addition: 0.95 },
    { development: 0.95 },
  ])
    assert.equal(storyAction({ ...duplicate, ...partial }), "uncertain");
  assert.equal(
    storyAction({
      ...duplicate,
      same: 0.85,
      covered: 0.85,
      sufficient: 0.8,
      addition: 0.2,
      development: 0.2,
    }),
    "duplicate",
  );
  assert.equal(storyAction({ ...duplicate, covered: 0.849 }), "uncertain");
});

function setup() {
  const tmp = tempStore();
  const { store } = tmp;
  // calls counts full five-question comparisons; screens counts the one-question `same` screens before them.
  let calls = 0;
  let screens = 0;
  let verdict = duplicate;
  let fail = false;
  const states: any[] = [];
  const fixture = fixtureDecide();
  const judge = new Judge({
    store,
    dir: join(PROMPTS_DIR, "jev"),
    decide: async (state, questions, opts) => {
      if (Object.keys(questions).length === 1) screens++;
      else calls++;
      if (fail) throw new Error("provider unavailable");
      states.push(state);
      const result = await fixture(state, questions, opts);
      result.answers = Object.fromEntries(
        Object.entries(verdict).map(([k, noul]) => [k, { type: "noul" as const, noul }]),
      );
      return result;
    },
  });
  const deps = {
    store,
    judge,
    bus: new Bus(),
    log: { warn() {}, info() {} } as unknown as Logger,
    http: {
      get: async () => {
        throw new Error("offline");
      },
      postJson: async () => {
        throw new Error("offline");
      },
    },
  };
  const item = (title: string, date = "2026-10-10T12:00:00.000Z") => {
    const url = `https://example.org/${encodeURIComponent(title)}`;
    const cached = store.sources.cache({
      url,
      title,
      contentMd:
        `${title}. ` +
        "Attributed technical evidence with explicit scope and supporting details. ".repeat(30),
      fetchVia: "http",
      ttlMinutes: 1440,
    });
    return store.news.upsertItem({
      url,
      title,
      excerpt: "Scion manages Anthropic source control.",
      publishedAt: date,
      cacheId: cached.id,
    }).item;
  };
  const card = (id: number) =>
    store.news.addCard({
      itemId: id,
      kind: "news",
      component: "brief",
      props: { title: store.news.item(id)!.title },
      toolCallId: `test:${id}`,
    }).card;
  return {
    ...tmp,
    deps,
    item,
    card,
    states,
    calls: () => calls,
    screens: () => screens,
    verdict: (v: StoryVerdict) => {
      verdict = v;
    },
    fail: () => {
      fail = true;
    },
  };
}

test("Scion headlines retrieve through excerpts and rare names below the old title threshold", () => {
  const s = setup();
  try {
    const a = s.item("Anthropic code merges reportedly rose tenfold since May");
    const b = s.item("Anthropic reportedly built Scion for AI-written code");
    const c = s.item("Anthropic builds in-house Git called Scion after code merges rise 12x");
    assert.deepEqual(new Set(shortlist(a, [b, c]).map((i) => i.id)), new Set([b.id, c.id]));
  } finally {
    s.cleanup();
  }
});

test("duplicate and evidence attach sources, a new development creates a timeline, and feed/search/SSE collapse the story", async () => {
  const s = setup();
  try {
    const matcher = new StoryMatcher(s.deps);
    const original = s.item("Scion introduced");
    const storyId = s.store.news.ensureStory(original);
    const first = s.card(original.id);
    const repeat = s.item("Another Scion introduction report");
    assert.equal(await matcher.classify(repeat, [original]), "duplicate");
    assert.equal(s.store.news.item(repeat.id)!.duplicateOf, original.id);
    assert.equal(s.store.news.card(first.id)!.sources!.length, 2);
    assert.equal(s.store.news.card(first.id)!.timeline, undefined);

    s.verdict(evidence);
    const explanation = s.item("Scion technical details");
    assert.equal(await matcher.classify(explanation, [original, repeat]), "evidence");
    assert.equal(s.store.news.membership(explanation.id)!.role, "evidence");
    assert.equal(s.store.news.cards().length, 1);

    s.verdict(development);
    const release = s.item("Scion public release", "2026-10-11T12:00:00.000Z");
    assert.equal(await matcher.classify(release, [original, repeat, explanation]), "development");
    const second = s.card(release.id);
    assert.deepEqual(
      s.store.news.cards().map((c) => c.id),
      [second.id],
    );
    assert.deepEqual(
      s.store.news.searchCards("search", "technical details").map((c) => c.id),
      [second.id],
    );
    assert.deepEqual(
      s.store.news.searchCards("url", repeat.url).map((c) => c.id),
      [second.id],
    );
    assert.deepEqual(
      s.store.news.timelineCards(storyId).map((c) => c.id),
      [first.id, second.id],
    );
    assert.equal(s.store.news.card(second.id)!.sources!.length, 4);
    const model = new FeedModel();
    model.load({ cards: [first] });
    model.apply({ type: "feed.card_updated", card: s.store.news.card(first.id)! });
    model.apply({ type: "feed.card", card: second });
    assert.deepEqual(
      model.state.news.map((c) => c.id),
      [second.id],
    );
    assert.equal(model.timeline(storyId).length, 2);
    model.load({ cards: s.store.news.timelineCards(storyId) });
    assert.equal(model.state.news.length, 1, "opening history does not restore hidden cards");
    for (let n = 0; n < 25; n++) s.store.news.ensureStory(s.item(`Unrelated singleton ${n}`));
    assert.equal(
      s.store.news.timelines(1)[0].id,
      storyId,
      "singletons cannot crowd out a timeline before pagination",
    );
    assert.equal(
      s.states.at(-1).existing.developments.length,
      3,
      "all known evidence participates",
    );
    assert.ok(s.states[0].candidate.article_text.length > 600);
  } finally {
    s.cleanup();
  }
});

test("pair verdicts survive a new matcher and changed evidence invalidates the memo", async () => {
  const s = setup();
  try {
    const a = s.item("Scion introduced"),
      b = s.item("Scion announcement");
    const matcher = new StoryMatcher(s.deps);
    await matcher.compare(b, a);
    await new StoryMatcher(s.deps).compare(b, a);
    assert.equal(s.calls(), 1);
    await new StoryMatcher(s.deps).compare(
      { ...b, excerpt: "A correction: the figure is 12x, not 10x." },
      a,
    );
    assert.equal(s.calls(), 2);
    assert.equal((s.store.db.prepare("SELECT count(*) n FROM story_decisions").get() as any).n, 2);
  } finally {
    s.cleanup();
  }
});

test("uncertainty and provider failure preserve candidates, and near-identical headlines cannot bypass Jev", async () => {
  const s = setup();
  try {
    const a = s.item("Scion is available to the public");
    s.store.news.ensureStory(a);
    s.card(a.id);
    s.verdict({ ...duplicate, covered: 0.4 });
    const b = s.item("Scion is not available to the public");
    assert.equal(await new StoryMatcher(s.deps).classify(b, [a]), "uncertain");
    assert.equal(s.store.news.item(b.id)!.status, "candidate");
    assert.notEqual(s.store.news.membership(b.id)!.storyId, s.store.news.membership(a.id)!.storyId);
    s.fail();
    const c = s.item("Scion availability unclear");
    await new StoryMatcher(s.deps).classify(c, [a]);
    assert.equal(s.store.news.item(c.id)!.status, "candidate");
  } finally {
    s.cleanup();
  }
});

test("history includes coverage beyond 48 hours and older than the first 200 results", () => {
  const s = setup();
  try {
    const old = s.item("Scion earliest report");
    s.card(old.id);
    s.store.db
      .prepare("UPDATE items SET created_at=?, updated_at=? WHERE id=?")
      .run(
        new Date(Date.now() - 7 * 86_400_000).toISOString(),
        new Date(Date.now() - 7 * 86_400_000).toISOString(),
        old.id,
      );
    for (let n = 0; n < 205; n++) s.card(s.item(`Other story ${n}`).id);
    assert.ok(s.store.news.storyHistory().some((i) => i.id === old.id));
  } finally {
    s.cleanup();
  }
});

test("new research reconsiders a singleton without suppressing an unresolved comparison", async () => {
  const s = setup();
  try {
    const original = s.item("Scion original report");
    s.store.news.ensureStory(original);
    s.card(original.id);
    const next = s.item("Scion repeated report");
    s.verdict({ ...duplicate, sufficient: 0.4 });
    await new StoryMatcher(s.deps).classify(next, [original]);
    assert.deepEqual(
      s.store.news.reviewMatches(next.id).map((i) => i.id),
      [original.id],
    );
    s.store.news.addFinding({
      itemId: next.id,
      summary: "The source confirms the same announcement and adds no new claims.",
      claims: [],
      evidence: [],
      claimSupport: [],
    });
    s.verdict(duplicate);
    assert.equal(
      await new StoryMatcher(s.deps).classify(
        s.store.news.item(next.id)!,
        [original],
        undefined,
        true,
      ),
      "duplicate",
    );
    assert.equal(
      s.store.news.membership(next.id)!.storyId,
      s.store.news.membership(original.id)!.storyId,
    );
    assert.equal(
      s.calls(),
      2,
      "research changed the evidence and invalidated the uncertain verdict",
    );
  } finally {
    s.cleanup();
  }
});

test("a clearly different pair is settled by the one-question screen, never the full five", async () => {
  const s = setup();
  try {
    const a = s.item("Scion introduced"),
      b = s.item("Scion announcement"),
      c = s.item("Scion released");
    s.verdict({ same: 0.05, development: 0.9, covered: 0.9, addition: 0.9, sufficient: 0.9 });
    const first = await new StoryMatcher(s.deps).compare(b, a);
    assert.equal(first.action, "different");
    assert.deepEqual([s.screens(), s.calls()], [1, 0], "the other four cannot change a different");
    s.verdict(duplicate);
    await new StoryMatcher(s.deps).compare(c, a);
    assert.deepEqual(
      [s.screens(), s.calls()],
      [2, 1],
      "a pair that may be the same is asked all five",
    );
  } finally {
    s.cleanup();
  }
});
