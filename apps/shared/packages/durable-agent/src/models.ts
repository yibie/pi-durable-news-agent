// The model catalog: Haiku 5.5 (default) plus 29 more models, all through OpenRouter.
// DNA_PROVIDER=deepseek uses DeepSeek's own API instead (DEEPSEEK_API_KEY), with its two chat models.
// Either one can add Claude through Anthropic's own API (`anthropic: true`), signed in through a credential store
// such as pi's auth.json; OpenRouter-style Claude ids then resolve to the native ones.
// DNA_PROVIDER=faux swaps in a free deterministic model with the same 1M window.
import type { CredentialStore } from "@earendil-works/pi-ai";
import { createModels, type MutableModels } from "@earendil-works/pi-ai/models";
import { anthropicProvider } from "@earendil-works/pi-ai/providers/anthropic";
import { deepseekProvider } from "@earendil-works/pi-ai/providers/deepseek";
import { openrouterProvider } from "@earendil-works/pi-ai/providers/openrouter";
import type { ModelRef } from "@earendil-works/pi-durable";

export type CatalogProvider = "openrouter" | "deepseek" | "faux";

export interface CatalogEntry {
  id: string;
  name: string;
  tier: string;
  icon: string;
}

export interface ModelInfo extends CatalogEntry {
  provider: string;
  contextWindow: number;
  reasoning: boolean;
  cost: { input: number; output: number };
}

export const DEFAULT_MODEL = "anthropic/claude-haiku-5.5";
export const DEEPSEEK_DEFAULT_MODEL = "deepseek-flash";
export const FAUX_WINDOW = 1_000_000;
export const FAUX_MODEL = "faux-haiku";

export const CATALOG: readonly CatalogEntry[] = [
  { id: "anthropic/claude-haiku-5.5", name: "Claude Haiku 5.5", tier: "A", icon: "anthropic.png" },
  { id: "anthropic/claude-opus-5.5", name: "Claude Opus 5.5", tier: "S+", icon: "anthropic.png" },
  {
    id: "anthropic/claude-sonnet-5.5",
    name: "Claude Sonnet 5.5",
    tier: "S+",
    icon: "anthropic.png",
  },
  { id: "anthropic/claude-fable-5.1", name: "Claude Fable 5.1", tier: "S+", icon: "anthropic.png" },
  { id: "openai/gpt-6-astra", name: "GPT-6 Astra", tier: "S+", icon: "openai.png" },
  { id: "anthropic/claude-opus-5", name: "Opus 5", tier: "S+", icon: "anthropic.png" },
  { id: "openai/gpt-6.1-sol", name: "GPT-6.1 Sol", tier: "S+", icon: "openai.png" },
  { id: "anthropic/claude-fable-5", name: "Fable 5", tier: "S", icon: "anthropic.png" },
  { id: "meta/muse-spark-1.3", name: "Muse Spark 1.3", tier: "S", icon: "meta.png" },
  { id: "openai/gpt-6-sol", name: "GPT-6 Sol", tier: "S", icon: "openai.png" },
  { id: "x-ai/grok-4.7", name: "Grok 4.7", tier: "S", icon: "grok.png" },
  { id: "xiaomi/mimo-v2.6-pro", name: "MiMo-V2.6-Pro", tier: "S", icon: "xiaomi.png" },
  { id: "x-ai/grok-4.6", name: "Grok 4.6", tier: "S", icon: "grok.png" },
  { id: "z-ai/glm-5.3", name: "GLM-5.3", tier: "A", icon: "zai.png" },
  { id: "moonshotai/kimi-k3", name: "Kimi K3", tier: "A", icon: "kimi.png" },
  { id: "openai/gpt-5.6-terra", name: "GPT 5.6 Terra", tier: "A", icon: "openai.png" },
  { id: "google/gemini-3.8-flash", name: "Gemini 3.8 Flash", tier: "A", icon: "gemini.png" },
  { id: "qwen/qwen3.8-2.4t-a95b", name: "Qwen3.8-2.4T-A95B", tier: "A", icon: "qwen.png" },
  {
    id: "deepseek/deepseek-v4.1-flash",
    name: "DeepSeek V4.1 Flash",
    tier: "A",
    icon: "deepseek.png",
  },
  { id: "google/gemini-3.7-flash", name: "Gemini 3.7 Flash", tier: "A", icon: "gemini.png" },
  { id: "anthropic/claude-sonnet-5", name: "Sonnet 5", tier: "A", icon: "anthropic.png" },
  { id: "openai/gpt-6-luna", name: "GPT-6 Luna", tier: "A", icon: "openai.png" },
  { id: "xiaomi/mimo-v2.6-flash", name: "MiMo-V2.6-Flash", tier: "A", icon: "xiaomi.png" },
  { id: "openai/gpt-5.6-luna", name: "GPT 5.6 Luna", tier: "A", icon: "openai.png" },
  {
    id: "deepseek/deepseek-v4-pro-0813",
    name: "DeepSeek V4 Pro 0813",
    tier: "A",
    icon: "deepseek.png",
  },
  { id: "z-ai/glm-5.2", name: "GLM-5.2", tier: "A", icon: "zai.png" },
  { id: "z-ai/glm-5.3-flash", name: "GLM-5.3-Flash", tier: "B", icon: "zai.png" },
  { id: "google/gemini-3.1-pro-preview", name: "Gemini 3.1 Pro", tier: "B", icon: "gemini.png" },
  { id: "minimax/minimax-m3", name: "MiniMax-M3", tier: "B", icon: "minimax.png" },
  {
    id: "google/gemini-3.5-flash-lite",
    name: "Gemini 3.5 Flash-Lite",
    tier: "B",
    icon: "gemini.png",
  },
];

/** DeepSeek's direct API: ids are DeepSeek's own, not OpenRouter's. */
export const DEEPSEEK_CATALOG: readonly CatalogEntry[] = [
  { id: "deepseek-flash", name: "DeepSeek V4.1 Flash", tier: "A", icon: "deepseek.png" },
  { id: "deepseek-v4-pro", name: "DeepSeek V4 Pro", tier: "A", icon: "deepseek.png" },
];

/** Anthropic's direct API: native ids, used next to the provider above when Claude is signed in. */
export const ANTHROPIC_CATALOG: readonly CatalogEntry[] = [
  { id: "claude-opus-5-5", name: "Claude Opus 5.5", tier: "S+", icon: "anthropic.png" },
  { id: "claude-sonnet-5-5", name: "Claude Sonnet 5.5", tier: "S+", icon: "anthropic.png" },
  { id: "claude-fable-5-1", name: "Claude Fable 5.1", tier: "S+", icon: "anthropic.png" },
  { id: "claude-haiku-5-5", name: "Claude Haiku 5.5", tier: "A", icon: "anthropic.png" },
];

/** anthropic/claude-haiku-5.5 (OpenRouter) to claude-haiku-5-5 (Anthropic). */
export function nativeClaudeId(id: string): string | undefined {
  const m = /^anthropic\/(claude-[a-z]+-[\d.]+)$/.exec(id);
  return m ? m[1]!.replaceAll(".", "-") : undefined;
}

export interface ModelCatalog {
  readonly models: MutableModels;
  readonly provider: CatalogProvider;
  readonly defaultModel: ModelRef;
  list(): ModelInfo[];
  /** A catalog id to a pi-durable model reference; throws for ids outside the catalog. */
  ref(id: string): ModelRef;
  info(id: string): ModelInfo | undefined;
}

export function createModelCatalog(options: {
  provider: CatalogProvider;
  installFaux?: (models: MutableModels) => void;
  defaultModel?: string;
  /** Also offer Claude through Anthropic's own API. */
  anthropic?: boolean;
  /** Where signed-in providers keep their credentials (OAuth refreshes write back here). */
  credentials?: CredentialStore;
}): ModelCatalog {
  const models = createModels(options.credentials ? { credentials: options.credentials } : {});
  if (options.provider === "faux") {
    if (!options.installFaux) throw new Error("A faux catalog needs installFaux");
    options.installFaux(models);
    const free = {
      provider: "faux",
      contextWindow: FAUX_WINDOW,
      reasoning: false,
      cost: { input: 0, output: 0 },
    };
    const all: ModelInfo[] = [
      { id: FAUX_MODEL, name: "Faux Haiku", tier: "T", icon: "lab.png", ...free },
      ...CATALOG.map((c) => ({ ...c, ...free })),
    ];
    return {
      models,
      provider: "faux",
      defaultModel: { provider: "faux", modelId: FAUX_MODEL },
      list: () => all,
      ref: (id) => {
        if (!all.some((m) => m.id === id))
          throw new Error(
            `Unknown model ${id}. The faux catalog mirrors the ${CATALOG.length} catalog models plus ${FAUX_MODEL}.`,
          );
        return { provider: "faux", modelId: id };
      },
      info: (id) => all.find((m) => m.id === id),
    };
  }
  const live =
    options.provider === "deepseek"
      ? {
          id: "deepseek",
          name: "DeepSeek",
          provider: deepseekProvider(),
          catalog: DEEPSEEK_CATALOG,
          fallback: DEEPSEEK_DEFAULT_MODEL,
        }
      : {
          id: "openrouter",
          name: "OpenRouter",
          provider: openrouterProvider(),
          catalog: CATALOG,
          fallback: DEFAULT_MODEL,
        };
  const lives = [
    live,
    ...(options.anthropic
      ? [
          {
            id: "anthropic",
            name: "Anthropic",
            provider: anthropicProvider(),
            catalog: ANTHROPIC_CATALOG,
            fallback: "claude-haiku-5-5",
          },
        ]
      : []),
  ];
  const entries = lives.flatMap((l) => {
    models.setProvider(l.provider);
    const known = l.provider.getModels();
    const missing = l.catalog.filter((c) => !known.some((m) => m.id === c.id)).map((c) => c.id);
    if (missing.length) throw new Error(`${l.name} catalog is missing: ${missing.join(", ")}`);
    return l.catalog.map((c) => {
      const m = known.find((x) => x.id === c.id)!;
      return {
        ...c,
        provider: l.id,
        contextWindow: m.contextWindow,
        reasoning: m.reasoning,
        cost: { input: m.cost.input, output: m.cost.output },
      };
    });
  });
  const list = () => entries;
  const defaultId = options.defaultModel ?? live.fallback;
  const find = (id: string) =>
    entries.find((m) => m.id === id) ??
    (options.anthropic && live.id !== "openrouter"
      ? entries.find((m) => m.id === nativeClaudeId(id))
      : undefined);
  const ref = (id: string): ModelRef => {
    const entry = find(id);
    if (!entry)
      throw new Error(`Unknown model ${id}. Pick one of the ${entries.length} catalog models.`);
    return { provider: entry.provider, modelId: entry.id };
  };
  return {
    models,
    provider: options.provider,
    defaultModel: ref(defaultId),
    list,
    ref,
    info: (id) => find(id),
  };
}
