<script setup lang="ts">
// One pick in the basket: its sources, and its draft as it will go out: the image, then the text, which the reader
// can edit in place (saved as a new revision). Older revisions stay one select away. 进入待发布 asks the server,
// which refuses a draft with Markdown, a missing link block or an image with problems.
import { computed, ref, watch } from "vue";
import { ArrowLeft, CircleAlert, PenLine, Save, Send, Undo2 } from "@lucide/vue";
import { GENRE_NAMES, pickName } from "../client/picks";
import { clean } from "../client/text";
import {
  closeWriting,
  draftProblems,
  drafts,
  openPick,
  saveEdit,
  setStage,
  shownDraft,
  shownRevision,
  startWriting,
} from "../client/writing";

const STAGES = {
  selected: "已选",
  drafting: "写作中",
  ready: "待发布",
  published: "已发布",
  dropped: "已放回",
};
const body = ref("");
watch(
  () => shownDraft.value?.id,
  () => (body.value = shownDraft.value?.body ?? ""),
  { immediate: true },
);
const edited = computed(
  () => !!shownDraft.value && body.value.trim() !== shownDraft.value.body.trim(),
);
const newest = computed(
  () => !shownDraft.value || shownDraft.value.revision === drafts.value[0]?.revision,
);
const saving = ref(false);

async function save() {
  const p = openPick.value;
  if (!p || saving.value) return;
  saving.value = true;
  await saveEdit(p, body.value);
  saving.value = false;
}
</script>

<template>
  <div v-if="openPick" class="pick-detail" :data-pick-id="openPick.id">
    <header class="pick-detail-head">
      <button
        class="button secondary small"
        aria-label="Back to the picks"
        title="回到选题篮列表"
        @click="closeWriting"
      >
        <ArrowLeft :size="13" />选题篮
      </button>
      <span class="grow" />
      <span class="pick-stage" :data-stage="openPick.status">{{ STAGES[openPick.status] }}</span>
    </header>
    <h3 class="pick-detail-title">{{ GENRE_NAMES[openPick.genre] }}：{{ pickName(openPick) }}</h3>
    <ol class="pick-sources">
      <li v-for="i in openPick.items" :key="i.cardId">
        <a v-if="i.url" :href="i.url" target="_blank" rel="noopener">{{ clean(i.title) }}</a>
        <span v-else>{{ clean(i.title) }}</span>
      </li>
    </ol>

    <div v-if="!openPick.conversationId" class="pick-empty-draft">
      <p>还没开始写。写手会读完原文，按写作规则出图、写正文。</p>
      <button
        class="button"
        data-cap="writing"
        aria-label="Start writing"
        @click="startWriting(openPick)"
      >
        <PenLine :size="14" />开始写
      </button>
    </div>
    <p v-else-if="!drafts.length" class="pick-empty-draft">写手在写，稿子出来后会显示在这里。</p>

    <template v-if="shownDraft">
      <div class="draft-meta">
        <select
          :value="shownDraft.revision"
          aria-label="Draft revision"
          title="历史版本：每次写手保存或你手改都会留一版"
          @change="shownRevision = Number(($event.target as HTMLSelectElement).value)"
        >
          <option v-for="d in drafts" :key="d.id" :value="d.revision">
            第 {{ d.revision }} 版（{{ d.author === "writer" ? "写手" : "我"
            }}{{ d.note ? `，${clean(d.note)}` : "" }}）
          </option>
        </select>
        <small>{{ shownDraft.layout ?? "无配图" }}，{{ shownDraft.lint.chars }} 字</small>
      </div>
      <img
        v-if="shownDraft.imageId"
        class="draft-image"
        :src="`/api/v1/images/${shownDraft.imageId}`"
        alt="Draft image"
      />
      <p v-if="shownDraft.quoteUrl" class="draft-quote">
        引用：<a :href="shownDraft.quoteUrl" target="_blank" rel="noopener">{{
          shownDraft.quoteUrl
        }}</a>
      </p>
      <ul v-if="draftProblems.length" class="draft-problems">
        <li v-for="(p, i) in draftProblems" :key="i"><CircleAlert :size="13" />{{ clean(p) }}</li>
      </ul>
      <textarea
        v-model="body"
        class="draft-body"
        aria-label="Draft text"
        :readonly="!newest"
        :title="newest ? '直接改正文，改完点「保存修改」存成新的一版' : '这是旧版本，只能看'"
      />
      <div class="draft-actions">
        <button
          v-if="newest"
          class="button secondary small"
          :disabled="!edited || saving"
          aria-label="Save the edit"
          title="把你改过的正文存成新的一版，配图不变"
          @click="save"
        >
          <Save :size="13" />保存修改
        </button>
        <span class="grow" />
        <button
          v-if="openPick.status === 'ready'"
          class="button secondary small"
          aria-label="Back to drafting"
          title="退回写作中：还要再改"
          @click="setStage(openPick, 'drafting')"
        >
          <Undo2 :size="13" />退回写作中
        </button>
        <button
          v-else-if="openPick.status !== 'published'"
          class="button small"
          :disabled="edited || !newest"
          aria-label="Mark ready"
          :title="edited ? '先保存修改' : '进入待发布：稿子定了，等发布'"
          @click="setStage(openPick, 'ready')"
        >
          <Send :size="13" />进入待发布
        </button>
      </div>
    </template>
  </div>
</template>
