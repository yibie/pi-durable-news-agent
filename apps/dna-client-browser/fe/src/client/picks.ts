// Picks in the browser: genre names and hints for the writing workflow, and the actions the card and the basket share.
import type { Card, PickGenre, TopicPick } from "@dna/sdk";
import { clean } from "./text";
import { layout } from "./layout";
import { api, attempt, feed, notify } from "./store";
import { openPickId } from "./writing";

export const GENRE_NAMES: Record<PickGenre, string> = {
  single: "单篇",
  roundup: "主题串烧",
  tool: "工具推荐",
  quote: "引用转发",
};

export const GENRE_HINTS: Record<PickGenre, string> = {
  single: "一条素材，写成一张论证图加正文",
  roundup: "几条素材回答同一个问题，合成一篇",
  tool: "素材是工具或 repo，一两句说明加截图",
  quote: "引用一条推文转发，加上自己的话",
};

/** A pick's name in the basket: its title, or its first card's title. */
export const pickName = (p: TopicPick) => clean(p.title ?? p.items[0]?.title ?? `选题 ${p.id}`);

/** Apply the pick the API returned at once; the pick frame that follows changes nothing. */
const applied = (p: TopicPick | undefined) => {
  if (p) feed.apply({ type: "pick", pick: p });
  return p;
};

export async function pickCard(card: Card, genre: PickGenre) {
  const p = applied(await attempt(() => api.pick({ cardIds: [card.id], genre })));
  if (!p) return;
  // Show the new pick, unless the reader is in the middle of another one.
  if (openPickId.value === undefined) layout.picksTab = "selected";
  notify(`已选用为${GENRE_NAMES[genre]}，放进选题篮`);
}

export async function joinRoundup(card: Card, pick: TopicPick) {
  const p = applied(await attempt(() => api.updatePick(pick.id, { addCardId: card.id })));
  if (p) notify(`已加入串烧「${pickName(p)}」，现在 ${p.items.length} 条`);
}

/** Take one candidate out of News. Unlike Show me less it moves no weights: it only tidies the list. */
export async function dismissCard(card: Card) {
  const r = await attempt(() => api.dismiss(card.id));
  if (r) {
    feed.apply({ type: "feed.card_updated", card: r });
    notify("已移出候选，不影响以后推荐什么");
  }
}

/** Clear the candidates: all of them, or those published more than `olderThanHours` ago. Picked cards stay. */
export async function clearCandidates(olderThanHours?: number) {
  const r = await attempt(() => api.clearFeed(olderThanHours ? { olderThanHours } : {}));
  if (r) notify(`已移出 ${r.dismissed.length} 条候选，不影响以后推荐什么`);
}

export async function setGenre(pick: TopicPick, genre: PickGenre) {
  const p = applied(await attempt(() => api.updatePick(pick.id, { genre })));
  if (p) notify(`改成${GENRE_NAMES[genre]}`);
}

export async function removeFromPick(pick: TopicPick, cardId: number) {
  const p = applied(await attempt(() => api.updatePick(pick.id, { removeCardId: cardId })));
  if (p) notify(p.status === "dropped" ? "选题已空，放回候选" : "已移出，卡片回到候选");
}

export async function dropPick(pick: TopicPick) {
  const p = applied(await attempt(() => api.updatePick(pick.id, { status: "dropped" })));
  if (p) notify("已放回候选");
}
