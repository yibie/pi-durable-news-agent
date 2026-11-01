// Posting on X through the 工作台发帖桥 extension in the everyday Chrome, on a tab it opens for the job: open the composer
// (a quote opens it from the post's retweet menu, the only way X attaches the quoted card), insert the text, attach the
// image, check the composer, then click Post. A rehearsal stops before the click and empties the composer. After the
// click, a closed composer is ok; one still open is unknown, because X may have posted anyway, and its tab stays open
// for the reader to look at. A posted post's link comes from X's "post sent" notice, else from the newest matching post
// on the account's profile; the first reply (the 原文 links) is posted under it from its page.
import { readFileSync } from "node:fs";
import { basename, extname } from "node:path";
import { bridge } from "./bridge.ts";

export interface PostInput {
  text: string;
  /** Absolute paths. */
  images: string[];
  /** A quote post: the post on X it quotes. */
  quoteUrl?: string;
  rehearsal: boolean;
  /** Called right before Post is clicked: the ledger's pending line. */
  beforeClick: () => void;
  phase: (name: string) => void;
}

/** The first reply: posted under a post, from the post's own page. */
export interface ReplyInput {
  /** The post replied to: https://x.com/<account>/status/<id>, or x.com/i/status/<id>. */
  postUrl: string;
  text: string;
  rehearsal: boolean;
  beforeClick: () => void;
  phase: (name: string) => void;
}

export type PostOutcome =
  | { status: "ok" | "unknown"; detail: string; url?: string }
  | { status: "failed"; detail: string }
  | { status: "rehearsed"; detail: string; clean: boolean };

interface ComposerState {
  text: string;
  button: string;
  media: number;
  card: boolean;
  dialog: boolean;
  dialogText: string;
}

const COMPOSE = "https://x.com/compose/post";
const sleep = (ms: number) => new Promise((ok) => setTimeout(ok, ms));
const norm = (s: string) => s.replace(/\s+/g, "");

const page = <T = any>(op: string, tabId: number, ...args: unknown[]) =>
  bridge.command<T>(op, { tabId, args });
const read = (tabId: number, quoteId?: string) =>
  page<ComposerState>("read", tabId, quoteId ?? null);
const openTab = async (url: string) =>
  (await bridge.command<{ tabId: number }>("open", { url })).tabId;
const closeTab = (tabId: number) => bridge.command("close", { tabId }).catch(() => undefined);

/** Poll until `fn` gives something truthy, or undefined when the time is up. */
async function until<T>(fn: () => Promise<T>, ms: number): Promise<T | undefined> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = await fn().catch(() => undefined);
    if (v) return v;
    await sleep(1_000);
  }
  return undefined;
}

const MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
};

async function attach(tabId: number, images: string[]) {
  const files = images.map((path) => ({
    name: basename(path),
    type: MIME[extname(path).toLowerCase()] ?? "image/png",
    b64: readFileSync(path).toString("base64"),
  }));
  if (!(await page("attach", tabId, files))) throw new Error("no file input in the composer");
  await until(async () => (await read(tabId)).media >= images.length, 30_000);
  await page("applyMedia", tabId);
}

/** Empty the composer after a rehearsal, close it, and check a fresh composer is empty. */
async function discard(tabId: number): Promise<boolean> {
  await page("clear", tabId).catch(() => undefined);
  await page("removeMedia", tabId).catch(() => undefined);
  await sleep(1_000);
  await closeTab(tabId);
  const fresh = await openTab(COMPOSE);
  try {
    if (!(await until(() => page("ready", fresh), 20_000))) return false;
    await sleep(1_500);
    const s = await read(fresh);
    return s.text.trim().length === 0 && s.media === 0;
  } finally {
    await closeTab(fresh);
  }
}

async function openQuote(tabId: number) {
  for (let attempt = 0; attempt < 3; attempt++) {
    await until(() => page("retweetMenu", tabId), 20_000);
    if (await until(() => page("quoteItem", tabId), 5_000)) return;
  }
  throw new Error("the retweet menu has no Quote item");
}

/** Wait for the button while X finishes the image, and list what is wrong with the composer. */
async function checkComposer(
  tabId: number,
  text: string,
  images: number,
  quoteId?: string,
): Promise<{ state: ComposerState; problems: string[] }> {
  await until(async () => (await read(tabId, quoteId)).button === "enabled", 30_000);
  const state = await read(tabId, quoteId);
  const problems = [
    norm(state.text) !== norm(text)
      ? `the text is not what was written (${state.text.length} of ${text.length} characters)`
      : "",
    images && state.media < images ? `${state.media} of ${images} images attached` : "",
    quoteId && !state.card ? "the quoted card is missing" : "",
    quoteId && state.text.includes(quoteId) ? "the quoted post's id is in the text" : "",
    state.button !== "enabled" ? `the Post button is ${state.button}` : "",
  ].filter(Boolean);
  return { state, problems };
}

export async function postToX(input: PostInput): Promise<PostOutcome> {
  let tabId: number | undefined;
  let clicked = false;
  let keep = false;
  try {
    input.phase("compose");
    const quoteId = input.quoteUrl?.match(/status\/(\d+)/)?.[1];
    if (input.quoteUrl && !quoteId) throw new Error(`not a post url: ${input.quoteUrl}`);
    tabId = await openTab(input.quoteUrl ?? COMPOSE);
    const tab = tabId;
    if (input.quoteUrl) await openQuote(tab);
    if (!(await until(() => page("ready", tab), 20_000)))
      return { status: "failed", detail: "the composer has no text box" };
    await page("clear", tab);
    input.phase("type");
    if (!(await page("insert", tab, input.text))) throw new Error("the text did not go in");
    await sleep(1_000);
    if (input.images.length) {
      input.phase("attach");
      await attach(tab, input.images);
    }
    input.phase("check");
    const { state, problems } = await checkComposer(tab, input.text, input.images.length, quoteId);
    const summary = `len ${state.text.length}, media ${state.media}, button ${state.button}${quoteId ? `, card ${state.card}` : ""}`;
    if (input.rehearsal) {
      input.phase("discard");
      const clean = await discard(tab);
      tabId = undefined;
      return {
        status: "rehearsed",
        clean,
        detail: problems.length
          ? `would not post: ${problems.join("; ")} (${summary})`
          : `ready to post (${summary})`,
      };
    }
    if (problems.length) return { status: "failed", detail: `not posted: ${problems.join("; ")}` };
    input.phase("click");
    input.beforeClick();
    clicked = true;
    if (!(await page("clickPost", tab))) throw new Error("the Post button was gone at the click");
    // X says "post sent" with a link to the new post for a few seconds: catch it while the post settles.
    input.phase("settle");
    let url = "";
    for (let i = 0; i < 10 && !url; i++) {
      await sleep(1_000);
      url = await page<string>("sent", tab).catch(() => "");
    }
    const at = await bridge.command<string>("url", { tabId: tab });
    if (at.includes("/compose/post")) {
      keep = true;
      return {
        status: "unknown",
        detail: `clicked Post, the composer is still open (${summary})`,
      };
    }
    url ||= await ownPost(tab, input.text).catch(() => "");
    return {
      status: "ok",
      detail: `posted (${summary})${url ? `: ${url}` : ", its link was not found"}`,
      ...(url ? { url } : {}),
    };
  } catch (error) {
    const detail = String((error as Error).message ?? error).slice(0, 300);
    if (clicked) keep = true;
    return clicked
      ? { status: "unknown", detail: `after the click: ${detail}` }
      : { status: "failed", detail };
  } finally {
    if (tabId !== undefined && !keep) {
      if (!clicked) await page("clear", tabId).catch(() => undefined);
      await closeTab(tabId);
    }
  }
}

/** The newest post on the signed-in account's profile whose text starts like `text`, or "". */
export async function ownPost(tabId: number, text: string): Promise<string> {
  const handle = await until(() => page<string>("handle", tabId), 10_000);
  if (!handle) return "";
  await bridge.command("navigate", { tabId, url: `https://x.com/${handle}` });
  const start = norm(text).slice(0, 24);
  return (await until(() => page<string>("findOwn", tabId, start), 20_000)) ?? "";
}

/** Reply under a post from its page: open the reply box, insert the text, check it is a reply with the whole text,
 * click. A rehearsal stops before the click and empties the box, like a post's. */
export async function replyOnX(input: ReplyInput): Promise<PostOutcome> {
  const id = input.postUrl.match(/status\/(\d+)/)?.[1];
  if (!id) return { status: "failed", detail: `not a post url: ${input.postUrl}` };
  let tabId: number | undefined;
  let clicked = false;
  let keep = false;
  try {
    input.phase("open");
    tabId = await openTab(`https://x.com/i/status/${id}`);
    const tab = tabId;
    const opened = await until(() => page<{ start: string } | null>("openReply", tab, id), 25_000);
    if (!opened)
      return {
        status: "failed",
        detail: "the post or its reply button did not show",
      };
    await sleep(3_000);
    if (!(await until(async () => (await read(tab)).dialog, 20_000)))
      return { status: "failed", detail: "the reply box did not open" };
    await page("clear", tab);
    input.phase("type");
    if (!(await page("insert", tab, input.text))) throw new Error("the text did not go in");
    await sleep(1_000);
    input.phase("check");
    const { state, problems } = await checkComposer(tab, input.text, 0);
    // X shows the replied-to post above the box (a reply to your own post has no "Replying to" line).
    const isReply = norm(state.dialogText).includes(opened.start);
    if (!isReply) problems.push("the reply box does not show the post it replies to");
    const summary = `len ${state.text.length}, reply ${isReply ? "yes" : "no"}, button ${state.button}`;
    if (input.rehearsal) {
      input.phase("discard");
      const clean = await discard(tab);
      tabId = undefined;
      return {
        status: "rehearsed",
        clean,
        detail: problems.length
          ? `would not reply: ${problems.join("; ")} (${summary})`
          : `ready to reply (${summary})`,
      };
    }
    if (problems.length)
      return {
        status: "failed",
        detail: `not replied: ${problems.join("; ")}`,
      };
    input.phase("click");
    input.beforeClick();
    clicked = true;
    if (!(await page("clickPost", tab))) throw new Error("the Reply button was gone at the click");
    await sleep(8_000);
    input.phase("settle");
    if ((await read(tab)).dialog) {
      keep = true;
      return {
        status: "unknown",
        detail: `clicked Reply, the reply box is still open (${summary})`,
      };
    }
    return { status: "ok", detail: `replied (${summary})` };
  } catch (error) {
    const detail = String((error as Error).message ?? error).slice(0, 300);
    if (clicked) keep = true;
    return clicked
      ? { status: "unknown", detail: `after the click: ${detail}` }
      : { status: "failed", detail };
  } finally {
    if (tabId !== undefined && !keep) {
      if (!clicked) await page("clear", tabId).catch(() => undefined);
      await closeTab(tabId);
    }
  }
}
