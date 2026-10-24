<script setup lang="ts">
// The writer's rules, edited in place: how to write the post (RULES) and how to draw its image (ARGMAP). A save reaches
// the writer's next turn, the pick being written included. Every saved text stays in the version list on the right;
// one can be read and restored. Each tab keeps its own unsaved edit, and closing with one asks first.
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { History, Network, PenLine, RotateCcw, Save, X } from "@lucide/vue";
import type { WriterRule, WriterRuleName, WriterRuleVersion } from "@dna/sdk";
import { api, attempt, notify, ui } from "../client/store";
import { beijingDate } from "../client/time";
import LoadingRows from "./LoadingRows.vue";

const TABS: { name: WriterRuleName; label: string; icon: typeof PenLine; hint: string }[] = [
  { name: "RULES", label: "写作规则", icon: PenLine, hint: "怎么写正文：形态、溯源、口径、格式" },
  { name: "ARGMAP", label: "出图规则", icon: Network, hint: "怎么出论证图：版式、节点、连线" },
];
const SOURCES: Record<WriterRuleVersion["source"], string> = {
  initial: "改之前的原文",
  edit: "在工作台保存",
  restore: "恢复旧版本",
  outside: "在工作台外改过",
};

const rules = ref<Record<string, WriterRule>>({});
const drafts = ref<Record<string, string>>({});
const tab = ref<WriterRuleName>("RULES");
const viewing = ref<{ version: WriterRuleVersion; body: string }>();
const saving = ref(false);
const closing = ref(false);
const restoreArmed = ref(false);

const rule = computed(() => rules.value[tab.value]);
const same = (a = "", b = "") => a.trimEnd() === b.trimEnd();
const dirty = (name: WriterRuleName) =>
  !!rules.value[name] && !same(drafts.value[name], rules.value[name].body);
const anyDirty = computed(() => TABS.some((t) => dirty(t.name)));
/** Version numbers count from the oldest, so 第 1 版 is the text before any edit. */
const number = (id: number) => {
  const list = rule.value?.versions ?? [];
  const i = list.findIndex((v) => v.id === id);
  return i < 0 ? undefined : list.length - i;
};
const text = computed({
  get: () => (viewing.value ? viewing.value.body : (drafts.value[tab.value] ?? "")),
  set: (v: string) => {
    if (!viewing.value) drafts.value[tab.value] = v;
  },
});

function take(r: WriterRule) {
  rules.value[r.name] = r;
  drafts.value[r.name] = r.body;
}
onMounted(async () => {
  const list = await attempt(() => api.writerRules());
  for (const r of list ?? []) take(r);
});

function choose(name: WriterRuleName) {
  tab.value = name;
  viewing.value = undefined;
  restoreArmed.value = false;
}
async function view(v: WriterRuleVersion, i: number) {
  restoreArmed.value = false;
  if (i === 0) {
    viewing.value = undefined;
    return;
  }
  const full = await attempt(() => api.writerRuleVersion(v.id));
  if (full) viewing.value = { version: v, body: full.body };
}
async function save() {
  const name = tab.value;
  if (!dirty(name) || saving.value) return;
  saving.value = true;
  const r = await attempt(() => api.saveWriterRule(name, { body: drafts.value[name] }));
  saving.value = false;
  if (r) {
    take(r);
    notify("已保存。写手从下一轮回复起照新规则写");
  }
}
async function restore() {
  const v = viewing.value;
  if (!v || saving.value) return;
  if (dirty(tab.value) && !restoreArmed.value) {
    restoreArmed.value = true;
    return;
  }
  const n = number(v.version.id);
  saving.value = true;
  const r = await attempt(() =>
    api.saveWriterRule(tab.value, { body: v.body, restoredFrom: v.version.id }),
  );
  saving.value = false;
  if (r) {
    take(r);
    viewing.value = undefined;
    restoreArmed.value = false;
    notify(`已恢复第 ${n} 版，存成了新的一版。写手从下一轮回复起照它写`);
  }
}
function close(force = false) {
  if (anyDirty.value && !force) {
    closing.value = true;
    return;
  }
  ui.rules = false;
}
const onKey = (e: KeyboardEvent) => {
  if (e.key === "Escape") close();
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
    e.preventDefault();
    void save();
  }
};
onMounted(() => addEventListener("keydown", onKey));
onBeforeUnmount(() => removeEventListener("keydown", onKey));
</script>

<template>
  <div class="modal-backdrop" @click.self="close()">
    <section
      class="modal settings-modal rules-modal"
      role="dialog"
      aria-modal="true"
      aria-label="Writing rules editor"
    >
      <header>
        <h2>写作规则</h2>
        <button class="icon-button" aria-label="Close writing rules" title="关闭" @click="close()">
          <X :size="18" />
        </button>
      </header>
      <div class="tabs">
        <button
          v-for="t in TABS"
          :key="t.name"
          class="tab"
          :class="{ on: tab === t.name }"
          :data-rule="t.name"
          :title="t.hint"
          @click="choose(t.name)"
        >
          <component :is="t.icon" :size="15" />{{ t.label
          }}<span v-if="dirty(t.name)" class="rules-dot">（未保存）</span>
        </button>
      </div>
      <div v-if="closing" class="rules-closing" role="alert">
        <span>还有没保存的修改，关掉就丢了。</span>
        <button class="button secondary small" @click="close(true)">放弃修改并关闭</button>
        <button class="button small" @click="closing = false">继续改</button>
      </div>
      <LoadingRows v-if="!rule" kind="block" label="Loading the writing rules" />
      <div v-else class="rules-body">
        <div class="rules-editor">
          <p class="rules-hint">
            保存后，写手从下一轮回复起照这份规则写，正在写的选题也一样。<template v-if="rule.custom"
              >文件：{{ rule.file }}</template
            ><template v-else>现在用的是默认规则；保存后会另存一份到 {{ rule.file }}</template>
          </p>
          <div v-if="viewing" class="rules-viewing">
            <History :size="15" />
            <span
              >正在看第 {{ number(viewing.version.id) }} 版（{{
                beijingDate(viewing.version.createdAt)
              }}），只能看不能改。</span
            >
            <button class="button small" :disabled="saving" @click="restore">
              <RotateCcw :size="14" />{{
                restoreArmed ? "再点一次：丢掉没保存的修改并恢复" : "恢复这一版"
              }}
            </button>
            <button class="button secondary small" @click="view(rule.versions[0], 0)">
              回到当前
            </button>
          </div>
          <textarea
            v-model="text"
            class="draft-body rules-text"
            aria-label="Rule text"
            spellcheck="false"
            :readonly="!!viewing"
          />
          <div class="draft-actions">
            <span class="rules-state"
              >{{ dirty(tab) ? "有没保存的修改" : "已保存" }}，{{ text.length }} 字。Cmd+S
              保存</span
            >
            <button
              class="button secondary small"
              :disabled="!dirty(tab) || !!viewing"
              @click="drafts[tab] = rule.body"
            >
              撤销修改
            </button>
            <button
              class="button small"
              :disabled="!dirty(tab) || saving || !!viewing"
              @click="save"
            >
              <Save :size="14" />保存
            </button>
          </div>
        </div>
        <aside class="rules-versions" aria-label="Rule versions">
          <h3><History :size="15" />历史版本</h3>
          <button
            v-for="(v, i) in rule.versions"
            :key="v.id"
            class="rules-version"
            :class="{ on: viewing ? viewing.version.id === v.id : i === 0 }"
            :title="i === 0 ? '写手现在读的就是这一版' : '点开看这一版，可以恢复'"
            @click="view(v, i)"
          >
            <span
              >第 {{ rule.versions.length - i }} 版<template v-if="i === 0"
                >（当前）</template
              ></span
            >
            <small
              >{{ beijingDate(v.createdAt) }}，{{ SOURCES[v.source]
              }}<template v-if="v.restoredFrom && number(v.restoredFrom)"
                >（第 {{ number(v.restoredFrom) }} 版）</template
              >，{{ v.chars }} 字</small
            >
          </button>
        </aside>
      </div>
    </section>
  </div>
</template>
