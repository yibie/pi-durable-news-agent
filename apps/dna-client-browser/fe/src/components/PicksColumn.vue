<script setup lang="ts">
// 选题篮: one tab per stage (已选, 写作中, 待发布, 已发布), newest first in each. Each pick shows its genre
// (changeable), its cards with links, lets a card leave a roundup or the whole pick go back to News, and opens into
// its draft (PickDetail) under the tabs, with its writer in the agent column. The tab follows the open pick's stage,
// and any tab goes back to its list. 待发布 says when the next post may go.
import { computed, watch } from "vue";
import { FileText, ListChecks, Undo2, X } from "@lucide/vue";
import { PICK_GENRES, type PickGenre } from "@dna/sdk";
import { layout, PICK_STAGES, type PickStage } from "../client/layout";
import {
  dropPick,
  GENRE_HINTS,
  GENRE_NAMES,
  pickName,
  removeFromPick,
  setGenre,
} from "../client/picks";
import { feedState, now } from "../client/store";
import { clean } from "../client/text";
import { beijingTime } from "../client/time";
import { closeWriting, loadSpacing, openPick, openWriting, spacing } from "../client/writing";
import PickDetail from "./PickDetail.vue";

const STAGES: Record<PickStage, { name: string; hint: string; empty: string }> = {
  selected: {
    name: "已选",
    hint: "选好了还没开始写",
    empty: "没有待写的选题。在候选卡片上点「选用」定体裁，或点「串烧」把几条归成一组。",
  },
  drafting: {
    name: "写作中",
    hint: "写手在写，或者你在改",
    empty: "没有在写的稿子。在「已选」里点开一个题，在右边开始写。",
  },
  ready: {
    name: "待发布",
    hint: "稿子定了，等发布",
    empty: "没有待发布的稿子。稿子定了以后，在稿子下面点「进入待发布」。",
  },
  published: {
    name: "已发布",
    hint: "已经发出去了",
    empty: "还没有经工作台发出的帖子。",
  },
};
const count = (s: PickStage) => feedState.value.picks.filter((p) => p.status === s).length;
const shown = computed(() => feedState.value.picks.filter((p) => p.status === layout.picksTab));

function showStage(s: PickStage) {
  layout.picksTab = s;
  closeWriting();
}

const running = computed(() => {
  const r = spacing.value.running;
  return r ? feedState.value.picks.find((p) => p.id === r.pickId) : undefined;
});
const waitUntil = computed(() => {
  const at = spacing.value.earliestAt;
  return at && Date.parse(at) > now.value ? at : undefined;
});
watch(
  () => layout.picksTab,
  (tab) => tab === "ready" && void loadSpacing(),
  { immediate: true },
);
</script>

<template>
  <section class="column picks-column" data-col="picks" data-cap="picks" aria-label="Picks">
    <div class="picks-bar">
      <span
        class="picks-mark"
        title="选题篮：按阶段分开的选题。点开一个题，这里看稿子，右边和写手对话"
        ><ListChecks :size="16"
      /></span>
      <nav class="picks-tabs" role="tablist" aria-label="Pick stages">
        <button
          v-for="s in PICK_STAGES"
          :key="s"
          role="tab"
          class="picks-tab"
          :data-stage-tab="s"
          :aria-selected="layout.picksTab === s"
          :title="
            openPick && layout.picksTab === s ? `回到「${STAGES[s].name}」列表` : STAGES[s].hint
          "
          @click="showStage(s)"
        >
          <span>{{ STAGES[s].name }}</span
          ><small>{{ count(s) }}</small>
        </button>
      </nav>
    </div>
    <div v-if="openPick" class="picks-list"><PickDetail /></div>
    <div v-else class="picks-list" :data-stage-list="layout.picksTab">
      <p v-if="layout.picksTab === 'ready'" class="picks-spacing">
        <template v-if="running">正在发布：{{ pickName(running) }}</template>
        <template v-else-if="waitUntil"
          >最早 {{ beijingTime(waitUntil) }} 可以发下一条（北京时间，两条之间隔 30 分钟）</template
        >
        <template v-else>现在就可以发下一条</template>
      </p>
      <p v-if="!shown.length" class="picks-empty">{{ STAGES[layout.picksTab].empty }}</p>
      <article v-for="p in shown" :key="p.id" class="pick" :class="p.genre" :data-pick-id="p.id">
        <header class="pick-head">
          <select
            class="pick-genre"
            :value="p.genre"
            aria-label="Pick genre"
            :title="`体裁：${GENRE_HINTS[p.genre]}`"
            @change="setGenre(p, ($event.target as HTMLSelectElement).value as PickGenre)"
          >
            <option v-for="g in PICK_GENRES" :key="g" :value="g">{{ GENRE_NAMES[g] }}</option>
          </select>
          <small v-if="p.genre === 'roundup'" class="pick-count">{{ p.items.length }} 条</small>
          <span class="grow" />
          <button
            class="pick-open"
            data-cap="writing"
            aria-label="Open the draft"
            :title="
              p.conversationId ? '打开稿子：左边看稿子，右边和写手对话' : '打开：开始写这个题'
            "
            @click="openWriting(p)"
          >
            <FileText :size="13" /><span>{{ p.conversationId ? "稿子" : "写" }}</span>
          </button>
          <button
            v-if="p.status !== 'published'"
            class="pick-drop"
            aria-label="Put the pick back"
            title="放回候选：这个题不写了，卡片回到候选栏"
            @click="dropPick(p)"
          >
            <Undo2 :size="13" /><span>放回</span>
          </button>
        </header>
        <ol class="pick-items">
          <li v-for="i in p.items" :key="i.cardId" :data-pick-card="i.cardId">
            <div class="pick-item-text">
              <a v-if="i.url" class="pick-title" :href="i.url" target="_blank" rel="noopener">{{
                clean(i.title)
              }}</a>
              <span v-else class="pick-title">{{ clean(i.title) }}</span>
              <small v-if="i.sourceName">{{ clean(i.sourceName) }}</small>
            </div>
            <button
              v-if="p.items.length > 1"
              class="icon-button small"
              aria-label="Remove from the pick"
              title="移出这一组，卡片回到候选栏"
              @click="removeFromPick(p, i.cardId)"
            >
              <X :size="13" />
            </button>
          </li>
        </ol>
      </article>
    </div>
  </section>
</template>
