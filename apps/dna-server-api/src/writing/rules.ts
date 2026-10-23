// The writer's rules: writer/RULES.md (how to write) and writer/ARGMAP.md (how to draw), from the config dir
// (DNA_CONFIG_DIR) when it has them, else the defaults in config/writer. Read on every turn, so an edit to the rules
// reaches the next turn without a restart.
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { loadPrompt } from "@dna/durable-agent";
import type { Config } from "../config.ts";

const DEFAULTS = resolve(import.meta.dirname, "..", "..", "config", "writer");

function rulesFile(config: Config, name: string): string {
  const own = join(config.configDir, "writer", name);
  return readFileSync(existsSync(own) ? own : join(DEFAULTS, name), "utf8").trim();
}

export function writerPrompt(config: Config): string {
  return loadPrompt(join(config.promptsDir, "agents"), "writer", "SYSTEM_PROMPT.md", {
    writer_rules: rulesFile(config, "RULES.md"),
    argmap_rules: rulesFile(config, "ARGMAP.md"),
  });
}
