// argmap JSON to a PNG and an .excalidraw scene, in headless Chromium: web/argmap.js lays the nodes out with
// Excalidraw's own text measurement, web/export.js exports. Then the self-checks a model that cannot see the image acts
// on: overlapping cards, text past a card's edge, a group title past its frame, a height/width ratio over 1.8.
import { createHash } from "node:crypto";
import { createReadStream, existsSync, readdirSync, statSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { homedir } from "node:os";
import { extname, join, resolve } from "node:path";
import { chromium } from "playwright";
import type { ArgmapData, ArgmapLayout } from "./types.ts";

const WEB = resolve(import.meta.dirname, "..", "web");
const TYPES: Record<string, string> = {
  ".js": "text/javascript",
  ".html": "text/html",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
};
const STYLES = {
  hand: {
    font: 5,
    bodyFont: 5,
    rough: 1,
    landmark: 30,
    title: 23,
    body: 19,
    tag: 15,
    pad: 18,
    cardW: 380,
  },
  clean: {
    font: 5,
    bodyFont: 6,
    rough: 0,
    landmark: 30,
    title: 23,
    body: 19,
    tag: 15,
    pad: 18,
    cardW: 380,
  },
};
const MAX_RATIO = 1.8;

export interface RenderOptions {
  layout?: ArgmapLayout;
  /** random picks light or dark from the landmark, so one image always gets the same theme. */
  theme?: "light" | "dark" | "random";
  style?: keyof typeof STYLES;
  scale?: number;
}

export interface RenderResult {
  png: Buffer;
  /** The .excalidraw scene: open it at excalidraw.com to move cards by hand. */
  scene: unknown;
  size: { w: number; h: number };
  layout: ArgmapLayout;
  theme: "light" | "dark";
  /** Problems to fix before using the image, in Chinese, one per line. Empty means none were found. */
  warnings: string[];
}

/** True once `npm run build` has produced web/bundle.js and web/fonts. */
export function argmapBuilt(): boolean {
  return existsSync(join(WEB, "bundle.js")) && existsSync(join(WEB, "fonts"));
}

function serve(): Promise<Server> {
  const server = createServer((req, res) => {
    const file = join(WEB, decodeURIComponent((req.url ?? "/").split("?")[0]!));
    if (!file.startsWith(WEB) || !existsSync(file) || statSync(file).isDirectory()) {
      res.writeHead(404);
      res.end();
      return;
    }
    res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream" });
    createReadStream(file).pipe(res);
  });
  return new Promise((ok) => server.listen(0, "127.0.0.1", () => ok(server)));
}

/** CHROME_BIN, else Playwright's own Chromium, else the installed Chrome. */
function chromePath(): string | undefined {
  if (process.env.CHROME_BIN) return process.env.CHROME_BIN;
  try {
    if (existsSync(chromium.executablePath())) return undefined;
  } catch {}
  const cache = join(homedir(), "Library/Caches/ms-playwright");
  if (existsSync(cache))
    for (const dir of readdirSync(cache)
      .filter((d) => d.startsWith("chromium_headless_shell"))
      .sort()
      .reverse())
      for (const sub of readdirSync(join(cache, dir))) {
        const bin = join(cache, dir, sub, "chrome-headless-shell");
        if (existsSync(bin)) return bin;
      }
  const system = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  return existsSync(system) ? system : undefined;
}

interface SceneElement {
  id: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  containerId?: string | null;
}

function selfCheck(data: ArgmapData, elements: SceneElement[], size: { w: number; h: number }) {
  const warnings: string[] = [];
  const byId = new Map(elements.map((e) => [e.id, e]));
  const groups = new Set(data.nodes.filter((n) => n.kind === "group").map((n) => n.id));
  const cards = data.nodes
    .filter((n) => !groups.has(n.id))
    .map((n) => byId.get(n.id))
    .filter((e): e is SceneElement => !!e);
  const hit = (a: SceneElement, b: SceneElement) =>
    a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
  for (let i = 0; i < cards.length; i++)
    for (let j = i + 1; j < cards.length; j++)
      if (hit(cards[i]!, cards[j]!)) warnings.push(`卡片 ${cards[i]!.id} 与 ${cards[j]!.id} 重叠`);
  for (const g of groups) {
    const frame = byId.get(g);
    if (!frame) continue;
    const title = elements.find(
      (e) =>
        e.type === "text" &&
        !e.containerId &&
        Math.abs(e.x - frame.x - 16) < 1 &&
        Math.abs(e.y - frame.y - 12) < 1,
    );
    if (title && title.x + title.width > frame.x + frame.width)
      warnings.push(`分组框 ${g} 的标题越出框外`);
  }
  for (const text of elements.filter((e) => e.type === "text" && e.containerId)) {
    const box = byId.get(text.containerId!);
    if (box?.type === "rectangle" && text.x + text.width > box.x + box.width + 1)
      warnings.push(`${text.containerId} 的文字越出右边`);
  }
  const ratio = size.h / size.w;
  if (ratio > MAX_RATIO)
    warnings.push(
      `高宽比 ${ratio.toFixed(2)} > ${MAX_RATIO}，时间线会把图裁成一小截：先砍节点或换版式，不要缩字号`,
    );
  return warnings;
}

export async function renderArgmap(
  data: ArgmapData,
  options: RenderOptions = {},
): Promise<RenderResult> {
  if (!argmapBuilt())
    throw new Error(
      "argmap is not built: run `npm run build -w @dna/argmap` (just install does it)",
    );
  const layout = options.layout ?? data.layout ?? "flow";
  let theme = options.theme ?? "random";
  if (theme === "random")
    theme =
      createHash("sha1")
        .update(data.landmark || JSON.stringify(data))
        .digest()[0]! % 2
        ? "dark"
        : "light";
  const opt = { layout, style: STYLES[options.style ?? "hand"] };
  const scale = options.scale ?? 2;
  const server = await serve();
  const executablePath = chromePath();
  const browser = await chromium.launch(executablePath ? { executablePath } : {});
  try {
    const page = await browser.newPage();
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const { port } = server.address() as { port: number };
    await page.goto(`http://127.0.0.1:${port}/index.html`);
    const args = JSON.stringify({ data, opt, dark: theme === "dark", scale });
    const result = (await page.evaluate(`window.ARGMAP_EXPORT(${args})`)) as {
      png: string;
      scene: unknown;
      size: { w: number; h: number };
    };
    if (errors.length) throw new Error(`argmap page error: ${errors[0]}`);
    const scene = result.scene as { elements: SceneElement[] };
    return {
      png: Buffer.from(result.png, "base64"),
      scene: result.scene,
      size: result.size,
      layout,
      theme,
      warnings: selfCheck(data, scene.elements, result.size),
    };
  } finally {
    await browser.close();
    server.close();
  }
}
