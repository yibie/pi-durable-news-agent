// Writing in the browser: the pick the reader opened, its drafts, and its writer conversation. The writer runs in its
// own conversation, so it gets its own stream and agent model while a pick is open; the main stream stays as it is.
import { computed, ref, shallowRef, watch } from "vue";
import { AgentModel, follow, type Draft, type TopicPick } from "@dna/sdk";
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

let writer: AgentModel | undefined;
export const writerView = shallowRef(new AgentModel().state);
let stopStream: AbortController | undefined;

/** Ready to publish needs an image, clean text and a clean image: the server says what is missing. */
export const draftProblems = computed(() => {
  const d = shownDraft.value;
  if (!d) return [];
  return [
    ...d.lint.markdown.map((h) => `第 ${h.line} 行有 Markdown：${h.text}`),
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
      if (id) void loadDrafts(id);
    }
    if (!id || !conversation) return unfollow();
    if (conversation !== before?.[1] || id !== before?.[0]) follow_(Number(conversation));
  },
);

onFrame((frame) => {
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

export async function startWriting(p: TopicPick) {
  const r = await attempt(() => api.write(p.id));
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

export async function saveEdit(p: TopicPick, body: string) {
  const d = await attempt(() => api.saveDraft(p.id, { body, note: "读者手改" }));
  if (d) notify(`已存为第 ${d.revision} 版`);
  return d;
}

export async function setStage(p: TopicPick, status: "drafting" | "ready") {
  const r = applied(await attempt(() => api.updatePick(p.id, { status })));
  if (r) notify(status === "ready" ? "已进入待发布" : "已退回写作中");
}
