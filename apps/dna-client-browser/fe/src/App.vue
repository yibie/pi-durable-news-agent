<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted } from "vue";
import AgentColumn from "./components/AgentColumn.vue";
import CardDetailDialog from "./components/CardDetailDialog.vue";
import ExecutionsView from "./components/ExecutionsView.vue";
import FeedColumn from "./components/FeedColumn.vue";
import PicksColumn from "./components/PicksColumn.vue";
import SettingsModal from "./components/SettingsModal.vue";
import TopBar from "./components/TopBar.vue";
import { layout, PICKS_MIN } from "./client/layout";
import { route } from "./client/route";
import { start, toast, ui } from "./client/store";

let stop: (() => void) | undefined;
onMounted(() => (stop = start()));
onBeforeUnmount(() => stop?.());

/** News takes the free width; the basket and the agent keep the widths the reader dragged them to, whether a draft is
 * open or not; a lone column fills the row. */
const grid = computed(() => {
  const open = [layout.feed, layout.picks, layout.agent].filter(Boolean).length;
  if (open === 1) return { gridTemplateColumns: "1fr" };
  const tracks = [
    layout.feed ? "minmax(320px, 1fr)" : "",
    layout.feed && layout.picks ? "6px" : "",
    layout.picks ? (layout.feed ? `${layout.picksWidth}px` : "minmax(300px, 1fr)") : "",
    layout.agent ? `6px ${layout.agentWidth}px` : "",
  ];
  return { gridTemplateColumns: tracks.filter(Boolean).join(" ") };
});

// Both handles sit on a column's left edge, so dragging left widens that column.
type Resizable = "picks" | "agent";
const LIMITS: Record<Resizable, { min: number; share: number }> = {
  picks: { min: PICKS_MIN, share: 0.5 },
  agent: { min: 380, share: 0.7 },
};
let startX = 0;
let startWidth = 0;
function resizeStart(e: PointerEvent, which: Resizable) {
  startX = e.clientX;
  startWidth = which === "picks" ? layout.picksWidth : layout.agentWidth;
  (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
}
function resizeMove(e: PointerEvent, which: Resizable) {
  if (!(e.currentTarget as HTMLElement).hasPointerCapture(e.pointerId)) return;
  const { min, share } = LIMITS[which];
  const width = Math.min(
    Math.round(window.innerWidth * share),
    Math.max(min, startWidth - (e.clientX - startX)),
  );
  if (which === "picks") layout.picksWidth = width;
  else layout.agentWidth = width;
}
</script>

<template>
  <div class="app">
    <TopBar />
    <main class="columns" :style="grid">
      <FeedColumn v-if="layout.feed" />
      <div
        v-if="layout.feed && layout.picks"
        class="resize-handle"
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize the picks column"
        title="拖动调整选题篮的宽度，会记住"
        @pointerdown="resizeStart($event, 'picks')"
        @pointermove="resizeMove($event, 'picks')"
      />
      <PicksColumn v-if="layout.picks" />
      <div
        v-if="(layout.feed || layout.picks) && layout.agent"
        class="resize-handle"
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize the agent column"
        title="拖动调整助手栏的宽度，会记住"
        @pointerdown="resizeStart($event, 'agent')"
        @pointermove="resizeMove($event, 'agent')"
      />
      <AgentColumn v-if="layout.agent" />
    </main>
    <ExecutionsView v-if="route.view === 'executions'" />
    <SettingsModal v-if="ui.settings" />
    <CardDetailDialog v-if="ui.card !== undefined" :id="ui.card" />
    <div v-if="toast" class="toast" :class="toast.kind" role="status">{{ toast.text }}</div>
  </div>
</template>
