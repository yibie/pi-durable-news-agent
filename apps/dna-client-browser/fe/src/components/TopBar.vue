<script setup lang="ts">
// The top bar: the brand, what the agent is doing and when the next sweep goes, spend, and the buttons. Nothing in it
// wraps. When the window is too narrow for every label, it folds in steps, measured against its real width (so any
// text size works): first the tagline, then the tool buttons' labels, then the column toggles' labels and the device
// name, last the brand name and the status text (cut short). Every button keeps its tooltip.
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import {
  Activity,
  Clock,
  Coins,
  ListChecks,
  LoaderCircle,
  PanelLeft,
  PanelRight,
  Server,
  ScrollText,
  SlidersHorizontal,
  WifiOff,
  Zap,
} from "@lucide/vue";
import { usd } from "@dna/sdk";
import { layout, toggle } from "../client/layout";
import DisplayMenu from "./DisplayMenu.vue";
import { go } from "../client/route";
import { agentState, api, attempt, connection, feed, info, now, ui } from "../client/store";

const busy = computed(() => agentState.value?.busy ?? false);
const bar = ref<HTMLElement>();
const FOLDS = 4;
/** The least folding that fits: try each step until nothing overflows. */
function fit() {
  const el = bar.value;
  if (!el) return;
  for (let level = 0; level <= FOLDS; level++) {
    el.dataset.fit = String(level);
    if (el.scrollWidth <= el.clientWidth + 1) return;
  }
}
let observer: ResizeObserver | undefined;
onMounted(() => {
  observer = new ResizeObserver(() => fit());
  if (bar.value) observer.observe(bar.value);
  void document.fonts?.ready.then(fit);
  fit();
});
onBeforeUnmount(() => observer?.disconnect());
const schedule = computed(() => agentState.value?.schedule);
const countdown = computed(() => {
  if (schedule.value && schedule.value.everyMinutes === null) return "定时抓取已关";
  const at = agentState.value?.nextSweepAt ?? info.value?.nextSweepAt;
  if (!at) return "没有排定的抓取";
  const s = Math.max(0, Math.round((Date.parse(at) - now.value) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")} 后抓下一轮`;
});
const every = (m: number) => (m === 60 ? "每小时" : m === 1 ? "每分钟" : `每 ${m} 分钟`);
const CARD_CHOICES = [3, 5, 7, 10, 15, 20, 30];
async function setCards(value: string) {
  const next = await attempt(() => api.setCardsPerSweep(Number(value)));
  if (next) feed.apply({ type: "schedule", schedule: next });
}
async function setSchedule(value: string) {
  const next = await attempt(() => api.setSchedule(value === "off" ? null : Number(value)));
  if (next) feed.apply({ type: "schedule", schedule: next });
}
/** All time: what the agent's model, jev and image generation have cost on this device. */
const spend = computed(() => agentState.value?.spend);
// What changes the bar's width besides the window: its texts and the text size.
watch(
  () => [
    busy.value,
    connection.value,
    schedule.value?.everyMinutes,
    schedule.value?.cardsPerSweep,
    countdown.value.length,
    spend.value?.totalUsd,
    info.value?.device,
    layout.textSize,
  ],
  () => fit(),
  { flush: "post" },
);
</script>

<template>
  <header ref="bar" class="topbar" data-fit="0">
    <div class="brand" title="Durable News Agent：News Worth Your Attention">
      <span class="brand-mark" aria-hidden="true"><Zap :size="17" /></span>
      <div class="brand-text">
        <strong>Durable News Agent</strong>
        <span class="tagline">News Worth Your Attention</span>
      </div>
    </div>
    <div
      class="agent-status"
      data-cap="status"
      :class="{ working: busy }"
      aria-live="polite"
      title="抓取状态：agent 是否在干活，以及离下一轮抓取还有多久。要装了定时任务才会按时自动抓取"
    >
      <template v-if="connection !== 'live'"
        ><WifiOff :size="16" /><span>{{
          connection === "unauthorized" ? "访问令牌被拒" : "正在重新连接"
        }}</span></template
      >
      <template v-else-if="busy"
        ><LoaderCircle :size="16" class="spin" /><span>正在干活</span></template
      >
      <template v-else
        ><Clock :size="16" /><span>{{ countdown }}</span></template
      >
      <select
        v-if="schedule"
        class="schedule-select"
        data-cap="schedule"
        aria-label="Sweep schedule"
        title="多久抓一轮新闻"
        :value="schedule.everyMinutes ?? 'off'"
        @change="setSchedule(($event.target as HTMLSelectElement).value)"
      >
        <option v-for="m in schedule.presets" :key="m" :value="m">{{ every(m) }}</option>
        <option value="off">不定时</option>
      </select>
      <select
        v-if="schedule"
        class="schedule-select"
        aria-label="Cards per sweep"
        title="每轮最多出几张卡：jev 给候选打分排序，只留前几条"
        :value="schedule.cardsPerSweep"
        @change="setCards(($event.target as HTMLSelectElement).value)"
      >
        <option
          v-for="n in [...new Set([...CARD_CHOICES, schedule.cardsPerSweep])].sort((a, b) => a - b)"
          :key="n"
          :value="n"
        >
          每轮 {{ n }} 张
        </option>
      </select>
    </div>
    <div class="topbar-right">
      <button
        class="stat link"
        data-cap="usage"
        :title="
          spend
            ? `累计花费：模型 ${usd(spend.modelUsd)}，jev ${usd(spend.jevUsd)}，配图 ${usd(spend.imageUsd)}。点开看每天的明细`
            : '累计花费'
        "
        @click="go('/executions/usage')"
      >
        <Coins :size="15" />{{ usd(spend?.totalUsd ?? 0) }}
      </button>
      <span class="stat device" :title="`连接的设备：${info?.device ?? ''}`" data-testid="device"
        ><Server :size="15" /><span class="bar-label" data-fold="2">{{
          info?.deviceName ?? info?.device ?? "device"
        }}</span></span
      >
      <button
        class="bar-button"
        data-cap="runs.read"
        aria-label="Executions"
        title="执行记录：每一轮抓取、每次对话调了哪些工具，各花了多少钱"
        @click="go('/executions')"
      >
        <Activity :size="16" /><span class="bar-label" data-fold="1">执行记录</span>
      </button>
      <button
        class="bar-button"
        data-cap="writer.rules"
        aria-label="Writing rules"
        title="写作规则：写手照着写的规则（怎么写正文、怎么出图）。改了保存，写手下一轮回复起照新规则写"
        @click="ui.rules = true"
      >
        <ScrollText :size="16" /><span class="bar-label" data-fold="1">写作规则</span>
      </button>
      <button
        class="bar-button"
        aria-label="Settings"
        title="设置：话题词、来源、搜索引擎、口味、工具"
        @click="ui.settings = true"
      >
        <SlidersHorizontal :size="16" /><span class="bar-label" data-fold="1">设置</span>
      </button>
      <DisplayMenu />
      <button
        class="bar-button"
        :class="{ on: layout.feed }"
        :aria-pressed="layout.feed"
        aria-label="Toggle the news column"
        title="显示或隐藏候选栏"
        @click="toggle('feed')"
      >
        <PanelLeft :size="16" /><span class="bar-label" data-fold="2">候选</span>
      </button>
      <button
        class="bar-button"
        data-cap="picks"
        :class="{ on: layout.picks }"
        :aria-pressed="layout.picks"
        aria-label="Toggle the picks column"
        title="显示或隐藏选题篮"
        @click="toggle('picks')"
      >
        <ListChecks :size="16" /><span class="bar-label" data-fold="2">选题篮</span>
      </button>
      <button
        class="bar-button"
        :class="{ on: layout.agent }"
        :aria-pressed="layout.agent"
        aria-label="Toggle the agent column"
        title="显示或隐藏助手栏，在这里和 agent 对话"
        @click="toggle('agent')"
      >
        <PanelRight :size="16" /><span class="bar-label" data-fold="2">助手</span>
      </button>
    </div>
  </header>
</template>
