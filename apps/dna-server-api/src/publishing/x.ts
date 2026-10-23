// Posting on X through the logged-in Chrome, ported from selfPromotion's publish-cdp.mjs, publish-post-cdp.mjs and
// quote-post-cdp.mjs: open the composer (a quote opens it from the post's retweet menu, the only way X attaches the
// quoted card), type the text in checked chunks, attach the image, check the composer, then click Post. A rehearsal
// stops before the click and empties the composer. After the click, a closed composer is ok; one still open is
// unknown, because X may have posted anyway.
import { Devtools, sleep } from "./devtools.ts";
import { CDP_URL } from "./chrome.ts";

export interface PostInput {
  text: string;
  /** Absolute paths under filesystemRoot. */
  images: string[];
  /** A quote post: the post on X it quotes. */
  quoteUrl?: string;
  rehearsal: boolean;
  /** Where chrome-devtools-mcp may read upload files from. */
  filesystemRoot: string;
  /** Called right before Post is clicked: the ledger's pending line. */
  beforeClick: () => void;
  phase: (name: string) => void;
}

export type PostOutcome =
  | { status: "ok" | "unknown"; detail: string }
  | { status: "failed"; detail: string }
  | { status: "rehearsed"; detail: string; clean: boolean };

const TEXTAREA = "[data-testid=tweetTextarea_0]";
const CHUNK = 1_800;

const textLen = `() => { const tb = document.querySelector('${TEXTAREA}'); return 'len=' + (tb ? tb.innerText.length : -1); }`;
const focus = `() => { const tb = document.querySelector('${TEXTAREA}'); if (!tb) return 'state=missing'; tb.focus(); return 'state=focused'; }`;
const composerState = (quoteId?: string) => `() => {
  const tb = document.querySelector('${TEXTAREA}');
  const text = tb ? tb.innerText : '';
  const bt = document.querySelector('[data-testid=tweetButton]');
  const media = document.querySelectorAll('[data-testid=attachments] img, [data-testid=attachments] [role=img]').length;
  const card = ${quoteId ? `!!document.querySelector('a[href*="${quoteId}"]')` : "false"};
  const bare = ${quoteId ? `text.includes('${quoteId}')` : "false"};
  return 'len=' + text.length + ';btn=' + (bt ? (bt.disabled ? 'disabled' : 'enabled') : 'missing') + ';media=' + media + ';card=' + card + ';bare=' + bare;
}`;

interface ComposerState {
  len: number;
  btn: string;
  media: number;
  card: boolean;
  bare: boolean;
}

async function readComposer(
  dt: Devtools,
  pageId: number,
  quoteId?: string,
): Promise<ComposerState> {
  const m = await dt.probe(
    pageId,
    composerState(quoteId),
    /len=(\d+);btn=(\w+);media=(\d+);card=(true|false);bare=(true|false)/,
  );
  if (!m) throw new Error("could not read the composer");
  return {
    len: Number(m[0]),
    btn: m[1]!,
    media: Number(m[2]),
    card: m[3] === "true",
    bare: m[4] === "true",
  };
}

async function waitFor(dt: Devtools, pageId: number, fn: string, re: RegExp, ms: number) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const m = await dt.probe(pageId, fn, re).catch(() => undefined);
    if (m) return m;
    await sleep(1_000);
  }
  return undefined;
}

/** Type the text in chunks, checking the composer grows by each chunk; retries a chunk up to 3 times. */
async function typeText(dt: Devtools, pageId: number, text: string) {
  let expect = (await readComposer(dt, pageId)).len;
  for (let i = 0; i < text.length; i += CHUNK) {
    const chunk = text.slice(i, i + CHUNK);
    let typed = false;
    for (let attempt = 0; attempt < 3 && !typed; attempt++) {
      try {
        await dt.tool("type_text", { pageId, text: chunk });
      } catch {}
      await sleep(1_300);
      const m = await dt.probe(pageId, textLen, /len=(-?\d+)/);
      if (m && Number(m[0]) >= expect + chunk.length - 50) typed = true;
    }
    if (!typed) throw new Error(`chunk ${i / CHUNK + 1} did not type`);
    expect += chunk.length;
  }
}

async function attach(dt: Devtools, pageId: number, images: string[]) {
  await dt.probe(
    pageId,
    `() => { const b = [...document.querySelectorAll('button')].find((el) => /添加照片或视频|Add photos or video/.test(el.getAttribute('aria-label') || '')); if (!b) return 'state=missing'; b.click(); return 'state=clicked'; }`,
    /state=(\w+)/,
  );
  await sleep(2_500);
  const snap = await dt.tool("take_snapshot", { pageId });
  const uid =
    snap.match(/uid=(\d+_\d+) button "Choose Files?"/)?.[1] ??
    snap.match(/uid=(\d+_\d+) input[^\n]*file/)?.[1];
  if (!uid) throw new Error("no file input in the composer");
  await dt.tool("upload_file", { pageId, uid, filePaths: images });
  await sleep(6_000 + images.length * 4_000);
  // X sometimes opens a media editor first; Apply closes it.
  await dt.probe(
    pageId,
    "() => { const b = document.querySelector('[data-testid=applyButton]'); if (b) { b.click(); return 'state=applied'; } return 'state=none'; }",
    /state=(\w+)/,
  );
  await sleep(3_000);
}

/** Empty the composer after a rehearsal: text, media, then leave; check a fresh composer is empty. */
async function discard(dt: Devtools, pageId: number): Promise<boolean> {
  await dt.probe(pageId, focus, /state=(\w+)/).catch(() => undefined);
  await dt.tool("press_key", { pageId, key: "Meta+KeyA" }).catch(() => undefined);
  await dt.tool("press_key", { pageId, key: "Backspace" }).catch(() => undefined);
  await dt.probe(
    pageId,
    "() => { let n = 0; for (const b of document.querySelectorAll('button')) if (/移除|删除|Remove/.test(b.getAttribute('aria-label') || '') && b.closest('[data-testid=attachments]')) { b.click(); n++; } return 'removed=' + n; }",
    /removed=(\d+)/,
  );
  await sleep(1_500);
  await dt.tool("navigate_page", { pageId, url: "https://x.com/home" }).catch(async () => {
    await dt.tool("handle_dialog", { action: "accept" }).catch(() => undefined);
  });
  await sleep(3_000);
  await dt.tool("navigate_page", { pageId, url: "https://x.com/compose/post" });
  const fresh = await waitFor(dt, pageId, textLen, /len=(\d+)/, 15_000);
  const state = fresh ? await readComposer(dt, pageId) : undefined;
  await dt.tool("navigate_page", { pageId, url: "https://x.com/home" }).catch(() => undefined);
  return !!state && state.len === 0 && state.media === 0;
}

async function composePage(
  dt: Devtools,
  quoteUrl?: string,
): Promise<{ pageId: number; quoteId?: string }> {
  // Leftover compose pages may hold an old draft that would mix into this post.
  for (const p of await dt.pages())
    if (p.url.includes("/compose/post"))
      await dt.tool("close_page", { pageId: p.id }).catch(() => undefined);
  if (!quoteUrl) {
    const pages = await dt.pages();
    const page = pages.find((p) => p.url.includes("x.com")) ?? pages[0];
    if (!page) throw new Error("no page to post from");
    await dt.tool("select_page", { pageId: page.id });
    await dt.tool("navigate_page", { pageId: page.id, url: "https://x.com/compose/post" });
    return { pageId: page.id };
  }
  const quoteId = quoteUrl.match(/status\/(\d+)/)?.[1];
  if (!quoteId) throw new Error(`not a post url: ${quoteUrl}`);
  await dt.tool("new_page", { url: quoteUrl });
  await sleep(12_000);
  const tweet = (await dt.pages()).find((p) => p.url.includes(`status/${quoteId}`));
  if (!tweet) throw new Error("the quoted post did not open");
  await dt.tool("select_page", { pageId: tweet.id });
  const openMenu =
    "() => { const b = document.querySelector('[data-testid=retweet]'); if (!b) return 'state=missing'; b.click(); return 'state=opened'; }";
  await dt.probe(tweet.id, openMenu, /state=(\w+)/);
  await sleep(4_000);
  const items = await dt.probe(
    tweet.id,
    "() => 'items=' + document.querySelectorAll('[role=menuitem]').length",
    /items=(\d+)/,
  );
  if (Number(items?.[0] ?? 0) < 2) {
    await dt.probe(tweet.id, openMenu, /state=(\w+)/);
    await sleep(3_500);
  }
  const quoted = await dt.probe(
    tweet.id,
    "() => { const q = [...document.querySelectorAll('[role=menuitem]')].find((e) => /引用|Quote/.test(e.innerText || '')); if (!q) return 'state=missing'; q.click(); return 'state=clicked'; }",
    /state=(\w+)/,
  );
  if (quoted?.[0] !== "clicked") throw new Error("the retweet menu has no Quote item");
  await sleep(7_000);
  const compose = (await dt.pages()).find((p) => p.url.includes("/compose/post"));
  if (!compose) throw new Error("Quote did not open a composer");
  await dt.tool("select_page", { pageId: compose.id });
  return { pageId: compose.id, quoteId };
}

export async function postToX(input: PostInput): Promise<PostOutcome> {
  const dt = new Devtools({ browserUrl: CDP_URL, filesystemRoot: input.filesystemRoot });
  let clicked = false;
  try {
    await dt.start();
    input.phase("compose");
    const { pageId, quoteId } = await composePage(dt, input.quoteUrl);
    if (!(await waitFor(dt, pageId, focus, /state=(focused)/, 20_000)))
      return { status: "failed", detail: "the composer has no text box" };
    await dt.tool("press_key", { pageId, key: "Meta+KeyA" });
    await dt.tool("press_key", { pageId, key: "Backspace" });
    await dt.probe(pageId, focus, /state=(\w+)/);
    input.phase("type");
    await typeText(dt, pageId, input.text);
    if (input.images.length) {
      input.phase("attach");
      await attach(dt, pageId, input.images);
    }
    input.phase("check");
    const state = await readComposer(dt, pageId, quoteId);
    const problems = [
      state.len < input.text.length - 50
        ? `text ${state.len} of ${input.text.length} characters`
        : "",
      input.images.length && state.media < input.images.length
        ? `${state.media} of ${input.images.length} images attached`
        : "",
      quoteId && !state.card ? "the quoted card is missing" : "",
      quoteId && state.bare ? "the quoted post's id is in the text" : "",
      state.btn !== "enabled" ? `the Post button is ${state.btn}` : "",
    ].filter(Boolean);
    const summary = `len ${state.len}, media ${state.media}, button ${state.btn}${quoteId ? `, card ${state.card}` : ""}`;
    if (input.rehearsal) {
      input.phase("discard");
      const clean = await discard(dt, pageId);
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
    await dt.probe(
      pageId,
      "() => { const b = document.querySelector('[data-testid=tweetButton]'); if (!b) return 'state=missing'; b.click(); return 'state=clicked'; }",
      /state=(\w+)/,
    );
    await sleep(9_000);
    input.phase("settle");
    const open = (await dt.pages()).some((p) => p.url.includes("/compose/post"));
    return open
      ? { status: "unknown", detail: `clicked Post, the composer is still open (${summary})` }
      : { status: "ok", detail: `posted (${summary})` };
  } catch (error) {
    const detail = String((error as Error).message ?? error).slice(0, 300);
    return clicked
      ? { status: "unknown", detail: `after the click: ${detail}` }
      : { status: "failed", detail };
  } finally {
    dt.close();
  }
}
