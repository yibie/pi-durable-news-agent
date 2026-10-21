<script setup lang="ts">
// A card's writing actions: pick it with a genre, join it to a roundup in the basket, or skip it.
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { CircleSlash, Layers, SquareCheck } from "@lucide/vue";
import { PICK_GENRES, type Card } from "@dna/sdk";
import {
  GENRE_HINTS,
  GENRE_NAMES,
  joinRoundup,
  pickCard,
  pickName,
  skipCard,
} from "../client/picks";
import { feedState } from "../client/store";

const props = defineProps<{ card: Card }>();
const open = ref<"pick" | "join">();
const root = ref<HTMLElement>();
const roundups = computed(() => feedState.value.picks.filter((p) => p.genre === "roundup"));

function close(e: PointerEvent) {
  if (open.value && !root.value?.contains(e.target as Node)) open.value = undefined;
}
onMounted(() => window.addEventListener("pointerdown", close));
onBeforeUnmount(() => window.removeEventListener("pointerdown", close));

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
      @click="open = open === 'pick' ? undefined : 'pick'"
    >
      <SquareCheck :size="13" /><span>选用</span>
    </button>
    <button
      class="pick-action"
      :aria-expanded="open === 'join'"
      aria-label="Add to a roundup"
      title="串烧：把这条加进一个主题串烧，或新建一个"
      @click="open = open === 'join' ? undefined : 'join'"
    >
      <Layers :size="13" /><span>串烧</span>
    </button>
    <button
      class="pick-action"
      aria-label="Skip this card"
      title="跳过：不写这条，从候选中移除，同类内容会少推一些"
      @click="skipCard(card)"
    >
      <CircleSlash :size="13" /><span>跳过</span>
    </button>
    <div v-if="open === 'pick'" class="pick-menu" role="menu" aria-label="Genre">
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
    <div v-if="open === 'join'" class="pick-menu" role="menu" aria-label="Roundups">
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
  </div>
</template>
