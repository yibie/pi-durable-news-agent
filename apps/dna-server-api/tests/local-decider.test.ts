import assert from "node:assert/strict";
import { test } from "node:test";
import { ensureLocalDecider } from "../src/news/local-decider.ts";

const URL_ = "http://127.0.0.1:11434/v1/systemone";

/** A fake Ollama: down until `opened`, then up after `upAfter` more polls (never, if Infinity). */
function ollama(upAtStart: boolean, upAfter = 0) {
  let opened = 0;
  let polls = 0;
  const seen: string[] = [];
  const fetch = (async (url: string | URL) => {
    seen.push(String(url));
    if (upAtStart) return new Response("{}");
    if (opened && polls++ >= upAfter) return new Response("{}");
    throw new TypeError("fetch failed");
  }) as typeof globalThis.fetch;
  const open = async () => {
    opened++;
  };
  return { fetch, open, seen, opened: () => opened };
}

test("an Ollama that answers is left alone", async () => {
  const o = ollama(true);
  await ensureLocalDecider(URL_, { fetch: o.fetch, open: o.open });
  assert.equal(o.opened(), 0);
  assert.deepEqual(o.seen, ["http://127.0.0.1:11434/api/version"]);
});

test("a closed Ollama app is opened once and waited for", async () => {
  const o = ollama(false, 2);
  await ensureLocalDecider(URL_, { fetch: o.fetch, open: o.open, pollMs: 1, waitMs: 1000 });
  assert.equal(o.opened(), 1);
});

test("an Ollama that never comes up fails with what to do; a remote one is never opened", async () => {
  const o = ollama(false, Infinity);
  await assert.rejects(
    ensureLocalDecider(URL_, { fetch: o.fetch, open: o.open, pollMs: 1, waitMs: 20 }),
    /does not answer at http:\/\/127\.0\.0\.1:11434, even after opening the Ollama app/,
  );
  const remote = ollama(false);
  await assert.rejects(
    ensureLocalDecider("http://192.168.1.5:11434/v1/systemone", {
      fetch: remote.fetch,
      open: remote.open,
    }),
    /Start Ollama there/,
  );
  assert.equal(remote.opened(), 0);
});
