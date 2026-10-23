<script setup lang="ts">
import { computed } from "vue";
import {
  Activity,
  Clock,
  Coins,
  ListChecks,
  LoaderCircle,
  PanelLeft,
  PanelRight,
  Server,
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
const schedule = computed(() => agentState.value?.schedule);
const countdown = computed(() => {
  if (schedule.value && schedule.value.everyMinutes === null) return "scheduled sweeps off";
  const at = agentState.value?.nextSweepAt ?? info.value?.nextSweepAt;
  if (!at) return "no sweep scheduled";
  const s = Math.max(0, Math.round((Date.parse(at) - now.value) / 1000));
  return `next sweep in ${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
});
const every = (m: number) =>
  m === 60 ? "Every hour" : m === 1 ? "Every minute" : `Every ${m} min`;
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
</script>

<template>
  <header class="topbar">
    <div class="brand">
      <span class="brand-mark" aria-hidden="true"><Zap :size="17" /></span>
      <div>
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
          connection === "unauthorized" ? "Token refused" : "Reconnecting"
        }}</span></template
      >
      <template v-else-if="busy"
        ><LoaderCircle :size="16" class="spin" /><span>Working</span></template
      >
      <template v-else
        ><Clock :size="16" /><span>Waiting, {{ countdown }}</span></template
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
        <option value="off">Off</option>
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
          {{ n }} cards
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
        ><Server :size="15" />{{ info?.deviceName ?? info?.device ?? "device" }}</span
      >
      <button
        class="bar-button"
        data-cap="runs.read"
        aria-label="Executions"
        title="执行记录：每一轮抓取、每次对话调了哪些工具，各花了多少钱"
        @click="go('/executions')"
      >
        <Activity :size="16" /><span>执行记录</span>
      </button>
      <button
        class="bar-button"
        aria-label="Settings"
        title="设置：话题词、来源、搜索引擎、口味、工具"
        @click="ui.settings = true"
      >
        <SlidersHorizontal :size="16" /><span>设置</span>
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
        <PanelLeft :size="16" /><span>候选</span>
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
        <ListChecks :size="16" /><span>选题篮</span>
      </button>
      <button
        class="bar-button"
        :class="{ on: layout.agent }"
        :aria-pressed="layout.agent"
        aria-label="Toggle the agent column"
        title="显示或隐藏助手栏，在这里和 agent 对话"
        @click="toggle('agent')"
      >
        <PanelRight :size="16" /><span>助手</span>
      </button>
    </div>
  </header>
</template>
