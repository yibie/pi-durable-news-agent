// Column layout and feed tabs in localStorage["dna.layout.v1"]: News, the picks basket and the agent each collapse to
// zero width, but one always stays open.
// The News tab is always first. Timeline tabs open from a card's timeline chip; search, keyword and url tabs open from
// the search box or when the agent calls open_tab. highlight_item switches to News and flashes one card.
import { nextTick, reactive, ref, watch } from "vue";
import type { TabBy } from "@dna/sdk";
import { notify, onFrame } from "./store";

export type FeedTab =
  | { kind: "timeline"; id: number; title: string }
  | { kind: TabBy; value: string };

/** A tab's key, also its data-tab attribute: timeline-12, search-durable agents, url-example.com. */
export const tabKey = (t: FeedTab) =>
  t.kind === "timeline" ? `timeline-${t.id}` : `${t.kind}-${t.value.toLowerCase()}`;

export interface Layout {
  feed: boolean;
  /** The picks basket (选题篮), between News and the agent. */
  picks: boolean;
  agent: boolean;
  agentWidth: number;
  /** The composer's Model toggle: model and thinking controls shown. */
  modelBar: boolean;
  /** Open tabs, after the News tab. */
  tabs: FeedTab[];
  /** The active tab: "news" or a tab key. */
  tab: string;
}

export const LAYOUT_KEY = "dna.layout.v1";
const DEFAULTS: Layout = {
  feed: true,
  picks: true,
  agent: true,
  agentWidth: 560,
  modelBar: false,
  tabs: [],
  tab: "news",
};

function load(): Layout {
  try {
    const saved = JSON.parse(localStorage.getItem(LAYOUT_KEY) ?? "{}") as Record<string, any>;
    const merged = { ...DEFAULTS, ...saved } as Layout;
    if (!merged.feed && !merged.picks && !merged.agent) merged.feed = true;
    // Earlier layouts kept timeline tabs as { id, title } and the active timeline as its id.
    merged.tabs = (Array.isArray(merged.tabs) ? merged.tabs : [])
      .map((t: any) => (t.kind ? t : { kind: "timeline", id: t.id, title: t.title }))
      .filter((t: any) =>
        t.kind === "timeline" ? Number.isInteger(t.id) : typeof t.value === "string",
      );
    if (typeof merged.tab === "number") merged.tab = `timeline-${merged.tab}`;
    if (merged.tab !== "news" && !merged.tabs.some((t) => tabKey(t) === merged.tab))
      merged.tab = "news";
    delete (merged as Partial<Layout> & { storiesSplit?: number }).storiesSplit;
    return merged;
  } catch {
    return { ...DEFAULTS };
  }
}

export const layout = reactive<Layout>(load());
watch(layout, (value) => localStorage.setItem(LAYOUT_KEY, JSON.stringify(value)), { deep: true });

export type Column = "feed" | "picks" | "agent";
const COLUMNS: Column[] = ["feed", "picks", "agent"];

export function toggle(column: Column): boolean {
  if (layout[column] && COLUMNS.every((c) => c === column || !layout[c])) {
    notify("至少保留一栏");
    return false;
  }
  layout[column] = !layout[column];
  return true;
}

/** Open a tab (or switch to it), opening the news column if it is closed. */
export function openTab(t: FeedTab) {
  const key = tabKey(t);
  const open = layout.tabs.find((x) => tabKey(x) === key);
  if (!open) layout.tabs.push(t);
  else if (open.kind === "timeline" && t.kind === "timeline") open.title = t.title;
  layout.tab = key;
  layout.feed = true;
}

export const openTimeline = (t: { id: number; title: string }) =>
  openTab({ kind: "timeline", id: t.id, title: t.title });

/** The search box edits the active search tab, or opens one. */
export function searchFor(value: string) {
  const active = layout.tabs.find((t) => tabKey(t) === layout.tab);
  if (active?.kind === "search") {
    const key = tabKey({ kind: "search", value });
    const dupe = layout.tabs.find((t) => t !== active && tabKey(t) === key);
    if (dupe) layout.tabs.splice(layout.tabs.indexOf(active), 1);
    else active.value = value;
    layout.tab = key;
  } else openTab({ kind: "search", value });
}

export function closeTab(key: string) {
  const i = layout.tabs.findIndex((t) => tabKey(t) === key);
  if (i < 0) return;
  layout.tabs.splice(i, 1);
  if (layout.tab === key) {
    const next = layout.tabs[Math.min(i, layout.tabs.length - 1)];
    layout.tab = next ? tabKey(next) : "news";
  }
}

/** The card the agent pointed at, highlighted for a few seconds. */
export const highlighted = ref<number>();
let highlightTimer: ReturnType<typeof setTimeout> | undefined;

/** Switch to News, scroll the card to the middle of the list and highlight it. */
export function highlight(cardId: number) {
  layout.feed = true;
  layout.tab = "news";
  highlighted.value = cardId;
  clearTimeout(highlightTimer);
  highlightTimer = setTimeout(() => (highlighted.value = undefined), 4000);
  const row = () => document.querySelector(`.feed-list [data-row="${cardId}"]`);
  // After the News list mounts and pins itself to the bottom, then once more if images moved it.
  void nextTick(() =>
    setTimeout(() => row()?.scrollIntoView({ block: "center", behavior: "smooth" }), 120),
  );
  setTimeout(() => {
    const r = row()?.getBoundingClientRect();
    if (r && (r.bottom < 0 || r.top > window.innerHeight))
      row()?.scrollIntoView({ block: "center" });
  }, 900);
}

onFrame((frame) => {
  if (frame.type === "ui.open_tab") openTab({ kind: frame.by, value: frame.value });
  if (frame.type === "ui.highlight") highlight(frame.card.id);
});
