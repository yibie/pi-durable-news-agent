// End-to-end check of the browser client: a faux dna-server-api with fixture search, the hub, and headless Chrome.
// Covers layout, cards and feedback, taste questions, tool rows into executions, the context bar, the model
// picker, keywords, text hygiene and data-cap coverage. Prints one PASS line per check.
//   npm run build -w dna-client-browser && node apps/dna-client-browser/tests/ui-faux.mjs   (HEADED=1 to watch)
import { spawn } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const require = createRequire(import.meta.url);
const { chromium } = require("@playwright/test");
const app = resolve(import.meta.dirname, "..");
const root = resolve(app, "../..");
const shots = join(app, "test-results");
mkdirSync(shots, { recursive: true });
const tmp = mkdtempSync(join(tmpdir(), "dna-ui-"));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const token = () => `dna_${randomBytes(32).toString("base64url")}`;
const freePort = () =>
  new Promise((done) => {
    const s = createServer().listen(0, "127.0.0.1", () => {
      const { port } = s.address();
      s.close(() => done(port));
    });
  });
const children = new Set();
function run(script, args, env, cwd) {
  const child = spawn(process.execPath, ["--import", "tsx", script, ...args], {
    cwd,
    env: {
      ...process.env,
      NODE_NO_WARNINGS: "1",
      DNA_ENV_FILE: "none",
      DNA_LOG_DIR: join(tmp, "logs"),
      ...env,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let log = "";
  child.stdout.on("data", (d) => (log += d));
  child.stderr.on("data", (d) => (log += d));
  children.add(child);
  child.on("exit", () => children.delete(child));
  child.log = () => log;
  return child;
}
async function waitHttp(url, child) {
  for (let i = 0; i < 300; i++) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {}
    if (child?.exitCode !== null && child?.exitCode !== undefined) throw new Error(child.log());
    await sleep(100);
  }
  throw new Error(`${url} never came up`);
}
const fail = (msg) => {
  throw new Error(`FAIL ${msg}`);
};
const check = (ok, msg) => (ok ? console.log(`PASS ${msg}`) : fail(msg));

const tokens = { client: token(), cron: token() };
const [apiPort, hubPort] = [await freePort(), await freePort()];
const apiUrl = `http://127.0.0.1:${apiPort}`;
const api = run(
  join(root, "apps/dna-server-api/src/main.ts"),
  ["--port", String(apiPort)],
  {
    DNA_PROVIDER: "faux",
    DNA_SEARCH_MODE: "fixture",
    DNA_FIXTURE_SET: "news",
    DNA_DATA_DIR: join(tmp, "data"),
    // The suite runs on the shipped defaults, even when .env points this device at its own config,
    // and never reads this device's publish ledger or writes into its archive. `just` exports .env into the
    // recipe, so the device's decision model (JEV_BACKEND=ollama) is blanked too: the fixture decider answers here.
    DNA_CONFIG_DIR: "",
    DNA_LEDGER_IMPORT: "",
    DNA_PUBLISHED_DIR: "",
    JEV_BACKEND: "",
    JEV_MODEL: "",
    JEV_OLLAMA_URL: "",
    DNA_DEVICE_NAME: "test",
    DNA_CLIENT_TOKEN: tokens.client,
    DNA_CRON_TOKEN: tokens.cron,
  },
  join(root, "apps/dna-server-api"),
);
await waitHttp(`${apiUrl}/healthz`, api);
const hub = run(
  join(app, "hub/src/main.ts"),
  ["--port", String(hubPort)],
  { DNA_API_URL: apiUrl, DNA_CLIENT_TOKEN: tokens.client, DNA_TARGET: "local" },
  app,
);
const base = `http://localhost:${hubPort}`;
await waitHttp(`${base}/hub/healthz`, hub);

const call = async (method, path, body, tok = tokens.client) => {
  const res = await fetch(apiUrl + path, {
    method,
    headers: { authorization: `Bearer ${tok}`, "content-type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return res.json();
};
/** Wait up to 20 seconds for an API condition. */
const until = async (ok) => {
  for (let i = 0; i < 200; i++) {
    if (await ok()) return;
    await sleep(100);
  }
  throw new Error("timed out waiting for the API");
};
const started = await call("POST", "/v1/workflows/news-sweep", { requestId: "ui:1" }, tokens.cron);
for (let i = 0; i < 300; i++) {
  const s = await call("GET", `/v1/sweeps/${started.sweep.id}`);
  if (s.status === "completed") break;
  await sleep(100);
}
for (let i = 0; i < 100 && (await call("GET", "/v1/agent")).busy; i++) await sleep(100);

// Seed a known relationship in the isolated fixture database. Semantic classification is tested separately.
const fixtureCards = (await call("GET", "/v1/feed")).items;
const related = fixtureCards.filter((c) => !c.title.includes("pi-durable")).slice(0, 2);
check(related.length === 2, "two fixture developments are available for story UI checks");
const fixtureDb = new DatabaseSync(join(tmp, "data", "dna.sqlite"));
const storyId = related[0].storyId;
fixtureDb.exec("BEGIN IMMEDIATE");
fixtureDb
  .prepare("UPDATE stories SET title=? WHERE id=?")
  .run("Fixture story progression", storyId);
fixtureDb.prepare("DELETE FROM story_items WHERE item_id=?").run(related[1].itemId);
fixtureDb
  .prepare("UPDATE story_memberships SET story_id=? WHERE item_id=?")
  .run(storyId, related[1].itemId);
fixtureDb.prepare("INSERT INTO story_items VALUES (?, ?)").run(storyId, related[1].itemId);
fixtureDb.exec("COMMIT");
fixtureDb.close();

const browser = await chromium.launch({ channel: "chrome", headless: !process.env.HEADED });
const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: base });
const errors = [];
const page = await context.newPage();
page.on("pageerror", (e) => errors.push(e.message));
page.on(
  "console",
  (m) => m.type() === "error" && !/Failed to load resource/.test(m.text()) && errors.push(m.text()),
);
const caps = new Set();
const collectCaps = async () =>
  (
    await page
      .locator("[data-cap]")
      .evaluateAll((els) => els.map((e) => e.getAttribute("data-cap")))
  ).forEach((c) => caps.add(c));
const BANNED = [/\u2014/, /\u2013/, /\u00b7/, /\u2022/, /\u2026/, / - /, /\.\.\./];
async function cleanText(where) {
  const text = await page.evaluate(() => document.body.innerText);
  const hit = BANNED.find((re) => re.test(text));
  check(
    !hit,
    `${where}: no em dash, en dash, middle dot, bullet, ellipsis, spaced hyphen or three dots${hit ? ` (found ${hit} near "${text.slice(Math.max(0, text.search(hit) - 40), text.search(hit) + 40)}")` : ""}`,
  );
}

try {
  await page.goto(base);
  await page.locator(".card").first().waitFor();
  await page.waitForFunction(() => document.querySelectorAll(".card").length >= 3);
  await page.locator('[data-role="agent"]').first().waitFor();
  await page.screenshot({ path: join(shots, "main.png") });

  // ---------------------------------------------------------------- feed
  const news = page.locator(".feed-list .card");
  const newsCount = await news.count();
  check(
    newsCount === 3 &&
      (await page.locator('[role="tab"][data-tab="news"]').getAttribute("aria-selected")) ===
        "true",
    "3 story cards render from 4 developments in the News tab",
  );
  // A wide News column gives every card one height; a narrow one (the basket and the agent open) lets cards grow from
  // that height so the title is never squeezed out.
  const cardShape = await page.evaluate(() => {
    const list = document.querySelector(".feed-list").getBoundingClientRect().width;
    const cards = [...document.querySelectorAll(".feed-list .card")];
    const min = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--card-h"));
    return {
      wide: list > 860,
      heights: cards.map((c) => Math.round(c.getBoundingClientRect().height)),
      min,
      titlesShown: cards.every((c) => {
        const t = c.querySelector(".card-title")?.getBoundingClientRect();
        const m = c.querySelector(".card-main").getBoundingClientRect();
        return !t || (t.height > 10 && t.bottom <= m.bottom + 1);
      }),
    };
  });
  check(
    cardShape.titlesShown &&
      (cardShape.wide
        ? new Set(cardShape.heights).size === 1
        : cardShape.heights.every((h) => h >= cardShape.min)),
    `every card shows its title, ${cardShape.wide ? "one height" : `at least ${cardShape.min} px`} (${[...new Set(cardShape.heights)].join(", ")} px)`,
  );
  const heads = await news.evaluateAll((cards) =>
    cards.map((c) => {
      const when = c.querySelector(".card-when").getBoundingClientRect();
      const meta = c.querySelector(".card-meta").getBoundingClientRect();
      return {
        rail: !!c.closest(".feed-row").querySelector(".rail"),
        icon: !!c.querySelector(".source-icon img, .source-icon svg"),
        tip: c.querySelector(".source-icon").getAttribute("title") ?? "",
        age: c.querySelector(".card-when strong").textContent.trim(),
        at: c.querySelector(".card-when small").textContent.trim(),
        topRight: Math.abs(when.right - meta.right) <= 2 && when.top - meta.top <= 2,
      };
    }),
  );
  check(
    heads.length === 3 &&
      heads.every(
        (h) =>
          !h.rail &&
          h.icon &&
          h.tip.startsWith("来源：") &&
          /(前|刚刚|不详|今天或昨天)$/.test(h.age) &&
          h.at &&
          h.topRight,
      ),
    `each card shows its source as an icon and how fresh it is in its top right corner (${heads.map((h) => `${h.age} ${h.at}`).join("; ")})`,
  );
  const media = await news.first().locator("a.card-media");
  check(
    (await media.getAttribute("target")) === "_blank" &&
      (await media.getAttribute("href")) ===
        (await news.first().locator('a[aria-label="Open the source"]').getAttribute("href")),
    "the card image opens the source in a new tab",
  );
  const ids = await news.evaluateAll((els) =>
    els.map((e) => Number(e.getAttribute("data-card-id"))),
  );
  const boxes = await news.evaluateAll((els) => els.map((e) => e.getBoundingClientRect().top));
  check(
    ids.every((id, i) => i === 0 || id > ids[i - 1]) &&
      boxes.every((y, i) => i === 0 || y > boxes[i - 1]),
    "news runs in arrival order, the newest card last and lowest",
  );
  const ranked = await page.locator('[data-testid="hfs"]').evaluateAll((els) =>
    els.map((el) =>
      [...el.querySelectorAll(".hfs-chip")].map((c) => ({
        score: Number(c.getAttribute("data-score")),
        primary: c.classList.contains("primary"),
      })),
    ),
  );
  check(
    ranked.length === 3 &&
      ranked.every(
        (chips) =>
          chips.length === 3 &&
          chips[0].primary &&
          chips.every((c, i) => i === 0 || c.score <= chips[i - 1].score),
      ),
    "H/F/S pills are ranked with the primary first",
  );
  const comps = await page
    .locator(".card")
    .evaluateAll((els) => els.map((e) => e.getAttribute("data-component")));
  check(
    comps.includes("signal_alert") && comps.includes("thread_pulse"),
    `generative components render (${[...new Set(comps)].join(", ")})`,
  );

  const before = await call("GET", "/v1/keywords?kind=topic");
  const durable = page.locator(".feed-list .card", { hasText: "pi-durable" }).first();
  await durable.getByRole("button", { name: "Show me more" }).click();
  await page.waitForFunction(
    (id) =>
      document
        .querySelector(`[data-card-id="${id}"] [data-cap="feedback.more"]`)
        ?.classList.contains("on"),
    await durable.getAttribute("data-card-id"),
  );
  const after = await call("GET", "/v1/keywords?kind=topic");
  const moved = after.filter((k) => k.weight > (before.find((b) => b.id === k.id)?.weight ?? 9));
  check(
    moved.length > 0,
    `Show me more raised a topic weight (${moved.map((k) => k.term).join(", ")})`,
  );
  await durable.getByRole("button", { name: "Label Signal" }).click();
  await page.waitForFunction(
    (id) =>
      document.querySelector(`[data-card-id="${id}"] .fb.tag.signal`)?.classList.contains("on"),
    await durable.getAttribute("data-card-id"),
  );
  check(true, "labeling a card Signal shows as pressed");
  const toast = await page.locator(".toast").boundingBox();
  check(toast && toast.y < 150, `notifications show at the top (y ${Math.round(toast?.y ?? -1)})`);

  // ---------------------------------------------------------------- timelines
  const chips = page.locator('.feed-list [data-cap="timelines.read"]');
  check(
    (await chips.count()) === 1 &&
      (await chips.allInnerTexts())
        .map((t) => t.replace(/\s+/g, " ").trim())
        .sort()
        .join(" | ") === "Timeline 2/2",
    "one story card links both developments in its timeline",
  );
  await page.getByRole("button", { name: "Open 2 story sources" }).click();
  await page.getByRole("heading", { name: "Story sources" }).waitFor();
  check(
    (await page.locator(".card-detail .finding a").count()) === 2,
    "story sources expand with both original article links",
  );
  await page.locator(".card-detail").getByRole("button", { name: "Close", exact: true }).click();
  await chips.first().click();
  await page.locator("[data-timeline] .card").nth(1).waitFor();
  const tab = page.locator('[data-tab^="timeline-"]');
  check(
    (await tab.innerText()).includes("Fixture story progression") &&
      (await page.locator('[data-timeline] [data-cap="timelines.read"]').allInnerTexts())
        .map((t) => t.replace(/\s+/g, " ").trim())
        .join(" | ") === "Timeline 1/2 | Timeline 2/2",
    "the chip opens a tab named after the timeline with its cards in order",
  );
  await page.screenshot({ path: join(shots, "timeline.png") });
  await page.reload();
  await page.locator("[data-timeline] .card").first().waitFor();
  check(true, "the open timeline tab survives a reload");
  await page.getByRole("button", { name: /Close the .* timeline/ }).click();
  await page.locator('[data-tab^="timeline-"]').waitFor({ state: "detached" });
  check(
    (await page.locator('[data-tab="news"]').getAttribute("aria-selected")) === "true",
    "closing the timeline tab returns to News",
  );
  await page.locator(".feed-list .card").first().waitFor();

  // ---------------------------------------------------------------- card polish
  const firstCard = page.locator(".feed-list .card").first();
  const chipFill = await firstCard.locator(".hfs-chip").evaluateAll((els) =>
    els.map((e) => ({
      score: e.getAttribute("data-score"),
      style: e.getAttribute("style") ?? "",
    })),
  );
  check(
    chipFill.length === 3 && chipFill.every((c) => c.style.includes(`--fill: ${c.score}%`)),
    "each H/F/S chip fills to its score",
  );
  const order = await page.locator(".feed-list .card").evaluateAll((cards) =>
    cards.map((card) => ({
      chips: [...card.querySelectorAll(".hfs-chip")].map((c) => c.getAttribute("data-category")),
      labels: [...card.querySelectorAll(".fb.tag")].map((b) =>
        ["hype", "facts", "signal"].find((c) => b.classList.contains(c)),
      ),
    })),
  );
  check(
    order.every((o) => o.chips.join() === o.labels.join()),
    "label buttons follow each card's ranked chip order",
  );
  await firstCard.getByRole("button", { name: "Reference in chat" }).click();
  const draftText = await page.getByLabel("Message the agent").inputValue();
  check(
    /^card \d+ ".+" $/.test(draftText),
    `the to-chat button drops the card id and title into the chat (${draftText.trim()})`,
  );
  await page.getByLabel("Message the agent").fill("");
  const [opened] = await Promise.all([
    page.context().waitForEvent("page"),
    firstCard.locator(".card-title").first().click(),
  ]);
  check(
    opened.url() !== "about:blank" || (await opened.evaluate(() => location.href)) !== "",
    "clicking a title opens the article in a new tab",
  );
  await opened.close();

  // ---------------------------------------------------------------- top bar and agent controls
  for (const name of ["执行记录", "设置", "候选", "选题篮", "助手"])
    check(
      (await page.locator(".topbar .bar-button", { hasText: name }).count()) === 1,
      `the top bar button ${name} has a text label`,
    );
  check(
    (await page.getByTestId("device").innerText()).trim().length > 0,
    `the top bar names the device (${(await page.getByTestId("device").innerText()).trim()})`,
  );
  const spendStat = page.locator('.topbar [data-cap="usage"]');
  check(
    /^\$\d/.test((await spendStat.innerText()).trim()) &&
      /^累计花费：模型 \$.*，jev \$.*，配图 \$/.test((await spendStat.getAttribute("title")) ?? ""),
    "the top bar shows total spend, with model, jev and images on hover",
  );
  const scheduleSelect = page.getByLabel("Sweep schedule");
  check(
    (await scheduleSelect.inputValue()) === "5" &&
      (await scheduleSelect.locator("option").allInnerTexts()).join(",") ===
        "Every minute,Every 5 min,Every 10 min,Every 15 min,Every 30 min,Every hour,Off",
    "the top bar schedule shows every 5 minutes with the presets",
  );
  const cardsSelect = page.getByLabel("Cards per sweep");
  check((await cardsSelect.inputValue()) === "7", "the top bar shows 7 cards per sweep");
  await cardsSelect.selectOption("10");
  await sleep(400);
  check(
    (await call("GET", "/v1/schedule")).cardsPerSweep === 10,
    "picking cards per sweep reaches the API",
  );
  await cardsSelect.selectOption("7");
  await scheduleSelect.selectOption("off");
  await page.locator(".agent-status", { hasText: "scheduled sweeps off" }).waitFor();
  check(
    (await call("GET", "/v1/schedule")).everyMinutes === null,
    "turning the schedule off reaches the API and the countdown says so",
  );
  await scheduleSelect.selectOption("5");
  await page.locator(".agent-status", { hasText: "next sweep in" }).waitFor();
  check(
    (await page.locator(".model-button").count()) === 0 &&
      (await page.locator(".context-line").count()) === 0,
    "model and context stay hidden until the Model toggle is on",
  );
  const modelToggle = page.locator(".composer .model-toggle");
  const busyBox = await page.locator(".when-busy").boundingBox();
  const toggleBox = await modelToggle.boundingBox();
  check(
    toggleBox.x >= busyBox.x + busyBox.width &&
      Math.abs(toggleBox.y + toggleBox.height / 2 - (busyBox.y + busyBox.height / 2)) < 6,
    "the Model toggle sits right of When busy",
  );
  await modelToggle.click();
  await page.locator(".composer .model-button").waitFor();
  check(
    (await modelToggle.getAttribute("aria-pressed")) === "true" &&
      (await page.getByLabel("Thinking level", { exact: true }).count()) === 1,
    "the Model toggle shows model and thinking above the composer buttons",
  );
  const contextLine = await page.locator(".composer .context-line").boundingBox();
  const composerBox = await page.locator(".composer textarea").boundingBox();
  check(
    contextLine.height <= 40 &&
      contextLine.y < composerBox.y &&
      (await page.locator(".context-line .context-marker").count()) === 2,
    `with Model on, context is one line above the message box with two ticks (${Math.round(contextLine.height)}px)`,
  );
  const modelRow = await page.locator(".composer .model-row").first().boundingBox();
  const ctxAfter = await page.locator(".composer .context-line").boundingBox();
  check(
    modelRow.y >= ctxAfter.y + ctxAfter.height - 1 &&
      modelRow.y - (ctxAfter.y + ctxAfter.height) < 16,
    "model and context sit together: the model row right under the context line",
  );
  const quickModel = page.getByLabel("Quick tasks model");
  check(
    (await quickModel.inputValue()) === "anthropic/claude-haiku-5.5" &&
      (await page.getByLabel("Quick tasks thinking level").inputValue()) === "off",
    "the Model panel shows the quick tasks model (Haiku 5.5, thinking off)",
  );
  await quickModel.selectOption("openai/gpt-6-luna");
  await sleep(400);
  check(
    (await call("GET", "/v1/agent")).quick.model === "openai/gpt-6-luna",
    "picking a quick tasks model reaches the API",
  );
  const quickBox = await page.getByRole("group", { name: "Quick tasks" }).boundingBox();
  const deepBox = await page.getByRole("group", { name: "Deep research" }).boundingBox();
  check(
    deepBox.y > quickBox.y &&
      (await page.getByLabel("Deep research model").inputValue()) ===
        "anthropic/claude-haiku-5.5" &&
      (await page.getByLabel("Deep research thinking level").inputValue()) === "xhigh" &&
      (await page.getByLabel("Deep research count").inputValue()) === "1",
    "the Deep research row sits under Quick tasks (Haiku 5.5, thinking xhigh, count 1)",
  );
  await page.getByLabel("Deep research count").selectOption("5");
  await page.getByLabel("Deep research thinking level").selectOption("high");
  await sleep(400);
  const deepState = (await call("GET", "/v1/agent")).deepResearch;
  check(
    deepState.count === 5 && deepState.thinkingLevel === "high",
    "picking a deep research count and thinking level reaches the API",
  );
  check((await page.locator(".brand-mark svg").count()) === 1, "the logo is the Signal icon");
  await collectCaps();

  // ---------------------------------------------------------------- agent: chat, sides, taste question
  const composer = page.getByLabel("Message the agent");
  await composer.fill("What did you find?");
  await composer.press("Enter");
  await page.locator('[data-role="user"]', { hasText: "What did you find?" }).waitFor();
  await page.waitForFunction(() =>
    [...document.querySelectorAll('[data-role="agent"]')].some((e) =>
      e.textContent?.includes("Got it"),
    ),
  );
  const chat = await page.getByTestId("chat").boundingBox();
  const user = await page.locator('[data-role="user"]').last().boundingBox();
  const agentMsg = await page.locator('[data-role="agent"]').last().boundingBox();
  check(
    Math.abs(user.x + user.width - (chat.x + chat.width)) < 4 && Math.abs(agentMsg.x - chat.x) < 4,
    "user messages sit right and agent messages left",
  );
  check(
    (await page.locator('[data-chip="sweep"]').count()) === 1 &&
      (await page.locator('[data-entry="dna.sweep-progress"]').count()) >= 4,
    "the cron prompt renders as a Scheduled sweep chip with progress lines",
  );

  const itemId = (await call("GET", `/v1/cards/${await durable.getAttribute("data-card-id")}`)).item
    .id;
  await composer.fill(
    `FAUX_CALL ask_taste {"item_id": ${itemId}, "question": "Is this hype, facts or signal for you?"}`,
  );
  await composer.press("Enter");
  const question = page.locator(".taste-question");
  await question.waitFor();
  await collectCaps();
  await question.getByRole("button", { name: "Facts" }).click();
  await question.getByRole("button", { name: "Answer" }).click();
  await page.locator('[data-chip="taste"]').waitFor();
  await page.waitForFunction(() =>
    [...document.querySelectorAll('[data-role="agent"]')].some((e) =>
      e.textContent?.includes("Noted"),
    ),
  );
  const answered = (await call("GET", "/v1/taste-questions?status=answered"))[0];
  check(
    answered?.answerLabels.includes("facts") && (await question.count()) === 0,
    "answering a taste question posts it and the chat acknowledges it",
  );

  // ---------------------------------------------------------------- search, open_tab, highlight_item
  const searchBox = page.getByLabel("Search news");
  await searchBox.fill("durable");
  await page.locator('[data-tab="search-durable"]').waitFor();
  await page.locator("[data-search] .card").first().waitFor();
  const matches = (await call("GET", "/v1/feed/search?q=durable")).length;
  check(
    matches >= 1 && (await page.locator("[data-search] .card").count()) === matches,
    `the search box opens a search tab with the matching news (${matches})`,
  );
  await searchBox.fill("durable agents");
  await page.locator('[data-tab="search-durable agents"]').waitFor();
  check(
    (await page.locator('[data-tab^="search-"]').count()) === 1,
    "typing edits the open search tab instead of opening another",
  );
  await collectCaps();
  await page.getByRole("button", { name: "Close the durable agents search" }).click();
  await page.locator('[data-tab^="search-"]').waitFor({ state: "detached" });
  const site = new URL(
    (await call("GET", `/v1/cards/${await durable.getAttribute("data-card-id")}`)).item.url,
  ).hostname;
  await composer.fill(`FAUX_CALL open_tab {"by": "url", "value": "${site}"}`);
  await composer.press("Enter");
  await page.locator(`[data-tab="url-${site}"]`).waitFor();
  await page.locator("[data-search] .card").first().waitFor();
  check(
    (await page.locator(`[data-tab="url-${site}"] [role="tab"]`).getAttribute("aria-selected")) ===
      "true",
    "the agent's open_tab opens a url tab in the browser",
  );
  const when = (c) => Date.parse(c.publishedAt ?? c.createdAt);
  const oldest = (await call("GET", "/v1/feed?limit=200")).items.sort(
    (a, b) => when(a) - when(b),
  )[0].id;
  await composer.fill(`FAUX_CALL highlight_item {"card_id": ${oldest}}`);
  await composer.press("Enter");
  const lit = page.locator(`.feed-list .feed-row.highlight[data-row="${oldest}"]`);
  await lit.waitFor();
  await sleep(1200);
  const box = await lit.boundingBox();
  const list = await page.locator(".feed-list .bottom-scroll").boundingBox();
  check(
    (await page.locator('[data-tab="news"]').getAttribute("aria-selected")) === "true" &&
      box.y + box.height > list.y &&
      box.y < list.y + list.height,
    "highlight_item switches to News, scrolls to the card and highlights it",
  );
  await page.screenshot({ path: join(shots, "highlight.png") });

  // ---------------------------------------------------------------- thumbs down hides a card from News
  const shownInNews = async () => Number(await page.locator(`[data-tab="news"] small`).innerText());
  const shownBefore = await shownInNews();
  const doomed = page
    .locator(".feed-list .feed-row:not(.highlight) .card:not(:has(.timeline-chip))")
    .last();
  const doomedId = await doomed.getAttribute("data-card-id");
  await doomed.getByRole("button", { name: "Show me less" }).click();
  await page.locator(`.feed-list [data-card-id="${doomedId}"]`).waitFor({ state: "detached" });
  await page.locator(".toast", { hasText: "已从候选中移除" }).waitFor();
  check(
    (await shownInNews()) === shownBefore - 1 &&
      (await call("GET", `/v1/cards/${doomedId}`)).card.feedback.signal === "less",
    "a thumbs down hides the card from News and records show me less",
  );

  // ---------------------------------------------------------------- picks: choose a genre, group a roundup, put back
  const pickable = () => page.locator(".feed-list .feed-row .card");
  const firstId = await pickable().first().getAttribute("data-card-id");
  const secondId = await pickable().nth(1).getAttribute("data-card-id");
  const newsBeforePicks = await shownInNews();
  const first = page.locator(`.feed-list [data-card-id="${firstId}"]`);
  await first.getByRole("button", { name: "Pick for writing" }).click();
  // Every option must be the topmost thing at its own center: a menu clipped by the card (the last option lost at the
  // card's bottom edge, or the left half lost at the column's edge) fails here.
  const allOptionsVisible = (menu) =>
    menu.evaluate((el) =>
      [...el.querySelectorAll("[role^=menuitem]")].every((item) => {
        const r = item.getBoundingClientRect();
        const x = r.left + r.width / 2;
        const y = r.top + r.height / 2;
        return (
          r.left >= 0 &&
          r.right <= innerWidth &&
          r.top >= 0 &&
          r.bottom <= innerHeight &&
          item.contains(document.elementFromPoint(x, y))
        );
      }),
    );
  const genreMenu = page.getByRole("menu", { name: "Genre" });
  await genreMenu.waitFor();
  check(
    await allOptionsVisible(genreMenu),
    "every option of the genre menu is fully visible, not cut off by the card",
  );
  await genreMenu.locator('[data-genre="roundup"]').click();
  await page.locator(`.picks-column [data-pick-card="${firstId}"]`).waitFor();
  await first.waitFor({ state: "detached" });
  const roundup = (await call("GET", "/v1/picks")).find((p) =>
    p.items.some((i) => String(i.cardId) === firstId),
  );
  const stageTab = (s) => page.locator(`.picks-column [data-stage-tab="${s}"]`);
  check(
    roundup?.genre === "roundup" &&
      (await stageTab("selected").getAttribute("aria-selected")) === "true" &&
      (await stageTab("selected").locator("small").innerText()) === "1" &&
      (await shownInNews()) === newsBeforePicks - 1 &&
      (await call("GET", `/v1/cards/${firstId}`)).card.feedback.signal === "more",
    "picking a card moves it from News into the basket's 已选 tab and counts as show me more",
  );
  const second = page.locator(`.feed-list [data-card-id="${secondId}"]`);
  await second.getByRole("button", { name: "Add to a roundup" }).click();
  await page.getByRole("menu", { name: "Roundups" }).locator(`[data-pick="${roundup.id}"]`).click();
  await page.locator(`.picks-column [data-pick-card="${secondId}"]`).waitFor();
  check(
    (await call("GET", "/v1/picks"))
      .find((p) => p.id === roundup.id)
      .items.map((i) => String(i.cardId))
      .join(",") === `${firstId},${secondId}`,
    "a second card joins the roundup in the basket",
  );
  // The basket's genre chooser is drawn in the page (no native <select> popup): every option visible, a check on the
  // current one, and a change the server refuses (a two-card roundup can't become 单篇) leaves it on the saved genre.
  const roundupRow = page.locator(`.picks-column [data-pick-id="${roundup.id}"]`);
  await roundupRow.getByRole("button", { name: "Pick genre" }).click();
  const genreChooser = page.getByRole("menu", { name: "Pick genre" });
  await genreChooser.waitFor();
  check(
    (await page.locator(".picks-column select").count()) === 0 &&
      (await allOptionsVisible(genreChooser)) &&
      (await genreChooser.locator('[aria-checked="true"]').getAttribute("data-value")) ===
        "roundup",
    "the basket's genre chooser is an in-page menu, fully visible, with a check on the current genre",
  );
  await genreChooser.locator('[data-value="single"]').click();
  await genreChooser.waitFor({ state: "detached" });
  await page.waitForTimeout(300);
  check(
    (await roundupRow.getByRole("button", { name: "Pick genre" }).innerText()).trim() ===
      "主题串烧" &&
      (await call("GET", "/v1/picks")).find((p) => p.id === roundup.id).genre === "roundup",
    "a genre change the server refuses leaves the chooser on the saved genre",
  );
  await page.screenshot({ path: join(shots, "picks.png") });
  await collectCaps();
  await cleanText("picks");
  await page
    .locator(`.picks-column [data-pick-id="${roundup.id}"]`)
    .getByRole("button", { name: "Put the pick back" })
    .click();
  await page.locator(`.feed-list [data-card-id="${firstId}"]`).waitFor();
  await page.locator(`.feed-list [data-card-id="${secondId}"]`).waitFor();
  check(
    (await shownInNews()) === newsBeforePicks &&
      !(await call("GET", "/v1/picks")).some((p) => p.id === roundup.id),
    "putting a pick back returns its cards to News",
  );

  // ---------------------------------------------------------------- writing: the writer drafts a pick, ready gate
  const writeId = await pickable().first().getAttribute("data-card-id");
  const toWrite = page.locator(`.feed-list [data-card-id="${writeId}"]`);
  await toWrite.getByRole("button", { name: "Pick for writing" }).click();
  await page.getByRole("menu", { name: "Genre" }).locator('[data-genre="single"]').click();
  await page.locator(`.picks-column [data-pick-card="${writeId}"]`).waitFor();
  const writing = (await call("GET", "/v1/picks")).find((p) =>
    p.items.some((i) => String(i.cardId) === writeId),
  );
  const basketWidth = async () =>
    Math.round((await page.locator(".picks-column").boundingBox()).width);
  const widthBefore = await basketWidth();
  await page
    .locator(`.picks-column [data-pick-id="${writing.id}"]`)
    .getByRole("button", { name: "Open the draft" })
    .click();
  await page.locator(".pick-detail").waitFor();
  await page.locator(".writer-column").waitFor();
  check(
    (await page.locator(".pick-detail").getByRole("button", { name: "Start writing" }).count()) ===
      0 && (await basketWidth()) === widthBefore,
    "writing starts in one place, the writer column, and opening a pick keeps the basket's width",
  );
  await page.getByLabel("Writing requirements").fill("写给不写代码的读者");
  await page.locator(".writer-column").getByRole("button", { name: "Start writing" }).click();
  await page.locator(".draft-image").waitFor({ timeout: 20_000 });
  check(
    (await page.locator(".writer-note").textContent()).includes("写给不写代码的读者") &&
      (await call("GET", "/v1/picks")).find((p) => p.id === writing.id).note ===
        "写给不写代码的读者",
    "the requirements typed before writing are kept on the pick and shown with the brief",
  );
  await page.waitForFunction(() =>
    document.querySelector('[data-testid="writer-chat"] .msg.agent .bubble'),
  );
  const drafted = await page.locator(".draft-body").inputValue();
  check(
    drafted.includes("原文链接在评论区") &&
      !/https?:\/\//.test(drafted) &&
      (await page.getByLabel("First reply").inputValue()).startsWith("原文：http") &&
      (await page.locator('.pick-stage[data-stage="drafting"]').count()) === 1,
    "the writer drafts the pick: an image, text with no links, the 原文 links in the first reply, in 写作中",
  );
  await page.screenshot({ path: join(shots, "writing.png") });
  await collectCaps();
  await cleanText("writing");
  // The reader's own edit goes to the writer with the next message, shown as one folded line above it.
  await page.locator(".draft-body").fill(drafted.replace(/^[^\n]*/, "读者自己改的开头。"));
  await page.getByRole("button", { name: "Save the edit" }).click();
  await until(async () => (await call("GET", `/v1/picks/${writing.id}/drafts`)).length === 2);
  await page.getByLabel("Message the writer").fill("再短一点");
  await page.getByLabel("Message the writer").press("Enter");
  await page.locator('[data-testid="edit-notice"]').waitFor();
  await until(async () => (await call("GET", `/v1/picks/${writing.id}/drafts`)).length === 3);
  const notice = page.locator('[data-testid="edit-notice"]');
  check(
    (await notice.locator("summary").innerText()).includes("第 2 版") &&
      (await page.locator('[data-testid="writer-chat"] .msg.user .bubble').last().innerText()) ===
        "再短一点" &&
      (await notice.locator("pre").isHidden()),
    "the reader's own edit goes to the writer with the next message, as one folded line",
  );
  await notice.locator("summary").click();
  check(
    (await notice.locator("pre").innerText()).includes("+ 读者自己改的开头。"),
    "unfolding the line shows what the reader changed",
  );

  // ---------------------------------------------------------------- writing rules: edit, versions, restore
  await page.getByRole("button", { name: "Writing rules", exact: true }).click();
  const rulesDialog = page.getByRole("dialog", { name: "Writing rules editor" });
  const ruleText = rulesDialog.getByLabel("Rule text");
  await ruleText.waitFor();
  const original = await ruleText.inputValue();
  check(
    original.length > 0 &&
      (await rulesDialog.locator(".rules-version").count()) === 1 &&
      (await rulesDialog.locator('[data-rule="ARGMAP"]').count()) === 1,
    "the writing rules open with both rules and the text before any edit as the first version",
  );
  await ruleText.fill(`${original}\n- 浏览器测试加的一条。`);
  await ruleText.press("ControlOrMeta+s");
  await rulesDialog.locator(".rules-version").nth(1).waitFor();
  const savedRules = await call("GET", "/v1/writer-rules");
  check(
    savedRules[0].body.includes("浏览器测试加的一条") &&
      savedRules[0].versions.length === 2 &&
      savedRules[0].custom,
    "saving a rule keeps the old text as a version and the writer reads the new one",
  );
  await rulesDialog.locator(".rules-version").nth(1).click();
  await rulesDialog.locator(".rules-viewing").waitFor();
  check(
    (await ruleText.getAttribute("readonly")) !== null &&
      !(await ruleText.inputValue()).includes("浏览器测试加的一条"),
    "an old version opens read only",
  );
  await rulesDialog.getByRole("button", { name: "恢复这一版" }).click();
  await rulesDialog.locator(".rules-version").nth(2).waitFor();
  const restoredRules = (await call("GET", "/v1/writer-rules"))[0];
  check(
    restoredRules.body.trimEnd() === original.trimEnd() &&
      restoredRules.versions[0].source === "restore",
    "restoring an old version saves it again as the newest version",
  );
  await ruleText.fill(`${original}\n没保存的一条`);
  await page.keyboard.press("Escape");
  await rulesDialog.locator(".rules-closing").waitFor();
  check(await rulesDialog.isVisible(), "closing with an unsaved edit asks first");
  await rulesDialog.getByRole("button", { name: "放弃修改并关闭" }).click();
  await rulesDialog.waitFor({ state: "detached" });

  await page.locator(".draft-body").fill(`${drafted}\n**加粗**`);
  await page.getByRole("button", { name: "Save the edit" }).click();
  await page.locator(".draft-problems").waitFor();
  await page.getByRole("button", { name: "Mark ready" }).click();
  await page.locator(".toast.bad").waitFor();
  check(
    (await page.locator(".toast.bad").textContent()).includes("not ready") &&
      (await call("GET", "/v1/picks")).find((p) => p.id === writing.id).status === "drafting",
    "a draft with Markdown cannot go to 待发布",
  );
  await page.locator(".draft-body").fill(drafted);
  await page.getByRole("button", { name: "Save the edit" }).click();
  await page.waitForFunction(() => !document.querySelector(".draft-problems"));
  await page.getByRole("button", { name: "Mark ready" }).click();
  await page.locator('.pick-stage[data-stage="ready"]').waitFor();
  check(
    (await call("GET", `/v1/picks/${writing.id}/drafts`)).length === 5 &&
      (await stageTab("ready").getAttribute("aria-selected")) === "true",
    "the reader's edits are kept as revisions, the clean draft goes to 待发布 and the stage tab follows it",
  );
  const revisionButton = page.getByRole("button", { name: "Draft revision" });
  await revisionButton.click();
  const revisionMenu = page.getByRole("menu", { name: "Draft revision" });
  await revisionMenu.waitFor();
  check(
    (await revisionMenu.locator("[role=menuitemradio]").count()) === 5 &&
      (await allOptionsVisible(revisionMenu)),
    "the revision chooser is an in-page menu listing every revision, fully visible",
  );
  await revisionMenu.locator('[data-value="4"]').click();
  await page.waitForFunction(() =>
    document.querySelector(".draft-body").value.includes("**加粗**"),
  );
  check(
    (await revisionButton.innerText()).trim() === "第 4 版",
    "picking an older revision from the chooser shows that revision",
  );
  await revisionButton.click();
  await revisionMenu.locator('[data-value="5"]').click();
  await page.waitForFunction(
    () => !document.querySelector(".draft-body").value.includes("**加粗**"),
  );
  await page.getByRole("button", { name: "Rehearse" }).click();
  await page.locator(".publish-line", { hasText: "上次排练" }).waitFor();
  check(
    (await call("GET", `/v1/publish?pickId=${writing.id}`)).rehearsal?.wouldPost === true &&
      (await call("GET", "/v1/ledger")).length === 0,
    "a rehearsal checks the composer and writes nothing to the ledger",
  );
  await page.getByRole("button", { name: "Publish", exact: true }).click();
  await page.getByRole("button", { name: "Confirm publish" }).click();
  await page.locator('.pick-stage[data-stage="published"]').waitFor();
  check(
    (await call("GET", "/v1/ledger"))
      .filter((e) => e.draftKey === `pick:${writing.id}`)
      .map((e) => e.status)
      .join(",") === "ok,pending",
    "publishing writes pending then ok to the ledger and the pick is published",
  );
  await page.locator('[data-testid="reply-state"]', { hasText: "已发" }).waitFor();
  check(
    (await call("GET", "/v1/ledger"))
      .filter((e) => e.draftKey === `pick:${writing.id}:reply`)
      .map((e) => e.status)
      .join(",") === "ok,pending" &&
      (await page.getByRole("link", { name: "看帖子" }).count()) === 1,
    "right after the post its first reply (the 原文 links) goes out under it, and the panel says so",
  );
  await collectCaps();
  await cleanText("publishing");
  await stageTab("ready").click();
  await page.locator('.picks-list[data-stage-list="ready"] .picks-spacing').waitFor();
  check(
    (await page.locator(".picks-spacing").textContent()).includes("最早") &&
      (await page.locator(".pick-detail").count()) === 0,
    "a stage tab goes back to its list, and 待发布 says when the next post may go",
  );
  await stageTab("published").click();
  await page
    .locator(`.picks-list[data-stage-list="published"] [data-pick-id="${writing.id}"]`)
    .waitFor();
  await page.locator('[data-testid="chat"]').waitFor();
  check(
    (await stageTab("published").getAttribute("aria-selected")) === "true" &&
      (await page.locator(".picks-list [data-pick-id]").count()) === 1,
    "已发布 lists only the published pick, and the agent column is the news assistant again",
  );
  await page.screenshot({ path: join(shots, "stage-tabs.png") });
  await cleanText("stage tabs");
  await page
    .locator(`.picks-list [data-pick-id="${writing.id}"]`)
    .getByRole("button", { name: "Open the draft" })
    .click();
  await page.getByRole("button", { name: "Back to ready" }).click();
  await page.locator('.pick-stage[data-stage="ready"]').waitFor();
  await page.locator(".publish-line", { hasText: "已经发过一次" }).waitFor();
  const back = (await call("GET", "/v1/picks")).find((p) => p.id === writing.id);
  check(
    back.status === "ready" &&
      Boolean(back.reopenedAt) &&
      (await stageTab("ready").getAttribute("aria-selected")) === "true",
    "移回待发布 moves a published pick back to 待发布 and warns that posting again adds a second post",
  );
  await cleanText("reopen");

  // ---------------------------------------------------------------- the publish line (排队 and 定时发布)
  const beijingClock = (iso) =>
    new Date(iso).toLocaleTimeString("zh-CN", {
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "Asia/Shanghai",
    });
  const pickNow = async () => (await call("GET", "/v1/picks")).find((p) => p.id === writing.id);
  await page.getByRole("button", { name: "Queue", exact: true }).click();
  await page.locator('[data-testid="publish-scheduled"]').waitFor();
  const queued = await pickNow();
  check(
    queued.scheduleMode === "queue" &&
      Date.parse(queued.scheduledAt) >= Date.now() + 29 * 60_000 &&
      (await page.locator('[data-testid="publish-scheduled"]').textContent()).includes(
        `${beijingClock(queued.scheduledAt)} 自动发`,
      ),
    "inside the 30 minutes, 排队 puts the pick in line after the last post and says when it goes",
  );
  await page.getByRole("button", { name: "Change the time" }).click();
  await page.locator('[data-testid="publish-timing"]').waitFor();
  await page.getByRole("button", { name: "Publish day" }).click();
  await page.getByRole("menu", { name: "Publish day" }).locator("[data-value]").nth(1).click();
  await page.getByLabel("Publish time").fill("25:00");
  check(
    (await page.getByRole("button", { name: "Set the time" }).isDisabled()) &&
      (await page.locator(".publish-line.bad", { hasText: "14:30" }).count()) === 1,
    "定时发布 refuses a time that is not HH:MM",
  );
  await page.getByLabel("Publish time").fill("09:30");
  await page.getByRole("button", { name: "Set the time" }).click();
  await page.waitForFunction(() => !document.querySelector('[data-testid="publish-timing"]'));
  const timed = await pickNow();
  check(
    timed.scheduleMode === "time" &&
      beijingClock(timed.scheduledAt) === "09:30" &&
      (await page.locator('[data-testid="publish-scheduled"]').textContent()).includes(
        "明天 09:30",
      ),
    "定时发布 sets tomorrow 09:30 Beijing time and the panel shows it",
  );
  await cleanText("publish line");
  await stageTab("ready").click();
  const goesAt = page.locator(
    `.picks-list [data-pick-id="${writing.id}"] [data-testid="pick-when"]`,
  );
  await goesAt.waitFor();
  check(
    (await goesAt.textContent()).includes("明天 09:30") &&
      (await page.locator(".picks-spacing").textContent()).includes("排着 1 条"),
    "待发布 lists the pick with when it goes, and the header counts the line",
  );
  await page
    .locator(`.picks-list [data-pick-id="${writing.id}"]`)
    .getByRole("button", { name: "Open the draft" })
    .click();
  await page.getByRole("button", { name: "Unschedule" }).click();
  await page.waitForFunction(() => !document.querySelector('[data-testid="publish-scheduled"]'));
  check(
    (await pickNow()).scheduledAt === undefined && (await pickNow()).status === "ready",
    "取消排期 takes the pick out of the line and leaves it in 待发布",
  );
  await page.screenshot({ path: join(shots, "publish-line.png") });
  await stageTab("ready").click();
  await page.locator('[data-testid="chat"]').waitFor();

  // ---------------------------------------------------------------- tool row into executions
  await page.waitForFunction(() =>
    document.querySelector('[data-tool="present_news"][data-status="done"]:not([disabled])'),
  );
  await page.locator('[data-tool="present_news"][data-status="done"]').first().click();
  await page.locator("[data-tool-detail]").waitFor();
  const field = async (f) =>
    (await page.locator(`[data-tool-detail] [data-field="${f}"]`).textContent())?.trim() ?? "";
  const [duration, startedAt, endedAt, tokensText, cost] = [
    await field("duration"),
    await field("started"),
    await field("ended"),
    await field("tokens"),
    await field("cost"),
  ];
  check(
    /\d+(ms|\.\ds)/.test(duration) &&
      /\d\d:\d\d:\d\d/.test(startedAt) &&
      /\d\d:\d\d:\d\d/.test(endedAt) &&
      /\d+k? in/.test(tokensText) &&
      /\$/.test(cost),
    `a tool row opens executions with duration ${duration}, start ${startedAt}, end ${endedAt}, tokens ${tokensText}, cost ${cost}`,
  );
  await page.getByRole("button", { name: "Open the run" }).click();
  await page.locator("[data-run] .generation").first().waitFor();
  check(
    (await page.locator("[data-run] .generation").count()) >= 5,
    "the run tree lists every generation",
  );
  await collectCaps();
  const sweepRow = page.locator(".exec-tree .list-row", { hasText: "Sweep 1" }).first();
  check(
    (await page.locator(".exec-list .tabs").count()) === 0 &&
      (await page.locator(".exec-tree .list-row", { hasText: "Chat" }).count()) >= 1,
    "Executions is one list: sweeps and chats together, no Runs and Sweeps tabs",
  );
  await sweepRow.locator(".row-main").click();
  await page.locator("[data-sweep]").waitFor();
  await page.locator("[data-run] .generation").first().waitFor();
  check(
    (await page.locator(".audit-step.missing").count()) === 0 &&
      (await page.locator(".audit-step").count()) > 3,
    "a sweep shows its phases, a clean audit and the run it started, together",
  );
  await sweepRow.getByRole("button", { name: "Open sweep 1" }).click();
  await page.locator('[data-exec-tool="run_news_sweep"]').waitFor();
  await page.locator(".exec-children .exec-leaf", { hasText: "news-researcher" }).first().waitFor();
  check(
    (await page.locator(".exec-children [data-exec-tool]").count()) >= 5,
    "a sweep opens into its tool calls and its researcher runs",
  );
  await page.locator('[data-exec-tool="complete_sweep"]').click();
  await page.locator("[data-tool-detail]").waitFor();
  check(true, "a tool call in the tree opens its detail");
  await sweepRow.locator(".row-main").click();
  await page.locator("[data-sweep]").waitFor();
  const logPills = page.locator(".logs .pill");
  check(
    (await logPills.count()) === 8 && (await page.locator(".logs .pill.on").count()) === 8,
    "logs start with every app and level selected as pills",
  );
  await page.locator(".log-line").first().waitFor();
  const payloadButton = page.locator(".log-line button[aria-label^='Show the']").first();
  await payloadButton.click();
  await page.locator(".json-modal .json-view .json-key").first().waitFor();
  check(true, "a log line's payload opens as highlighted JSON in a modal");
  await page.keyboard.press("Escape");
  await page.locator(".json-modal").waitFor({ state: "detached" });
  await page.locator(".logs .pill", { hasText: "debug" }).click();
  check((await page.locator(".logs .pill.on").count()) === 7, "a level pill filters the logs down");
  await collectCaps();
  await page.screenshot({ path: join(shots, "executions.png") });
  await cleanText("executions");
  await page.getByRole("button", { name: "Close executions" }).click();

  // ---------------------------------------------------------------- context bar
  await call("PATCH", "/v1/agent/compaction", { background: 60_000, force: 300_000 });
  await page.reload();
  await page.locator('[data-marker="background"][aria-valuenow="60000"]').waitFor();
  const bar = await page.locator(".context-bar").boundingBox();
  const windowTokens = (await call("GET", "/v1/agent/compaction")).window;
  const dragTo = async (marker, tokensAt) => {
    const m = await page.locator(`[data-marker="${marker}"]`).boundingBox();
    await page.mouse.move(m.x + m.width / 2, m.y + m.height / 2);
    await page.mouse.down();
    await page.mouse.move(bar.x + (bar.width * tokensAt) / windowTokens, m.y + m.height / 2, {
      steps: 8,
    });
    await page.mouse.up();
    await sleep(400);
  };
  await dragTo("force", 200_000);
  await dragTo("background", 100_000);
  const saved = await call("GET", "/v1/agent/compaction");
  const tolerance = windowTokens / bar.width + 512;
  check(
    Math.abs(saved.background - 100_000) <= tolerance &&
      Math.abs(saved.force - 200_000) <= tolerance,
    `dragging the context bar sets about 100k and 200k (${saved.background}, ${saved.force})`,
  );
  await page.reload();
  await page.locator(`[data-marker="background"][aria-valuenow="${saved.background}"]`).waitFor();
  check(
    (await page.locator('[data-marker="force"]').getAttribute("aria-valuenow")) ===
      String(saved.force),
    "the context points survive a reload",
  );
  const tickLabel = (m) => page.locator(`[data-marker="${m}"] .tick-label`);
  const [bgText, forceText] = [
    await tickLabel("background").innerText(),
    await tickLabel("force").innerText(),
  ];
  const [bgBox, forceBox] = [
    await tickLabel("background").boundingBox(),
    await tickLabel("force").boundingBox(),
  ];
  check(
    bgText === "100k" && forceText === "200k" && bgBox.x + bgBox.width <= forceBox.x,
    `each tick shows its token count above it (${bgText}, ${forceText}), side by side without overlap`,
  );
  await page.getByRole("button", { name: "Compaction details" }).click();
  await page.getByRole("dialog", { name: "Context compaction" }).waitFor();
  await collectCaps();
  await page
    .getByRole("dialog", { name: "Context compaction" })
    .getByRole("button", { name: "Close" })
    .click();

  // ---------------------------------------------------------------- model picker
  check(
    (await page.locator(".model-button").textContent()).includes("Faux Haiku"),
    "the agent starts on the device default model",
  );
  await page.getByRole("button", { name: "Choose a model" }).click();
  const haiku = page.locator('[data-model="anthropic/claude-haiku-5.5"]');
  check(
    (await haiku.locator(".badge").textContent()) === "Default",
    "the model picker marks Claude Haiku 5.5 as the default",
  );
  await haiku.click();
  await page.waitForFunction(() =>
    document.querySelector(".model-button")?.textContent?.includes("Claude Haiku 5.5"),
  );
  check(
    (await call("GET", "/v1/agent")).model === "anthropic/claude-haiku-5.5",
    "the model picker switches the agent's model",
  );

  // ---------------------------------------------------------------- settings: keywords CRUD
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const settingsBox = await page.getByRole("dialog", { name: "Settings" }).boundingBox();
  const viewport = page.viewportSize();
  check(
    settingsBox.width > viewport.width * 0.55 &&
      Math.abs(settingsBox.x + settingsBox.width / 2 - viewport.width / 2) < 4,
    `Settings opens as a full, centered modal (${Math.round(settingsBox.width)}px wide)`,
  );
  await page.getByLabel("Add a topic keyword").fill("agent memory");
  await page.getByRole("button", { name: "Add topic keyword" }).click();
  const row = page.locator('[data-keyword="agent memory"]');
  await row.waitFor();
  await row.locator('input[type="range"]').evaluate((el) => {
    el.value = "1.5";
    el.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await page.waitForFunction(
    () =>
      document.querySelector('[data-keyword="agent memory"] .kw-weight')?.textContent === "1.50",
  );
  await row.getByRole("button", { name: "Turn off agent memory" }).click();
  await page.locator('[data-keyword="agent memory"].off').waitFor();
  const kw = (await call("GET", "/v1/keywords?kind=topic")).find((k) => k.term === "agent memory");
  check(
    kw?.weight === 1.5 && kw.enabled === false,
    "keywords: add, weight and toggle reach the API",
  );
  await page
    .locator('[data-keyword="agent memory"]')
    .getByRole("button", { name: "Remove agent memory" })
    .click();
  await page.locator('[data-keyword="agent memory"]').waitFor({ state: "detached" });
  check(
    !(await call("GET", "/v1/keywords?kind=topic")).some((k) => k.term === "agent memory"),
    "keywords: remove reaches the API",
  );
  await composer.fill('FAUX_CALL edit_keyword {"action": "add", "term": "agent queues"}');
  await composer.press("Enter");
  await page.locator('[data-keyword="agent queues"]').waitFor();
  check(true, "the agent's keyword edits show up live in Settings");
  await page.getByRole("button", { name: "Sources", exact: true }).click();
  const simonWeight = page.getByLabel("Weight of Simon Willison");
  await simonWeight.evaluate((el) => {
    el.value = "1.5";
    el.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await sleep(400);
  check(
    (await call("GET", "/v1/sources")).find((x) => x.name === "Simon Willison")?.weight === 1.5,
    "a source's weight slider reaches the API",
  );
  await collectCaps();
  await page.getByRole("button", { name: "Tools", exact: true }).click();
  const searchDoc = page.locator('[data-tool-doc="search_web"]');
  await searchDoc.waitFor();
  await searchDoc.locator("summary").first().click();
  await searchDoc.locator(".tool-definition summary").click();
  check(
    (await searchDoc.locator(".param-table tr").count()) === 3 &&
      (await searchDoc.locator(".req").count()) === 1 &&
      (await searchDoc.innerText()).includes("one line per hit") &&
      (await searchDoc.locator(".json-view .json-key").count()) > 3,
    "the Tools tab shows each tool's params, return and a highlighted definition",
  );
  await page.getByRole("button", { name: "Taste", exact: true }).click();
  await collectCaps();
  await page.screenshot({ path: join(shots, "settings.png") });
  await cleanText("settings");
  await page.getByRole("button", { name: "Close settings" }).click();

  // ---------------------------------------------------------------- layout
  await collectCaps();
  await cleanText("main view");
  await page.getByRole("button", { name: "Toggle the news column" }).click();
  check((await page.locator('[data-col="feed"]').count()) === 0, "the news column collapses");
  await page.reload();
  await page.locator('[data-col="agent"]').waitFor();
  check(
    (await page.locator('[data-col="feed"]').count()) === 0,
    "the collapsed column stays collapsed after a reload",
  );
  await page.getByRole("button", { name: "Toggle the picks column" }).click();
  check((await page.locator('[data-col="picks"]').count()) === 0, "the picks column collapses");
  await page.getByRole("button", { name: "Toggle the agent column" }).click();
  await page.locator(".toast", { hasText: "至少保留一栏" }).waitFor();
  check(
    (await page.locator('[data-col="agent"]').count()) === 1,
    "the last open column cannot hide",
  );
  await page.getByRole("button", { name: "Toggle the news column" }).click();
  await page.getByRole("button", { name: "Toggle the agent column" }).click();
  check(
    (await page.locator('[data-col="agent"]').count()) === 0 &&
      (await page.locator('[data-col="feed"]').count()) === 1,
    "the agent column collapses too",
  );
  await page.reload();
  await page.locator('[data-col="feed"]').waitFor();
  check(
    (await page.locator('[data-col="agent"]').count()) === 0,
    "the agent column stays collapsed after a reload",
  );
  await page.getByRole("button", { name: "Toggle the agent column" }).click();
  await page.locator('[data-col="agent"]').waitFor();

  // ---------------------------------------------------------------- basket width and the 显示 menu
  await page.getByRole("button", { name: "Toggle the picks column" }).click();
  await page.locator('[data-col="picks"]').waitFor();
  const picksBox = async () => await page.locator(".picks-column").boundingBox();
  const startBox = await picksBox();
  const handle = await page
    .getByRole("separator", { name: "Resize the picks column" })
    .boundingBox();
  await page.mouse.move(handle.x + handle.width / 2, handle.y + 200);
  await page.mouse.down();
  await page.mouse.move(handle.x + handle.width / 2 - 100, handle.y + 200, { steps: 5 });
  await page.mouse.up();
  const dragged = Math.round((await picksBox()).width);
  await page.reload();
  await page.locator('[data-col="picks"]').waitFor();
  check(
    dragged === Math.round(startBox.width) + 100 &&
      Math.round((await picksBox()).width) === dragged,
    "dragging the basket's edge widens it, and the width survives a reload",
  );
  const htmlData = () =>
    page.evaluate(() => ({
      theme: document.documentElement.dataset.theme,
      size: document.documentElement.dataset.size,
      bg: getComputedStyle(document.body).backgroundColor,
      font: getComputedStyle(document.body).fontSize,
    }));
  await page.getByRole("button", { name: "Theme and text size" }).click();
  await page.getByRole("button", { name: "Eye-care theme" }).click();
  await page.getByRole("button", { name: "Large text" }).click();
  await cleanText("display menu");
  await page.screenshot({ path: join(shots, "paper.png") });
  await page.reload();
  await page.locator('[data-col="feed"]').waitFor();
  const paper = await htmlData();
  check(
    paper.theme === "paper" &&
      paper.size === "large" &&
      paper.bg === "rgb(243, 238, 227)" &&
      paper.font === "18px",
    "the 显示 menu switches to the 护眼 theme and large text, and both survive a reload",
  );
  await page.getByRole("button", { name: "Theme and text size" }).click();
  await page.getByRole("button", { name: "Dark theme" }).click();
  await page.getByRole("button", { name: "Normal text" }).click();
  const dark = await htmlData();
  check(
    dark.theme === "dark" && dark.bg === "rgb(18, 18, 18)" && dark.font === "16px",
    "and back to the dark theme with normal text",
  );

  await page.locator('[data-tab="news"]').click();
  // ---------------------------------------------------------------- 移出: dismissing a card moves no weights
  const weightsNow = async () =>
    JSON.stringify([
      (await call("GET", "/v1/keywords")).map((k) => [k.id, k.weight]),
      (await call("GET", "/v1/sources")).map((x) => [x.id, x.weight]),
    ]);
  // The faux sweep's cards are used up by now: voting the thumbs-down card back up returns it to News.
  await call("POST", `/v1/cards/${doomedId}/feedback`, { signal: "more" });
  await page.locator(`.feed-list [data-card-id="${doomedId}"]`).waitFor();
  const weightsBeforeDismiss = await weightsNow();
  const dismissed = page.locator(".feed-list .feed-row:not(.highlight) .card").last();
  const dismissedId = await dismissed.getAttribute("data-card-id");
  const shownBeforeDismiss = await shownInNews();
  await dismissed.getByRole("button", { name: "Dismiss this card" }).click();
  await page.locator(`.feed-list [data-card-id="${dismissedId}"]`).waitFor({ state: "detached" });
  await page.locator(".toast", { hasText: "已移出候选" }).waitFor();
  const dismissedCard = (await call("GET", `/v1/cards/${dismissedId}`)).card;
  check(
    (await shownInNews()) === shownBeforeDismiss - 1 &&
      Boolean(dismissedCard.dismissedAt) &&
      dismissedCard.feedback.signal !== "less" &&
      (await weightsNow()) === weightsBeforeDismiss,
    "移出 takes a card out of News without show me less and without moving any weights",
  );

  // ---------------------------------------------------------------- 清理: clearing the candidates
  const weightsBeforeClear = await weightsNow();
  await page.getByRole("button", { name: "Clear candidates" }).click();
  const clearOld = page.locator('[data-clear="old"]');
  check(
    (await clearOld.isDisabled()) && (await clearOld.innerText()).includes("0 条"),
    "清理 offers the 48 hour clear, disabled when nothing is that old",
  );
  await page.locator('[data-clear="all"]').click();
  await page.locator('[data-clear="all-confirm"]').click();
  await page.locator(".toast", { hasText: "条候选" }).waitFor();
  await page.locator(".feed-list .card").first().waitFor({ state: "detached" });
  const inBasket = new Set(
    (await call("GET", "/v1/picks")).flatMap((p) => p.items.map((i) => i.cardId)),
  );
  check(
    (await shownInNews()) === 0 &&
      (await call("GET", "/v1/feed")).items.every((c) => inBasket.has(c.id)) &&
      (await weightsNow()) === weightsBeforeClear,
    "清空 asks once more, empties News but keeps the basket, and moves no weights",
  );
  await cleanText("clear");

  // ---------------------------------------------------------------- capabilities
  const { CAPABILITY_IDS } = await import(
    join(root, "apps/shared/packages/dna-sdk/src/capabilities.ts")
  );
  const missing = CAPABILITY_IDS.filter((id) => !caps.has(id));
  check(
    missing.length === 0,
    `every capability has a data-cap control${missing.length ? ` (missing ${missing.join(", ")})` : ""}`,
  );
  check(errors.length === 0, `no page errors${errors.length ? `: ${errors.join(" | ")}` : ""}`);
  console.log("ALL PASS");
} catch (error) {
  await page.screenshot({ path: join(shots, "failure.png") }).catch(() => {});
  console.error(error.message);
  console.error(`api log tail:\n${api.log().slice(-2000)}`);
  process.exitCode = 1;
} finally {
  await browser.close();
  for (const child of children) child.kill("SIGTERM");
  await sleep(300);
  rmSync(tmp, { recursive: true, force: true });
}
