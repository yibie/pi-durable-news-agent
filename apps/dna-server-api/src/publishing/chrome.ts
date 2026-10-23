// The logged-in Chrome that posts to X: a separate profile (/tmp/chrome-cdp-profile) with remote debugging on 9333.
// Ported from selfPromotion's cdp-ensure.sh and publish.py: start it through `open -n` (launchd) so it outlives the
// caller, make sure it has a usable http page (a lone about:blank makes every later step fail), and close stray
// compose and blank pages, except while an Article editor is open.
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { sleep } from "./devtools.ts";

export const CDP_PORT = 9333;
export const CDP_URL = `http://127.0.0.1:${CDP_PORT}`;
const PROFILE = "/tmp/chrome-cdp-profile";
const START_URL = "https://x.com/home";

interface Target {
  id: string;
  type: string;
  url: string;
}

async function targets(): Promise<Target[] | undefined> {
  try {
    const res = await fetch(`${CDP_URL}/json/list`, { signal: AbortSignal.timeout(5_000) });
    return res.ok ? ((await res.json()) as Target[]) : undefined;
  } catch {
    return undefined;
  }
}

const usable = (t: Target) =>
  t.type === "page" && t.url.startsWith("http") && !t.url.includes("about:blank");

async function launch(): Promise<void> {
  mkdirSync(PROFILE, { recursive: true });
  await new Promise<void>((ok) => {
    const child = spawn(
      "open",
      [
        "-n",
        "-a",
        "Google Chrome",
        "--args",
        `--user-data-dir=${PROFILE}`,
        `--remote-debugging-port=${CDP_PORT}`,
        "--no-first-run",
        "--no-default-browser-check",
        START_URL,
      ],
      { stdio: "ignore", detached: true },
    );
    child.on("exit", () => ok());
    child.on("error", () => ok());
  });
}

/** Close extra blank, compose and duplicate x.com pages, keeping one; never while an Article editor is open. */
async function tidy(list: Target[]): Promise<number> {
  const pages = list.filter((t) => t.type === "page");
  if (pages.length <= 1 || pages.some((t) => t.url.includes("/compose/articles"))) return 0;
  const x = pages.filter((t) => t.url.startsWith("https://x.com") && !t.url.includes("/compose"));
  const http = pages.filter((t) => t.url.startsWith("http") && !t.url.includes("/compose"));
  const keep = (x[0] ?? http[0] ?? pages[0])!.id;
  let closed = 0;
  for (const t of pages) {
    const blank = !t.url.startsWith("http");
    const compose = t.url.startsWith("http") && t.url.includes("/compose");
    const dupX = t.url.startsWith("https://x.com") && t.id !== keep;
    if (t.id !== keep && (blank || compose || dupX)) {
      try {
        await fetch(`${CDP_URL}/json/close/${t.id}`, { signal: AbortSignal.timeout(5_000) });
        closed++;
      } catch {}
    }
  }
  return closed;
}

/** The Chrome is up with a usable page, starting it if needed. Throws with what failed. */
export async function ensureChrome(log: (msg: string) => void = () => {}): Promise<void> {
  let list = await targets();
  if (!list) {
    log("chrome not answering on 9333, starting it");
    await launch();
    for (let i = 0; i < 30 && !list; i++) {
      await sleep(2_000);
      list = await targets();
    }
    if (!list) throw new Error(`Chrome on ${CDP_PORT} did not come up (profile ${PROFILE})`);
  }
  const closed = await tidy(list);
  if (closed) log(`closed ${closed} extra pages`);
  if ((await targets())?.some(usable)) return;
  await fetch(`${CDP_URL}/json/new?${START_URL}`, {
    method: "PUT",
    signal: AbortSignal.timeout(10_000),
  });
  await sleep(4_000);
  if (!(await targets())?.some(usable))
    throw new Error(`Chrome on ${CDP_PORT} has no usable http page`);
}
