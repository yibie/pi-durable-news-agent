// Writing in the browser: the pick the reader opened, its drafts, and its writer conversation. The writer runs in its
// own conversation, so it gets its own stream and agent model while a pick is open; the main stream stays as it is.
import { computed, ref, shallowRef, watch } from "vue";
import { AgentModel, follow, type Draft, type PublishState, type TopicPick } from "@dna/sdk";
import { layout, PICK_STAGES, type PickStage } from "./layout";
import { api, attempt, feed, feedState, notify, onFrame } from "./store";

/** The pick open in the basket (detail view) and in the agent column (its writer). */
export const openPickId = ref<number>();
export const openPick = computed(() =>
  feedState.value.picks.find((p) => p.id === openPickId.value),
);
/** Every revision of the open pick, newest first. */
export const drafts = shallowRef<Draft[]>([]);
/** The revision shown; undefined follows the newest. */
export const shownRevision = ref<number>();
export const shownDraft = computed(
  () => drafts.value.find((d) => d.revision === shownRevision.value) ?? drafts.value[0],
);

/** Where publishing stands for the open pick: spacing, its ledger line, a running publish, its last rehearsal. */
export const publishState = shallowRef<PublishState>({});
/** Where publishing stands for the basket's 待发布 tab: the earliest next post and a running publish. */
export const spacing = shallowRef<PublishState>({});

export async function loadSpacing() {
  const st = await attempt(() => api.publishState());
  if (st) spacing.value = st;
}

let writer: AgentModel | undefined;
export const writerView = shallowRef(new AgentModel().state);
let stopStream: AbortController | undefined;

/** Ready to publish needs an image, clean text and a clean image: the server says what is missing. */
export const draftProblems = computed(() => {
  const d = shownDraft.value;
  if (!d) return [];
  return [
    ...d.lint.markdown.map((h) => `第 ${h.line} 行有 Markdown：${h.text}`),
    ...d.lint.links.map((l) => `正文里有链接（会被降权，放进首条回复）：${l}`),
    ...(/原文[:：]/.test(d.reply ?? "") && /https?:\/\//.test(d.reply ?? "")
      ? []
      : ["首条回复要有「原文：」和原文链接"]),
    ...(d.lint.overLimit ? [`加权长度 ${d.lint.weighted} 超过 X 的上限`] : []),
    ...d.warnings.map((w) => `配图：${w}`),
  ];
});

async function loadDrafts(id: number) {
  const list = await attempt(() => api.drafts(id));
  if (openPickId.value === id && list) drafts.value = list;
}

function follow_(conversationId: number) {
  stopStream?.abort();
  stopStream = new AbortController();
  const model = new AgentModel(conversationId);
  writer = model;
  writerView.value = { ...model.state };
  model.subscribe(() => {
    if (writer === model) writerView.value = { ...model.state };
  });
  void follow(
    (signal) => api.stream(signal, { conversations: [conversationId] }),
    (frame) => {
      if (frame.type === "agent.snapshot" || frame.type === "agent.batch") model.apply(frame);
    },
    () => {},
    stopStream.signal,
  );
}

function unfollow() {
  stopStream?.abort();
  stopStream = undefined;
  writer = undefined;
  writerView.value = new AgentModel().state;
}

// Follow the open pick's writer once it has one (writing may start after the pick was opened).
watch(
  () => [openPickId.value, openPick.value?.conversationId] as const,
  ([id, conversation], before) => {
    if (id !== before?.[0]) {
      drafts.value = [];
      shownRevision.value = undefined;
      publishState.value = {};
      if (id) {
        void loadDrafts(id);
        void attempt(() => api.publishState(id)).then((st) => {
          if (st && openPickId.value === id) publishState.value = st;
        });
      }
    }
    if (!id || !conversation) return unfollow();
    if (conversation !== before?.[1] || id !== before?.[0]) follow_(Number(conversation));
  },
);

// The basket's stage tab follows the open pick: 开始写, 进入待发布 and 发布 move it, and back to the list lands there.
watch(
  () => openPick.value?.status,
  (status) => {
    if (status && PICK_STAGES.includes(status as PickStage)) layout.picksTab = status as PickStage;
  },
);

onFrame((frame) => {
  if (frame.type === "publish") {
    spacing.value = {
      earliestAt: frame.state.earliestAt,
      last: frame.state.last,
      running: frame.state.running,
    };
    const mine = frame.pickId === openPickId.value;
    publishState.value = mine
      ? frame.state
      : {
          ...publishState.value,
          earliestAt: frame.state.earliestAt,
          last: frame.state.last,
          running: frame.state.running,
        };
    if (mine && frame.phase === "rehearsed" && frame.state.rehearsal)
      notify(
        frame.state.rehearsal.wouldPost && frame.state.rehearsal.clean
          ? "排练通过：能发出去，编辑框已清空"
          : `排练有问题：${frame.state.rehearsal.detail}`,
        frame.state.rehearsal.wouldPost && frame.state.rehearsal.clean ? "info" : "bad",
      );
    if (mine && frame.phase === "ok") notify("已发布到 X");
    if (mine && (frame.phase === "unknown" || frame.phase === "failed"))
      notify(
        frame.phase === "unknown"
          ? "发布状态不明：可能已经发出去了，先到 X 上看一眼"
          : `没有发出去：${frame.entry?.note ?? ""}`,
        "bad",
      );
    return;
  }
  if (frame.type !== "draft" || frame.draft.pickId !== openPickId.value) return;
  drafts.value = [frame.draft, ...drafts.value.filter((d) => d.id !== frame.draft.id)].sort(
    (a, b) => b.revision - a.revision,
  );
  shownRevision.value = undefined;
});

export function openWriting(p: TopicPick) {
  openPickId.value = p.id;
}

export function closeWriting() {
  openPickId.value = undefined;
}

const applied = (p: TopicPick | undefined) => {
  if (p) feed.apply({ type: "pick", pick: p });
  return p;
};

/** Start the pick's writer; the reader's requirements, if any, go into its brief. */
export async function startWriting(p: TopicPick, note = "") {
  const message = note.trim();
  const r = await attempt(() => api.write(p.id, message ? { message } : {}));
  if (r) {
    applied(r.pick);
    notify("开始写了：写手会读原文、出图、写正文，写好会出现在这里");
  }
}

export async function sendToWriter(p: TopicPick, message: string): Promise<boolean> {
  const r = await attempt(() => api.write(p.id, { message }));
  if (r) applied(r.pick);
  return !!r;
}

export async function stopWriting(p: TopicPick) {
  if (await attempt(() => api.stopWriter(p.id))) notify("已让写手停下");
}

export async function saveEdit(p: TopicPick, body: string, reply: string) {
  const d = await attempt(() => api.saveDraft(p.id, { body, reply, note: "读者手改" }));
  if (d) notify(`已存为第 ${d.revision} 版`);
  return d;
}

export async function setStage(p: TopicPick, status: "drafting" | "ready") {
  const r = applied(await attempt(() => api.updatePick(p.id, { status })));
  if (r)
    notify(
      p.status === "published"
        ? "已移回待发布：可以改稿，再发会在 X 上多出一条"
        : status === "ready"
          ? "已进入待发布"
          : "已退回写作中",
    );
}

// The publish frames carry the state; a start notice only shows if the run has not already finished.
export async function rehearse(p: TopicPick) {
  const st = await attempt(() => api.publish(p.id, { rehearsal: true }));
  if (st && publishState.value.running?.pickId === p.id)
    notify("开始排练：会在 X 的编辑框里把稿子填好、核对，但不点发布，最后清空");
}

export async function publishNow(p: TopicPick, override?: string) {
  const st = await attempt(() => api.publish(p.id, override ? { override } : {}));
  if (st && publishState.value.running?.pickId === p.id)
    notify("开始发布：在 X 上填稿、上传配图，然后点发布");
}

/** Post the first reply (the 原文 links) under a published pick's post again; postUrl when its link was not found. */
export async function replyAgain(p: TopicPick, postUrl?: string) {
  const st = await attempt(() => api.replyAgain(p.id, postUrl ? { postUrl } : {}));
  if (st) notify("开始补发首条回复：打开帖子，在下面回复原文链接");
}

export async function ackReply(p: TopicPick, note: string) {
  const e = await attempt(() => api.ack(p.id, { note, reply: true }));
  if (e) {
    publishState.value = { ...publishState.value, reply: e, replyDue: true };
    notify("已记下：首条回复没有发出去，可以补发");
  }
}

export async function ackPublish(p: TopicPick, note: string) {
  const e = await attempt(() => api.ack(p.id, { note }));
  if (e) {
    publishState.value = { ...publishState.value, pick: e };
    notify("已记下：上次没有发出去，可以重新发布");
  }
}
