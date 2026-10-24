// Server configuration from the root .env and flags. Every default here is documented in .env.example.
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { loadNetwork, repoRoot } from "@dna/sdk/node";

export interface Config {
  device: string;
  /** The device's name in dna-network.yaml (DNA_DEVICE_LABEL on devices, written by `just net`). */
  deviceName: string;
  mode: string;
  host: string;
  port: number;
  dataDir: string;
  rootDir: string;
  configDir: string;
  promptsDir: string;
  provider: "openrouter" | "deepseek" | "faux";
  jevBackend: "auto" | "fixture" | "mock" | "ollama" | "openrouter" | "typesafe";
  /** The decision model a local backend (ollama) answers with, e.g. nimble:9b. */
  jevModel?: string;
  /** Policy overrides for the active jev backend, by command: <configDir>/jev-policy.json, keyed by backend. */
  jevPolicy?: Record<string, Record<string, unknown>>;
  /** auto | web | fallback | firecrawl | fixture; SearchService warns on anything else and searches the web. */
  searchMode: string;
  firecrawlKey?: string;
  sweepCredits: number;
  dailyCredits: number;
  /** Topic keywords searched per sweep, heaviest and least recently searched first. */
  sweepQueries: number;
  /** Cap on sources the agent saves with save_source. */
  maxSavedSources: number;
  model: string;
  researchModel: string;
  /** A pi-style auth.json signed in to Anthropic: adds Claude (native ids) next to the provider above. */
  anthropicAuth?: string;
  /** The writer's model: Claude Opus 5.5 when Anthropic is signed in, DeepSeek V4 Pro on DeepSeek, else the agent's. */
  writerModel: string;
  imageModel: string;
  imageQuality: string;
  openaiKey?: string;
  cronSchedule: string;
  clientToken: string;
  cronToken: string;
  stallMinutes: number;
  /** The old jsonl publish ledger to import on start (selfPromotion's publish-ledger.jsonl), so spacing sees it. */
  ledgerImport?: string;
  /** Where a published post is archived as <date>-pick-<id>.md and .png (selfPromotion's 13-published/x). */
  publishedDir?: string;
}

/** apps/dna-server-api: its prompts and default config live with it. */
const APP_DIR = resolve(import.meta.dirname, "..");

const int = (v: string | undefined, d: number) => (v && Number.isFinite(Number(v)) ? Number(v) : d);

export function loadConfig(argv = process.argv.slice(2), env = process.env): Config {
  const { values } = parseArgs({
    args: argv,
    options: {
      port: { type: "string" },
      host: { type: "string" },
      "data-dir": { type: "string" },
      device: { type: "string" },
    },
    allowPositionals: true,
    strict: false,
  });
  const rootDir = repoRoot();
  const provider =
    env.DNA_PROVIDER === "faux"
      ? "faux"
      : env.DNA_PROVIDER === "deepseek"
        ? "deepseek"
        : "openrouter";
  const defaultModel = provider === "deepseek" ? "deepseek-flash" : "anthropic/claude-haiku-5.5";
  const searchMode = env.DNA_SEARCH_MODE?.trim() || "auto";
  const config: Config = {
    device: String(values.device ?? env.DNA_DEVICE_NAME ?? "local"),
    deviceName: "",
    mode: env.DNA_MODE ?? (provider === "faux" ? "faux" : "live"),
    host: String(values.host ?? env.DNA_HOST ?? "127.0.0.1"),
    port: int(values.port as string | undefined, int(env.DNA_PORT, 4850)),
    dataDir: resolve(String(values["data-dir"] ?? env.DNA_DATA_DIR ?? join(rootDir, "data"))),
    rootDir,
    configDir: env.DNA_CONFIG_DIR?.trim()
      ? resolve(rootDir, env.DNA_CONFIG_DIR.trim())
      : join(APP_DIR, "config"),
    promptsDir: join(APP_DIR, "prompt_engineering"),
    provider,
    jevBackend:
      ((env.JEV_BACKEND?.trim() || undefined) as Config["jevBackend"] | undefined) ??
      (searchMode === "fixture" ? "fixture" : "auto"),
    jevModel: env.JEV_MODEL?.trim() || undefined,
    searchMode,
    firecrawlKey: env.FIRECRAWL_API_KEY?.trim() || undefined,
    sweepCredits: int(env.DNA_FIRECRAWL_SWEEP_CREDITS, 5),
    dailyCredits: int(env.DNA_FIRECRAWL_DAILY_CREDITS, 40),
    sweepQueries: int(env.DNA_SWEEP_QUERIES, 15),
    maxSavedSources: int(env.DNA_MAX_SAVED_SOURCES, 25),
    model: env.DNA_MODEL ?? defaultModel,
    researchModel: env.DNA_RESEARCH_MODEL ?? env.DNA_MODEL ?? defaultModel,
    anthropicAuth: provider === "faux" ? undefined : env.DNA_ANTHROPIC_AUTH?.trim() || undefined,
    writerModel:
      env.DNA_WRITER_MODEL?.trim() ||
      (provider !== "faux" && env.DNA_ANTHROPIC_AUTH?.trim()
        ? "claude-opus-5-5"
        : provider === "deepseek"
          ? "deepseek-v4-pro"
          : (env.DNA_MODEL ?? defaultModel)),
    imageModel: env.DNA_IMAGE_MODEL ?? "gpt-image-2.5-flare",
    imageQuality: env.DNA_IMAGE_QUALITY ?? "low",
    openaiKey: env.OPENAI_API_KEY?.trim() || undefined,
    cronSchedule: env.DNA_CRON_SCHEDULE ?? "* * * * *",
    clientToken: env.DNA_CLIENT_TOKEN?.trim() ?? "",
    cronToken: env.DNA_CRON_TOKEN?.trim() ?? "",
    stallMinutes: int(env.DNA_STALL_MINUTES, 30),
    ledgerImport: env.DNA_LEDGER_IMPORT?.trim() || undefined,
    publishedDir: env.DNA_PUBLISHED_DIR?.trim() || undefined,
  };
  config.jevPolicy = jevPolicyFor(config.configDir, config.jevBackend);
  config.deviceName =
    env.DNA_DEVICE_LABEL?.trim() ||
    (() => {
      try {
        return loadNetwork().devices[config.device]?.name;
      } catch {
        return undefined;
      }
    })() ||
    config.device;
  return config;
}

/** <configDir>/jev-policy.json holds thresholds per jev backend ({"ollama": {"relevance": {"relevance_min": 0.35}}}). */
function jevPolicyFor(configDir: string, backend: string) {
  const file = join(configDir, "jev-policy.json");
  if (!existsSync(file)) return undefined;
  const all = JSON.parse(readFileSync(file, "utf8")) as Record<
    string,
    Record<string, Record<string, unknown>>
  >;
  return all[backend];
}

export function assertTokens(config: Config): void {
  for (const [name, token] of [
    ["DNA_CLIENT_TOKEN", config.clientToken],
    ["DNA_CRON_TOKEN", config.cronToken],
  ] as const) {
    if (token.length < 32)
      throw new Error(`${name} must be at least 32 characters. Run: just api tokens`);
  }
  if (config.clientToken === config.cronToken)
    throw new Error("DNA_CLIENT_TOKEN and DNA_CRON_TOKEN must differ. Run: just api tokens");
}

// Next fire time of an every-N-minutes or fixed-minute schedule; enough for the default cron line.
export function nextRun(schedule: string, now = new Date()): Date | undefined {
  const minute = schedule.trim().split(/\s+/)[0];
  const step = minute.match(/^\*\/(\d+)$/)?.[1];
  const next = new Date(now);
  next.setSeconds(0, 0);
  if (step) {
    const n = Number(step);
    next.setMinutes(Math.floor(now.getMinutes() / n) * n + n);
    return next;
  }
  if (/^\d+$/.test(minute)) {
    next.setMinutes(Number(minute));
    if (next <= now) next.setHours(next.getHours() + 1);
    return next;
  }
  return undefined;
}
