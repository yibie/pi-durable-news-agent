// The writer's rules: writer/RULES.md (how to write) and writer/ARGMAP.md (how to draw). The writer reads the copy
// saved from the workbench (rulesDir), else the device's config dir (DNA_CONFIG_DIR), else the shipped defaults in
// config/writer. Read on every turn, so an edit reaches the writer's next turn without a restart. Every saved text is
// kept as a version; a change made to the file outside the workbench is kept as a version before it is overwritten.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { loadPrompt } from "@dna/durable-agent";
import { WRITER_RULE_NAMES, type WriterRule, type WriterRuleName } from "@dna/sdk";
import type { Config } from "../config.ts";
import type { Store } from "../db/store.ts";
import { invalid } from "../errors.ts";

const DEFAULTS = resolve(import.meta.dirname, "..", "..", "config", "writer");
const FILES: Record<WriterRuleName, string> = { RULES: "RULES.md", ARGMAP: "ARGMAP.md" };

/** The file the writer reads for a rule, and whether it is this device's own copy rather than the shipped default. */
function ruleFile(config: Config, name: WriterRuleName): { path: string; custom: boolean } {
  const fallback = join(DEFAULTS, FILES[name]);
  for (const dir of [config.rulesDir, join(config.configDir, "writer")]) {
    const path = join(dir, FILES[name]);
    if (path !== fallback && existsSync(path)) return { path, custom: true };
  }
  return { path: fallback, custom: false };
}

/** One line ending, no trailing blank lines: the form a rule is compared and saved in. */
const normalize = (text: string) => `${text.replace(/\r\n?/g, "\n").trimEnd()}\n`;

const readRule = (config: Config, name: WriterRuleName) =>
  normalize(readFileSync(ruleFile(config, name).path, "utf8"));

// The 去AI味 v2 pass the writer runs after every draft, unless DNA_AI_TONE=off.
const AI_TONE_ON =
  "- Every time you write or revise a draft, finish with the 去AI味 v2 skill; the reader does not want to be asked first. Read read_ai_tone_guide once per conversation. After save_draft: run check_ai_tone, judge its candidates by the semantic criteria, and rewrite the hits the skill marks 拟改 with its minimal-change rules (no new facts, same claim strength, structure untouched, X-level items never changed). If anything changed, save_draft again and run check_ai_tone once more; do not loop further. The skill's step of waiting for the reader before rewriting does not apply here. The writing rules are the studio's style document: where the skill and the writing rules disagree, keep what the writing rules require (for example 我的判断： and 原文链接在评论区). The post is often under 500 汉字 (meta.short): per-thousand densities then mean little, so act on the locatable hits, not the density thresholds.\n- In the reply after a 去 AI 味 pass, add a short 去 AI 味 section: the hit counts before and after, each change as 原文 → 改后 with its rule number, and what you kept and why. A message that starts with 【去 AI 味】 asks for this pass again on the newest draft, including the reader's own edits.";
const AI_TONE_OFF =
  "- The 去 AI 味 pass is turned off. A message that starts with 【去 AI 味】 gets a one-line reply saying so; do not check or rewrite for it.";

const WRITER_TOOL_LIST = (aiTone: boolean) =>
  [
    "read_pick",
    "read_source",
    "search_web",
    "recent_layouts",
    "render_argmap",
    ...(aiTone ? ["read_ai_tone_guide", "check_ai_tone"] : []),
    "save_draft",
  ].join(", ");

export function writerPrompt(config: Config): string {
  return loadPrompt(join(config.promptsDir, "agents"), "writer", "SYSTEM_PROMPT.md", {
    writer_rules: readRule(config, "RULES").trim(),
    argmap_rules: readRule(config, "ARGMAP").trim(),
    ai_tone_instructions: config.aiTone ? AI_TONE_ON : AI_TONE_OFF,
    tool_list: `${WRITER_TOOL_LIST(config.aiTone)}.`,
  });
}

export const isRuleName = (name: string): name is WriterRuleName =>
  (WRITER_RULE_NAMES as readonly string[]).includes(name);

/** The rule's text now, recorded as a version when it is not the newest one: the first look keeps the text before
 * any edit, and a change made outside the workbench is kept before a save overwrites it. */
function track(config: Config, store: Store, name: WriterRuleName): string {
  const text = readRule(config, name);
  const latest = store.rules.latest(name);
  if (!latest) store.rules.add(name, text, "initial");
  else if (latest.body !== text) store.rules.add(name, text, "outside");
  return text;
}

export function writerRule(config: Config, store: Store, name: WriterRuleName): WriterRule {
  const body = track(config, store, name);
  return {
    name,
    body,
    file: join(config.rulesDir, FILES[name]),
    custom: ruleFile(config, name).custom,
    versions: store.rules.versions(name),
  };
}

/** Save a rule where the writer reads it first, and keep the text as a version. Saving the same text is a no-op. */
export function saveWriterRule(
  config: Config,
  store: Store,
  name: WriterRuleName,
  body: string,
  restoredFrom?: number,
): WriterRule {
  const text = normalize(body);
  if (!text.trim()) throw invalid("规则不能是空的：清空以后写手就没有规则可依");
  if (restoredFrom !== undefined && store.rules.version(restoredFrom)?.name !== name)
    throw invalid(`版本 ${restoredFrom} 不是 ${name} 的版本`);
  const current = track(config, store, name);
  if (text !== current) {
    mkdirSync(config.rulesDir, { recursive: true });
    const file = join(config.rulesDir, FILES[name]);
    const tmp = `${file}.${process.pid}.tmp`;
    writeFileSync(tmp, text);
    renameSync(tmp, file);
    store.rules.add(name, text, restoredFrom === undefined ? "edit" : "restore", restoredFrom);
  }
  return writerRule(config, store, name);
}
