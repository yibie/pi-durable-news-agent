<script setup lang="ts">
// H/F/S from jev, always ranked: the primary category first and emphasized, then the others with their scores.
// Each chip fills like a progress bar to its score, in its category color.
import { computed } from "vue";
import { BadgeCheck, Megaphone, Zap } from "@lucide/vue";
import type { HfsCategory, HfsScores } from "@dna/sdk";

const props = defineProps<{ hfs?: HfsScores }>();
const ICONS = { signal: Zap, facts: BadgeCheck, hype: Megaphone };
const NAMES: Record<HfsCategory, string> = { signal: "Signal", facts: "Facts", hype: "Hype" };
const MEANINGS: Record<HfsCategory, string> = {
  signal: "Signal：能不能拿来马上行动",
  facts: "Facts：有没有扎实的事实依据",
  hype: "Hype：炒作成分有多少",
};
const ranked = computed(() => props.hfs?.ranked ?? []);
</script>

<template>
  <div
    v-if="hfs"
    class="hfs"
    data-testid="hfs"
    :aria-label="`Ranked by jev: ${ranked.map((r) => `${NAMES[r.category]} ${r.score}`).join(', ')}`"
  >
    <span
      v-for="(r, i) in ranked"
      :key="r.category"
      class="hfs-chip"
      :class="[r.category, { primary: i === 0, label: hfs.labels.includes(r.category) }]"
      :data-category="r.category"
      :data-score="r.score"
      :style="{ '--fill': `${Math.max(0, Math.min(100, r.score))}%` }"
      :title="`${NAMES[r.category]} ${r.score} 分（满分 100，jev 把握 ${Math.round(r.confidence * 100)}%）。${MEANINGS[r.category]}`"
    >
      <component :is="ICONS[r.category]" :size="i === 0 ? 15 : 13" />
      <span>{{ NAMES[r.category] }}</span>
      <strong>{{ r.score }}</strong>
    </span>
    <span v-if="hfs.suspectCombo" class="hfs-warn" title="Hype and signal without facts"
      >check it</span
    >
  </div>
  <div v-else class="hfs pending">Not ranked yet</div>
</template>
