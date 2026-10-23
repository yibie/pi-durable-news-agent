// X accounts, through the twitter CLI (ported from selfPromotion's scout_collect.py scan_x): an account is a web_page
// source whose url is its profile (https://x.com/<handle>). Its latest posts, replies and retweets left out; a post
// that links an article becomes that article (so it can be traced to its source), any other post is the post itself.
// The CLI reads X's cookies from DNA_TWITTER_ENV (default ~/.config/selfpromotion/twitter.env) before the browser's,
// which a server started outside a terminal cannot read. A missing login is a skip, not a failure: one expired cookie
// must not disable every account.
import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import type { FeedEntry, Fetcher, FetchResult } from "./types.ts";

const KEYS = ["TWITTER_AUTH_TOKEN", "TWITTER_CT0"];
const SKIP_HOSTS = new Set([
  "x.com",
  "twitter.com",
  "t.co",
  "reddit.com",
  "play.google.com",
  "apps.apple.com",
]);
const SKIP_EXT =
  /\.(xml|json|jpe?g|png|gif|svg|css|js|webp|avif|ico|mp4|webm|m3u8|woff2?|ttf|otf)$/i;
const POSTS = 10;
const TIMEOUT_MS = 30_000;

/** The handle of an x.com or twitter.com profile url, else undefined. */
export function xHandle(url: string): string | undefined {
  const m = /^https:\/\/(?:www\.)?(?:x|twitter)\.com\/([A-Za-z0-9_]{1,15})\/?$/.exec(url);
  return m?.[1];
}

function cookieEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  const file = (process.env.DNA_TWITTER_ENV ?? "~/.config/selfpromotion/twitter.env").replace(
    /^~\//,
    `${homedir()}/`,
  );
  if (!existsSync(file)) return env;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const [key, ...rest] = line.trim().split("=");
    const value = rest.join("=");
    if (key && KEYS.includes(key) && value && !env[key]) env[key] = value;
  }
  return env;
}

function run(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((ok) =>
    execFile(
      "twitter",
      args,
      { env: cookieEnv(), timeout: TIMEOUT_MS, maxBuffer: 8 * 1024 * 1024 },
      (error, stdout, stderr) =>
        ok({
          code: error ? ((error as { code?: number }).code ?? 1) : 0,
          stdout: String(stdout),
          stderr: String(stderr),
        }),
    ),
  );
}

/** The first JSON object or array in the output (the CLI may print warnings first). */
function payload(text: string): any {
  for (let i = 0; i < text.length; i++) {
    const open = text[i];
    if (open !== "{" && open !== "[") continue;
    const end = text.lastIndexOf(open === "{" ? "}" : "]");
    if (end <= i) continue;
    try {
      return JSON.parse(text.slice(i, end + 1));
    } catch {}
  }
  return undefined;
}

/** The CLI's own error (code: message), which it prints as JSON on stdout. */
function cliError(r: { code: number; stdout: string; stderr: string }): string {
  const p = payload(r.stdout);
  const e = p && typeof p === "object" ? p.error : undefined;
  if (e && typeof e === "object") return `${e.code ?? "error"}: ${e.message ?? ""}`.trim();
  return (r.stderr || r.stdout || `exit ${r.code}`).replace(/\s+/g, " ").trim().slice(0, 300);
}

interface Tweet {
  id: string;
  text: string;
  createdAtISO?: string;
  author?: { screenName?: string; name?: string };
  metrics?: { likes?: number; replies?: number };
  urls?: string[];
  quotedTweet?: { text?: string; author?: { screenName?: string } };
  articleTitle?: string;
}

function articleLink(urls: string[] | undefined): string | undefined {
  for (const url of urls ?? []) {
    try {
      const u = new URL(url);
      const host = u.hostname.replace(/^www\./, "");
      if (!/^https?:$/.test(u.protocol) || SKIP_HOSTS.has(host) || SKIP_EXT.test(u.pathname))
        continue;
      return url;
    } catch {}
  }
  return undefined;
}

const ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
};
const decode = (text: string) => text.replace(/&(amp|lt|gt|quot|#39);/g, (m) => ENTITIES[m] ?? m);

export function tweetEntry(handle: string, raw: Tweet): FeedEntry {
  const t = { ...raw, text: decode(raw.text) };
  const own = `https://x.com/${t.author?.screenName ?? handle}/status/${t.id}`;
  const link = articleLink(t.urls);
  const quoted = t.quotedTweet?.text
    ? `\n\nQuoting @${t.quotedTweet.author?.screenName ?? "?"}: ${decode(t.quotedTweet.text)}`
    : "";
  const firstLine = t.text
    .replace(/https:\/\/t\.co\/\S+/g, "")
    .trim()
    .split("\n")[0]!
    .trim();
  const title =
    t.articleTitle ?? (firstLine.length > 140 ? `${firstLine.slice(0, 137)}...` : firstLine);
  return {
    url: link ?? own,
    title: title || `@${handle}`,
    excerpt: `@${handle}: ${t.text}${quoted}`.slice(0, 1200),
    publishedAt: t.createdAtISO,
    author: `@${handle}`,
    discussionUrl: link ? own : undefined,
    points: t.metrics?.likes,
    comments: t.metrics?.replies,
  };
}

export const fetchXUser: Fetcher = async (source): Promise<FetchResult> => {
  const handle = xHandle(source.url);
  if (!handle)
    return { ok: false, status: "error", entries: [], error: `not an X profile: ${source.url}` };
  const attempts: [string, string[]][] = [
    [
      "search",
      [
        "search",
        "--from",
        handle,
        "--type",
        "latest",
        "--exclude",
        "replies",
        "--exclude",
        "retweets",
        "-n",
        String(POSTS),
        "--json",
      ],
    ],
    ["user-posts", ["user-posts", handle, "-n", String(POSTS), "--json"]],
  ];
  const errors: string[] = [];
  for (const [label, args] of attempts) {
    let r;
    try {
      r = await run(args);
    } catch (error) {
      errors.push(`${label}: ${String(error).slice(0, 200)}`);
      continue;
    }
    if ((r as { code: unknown }).code === "ENOENT")
      throw new Error("the twitter CLI is not installed (uv tool install twitter-cli)");
    const p = payload(r.stdout);
    if (r.code === 0 && p && p.ok !== false) {
      const tweets: Tweet[] = (Array.isArray(p.data) ? p.data : []).filter(
        (t: Tweet) => t && typeof t.text === "string" && t.id,
      );
      return {
        ok: true,
        status: `ok via ${label}`,
        entries: tweets.map((t) => tweetEntry(handle, t)),
      };
    }
    errors.push(`${label}: ${cliError(r)}`);
  }
  const message = errors.join("; ");
  if (/not_authenticated|auth/i.test(message))
    throw Object.assign(new Error(message.slice(0, 300)), {
      skip: "X login missing or expired: refresh the cookie file in a terminal with python3 ~/Documents/prj/selfPromotion/40-49-tools/twitter_env.py",
    });
  throw new Error(message.slice(0, 600));
};
