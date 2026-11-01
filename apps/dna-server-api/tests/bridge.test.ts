import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { Bridge } from "../src/publishing/bridge.ts";

const b = new Bridge();
let base = "";
const HEADERS = { "x-dna-bridge": "1" };

before(async () => {
  base = `http://127.0.0.1:${await b.listen(0)}/bridge`;
});
after(() => b.close());

test("a request without the extension's header gets nothing", async () => {
  assert.equal((await fetch(`${base}/next`)).status, 403);
  assert.equal(
    (await fetch(`${base}/result`, { method: "POST", body: "{}" })).status,
    403,
  );
});

test("a command goes to the poller and comes back with its result", async () => {
  const running = b.command("read", { tabId: 7 });
  const c = (await (
    await fetch(`${base}/next`, { headers: HEADERS })
  ).json()) as any;
  assert.equal(c.op, "read");
  assert.deepEqual(c.args, { tabId: 7 });
  await fetch(`${base}/result`, {
    method: "POST",
    headers: HEADERS,
    body: JSON.stringify({ id: c.id, ok: true, result: "done" }),
  });
  assert.equal(await running, "done");
});

test("the extension's error rejects the command", async () => {
  const running = assert.rejects(b.command("clickPost"), /clickPost: gone/);
  const c = (await (
    await fetch(`${base}/next`, { headers: HEADERS })
  ).json()) as any;
  await fetch(`${base}/result`, {
    method: "POST",
    headers: HEADERS,
    body: JSON.stringify({ id: c.id, ok: false, error: "gone" }),
  });
  await running;
});

test("a command that timed out never reaches a later poll", async () => {
  await assert.rejects(b.command("clickPost", {}, 20), /no answer/);
  const next = b.command("ping");
  const c = (await (
    await fetch(`${base}/next`, { headers: HEADERS })
  ).json()) as any;
  assert.equal(c.op, "ping");
  await fetch(`${base}/result`, {
    method: "POST",
    headers: HEADERS,
    body: JSON.stringify({ id: c.id, ok: true, result: {} }),
  });
  await next;
});

test("ensure says what to do when the extension is not there", async () => {
  await assert.rejects(b.ensure(20), /工作台发帖桥没连上/);
});
