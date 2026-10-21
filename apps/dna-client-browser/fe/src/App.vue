<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted } from "vue";
import AgentColumn from "./components/AgentColumn.vue";
import CardDetailDialog from "./components/CardDetailDialog.vue";
import ExecutionsView from "./components/ExecutionsView.vue";
import FeedColumn from "./components/FeedColumn.vue";
import PicksColumn from "./components/PicksColumn.vue";
import SettingsModal from "./components/SettingsModal.vue";
import TopBar from "./components/TopBar.vue";
import { layout } from "./client/layout";
import { route } from "./client/route";
import { start, toast, ui } from "./client/store";

let stop: (() => void) | undefined;
onMounted(() => (stop = start()));
onBeforeUnmount(() => stop?.());

/** News takes the free width, the basket a fixed 340px, the agent its dragged width; a lone column fills the row. */
const PICKS_WIDTH = 340;
const grid = computed(() => {
  const open = [layout.feed, layout.picks, layout.agent].filter(Boolean).length;
  if (open === 1) return { gridTemplateColumns: "1fr" };
  const tracks = [
    layout.feed ? "minmax(320px, 1fr)" : "",
    layout.picks ? (layout.feed ? `${PICKS_WIDTH}px` : "minmax(300px, 1fr)") : "",
    layout.agent ? `6px ${layout.agentWidth}px` : "",
  ];
  return { gridTemplateColumns: tracks.filter(Boolean).join(" ") };
});

let startX = 0;
let startWidth = 0;
function resizeStart(e: PointerEvent) {
  startX = e.clientX;
  startWidth = layout.agentWidth;
  (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
}
function resizeMove(e: PointerEvent) {
  if (!(e.currentTarget as HTMLElement).hasPointerCapture(e.pointerId)) return;
  const max = Math.round(window.innerWidth * 0.7);
  layout.agentWidth = Math.min(max, Math.max(380, startWidth - (e.clientX - startX)));
}
</script>

<template>
  <div class="app">
    <TopBar />
    <main class="columns" :style="grid">
      <FeedColumn v-if="layout.feed" />
      <PicksColumn v-if="layout.picks" />
      <div
        v-if="(layout.feed || layout.picks) && layout.agent"
        class="resize-handle"
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize the agent column"
        @pointerdown="resizeStart"
        @pointermove="resizeMove"
      />
      <AgentColumn v-if="layout.agent" />
    </main>
    <ExecutionsView v-if="route.view === 'executions'" />
    <SettingsModal v-if="ui.settings" />
    <CardDetailDialog v-if="ui.card !== undefined" :id="ui.card" />
    <div v-if="toast" class="toast" :class="toast.kind" role="status">{{ toast.text }}</div>
  </div>
</template>
