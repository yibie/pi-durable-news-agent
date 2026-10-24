// The local decision model lives in this Mac's Ollama app, which the reader can quit. Before a sweep phase asks it
// anything, make sure it answers; if it does not, open the app (in the background) and wait for its server. A sweep
// that still cannot reach it fails the phase, which retries with backoff, instead of failing every item it holds.
import { execFile } from "node:child_process";
import type { Logger } from "@dna/sdk/node";

export interface LocalDeciderDeps {
  log?: Logger;
  /** How long to wait for the server after opening the app. */
  waitMs?: number;
  pollMs?: number;
  /** Injected in tests. */
  fetch?: typeof fetch;
  open?: () => Promise<void>;
}

const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]"]);

const openApp = () =>
  new Promise<void>((resolve, reject) =>
    execFile("open", ["-g", "-a", "Ollama"], (error) => (error ? reject(error) : resolve())),
  );

/** Resolves once the Ollama server behind `endpoint` answers; throws when it cannot be brought up. */
export async function ensureLocalDecider(
  endpoint: string,
  deps: LocalDeciderDeps = {},
): Promise<void> {
  const get = deps.fetch ?? fetch;
  const { origin, host } = new URL(endpoint);
  const up = async () => {
    try {
      return (await get(`${origin}/api/version`, { signal: AbortSignal.timeout(2000) })).ok;
    } catch {
      return false;
    }
  };
  if (await up()) return;
  // Only an Ollama on this Mac can be opened from here.
  if (!LOOPBACK.has(host.replace(/:\d+$/, "")) || (!deps.open && process.platform !== "darwin"))
    throw new Error(`The local decision model does not answer at ${origin}. Start Ollama there.`);
  deps.log?.warn("decider.opening_ollama", { origin });
  try {
    await (deps.open ?? openApp)();
  } catch (error) {
    throw new Error(
      `The local decision model does not answer at ${origin}, and opening the Ollama app failed: ${String(error)}`,
    );
  }
  const end = Date.now() + (deps.waitMs ?? 60_000);
  while (Date.now() < end) {
    await new Promise((r) => setTimeout(r, deps.pollMs ?? 1000));
    if (await up()) {
      deps.log?.info("decider.ollama_up", { origin });
      return;
    }
  }
  throw new Error(
    `The local decision model does not answer at ${origin}, even after opening the Ollama app.`,
  );
}
