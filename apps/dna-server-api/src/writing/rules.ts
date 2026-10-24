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

export function writerPrompt(config: Config): string {
  return loadPrompt(join(config.promptsDir, "agents"), "writer", "SYSTEM_PROMPT.md", {
    writer_rules: readRule(config, "RULES").trim(),
    argmap_rules: readRule(config, "ARGMAP").trim(),
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
