<script setup lang="ts">
// 选题篮: the picks being written, newest first. Each pick shows its genre (changeable), its cards with links, and
// lets a card leave a roundup or the whole pick go back to News.
import { ListChecks, Undo2, X } from "@lucide/vue";
import { PICK_GENRES, type PickGenre } from "@dna/sdk";
import { dropPick, GENRE_HINTS, GENRE_NAMES, removeFromPick, setGenre } from "../client/picks";
import { feedState } from "../client/store";
import { clean } from "../client/text";
</script>

<template>
  <section class="column picks-column" data-col="picks" data-cap="picks" aria-label="Picks">
    <div class="picks-bar" title="选题篮：选好要写的题，按体裁分好。写稿和发布暂时在对话里做">
      <ListChecks :size="15" /><span>选题篮</span><small>{{ feedState.picks.length }}</small>
    </div>
    <div class="picks-list">
      <p v-if="!feedState.picks.length" class="picks-empty">
        还没有选题。在候选卡片上点「选用」定体裁，或点「串烧」把几条归成一组。
      </p>
      <article
        v-for="p in feedState.picks"
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
