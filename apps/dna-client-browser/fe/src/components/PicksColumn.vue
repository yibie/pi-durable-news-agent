<script setup lang="ts">
// 选题篮: the picks grouped by stage (已选, 写作中, 待发布, 已发布), newest first in each. Each pick shows its genre
// (changeable), its cards with links, lets a card leave a roundup or the whole pick go back to News, and opens into
// its draft (PickDetail) with its writer in the agent column.
import { computed } from "vue";
import { FileText, ListChecks, Undo2, X } from "@lucide/vue";
import { PICK_GENRES, type PickGenre, type PickStatus } from "@dna/sdk";
import { dropPick, GENRE_HINTS, GENRE_NAMES, removeFromPick, setGenre } from "../client/picks";
import { feedState } from "../client/store";
import { clean } from "../client/text";
import { openPick, openWriting } from "../client/writing";
import PickDetail from "./PickDetail.vue";

const STAGES: { status: PickStatus; name: string; hint: string }[] = [
  { status: "selected", name: "已选", hint: "选好了还没开始写" },
  { status: "drafting", name: "写作中", hint: "写手在写，或者你在改" },
  { status: "ready", name: "待发布", hint: "稿子定了，等发布" },
  { status: "published", name: "已发布", hint: "已经发出去了" },
];
const stages = computed(() =>
  STAGES.map((s) => ({
    ...s,
    picks: feedState.value.picks.filter((p) => p.status === s.status),
  })).filter((s) => s.picks.length),
);
</script>

<template>
  <section class="column picks-column" data-col="picks" data-cap="picks" aria-label="Picks">
    <div class="picks-bar" title="选题篮：按阶段排好的选题。点开一个题，左边看稿子，右边和写手对话">
      <ListChecks :size="15" /><span>选题篮</span><small>{{ feedState.picks.length }}</small>
    </div>
    <div v-if="openPick" class="picks-list"><PickDetail /></div>
    <div v-else class="picks-list">
      <p v-if="!feedState.picks.length" class="picks-empty">
        还没有选题。在候选卡片上点「选用」定体裁，或点「串烧」把几条归成一组。
      </p>
      <template v-for="stage in stages" :key="stage.status">
        <h4 class="pick-stage-head" :data-stage="stage.status" :title="stage.hint">
          {{ stage.name }}<small>{{ stage.picks.length }}</small>
        </h4>
        <article
          v-for="p in stage.picks"
          :key="p.id"
          class="pick"
          :class="p.genre"
          :data-pick-id="p.id"
        >
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
      </template>
    </div>
  </section>
</template>
