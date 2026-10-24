import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { until } from "./helpers.ts";

const HOST = join(import.meta.dirname, "fixtures/sweep-host.ts");
const ENV = {
  ...process.env,
  NODE_NO_WARNINGS: "1",
  DNA_FIXTURE_SET: "news",
  DNA_FIXTURE_JEV_DELAY_MS: "250",
  DNA_GATE_CHUNK: "3",
  // The fixture judge, never the device's local decision model from .env.
  JEV_BACKEND: "",
};

const counts = (db: DatabaseSync) =>
  db
    .prepare(
      "SELECT item_id, count(*) n FROM jev_calls WHERE command = 'relevance' GROUP BY item_id",
    )
    .all() as { item_id: number; n: number }[];

test("SIGKILL mid gate: the restarted server resumes at the last checkpoint, pays jev once per judged item and presents each card once", async () => {
  const dir = mkdtempSync(join(tmpdir(), "dna-crash-"));
  try {
    const first = spawn(process.execPath, ["--import", "tsx", HOST, dir, "start"], {
      env: ENV,
      stdio: "ignore",
    });
    let db: DatabaseSync | undefined;
    let judged: number[] = [];
    await until(
      () => {
        try {
          db ??= new DatabaseSync(join(dir, "dna.sqlite"), { readOnly: true });
          const done = db
            .prepare("SELECT id FROM items WHERE relevance IS NOT NULL AND worth IS NOT NULL")
            .all() as { id: number }[];
          const total = (db.prepare("SELECT count(*) n FROM items").get() as { n: number }).n;
          judged = done.map((r) => r.id);
          return judged.length >= 3 && judged.length < total;
        } catch {
          return false;
        }
      },
      30_000,
      "the first gate chunk",
    );
    first.kill("SIGKILL");
    await new Promise((r) => first.once("exit", r));
    const before = new Map(counts(db!).map((r) => [r.item_id, r.n]));
    assert.ok(judged.every((id) => before.get(id) === 1));

    const second = spawnSync(process.execPath, ["--import", "tsx", HOST, dir, "resume"], {
      env: ENV,
      encoding: "utf8",
      timeout: 90_000,
    });
    assert.equal(second.status, 0, second.stderr);
    const out = JSON.parse(second.stdout.trim().split("\n").at(-1)!);
    assert.equal(out.status, "completed");
    assert.deepEqual(out.audit.missing, []);

    const after = new Map(counts(db!).map((r) => [r.item_id, r.n]));
    for (const id of judged)
      assert.equal(
        after.get(id),
        1,
        `item ${id} was judged before the crash and must not be judged again`,
      );
    const news = out.cards.filter((c: { kind: string }) => c.kind === "news");
    assert.equal(news.length, 4);
    assert.equal(
      new Set(news.map((c: { itemId: number }) => c.itemId)).size,
      4,
      "no duplicate cards",
    );
    assert.deepEqual(
      out.cards
        .filter((c: { timeline?: unknown }) => c.timeline)
        .map(
          (c: { timeline: { index: number; count: number } }) =>
            `${c.timeline.index}/${c.timeline.count}`,
        )
        .sort(),
      [],
      "a replay keeps unrelated stories separate",
    );
    db!.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
