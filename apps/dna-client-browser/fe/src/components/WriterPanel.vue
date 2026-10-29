<script setup lang="ts">
// The open pick's writer in the agent column: what it did (its messages and tool calls) and a box to ask for
// changes. The first message is the pick's writing brief, shown as a chip. Back returns the column to the news desk.
import { computed, nextTick, ref, watch } from "vue";
import {
  ArrowLeft,
  Brain,
  FilePen,
  PenLine,
  ScrollText,
  Send,
  Sparkles,
  Square,
} from "@lucide/vue";
import { GENRE_NAMES, pickName } from "../client/picks";
import { clean, markdown } from "../client/text";
import {
  closeWriting,
  openPick,
  sendToWriter,
  startWriting,
  stopWriting,
  writerView,
} from "../client/writing";
import { ui } from "../client/store";
import ToolCallRow from "./ToolCallRow.vue";

const text = ref("");
const brief = ref("");
const sending = ref(false);
const list = ref<HTMLElement>();
const items = computed(() => writerView.value.items);
const working = computed(
  () =>
    writerView.value.generating ||
    items.value.some(
      (i) =>
        (i.kind === "tool" && i.call.status === "running") ||
        (i.kind === "assistant" &&
          i.blocks.some((b) => b.type === "tool" && b.call.status === "running")),
    ),
);
const isBrief = (t: string) => /^# Purpose\s+Write pick \d+/.test(t);
/** A message the server sent with a notice of the reader's own edit in front (see writing/edit-notice.ts). */
function edited(t: string) {
  const m = t.match(/^【读者手改了稿子】\n([\s\S]*?)\n\n【读者这次的话】\n([\s\S]*)$/);
  if (!m) return undefined;
  return { notice: m[1], revision: m[1].match(/现在最新的是第 (\d+) 版/)?.[1], message: m[2] };
}

watch(
  () => items.value.length,
  async () => {
    await nextTick();
    list.value?.scrollTo({ top: list.value.scrollHeight });
  },
);

async function send() {
  const p = openPick.value;
  const message = text.value.trim();
  if (!p || !message || sending.value) return;
  sending.value = true;
  if (await sendToWriter(p, message)) text.value = "";
  sending.value = false;
}
/** The writer runs the 去AI味 v2 pass after every draft on its own; this asks for it again, e.g. after a hand edit. */
const AI_TONE = "【去 AI 味】按「去AI味 v2」再查一遍最新稿，该改的直接改，改完告诉我改了什么。";
async function checkTone() {
  const p = openPick.value;
  if (!p || sending.value) return;
  sending.value = true;
  await sendToWriter(p, AI_TONE);
  sending.value = false;
}
async function start() {
  const p = openPick.value;
  if (!p || sending.value) return;
  sending.value = true;
  await startWriting(p, brief.value);
  brief.value = "";
  sending.value = false;
}
function onStartKey(e: KeyboardEvent) {
  if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    void start();
  }
}
function onKey(e: KeyboardEvent) {
  if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    void send();
  }
}
</script>

<template>
  <section
    v-if="openPick"
    class="column agent-column writer-column"
    data-col="agent"
    aria-label="Writer"
  >
    <div class="writer-bar">
      <button
        class="button secondary small"
        aria-label="Back to the news desk"
        title="回到新闻助手（选题篮也回到列表）"
        @click="closeWriting"
      >
        <ArrowLeft :size="13" />新闻助手
      </button>
      <span class="writer-title" :title="pickName(openPick)"
        ><PenLine :size="14" />写作：{{ GENRE_NAMES[openPick.genre] }}，{{
          pickName(openPick)
        }}</span
      >
      <span v-if="working" class="writer-busy">写手在干活</span>
      <button
        class="icon-button writer-rules"
        aria-label="Edit the rules"
        title="写作规则：写手照着写的规则。改了保存，写手下一轮回复起照新规则写"
        @click="ui.rules = true"
      >
        <ScrollText :size="15" />
      </button>
    </div>
    <div ref="list" class="pane transcript-pane">
      <div class="transcript" data-testid="writer-chat">
        <div v-if="!openPick.conversationId" class="writer-start">
          <p>
            写手会读完原文、选版式出图、按写作规则写正文，写好的稿子出现在左边。之后在这里告诉它怎么改。
          </p>
          <textarea
            v-model="brief"
            rows="4"
            aria-label="Writing requirements"
            placeholder="这篇的要求（可不填），比如：写给不写代码的读者；重点讲它怎么省钱；配图用对比版式"
            @keydown="onStartKey"
          />
          <button
            class="button"
            data-cap="writing"
            aria-label="Start writing"
            title="开始写（Enter）。上面写了要求的话，写手动笔前就会看到"
            :disabled="sending"
            @click="start"
          >
            <PenLine :size="14" />开始写
          </button>
        </div>
        <template v-for="item in items" :key="`${item.kind}:${item.id}`">
          <template v-if="item.kind === 'user'">
            <template v-if="isBrief(item.text)">
              <div class="chip-line">
                <span class="chip"><PenLine :size="14" />开始写选题 {{ openPick.id }}</span>
              </div>
              <p v-if="openPick.note" class="writer-note">你的要求：{{ clean(openPick.note) }}</p>
            </template>
            <template v-else-if="edited(item.text)">
              <details class="edit-notice" data-testid="edit-notice">
                <summary>
                  <FilePen :size="14" />已告诉写手：你手改过稿子，最新是第
                  {{ edited(item.text)!.revision }} 版，要在这一版上改
                </summary>
                <pre>{{ clean(edited(item.text)!.notice) }}</pre>
              </details>
              <div class="msg user" data-role="user">
                <div class="bubble">{{ clean(edited(item.text)!.message) }}</div>
              </div>
            </template>
            <div v-else class="msg user" data-role="user">
              <div class="bubble">{{ clean(item.text) }}</div>
            </div>
          </template>
          <div v-else-if="item.kind === 'assistant'" class="msg agent" data-role="agent">
            <template v-for="(block, i) in item.blocks" :key="i">
              <details v-if="block.type === 'thinking'" class="thinking">
                <summary><Brain :size="13" />思考</summary>
                <p>{{ clean(block.text) }}</p>
              </details>
              <div
                v-else-if="block.type === 'text'"
                class="bubble markdown"
                v-html="markdown(block.text)"
              />
              <ToolCallRow v-else :call="block.call" />
            </template>
            <p v-if="item.error" class="msg-error">{{ clean(item.error) }}</p>
          </div>
          <ToolCallRow v-else-if="item.kind === 'tool'" :call="item.call" />
        </template>
      </div>
    </div>
    <form v-if="openPick.conversationId" class="composer" @submit.prevent="send">
      <textarea
        v-model="text"
        rows="2"
        aria-label="Message the writer"
        placeholder="告诉写手怎么改，比如：开头再直白一点，第三段删掉"
        @keydown="onKey"
      />
      <div class="composer-row">
        <button
          type="button"
          class="button secondary small"
          data-cap="writing"
          aria-label="Check the draft for AI tone"
          title="去 AI 味：写手每写完一稿会自动做一遍；手改过稿子后想再查，就点这里。它直接改，改完列出改了哪些句子、按哪条规则"
          :disabled="sending"
          @click="checkTone"
        >
          <Sparkles :size="13" />去 AI 味
        </button>
        <span class="grow" />
        <button
          type="button"
          class="button secondary small"
          :disabled="!working"
          aria-label="Stop the writer"
          title="停止：让写手停下手头的事"
          @click="stopWriting(openPick)"
        >
          <Square :size="13" />停止
        </button>
        <button
          type="submit"
          class="button small"
          :disabled="!text.trim() || sending"
          aria-label="Send to the writer"
          title="发送（Enter）。它正在干活时，消息会排在它做完之后"
        >
          <Send :size="14" />发送
        </button>
      </div>
    </form>
  </section>
</template>
