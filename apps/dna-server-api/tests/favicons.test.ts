import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { sourceSite } from "../src/db/repos/news.ts";
import { Favicons, iconLinks } from "../src/news/favicons.ts";

const PNG = Buffer.concat([Buffer.from("89504e470d0a1a0a", "hex"), Buffer.alloc(64, 1)]);

test("a card's source site: Hacker News and GitHub by kind, a feed by its site, no source by the article", () => {
  assert.equal(sourceSite("hn_search", "", "https://github.com/a/b"), "news.ycombinator.com");
  assert.equal(sourceSite("github_releases", "https://github.com/a/b", ""), "github.com");
  assert.equal(sourceSite("web_page", "https://x.com/simonw", ""), "x.com");
  assert.equal(sourceSite("rss", "https://feeds.example.org/blog.xml", ""), "example.org");
  assert.equal(sourceSite("rss", "https://www.reddit.com/r/LocalLLaMA/.rss", ""), "reddit.com");
  assert.equal(sourceSite(null, null, "https://twitter.com/a/status/1"), "x.com");
  assert.equal(sourceSite(null, null, "not a url"), undefined);
});

test("icon links: tab icons first, apple-touch-icon last, resolved against the page", () => {
  const html = `<head><link rel="apple-touch-icon" href="/touch.png">
    <link rel="stylesheet" href="/a.css"><link href="img/fav.png" rel="shortcut icon"></head>`;
  assert.deepEqual(iconLinks(html, "https://example.org/blog/"), [
    "https://example.org/blog/img/fav.png",
    "https://example.org/touch.png",
  ]);
});

test("a site's icon is fetched once and cached; a site without one is remembered; bad hosts never fetch", async () => {
  const dir = mkdtempSync(join(tmpdir(), "favicons-"));
  try {
    const asked: string[] = [];
    const fakeFetch = (async (url: string) => {
      asked.push(url);
      if (url === "https://example.org/favicon.ico")
        return new Response("<html>not an icon</html>", {
          headers: { "content-type": "text/html" },
        });
      if (url === "https://example.org/")
        return new Response(`<link rel="icon" href="/i.png">`, {
          headers: { "content-type": "text/html; charset=utf-8" },
        });
      if (url === "https://example.org/i.png")
        return new Response(PNG, { headers: { "content-type": "image/png" } });
      return new Response("", { status: 404 });
    }) as typeof fetch;
    const icons = new Favicons({ dataDir: dir, fetch: fakeFetch });

    const icon = await icons.get("Example.org");
    assert.equal(icon?.type, "image/png");
    assert.deepEqual(readFileSync(icon!.file), PNG);
    assert.deepEqual(asked, [
      "https://example.org/favicon.ico",
      "https://example.org/",
      "https://example.org/i.png",
    ]);

    asked.length = 0;
    assert.equal((await icons.get("example.org"))?.type, "image/png");
    assert.equal(await icons.get("none.example"), undefined);
    assert.equal(await icons.get("none.example"), undefined);
    assert.deepEqual(asked, ["https://none.example/favicon.ico", "https://none.example/"]);

    asked.length = 0;
    assert.equal(await icons.get("../etc/passwd"), undefined);
    assert.equal(await icons.get("localhost"), undefined);
    assert.equal(await icons.get("127.0.0.1"), undefined);
    assert.equal(await icons.get("printer.local"), undefined);
    assert.deepEqual(asked, []);
    assert.equal(await new Favicons({ dataDir: dir, offline: true }).get("other.org"), undefined);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
