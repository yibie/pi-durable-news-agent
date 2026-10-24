<script setup lang="ts">
// Publishing a ready pick: when the next post may go (30 minutes apart), a rehearsal (fills X's composer and checks
// it without posting), and 发布 behind a confirm. Inside the 30 minutes a reason is required and goes into the ledger.
// A publish whose result is unknown blocks the pick until the reader checks X and says it did not post. Once the post
// is out, its first reply (the 原文 links) follows under it; one that did not go out can be posted again from here.
import { computed, ref } from "vue";
import { CircleAlert, FlaskConical, Send } from "@lucide/vue";
import type { TopicPick } from "@dna/sdk";
import { now } from "../client/store";
import { clean } from "../client/text";
import { beijingTime as time } from "../client/time";
import {
  ackPublish,
  ackReply,
  publishNow,
  publishState,
  rehearse,
  replyAgain,
} from "../client/writing";

const props = defineProps<{ pick: TopicPick }>();

const PHASES: Record<string, string> = {
  preflight: "检查浏览器",
  compose: "打开编辑框",
  type: "输入正文",
  attach: "上传配图",
  check: "核对编辑框",
  discard: "清空编辑框",
  click: "点发布",
  settle: "确认结果",
  pending: "点发布",
  reply: "发首条回复",
  "reply open": "打开帖子",
  "reply type": "输入首条回复",
  "reply check": "核对回复框",
  "reply click": "点回复",
  "reply pending": "点回复",
  "reply settle": "确认回复结果",
};

const st = computed(() => publishState.value);
const waitUntil = computed(() => {
  const at = st.value.earliestAt;
  return at && Date.parse(at) > now.value ? at : undefined;
});
const mine = computed(() =>
  st.value.running?.pickId === props.pick.id ? st.value.running : undefined,
);
const busy = computed(() => !!st.value.running);
const blocked = computed(() =>
  st.value.pick && (st.value.pick.status === "pending" || st.value.pick.status === "unknown")
    ? st.value.pick
    : undefined,
);
/** A pick moved back from 已发布: when its first post went out. */
const postedBefore = computed(() =>
  props.pick.reopenedAt && st.value.pick?.status === "ok" ? st.value.pick.at : undefined,
);
/** The first reply that belongs to the post now on X: one written after the post went out. */
const reply = computed(() => {
  const post = st.value.pick;
  const r = st.value.reply;
  return post?.status === "ok" && r && r.at >= post.at ? r : undefined;
});
const replyBlocked = computed(() =>
  reply.value && (reply.value.status === "pending" || reply.value.status === "unknown")
    ? reply.value
    : undefined,
);
const postUrl = ref("");
const replyChecked = ref("");
const confirming = ref(false);
const reason = ref("");
const checked = ref("");

async function go() {
  await publishNow(props.pick, waitUntil.value ? reason.value.trim() : undefined);
  confirming.value = false;
  reason.value = "";
}
</script>

<template>
  <section class="publish-panel" data-cap="publish" aria-label="Publish">
    <h4>发布</h4>
    <template v-if="pick.status === 'published'">
      <p class="publish-line">
        已发布{{ st.pick?.status === "ok" ? `，${time(st.pick.at)}` : ""
        }}<template v-if="st.postUrl"
          >，<a :href="st.postUrl" target="_blank" rel="noopener">看帖子</a></template
        >
      </p>
      <p v-if="mine" class="publish-line running">
        正在发布：{{ PHASES[mine.phase] ?? mine.phase }}
      </p>
      <p
        v-else-if="reply || st.replyDue"
        class="publish-line"
        :class="{ bad: st.replyDue || !!replyBlocked }"
        data-testid="reply-state"
        :title="reply?.note ? clean(reply.note) : ''"
      >
        首条回复（原文链接）：{{
          reply?.status === "ok"
            ? `已发，${time(reply.at)}`
            : replyBlocked
              ? "结果不明，可能已经发出去了"
              : reply?.status === "ack"
                ? "确认过没发出去，可以补发"
                : reply?.status === "failed"
                  ? "没发出去"
                  : "还没发"
        }}
      </p>
      <div v-if="replyBlocked && !mine" class="publish-blocked">
        <p>
          <CircleAlert :size="13" />首条回复上次{{
            replyBlocked.status === "pending" ? "停在点回复那一步" : "结果不明"
          }}（{{ time(replyBlocked.at) }}）。先去帖子下面看一眼：
        </p>
        <input
          v-model="replyChecked"
          aria-label="What you checked under the post"
          placeholder="你看到了什么，比如：帖子下面没有这条回复"
        />
        <button
          class="button secondary small"
          :disabled="!replyChecked.trim()"
          aria-label="The reply did not post"
          title="确认首条回复没发出：记进台账，之后可以补发"
          @click="ackReply(pick, replyChecked.trim())"
        >
          确认没发出
        </button>
      </div>
      <div v-else-if="st.replyDue && !mine" class="publish-actions">
        <input
          v-if="!st.postUrl"
          v-model="postUrl"
          class="grow"
          aria-label="Post link"
          placeholder="没找到帖子的链接：把帖子链接贴在这里"
        />
        <span v-else class="grow" />
        <button
          class="button small"
          :disabled="busy || (!st.postUrl && !postUrl.trim())"
          aria-label="Post the reply again"
          title="补发首条回复：打开帖子，在下面回复原文链接，不会重发帖子"
          @click="replyAgain(pick, st.postUrl ? undefined : postUrl.trim())"
        >
          <Send :size="13" />补发首条回复
        </button>
      </div>
    </template>
    <template v-else>
      <p
        class="publish-line"
        :title="st.last ? `上一条：${st.last.draftKey}，${time(st.last.at)}` : ''"
      >
        {{
          waitUntil
            ? `最早 ${time(waitUntil)} 可以发（北京时间，两条之间隔 30 分钟）`
            : "现在可以发"
        }}
      </p>
      <p v-if="mine" class="publish-line running">
        正在{{ mine.rehearsal ? "排练" : "发布" }}：{{ PHASES[mine.phase] ?? mine.phase }}
      </p>
      <p v-else-if="busy" class="publish-line">
        另一条正在{{ st.running?.rehearsal ? "排练" : "发布" }}，等它结束
      </p>
      <p
        v-if="st.rehearsal && !mine"
        class="publish-line"
        :class="{ bad: !st.rehearsal.wouldPost || !st.rehearsal.clean }"
      >
        上次排练（{{ time(st.rehearsal.at) }}）：{{
          st.rehearsal.wouldPost ? "能发出去" : "发不出去"
        }}，编辑框{{ st.rehearsal.clean ? "已清空" : "没清干净，去 X 上看一眼" }}
      </p>
      <p v-if="postedBefore" class="publish-line bad">
        这条 {{ time(postedBefore) }} 已经发过一次，再发会在 X 上多出一条；原帖还在的话，先去 X
        上删掉
      </p>
      <div v-if="blocked" class="publish-blocked">
        <p>
          <CircleAlert :size="13" />上次发布{{
            blocked.status === "pending" ? "停在点发布那一步" : "结果不明"
          }}（{{ time(blocked.at) }}），可能已经发出去了。先到 X 主页看一眼：
        </p>
        <input
          v-model="checked"
          aria-label="What you checked"
          placeholder="你看到了什么，比如：主页没有这条"
        />
        <button
          class="button secondary small"
          :disabled="!checked.trim()"
          aria-label="It did not post"
          title="确认未发出：记进台账，之后可以重新发布"
          @click="ackPublish(pick, checked.trim())"
        >
          确认未发出
        </button>
      </div>
      <div v-else-if="pick.status === 'ready'" class="publish-actions">
        <button
          class="button secondary small"
          :disabled="busy"
          aria-label="Rehearse"
          title="排练：在 X 的编辑框里填好正文、传好配图、核对一遍，但不点发布，最后清空"
          @click="rehearse(pick)"
        >
          <FlaskConical :size="13" />排练
        </button>
        <span class="grow" />
        <button
          v-if="!confirming"
          class="button small"
          :disabled="busy"
          aria-label="Publish"
          title="发布到 X"
          @click="confirming = true"
        >
          <Send :size="13" />发布
        </button>
      </div>
      <div v-if="confirming && !blocked && pick.status === 'ready'" class="publish-confirm">
        <p>确定把这条发到 X？发出去就撤不回了。{{ postedBefore ? "它之前已经发过一次。" : "" }}</p>
        <input
          v-if="waitUntil"
          v-model="reason"
          aria-label="Reason to post now"
          placeholder="还没到 30 分钟，写一句插队的理由（会记进台账）"
        />
        <div class="publish-actions">
          <button class="button secondary small" aria-label="Cancel" @click="confirming = false">
            取消
          </button>
          <span class="grow" />
          <button
            class="button small"
            :disabled="busy || (!!waitUntil && !reason.trim())"
            aria-label="Confirm publish"
            @click="go"
          >
            确认发布
          </button>
        </div>
      </div>
      <p v-if="pick.status !== 'ready' && !blocked" class="publish-line">
        {{ clean("稿子进入待发布后才能排练和发布。") }}
      </p>
    </template>
  </section>
</template>
