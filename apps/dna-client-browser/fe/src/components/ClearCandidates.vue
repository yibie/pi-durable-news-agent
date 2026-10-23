<script setup lang="ts">
// Clearing the candidates list: the ones published more than 48 hours ago (outside the candidate pool), or all of them.
// Cards in the picks basket stay, and nothing here moves taste weights; clearing all asks once more before it runs.
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { BrushCleaning } from "@lucide/vue";
import type { Card } from "@dna/sdk";
import { clearCandidates } from "../client/picks";

const POOL_HOURS = 48;
const props = defineProps<{ cards: Card[] }>();
const open = ref(false);
const confirmAll = ref(false);
const root = ref<HTMLElement>();

/** Same age rule as the server: the publish time, or when the card was made if the source gave none. */
const old = computed(() => {
  const cutoff = Date.now() - POOL_HOURS * 3_600_000;
  return props.cards.filter((c) => Date.parse(c.publishedAt ?? c.createdAt) < cutoff).length;
});

function toggle() {
  open.value = !open.value;
  confirmAll.value = false;
}
function close(e: PointerEvent) {
  if (open.value && !root.value?.contains(e.target as Node)) toggle();
}
onMounted(() => window.addEventListener("pointerdown", close));
onBeforeUnmount(() => window.removeEventListener("pointerdown", close));

async function run(olderThanHours?: number) {
  open.value = false;
  confirmAll.value = false;
  await clearCandidates(olderThanHours);
}
</script>

<template>
  <div ref="root" class="clear-candidates">
    <button
      class="clear-btn"
      :aria-expanded="open"
      aria-label="Clear candidates"
      title="清理候选：一次移出旧的或全部候选。只是整理列表，不影响以后推荐什么"
      @click="toggle"
    >
      <BrushCleaning :size="14" /><span>清理</span>
    </button>
    <div v-if="open" class="pick-menu" role="menu" aria-label="Clear">
      <button role="menuitem" data-clear="old" :disabled="!old" @click="run(POOL_HOURS)">
        <strong>移出 48 小时前的</strong><small>超出候选池的 {{ old }} 条</small>
      </button>
      <button
        v-if="!confirmAll"
        role="menuitem"
        data-clear="all"
        :disabled="!cards.length"
        @click="confirmAll = true"
      >
        <strong>全部移出</strong><small>现在 {{ cards.length }} 条，选题篮里的不受影响</small>
      </button>
      <button v-else role="menuitem" data-clear="all-confirm" class="danger" @click="run()">
        <strong>确认全部移出 {{ cards.length }} 条</strong
        ><small>移出后，新一轮抓取的卡片照常出现</small>
      </button>
    </div>
  </div>
</template>
