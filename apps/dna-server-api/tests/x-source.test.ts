import assert from "node:assert/strict";
import { test } from "node:test";
import { tweetEntry, xHandle } from "../src/news/sources/x.ts";

test("an X profile url is an account; other x.com urls are not", () => {
  assert.equal(xHandle("https://x.com/simonw"), "simonw");
  assert.equal(xHandle("https://twitter.com/_philschmid/"), "_philschmid");
  assert.equal(xHandle("https://x.com/simonw/status/1"), undefined);
  assert.equal(xHandle("https://example.com/simonw"), undefined);
});

test("a post with an article link becomes the article; others stay the post", () => {
  const linked = tweetEntry("simonw", {
    id: "2",
    text: "I built a Command &amp; Conquer style RTS https://t.co/abc",
    createdAtISO: "2026-10-20T19:43:00+00:00",
    author: { screenName: "simonw" },
    metrics: { likes: 5, replies: 2 },
    urls: ["https://x.com/i/web/status/9", "https://simonwillison.net/2026/Oct/20/battledrones/"],
  });
  assert.equal(linked.url, "https://simonwillison.net/2026/Oct/20/battledrones/");
  assert.equal(linked.discussionUrl, "https://x.com/simonw/status/2");
  assert.equal(linked.title, "I built a Command & Conquer style RTS");
  assert.equal(linked.points, 5);
  const plain = tweetEntry("simonw", { id: "3", text: "Has anyone seen these prompts?", urls: [] });
  assert.equal(plain.url, "https://x.com/simonw/status/3");
  assert.equal(plain.discussionUrl, undefined);
});
