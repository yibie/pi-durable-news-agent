<script setup lang="ts">
// Every card, one fixed height in a wide column: the image (3:2, links to the source; a skeleton while it generates),
// then the source's icon, the timeline chip, the pick buttons and links, and in the top right corner how fresh it is;
// then the generative body (clamped), H/F/S and feedback.
import { computed, ref } from "vue";
import { ExternalLink, GitCommitVertical, ImageOff, Info, MessageSquareQuote } from "@lucide/vue";
import type { Card } from "@dna/sdk";
import { openTimeline } from "../../client/layout";
import { clean } from "../../client/text";
import { now, referenceInChat, ui } from "../../client/store";
import { cardWhen } from "../../client/time";
import FeedbackBar from "../FeedbackBar.vue";
import HfsPill from "../HfsPill.vue";
import PickBar from "../PickBar.vue";
import SourceIcon from "../SourceIcon.vue";
import { cardComponent } from "./registry";

const props = defineProps<{ card: Card }>();
const body = computed(() => cardComponent(props.card.component));
const broken = ref(false);
const when = computed(() => cardWhen(props.card.publishedAt, props.card.createdAt, now.value));
/** Drop "card 22 "Title"" into the composer so the agent knows exactly which card you mean. */
const reference = () => referenceInChat(`card ${props.card.id} "${clean(props.card.title)}"`);
/** The title and the source open the article in a new tab. */
function openFromBody(e: MouseEvent) {
  if (!props.card.url) return;
  if ((e.target as HTMLElement).closest(".card-title"))
    window.open(props.card.url, "_blank", "noopener");
}
const image = computed(() =>
  props.card.image?.status === "ready" && !broken.value
    ? `/api/v1/images/${props.card.image.id}`
    : undefined,
);
</script>

<template>
  <article
    class="card"
    :class="card.component"
    :data-card-id="card.id"
    :data-kind="card.kind"
    :data-component="card.component"
  >
    <a
      class="card-media"
      :class="{ skeleton: card.image?.status === 'pending', empty: !image }"
      :href="card.url"
      target="_blank"
      rel="noopener"
      :aria-label="`Open the source: ${clean(card.title)}`"
      :title="card.url ? `Open ${card.sourceName ?? 'the source'}` : undefined"
    >
      <img v-if="image" :src="image" alt="" loading="lazy" @error="broken = true" />
      <ImageOff v-else-if="card.image?.status !== 'pending'" :size="22" />
    </a>
    <div class="card-content">
      <div class="card-meta">
        <SourceIcon :card="card" />
        <button
          v-if="card.timeline"
          class="timeline-chip"
          data-cap="timelines.read"
          :aria-label="`Open the ${clean(card.timeline.title)} timeline, item ${card.timeline.index} of ${card.timeline.count}`"
          :title="`Timeline: ${clean(card.timeline.title)}`"
          @click="openTimeline(card.timeline)"
        >
          <GitCommitVertical :size="13" /><span>Timeline</span
          ><strong>{{ card.timeline.index }}/{{ card.timeline.count }}</strong>
        </button>
        <button
          v-if="(card.sources?.length ?? 0) > 1"
          class="timeline-chip"
          :aria-label="`Open ${card.sources!.length} story sources`"
          @click="ui.card = card.id"
        >
          {{ card.sources!.length }} sources
        </button>
        <div class="card-actions">
          <PickBar :card="card" />
          <button
            class="icon-button small"
            aria-label="Reference in chat"
            title="在对话里引用这张卡：把卡片编号和标题放进右边的输入框"
            @click="reference"
          >
            <MessageSquareQuote :size="14" />
          </button>
          <button
            class="icon-button small"
            data-cap="card.read"
            aria-label="Card details"
            title="详情：来源、相关度、值得看的程度、话题，以及研究子 agent 读完原文后列出的要点"
            @click="ui.card = card.id"
          >
            <Info :size="14" />
          </button>
          <a
            v-if="card.url"
            class="icon-button small"
            :href="card.url"
            target="_blank"
            rel="noopener"
            aria-label="Open the source"
            title="打开原文"
            ><ExternalLink :size="14"
          /></a>
        </div>
        <span class="grow" />
        <time
          class="card-when"
          :class="when.freshness"
          :datetime="card.publishedAt"
          :title="when.title"
          ><strong>{{ when.age }}</strong
          ><small>{{ when.at }}</small></time
        >
      </div>
      <div class="card-main" :class="{ linked: !!card.url }" @click="openFromBody">
        <component :is="body" :card="card" />
      </div>
      <div class="card-foot">
        <HfsPill :hfs="card.hfs" />
        <FeedbackBar :card="card" />
      </div>
    </div>
  </article>
</template>
