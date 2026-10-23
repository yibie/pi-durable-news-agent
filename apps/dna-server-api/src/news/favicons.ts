// Source icons: a site's favicon, fetched once and kept in <dataDir>/favicons, so a card can show where it came from
// as an icon. It tries /favicon.ico, then the icon the home page links; a site without one is remembered for a day and
// the browser draws a plain icon instead. Offline (faux mode and tests) it never touches the network.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Logger } from "@dna/sdk/node";

export interface FaviconDeps {
  dataDir: string;
  log?: Logger;
  offline?: boolean;
  /** Injected in tests. */
  fetch?: typeof fetch;
}

export interface Favicon {
  file: string;
  type: string;
}

interface Meta {
  file?: string;
  type?: string;
  at: string;
}

const HOST = /^(?=.{1,253}$)[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;
const MISS_MS = 24 * 60 * 60 * 1000;
const TIMEOUT_MS = 6000;
const MAX_BYTES = 200_000;
const EXT: Record<string, string> = {
  "image/x-icon": "ico",
  "image/vnd.microsoft.icon": "ico",
  "image/png": "png",
  "image/svg+xml": "svg",
  "image/gif": "gif",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36";

/** A public site's name: no IP addresses, no local names, so the icon fetch cannot be pointed at this machine. */
export const validHost = (host: string) =>
  HOST.test(host) && !/^[\d.]+$/.test(host) && !/\.(local|localhost|internal|lan)$/.test(host);

/** The icon links in a page, apple-touch-icon last: it is big and plain where the tab icon is not. */
export function iconLinks(html: string, base: string): string[] {
  const links: { href: string; touch: boolean }[] = [];
  for (const tag of html.match(/<link\b[^>]*>/gi) ?? []) {
    const rel = /\brel\s*=\s*["']?([^"'>]+)/i.exec(tag)?.[1]?.toLowerCase() ?? "";
    const href = /\bhref\s*=\s*["']?([^"'\s>]+)/i.exec(tag)?.[1];
    if (!href || !/(^|\s)(icon|shortcut icon|apple-touch-icon)(\s|$)/.test(rel)) continue;
    try {
      links.push({ href: new URL(href, base).href, touch: rel.includes("apple-touch-icon") });
    } catch {
      // A broken href is just skipped.
    }
  }
  return [...links.filter((l) => !l.touch), ...links.filter((l) => l.touch)].map((l) => l.href);
}

export class Favicons {
  private readonly dir: string;
  private readonly running = new Map<string, Promise<Favicon | undefined>>();

  constructor(private readonly deps: FaviconDeps) {
    this.dir = join(deps.dataDir, "favicons");
  }

  /** The cached icon of a host, fetching it the first time; undefined when the site has none. */
  get(host: string): Promise<Favicon | undefined> {
    host = host.toLowerCase();
    if (!validHost(host)) return Promise.resolve(undefined);
    const cached = this.cached(host);
    if (cached !== "unknown") return Promise.resolve(cached);
    if (this.deps.offline) return Promise.resolve(undefined);
    let run = this.running.get(host);
    if (!run) {
      run = this.fetchIcon(host).finally(() => this.running.delete(host));
      this.running.set(host, run);
    }
    return run;
  }

  private meta(host: string) {
    return join(this.dir, `${host}.json`);
  }

  private cached(host: string): Favicon | undefined | "unknown" {
    const path = this.meta(host);
    if (!existsSync(path)) return "unknown";
    try {
      const m = JSON.parse(readFileSync(path, "utf8")) as Meta;
      if (m.file && m.type && existsSync(join(this.dir, m.file)))
        return { file: join(this.dir, m.file), type: m.type };
      return Date.now() - Date.parse(m.at) < MISS_MS ? undefined : "unknown";
    } catch {
      return "unknown";
    }
  }

  private async fetchIcon(host: string): Promise<Favicon | undefined> {
    mkdirSync(this.dir, { recursive: true });
    const base = `https://${host}/`;
    let found = await this.download(`${base}favicon.ico`);
    if (!found) {
      const page = await this.text(base);
      for (const url of page ? iconLinks(page.html, page.url) : []) {
        found = await this.download(url);
        if (found) break;
      }
    }
    const at = new Date().toISOString();
    if (!found) {
      writeFileSync(this.meta(host), JSON.stringify({ at } satisfies Meta));
      this.deps.log?.debug("favicon.miss", { host });
      return undefined;
    }
    const file = `${host}.${EXT[found.type]}`;
    writeFileSync(join(this.dir, file), found.bytes);
    writeFileSync(this.meta(host), JSON.stringify({ file, type: found.type, at } satisfies Meta));
    return { file: join(this.dir, file), type: found.type };
  }

  private async request(url: string) {
    const f = this.deps.fetch ?? fetch;
    try {
      return await f(url, {
        redirect: "follow",
        headers: { "user-agent": UA, accept: "image/*,text/html;q=0.8,*/*;q=0.5" },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch {
      return undefined;
    }
  }

  private async download(url: string): Promise<{ bytes: Buffer; type: string } | undefined> {
    const res = await this.request(url);
    if (!res?.ok) return undefined;
    const type = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
    if (!EXT[type]) return undefined;
    const bytes = Buffer.from(await res.arrayBuffer());
    return bytes.length > 32 && bytes.length <= MAX_BYTES ? { bytes, type } : undefined;
  }

  private async text(url: string): Promise<{ html: string; url: string } | undefined> {
    const res = await this.request(url);
    if (!res?.ok || !(res.headers.get("content-type") ?? "").includes("html")) return undefined;
    return { html: (await res.text()).slice(0, 300_000), url: res.url || url };
  }
}
