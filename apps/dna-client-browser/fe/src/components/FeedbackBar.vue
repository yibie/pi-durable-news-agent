<script setup lang="ts">
import { computed } from "vue";
import { BadgeCheck, Megaphone, ThumbsDown, ThumbsUp, Zap } from "@lucide/vue";
import { HFS_CATEGORIES, type Card, type HfsCategory } from "@dna/sdk";
import { api, attempt, notify } from "../client/store";

const props = defineProps<{ card: Card }>();
const ICONS = { hype: Megaphone, facts: BadgeCheck, signal: Zap };
const NAMES: Record<HfsCategory, string> = { hype: "Hype", facts: "Facts", signal: "Signal" };
/** What a label tells jev: it moves the keywords of that section and becomes an example for its next calls. */
const TIPS: Record<HfsCategory, string> = {
  signal: "标为 Signal：这条能拿来马上行动。纠正 jev 的判断，也会成为它以后的参考",
  facts: "标为 Facts：这条有扎实的事实依据。纠正 jev 的判断，也会成为它以后的参考",
  hype: "标为 Hype：这条主要是炒作。纠正 jev 的判断，也会成为它以后的参考",
};
/** Label buttons in the same order as the card's ranked H/F/S chips. */
const order = computed<HfsCategory[]>(
  () => props.card.hfs?.ranked.map((r) => r.category) ?? [...HFS_CATEGORIES],
);

async function signal(value: "more" | "less") {
  const r = await attempt(() => api.feedback(props.card.id, { signal: value }));
  if (r)
    notify(
      value === "more"
        ? `会多推这类内容${r.changed.length ? `：${r.changed.map((c) => c.term).join("、")} 权重上调` : ""}${r.leads?.length ? `。下一轮会把 ${r.leads.map((l) => l.site).join("、")} 当作新来源看看` : ""}`
        : `已从候选中移除，同类内容会少推一些${r.changed.length ? `：${r.changed.map((c) => c.term).join("、")} 权重下调` : ""}`,
    );
}
async function label(category: HfsCategory) {
  const current = props.card.feedback?.labels ?? [];
  const next = current.includes(category)
    ? current.filter((c) => c !== category)
    : [...current, category];
  await attempt(() => api.feedback(props.card.id, { labels: next }));
}
</script>

<template>
  <div class="feedback">
    <button
      class="fb"
      data-cap="feedback.more"
      :class="{ on: card.feedback?.signal === 'more' }"
      :aria-pressed="card.feedback?.signal === 'more'"
      title="多看：调高这张卡所属话题和来源的权重"
      aria-label="Show me more"
      @click="signal('more')"
    >
      <ThumbsUp :size="14" />
    </button>
    <button
      class="fb"
      data-cap="feedback.less"
      :class="{ on: card.feedback?.signal === 'less' }"
      :aria-pressed="card.feedback?.signal === 'less'"
      title="少看：调低这张卡所属话题和来源的权重，并从候选中移除"
      aria-label="Show me less"
      @click="signal('less')"
    >
      <ThumbsDown :size="14" />
    </button>
    <span class="fb-labels" data-cap="feedback.label" role="group" aria-label="Your label">
      <span class="fb-prefix" aria-hidden="true">标签</span>
      <button
        v-for="c in order"
        :key="c"
        class="fb tag"
        :class="[c, { on: card.feedback?.labels.includes(c) }]"
        :aria-pressed="!!card.feedback?.labels.includes(c)"
        :aria-label="`Label ${NAMES[c]}`"
        :title="TIPS[c]"
        @click="label(c)"
      >
        <component :is="ICONS[c]" :size="13" />
      </button>
    </span>
  </div>
</template>
