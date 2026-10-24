<script setup lang="ts">
// A card's writing actions: pick it with a genre, join it to a roundup in the basket, or dismiss it from the candidates
// (dismissing only tidies the list; Show me less is the button that lowers weights).
// The menus are teleported to <body> and placed beside the button: cards clip their overflow (fixed height, faded
// summary), so a menu drawn inside the card lost its last option at the card's bottom edge.
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from "vue";
import { Layers, ListX, SquareCheck } from "@lucide/vue";
import { PICK_GENRES, type Card } from "@dna/sdk";
import {
  GENRE_HINTS,
  GENRE_NAMES,
  dismissCard,
  joinRoundup,
  pickCard,
  pickName,
} from "../client/picks";
import { feedState } from "../client/store";

const props = defineProps<{ card: Card }>();
const open = ref<"pick" | "join">();
const root = ref<HTMLElement>();
const menu = ref<HTMLElement>();
const place = ref<Record<string, string>>({});
const roundups = computed(() => feedState.value.picks.filter((p) => p.genre === "roundup"));

const GAP = 4;
const EDGE = 8;

// Below the button when it fits, else above; if neither fits, the roomier side with a scrollbar. Horizontally it
// starts at the button and is pulled back inside the window.
async function toggle(which: "pick" | "join", e: MouseEvent) {
  if (open.value === which) return (open.value = undefined);
  const button = (e.currentTarget as HTMLElement).getBoundingClientRect();
  open.value = which;
  place.value = { top: `${button.bottom + GAP}px`, left: `${button.left}px`, visibility: "hidden" };
  await nextTick();
  const el = menu.value;
  if (!el) return;
  const { width, height } = el.getBoundingClientRect();
  const below = innerHeight - button.bottom - GAP - EDGE;
  const above = button.top - GAP - EDGE;
  const left = Math.max(EDGE, Math.min(button.left, innerWidth - width - EDGE));
  const next: Record<string, string> = { left: `${left}px` };
  if (height <= below || below >= above) {
    next.top = `${button.bottom + GAP}px`;
    if (height > below) next.maxHeight = `${below}px`;
  } else {
    next.top = `${Math.max(EDGE, button.top - GAP - height)}px`;
    if (height > above) next.maxHeight = `${above}px`;
  }
  place.value = next;
}

const dismiss = () => (open.value = undefined);
function close(e: PointerEvent) {
  const t = e.target as Node;
  if (open.value && !root.value?.contains(t) && !menu.value?.contains(t)) dismiss();
}
function onKey(e: KeyboardEvent) {
  if (open.value && e.key === "Escape") dismiss();
}
// A fixed menu would float away from its card when the list scrolls, so scrolling closes it.
function onScroll(e: Event) {
  if (open.value && !menu.value?.contains(e.target as Node)) dismiss();
}
onMounted(() => {
  window.addEventListener("pointerdown", close);
  window.addEventListener("keydown", onKey);
  window.addEventListener("scroll", onScroll, true);
  window.addEventListener("resize", dismiss);
});
onBeforeUnmount(() => {
  window.removeEventListener("pointerdown", close);
  window.removeEventListener("keydown", onKey);
  window.removeEventListener("scroll", onScroll, true);
  window.removeEventListener("resize", dismiss);
});

const run = async (fn: () => Promise<void>) => {
  open.value = undefined;
  await fn();
};
</script>

<template>
  <div ref="root" class="pick-bar" data-cap="picks">
    <button
      class="pick-action"
      :aria-expanded="open === 'pick'"
      aria-label="Pick for writing"
      title="选用：选这条来写，并定下体裁"
      @click="toggle('pick', $event)"
    >
      <SquareCheck :size="13" /><span>选用</span>
    </button>
    <button
      class="pick-action"
      :aria-expanded="open === 'join'"
      aria-label="Add to a roundup"
      title="串烧：把这条加进一个主题串烧，或新建一个"
      @click="toggle('join', $event)"
    >
      <Layers :size="13" /><span>串烧</span>
    </button>
    <button
      class="pick-action"
      aria-label="Dismiss this card"
      title="移出：从候选里拿掉这条。只是整理列表，不影响以后推荐什么；想少看同类内容，用下面的 👎"
      @click="dismissCard(card)"
    >
      <ListX :size="13" /><span>移出</span>
    </button>
    <Teleport to="body">
      <div
        v-if="open === 'pick'"
        ref="menu"
        class="pick-menu floating"
        role="menu"
        aria-label="Genre"
        :style="place"
      >
        <button
          v-for="g in PICK_GENRES"
          :key="g"
          role="menuitem"
          :data-genre="g"
          @click="run(() => pickCard(props.card, g))"
        >
          <strong>{{ GENRE_NAMES[g] }}</strong
          ><small>{{ GENRE_HINTS[g] }}</small>
        </button>
      </div>
      <div
        v-if="open === 'join'"
        ref="menu"
        class="pick-menu floating"
        role="menu"
        aria-label="Roundups"
        :style="place"
      >
        <button
          v-for="p in roundups"
          :key="p.id"
          role="menuitem"
          :data-pick="p.id"
          @click="run(() => joinRoundup(props.card, p))"
        >
          <strong>加入「{{ pickName(p) }}」</strong><small>现在 {{ p.items.length }} 条</small>
        </button>
        <button
          role="menuitem"
          data-genre="roundup"
          @click="run(() => pickCard(props.card, 'roundup'))"
        >
          <strong>新建串烧</strong><small>从这条开始，之后再往里加</small>
        </button>
      </div>
    </Teleport>
  </div>
</template>
