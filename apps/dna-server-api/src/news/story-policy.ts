import type { Item } from "../db/repos/news.ts";

export interface StoryVerdict {
  same: number;
  development: number;
  covered: number;
  addition: number;
  sufficient: number;
}
/**
 * Only `same` was asked: it came back at or below the no threshold, where the other four answers cannot change the
 * action (different). Most comparisons end here, so dedupe asks one question instead of five for them.
 */
export interface ScreenedVerdict {
  same: number;
  screened: true;
}
export type StoryAction = "different" | "duplicate" | "evidence" | "development" | "uncertain";
export const STORY_THRESHOLDS = { same: 0.85, yes: 0.85, no: 0.2, sufficient: 0.8 };

/** Suppression requires an affirmative coverage judgment and enough evidence. Conflicting answers stay open. */
export function storyAction(v: StoryVerdict | ScreenedVerdict, t = STORY_THRESHOLDS): StoryAction {
  if (v.same <= t.no) return "different";
  // A screened verdict above the no threshold only happens if the threshold was raised since: not enough to act on.
  if ("screened" in v) return "uncertain";
  if (v.same < t.same || v.sufficient < t.sufficient) return "uncertain";
  if (v.development >= t.yes && v.covered <= t.no) return "development";
  if (v.development <= t.no && v.addition >= t.yes && v.covered <= t.no) return "evidence";
  if (v.covered >= t.yes && v.development <= t.no && v.addition <= t.no) return "duplicate";
  return "uncertain";
}

const STOP = new Set(
  "the and for with from that this have has was are its into about after before more new says said report reportedly reports built builds code ai how why what when since their will can all not but out now than over our your they been also only first latest use using released release launches launch".split(
    " ",
  ),
);
const words = (s: string) =>
  new Set(
    s
      .toLowerCase()
      .match(/[a-z0-9][a-z0-9.-]{2,}/g)
      ?.filter((w) => !STOP.has(w)) ?? [],
  );

/** Title overlap is a retrieval signal only. Excerpts and rare entity names recover differently worded reports. */
export function shortlist(candidate: Item, others: Item[], limit = 12): Item[] {
  const query = words(`${candidate.title} ${candidate.excerpt ?? ""}`);
  const docs = others
    .filter((i) => i.id !== candidate.id)
    .map((item) => ({ item, terms: words(`${item.title} ${item.excerpt ?? ""}`) }));
  const frequency = new Map<string, number>();
  for (const d of docs)
    for (const term of d.terms) frequency.set(term, (frequency.get(term) ?? 0) + 1);
  return docs
    .map((d) => {
      const shared = [...query].filter((w) => d.terms.has(w));
      const score = shared.reduce(
        (n, w) => n + Math.log(1 + docs.length / (frequency.get(w) ?? 1)),
        0,
      );
      return { ...d, score, shared: shared.length };
    })
    .filter((d) => d.shared > 0)
    .sort((a, b) => b.score - a.score || b.item.id - a.item.id)
    .slice(0, limit)
    .map((d) => d.item);
}
