// The workbench's hands in the everyday Chrome. It long-polls the local workbench for one command at a time and runs
// it on x.com tabs it opened itself; it never touches the reader's own tabs. Only the fixed operations below exist:
// the workbench cannot run arbitrary code in a page. X shows its Post button only in a visible tab, so a tab opened
// for posting comes to the front, and closing it goes back to the tab the reader was on.
const BASE = "http://127.0.0.1:4860/bridge";
const HEADERS = { "x-dna-bridge": "1" };
const own = new Map(); // tab id -> the tab to go back to

const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));

async function inPage(tabId, func, ...args) {
  const [r] = await chrome.scripting.executeScript({
    target: { tabId },
    func,
    args,
  });
  return r?.result;
}

async function loaded(tabId, ms = 30_000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const tab = await chrome.tabs.get(tabId);
    if (tab.status === "complete") return;
    await sleep(300);
  }
  throw new Error("the page did not load");
}

// These run inside the page, so each one finds what it needs itself. A reply opens in a dialog over the post's page,
// which has an inline box of its own: the dialog's box comes first.
const pageOps = {
  ready: () => {
    const T = "[data-testid=tweetTextarea_0]";
    return !!(
      document.querySelector(`[role=dialog] ${T}`) ?? document.querySelector(T)
    );
  },
  clear: () => {
    const T = "[data-testid=tweetTextarea_0]";
    const tb =
      document.querySelector(`[role=dialog] ${T}`) ?? document.querySelector(T);
    if (!tb) return false;
    tb.focus();
    document.execCommand("selectAll");
    document.execCommand("delete");
    return true;
  },
  insert: (text) => {
    const T = "[data-testid=tweetTextarea_0]";
    const tb =
      document.querySelector(`[role=dialog] ${T}`) ?? document.querySelector(T);
    if (!tb) return false;
    tb.focus();
    return document.execCommand("insertText", false, text);
  },
  read: (quoteId) => {
    const T = "[data-testid=tweetTextarea_0]";
    const B = "[data-testid=tweetButton]";
    const tb =
      document.querySelector(`[role=dialog] ${T}`) ?? document.querySelector(T);
    const bt =
      document.querySelector(`[role=dialog] ${B}`) ?? document.querySelector(B);
    return {
      text: tb ? tb.innerText : "",
      button: bt ? (bt.disabled ? "disabled" : "enabled") : "missing",
      media: document.querySelectorAll(
        "[data-testid=attachments] img, [data-testid=attachments] [role=img]",
      ).length,
      card: quoteId ? !!document.querySelector(`a[href*="${quoteId}"]`) : false,
      dialog: !!document.querySelector(`[role=dialog] ${T}`),
      dialogText: tb?.closest("[role=dialog]")?.innerText ?? "",
    };
  },
  attach: (files) => {
    const input = document.querySelector("input[data-testid=fileInput]");
    if (!input) return false;
    const data = new DataTransfer();
    for (const f of files) {
      const bytes = Uint8Array.from(atob(f.b64), (c) => c.charCodeAt(0));
      data.items.add(new File([bytes], f.name, { type: f.type }));
    }
    input.files = data.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  },
  // X sometimes opens a media editor first; Apply closes it.
  applyMedia: () => {
    const b = document.querySelector("[data-testid=applyButton]");
    b?.click();
    return !!b;
  },
  removeMedia: () => {
    let n = 0;
    for (const b of document.querySelectorAll(
      "[data-testid=attachments] button",
    ))
      if (/移除|删除|Remove/.test(b.getAttribute("aria-label") || "")) {
        b.click();
        n++;
      }
    return n;
  },
  clickPost: () => {
    const B = "[data-testid=tweetButton]";
    const b =
      document.querySelector(`[role=dialog] ${B}`) ?? document.querySelector(B);
    if (!b || b.disabled) return false;
    b.click();
    return true;
  },
  sent: () =>
    document.querySelector('[data-testid=toast] a[href*="/status/"]')?.href ??
    "",
  retweetMenu: () => {
    const b = document.querySelector("[data-testid=retweet]");
    b?.click();
    return !!b;
  },
  quoteItem: () => {
    const q = [...document.querySelectorAll("[role=menuitem]")].find((e) =>
      /引用|Quote/.test(e.innerText || ""),
    );
    q?.click();
    return !!q;
  },
  // Opens the reply box of this post, and says how the post starts, to check the box shows it.
  openReply: (id) => {
    const art = [...document.querySelectorAll("article")].find((a) =>
      a.querySelector(`a[href*="/status/${id}"]`),
    );
    const b = art?.querySelector("[data-testid=reply]");
    if (!b) return null;
    const start = (
      art.querySelector("[data-testid=tweetText]")?.innerText || ""
    )
      .replace(/\s+/g, "")
      .slice(0, 20);
    b.click();
    return { start };
  },
  handle: () =>
    document
      .querySelector("a[data-testid=AppTabBar_Profile_Link]")
      ?.getAttribute("href")
      ?.replace(/^\//, "") ?? "",
  // The newest post on this profile that starts like this, pinned ones aside.
  findOwn: (start) => {
    const norm = (s) => (s || "").replace(/\s+/g, "");
    for (const art of document.querySelectorAll("article")) {
      if (
        /Pinned|已置顶/.test(
          art.querySelector("[data-testid=socialContext]")?.innerText || "",
        )
      )
        continue;
      if (
        !norm(
          art.querySelector("[data-testid=tweetText]")?.innerText,
        ).startsWith(start)
      )
        continue;
      const a = art.querySelector("time")?.closest("a");
      if (a) return a.href;
    }
    return "";
  },
};

const ops = {
  ping: async () => ({ version: chrome.runtime.getManifest().version }),
  open: async ({ url }) => {
    const [back] = await chrome.tabs.query({
      active: true,
      lastFocusedWindow: true,
    });
    const tab = await chrome.tabs.create({ url, active: true });
    const win = await chrome.windows.get(tab.windowId);
    await chrome.windows.update(tab.windowId, {
      focused: true,
      ...(win.state === "minimized" ? { state: "normal" } : {}),
    });
    own.set(tab.id, back?.id);
    await loaded(tab.id);
    return { tabId: tab.id };
  },
  navigate: async ({ tabId, url }) => {
    await chrome.tabs.update(tabId, { url });
    await sleep(300);
    await loaded(tabId);
    return true;
  },
  url: async ({ tabId }) => (await chrome.tabs.get(tabId)).url ?? "",
  close: async ({ tabId }) => {
    const back = own.get(tabId);
    own.delete(tabId);
    await chrome.tabs.remove(tabId);
    if (back !== undefined)
      await chrome.tabs.update(back, { active: true }).catch(() => {});
    return true;
  },
};
for (const [name, func] of Object.entries(pageOps))
  ops[name] = ({ tabId, args = [] }) => inPage(tabId, func, ...args);

async function run(cmd) {
  if (cmd.args?.tabId !== undefined && !own.has(cmd.args.tabId))
    throw new Error("not a tab this extension opened");
  const op = ops[cmd.op];
  if (!op) throw new Error(`no such operation: ${cmd.op}`);
  return op(cmd.args ?? {});
}

let polling = false;
async function poll() {
  if (polling) return;
  polling = true;
  try {
    for (;;) {
      await chrome.runtime.getPlatformInfo(); // an extension call keeps the worker awake between polls
      let cmd;
      try {
        const res = await fetch(`${BASE}/next`, {
          headers: HEADERS,
          signal: AbortSignal.timeout(25_000),
        });
        if (res.status === 204) continue;
        if (res.status !== 200) throw new Error(`status ${res.status}`);
        cmd = await res.json();
      } catch {
        await sleep(3_000);
        continue;
      }
      let reply;
      try {
        reply = { id: cmd.id, ok: true, result: await run(cmd) };
      } catch (error) {
        reply = {
          id: cmd.id,
          ok: false,
          error: String(error?.message ?? error),
        };
      }
      await fetch(`${BASE}/result`, {
        method: "POST",
        headers: HEADERS,
        body: JSON.stringify(reply),
      }).catch(() => {});
    }
  } finally {
    polling = false;
  }
}

chrome.alarms.create("wake", { periodInMinutes: 0.5 });
chrome.alarms.onAlarm.addListener(poll);
chrome.runtime.onStartup.addListener(poll);
chrome.runtime.onInstalled.addListener(poll);
poll();
