// The publish ledger: append-only lines, the newest line per draft key is its state. Ported from selfPromotion's
// publish.py: pending and unknown block a second publish of the same pick until a person acks; the spacing rule counts
// the latest post activity, which is ok, unknown (it may have posted), or pending while it is still that draft's final
// state (a pending later settled as failed did not post and frees the window). A post's first reply has its own key
// (pick:<id>:reply) and does not count toward spacing.
import { existsSync, readFileSync } from "node:fs";
import type { LedgerEntry, LedgerStatus } from "@dna/sdk";
import { bool, type Db, nowIso, num, str } from "../db.ts";

export const BLOCKING: readonly LedgerStatus[] = ["pending", "unknown"];
const ACTIVITY: readonly LedgerStatus[] = ["ok", "pending", "unknown"];

const toEntry = (r: any): LedgerEntry => ({
  id: r.id,
  draftKey: r.draft_key,
  pickId: num(r.pick_id),
  draftId: num(r.draft_id),
  status: r.status,
  backend: str(r.backend),
  tweetId: str(r.tweet_id),
  note: str(r.note),
  at: r.at,
  imported: bool(r.imported),
});

export const pickKey = (pickId: number) => `pick:${pickId}`;
/** The first reply under the pick's post: its own line, not a post, so the spacing rule leaves it out. */
export const replyKey = (pickId: number) => `pick:${pickId}:reply`;
const isReply = (key: string) => key.endsWith(":reply");

export class LedgerRepo {
  constructor(private readonly db: Db) {}

  append(input: {
    draftKey: string;
    status: LedgerStatus;
    pickId?: number;
    draftId?: number;
    hash?: string;
    backend?: string;
    tweetId?: string;
    note?: string;
  }): LedgerEntry {
    const id = Number(
      this.db
        .prepare(
          `INSERT INTO publish_ledger (draft_key, pick_id, draft_id, status, hash, backend, tweet_id, note, at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          input.draftKey,
          input.pickId ?? null,
          input.draftId ?? null,
          input.status,
          input.hash ?? null,
          input.backend ?? null,
          input.tweetId ?? null,
          input.note ?? null,
          nowIso(),
        ).lastInsertRowid,
    );
    return toEntry(this.db.prepare("SELECT * FROM publish_ledger WHERE id = ?").get(id));
  }

  /** The draft key's newest line: its state. */
  state(draftKey: string): LedgerEntry | undefined {
    const r = this.db
      .prepare("SELECT * FROM publish_ledger WHERE draft_key = ? ORDER BY id DESC LIMIT 1")
      .get(draftKey);
    return r ? toEntry(r) : undefined;
  }

  /** Newest first. */
  list(limit = 50): LedgerEntry[] {
    return (
      this.db
        .prepare("SELECT * FROM publish_ledger ORDER BY at DESC, id DESC LIMIT ?")
        .all(limit) as any[]
    ).map(toEntry);
  }

  /** Every pending line, for the restart check: a pending with no publish running became unknown. */
  pendingNow(): LedgerEntry[] {
    return (this.db.prepare("SELECT * FROM publish_ledger ORDER BY id").all() as any[])
      .map(toEntry)
      .filter((e, _i, all) => e.status === "pending" && this.isFinal(e, all));
  }

  private isFinal(e: LedgerEntry, all: LedgerEntry[]) {
    return !all.some((x) => x.draftKey === e.draftKey && x.id > e.id);
  }

  /** The latest post activity the spacing rule counts, by time. */
  lastActivity(): LedgerEntry | undefined {
    const all = (this.db.prepare("SELECT * FROM publish_ledger ORDER BY id").all() as any[]).map(
      toEntry,
    );
    const final = new Map(all.map((e) => [e.draftKey, e.status]));
    let latest: LedgerEntry | undefined;
    for (const e of all) {
      if (!ACTIVITY.includes(e.status) || isReply(e.draftKey)) continue;
      if (e.status === "pending" && final.get(e.draftKey) !== "pending") continue;
      if (!latest || Date.parse(e.at) > Date.parse(latest.at)) latest = e;
    }
    return latest;
  }

  /** Posts that went out on a Beijing day (YYYY-MM-DD), first replies left out: the queue's daily cap counts these. */
  postsOn(day: string): number {
    const day0 = Date.parse(`${day}T00:00:00+08:00`);
    const rows = this.db
      .prepare("SELECT draft_key, at FROM publish_ledger WHERE status = 'ok'")
      .all() as { draft_key: string; at: string }[];
    return rows.filter((r) => {
      const t = Date.parse(r.at);
      return !isReply(r.draft_key) && t >= day0 && t < day0 + 86_400_000;
    }).length;
  }

  /**
   * Import the old jsonl ledger (selfPromotion's publish-ledger.jsonl): every line once, by draft, status and time,
   * so a restart re-reads the file and only adds what is new. Returns how many lines were added.
   */
  importJsonl(path: string): number {
    if (!existsSync(path)) return 0;
    const insert = this.db.prepare(
      `INSERT OR IGNORE INTO publish_ledger (draft_key, status, hash, backend, tweet_id, note, at, imported)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1)`,
    );
    let added = 0;
    for (const line of readFileSync(path, "utf8").split("\n")) {
      if (!line.trim()) continue;
      let rec: Record<string, unknown>;
      try {
        rec = JSON.parse(line);
      } catch {
        continue;
      }
      const status = String(rec.status ?? "");
      if (!rec.draft || !rec.at || !["pending", "ok", "unknown", "failed", "ack"].includes(status))
        continue;
      const at = new Date(String(rec.at));
      if (Number.isNaN(at.getTime())) continue;
      added += Number(
        insert.run(
          String(rec.draft),
          status,
          rec.hash ? String(rec.hash) : null,
          rec.backend ? String(rec.backend) : null,
          rec.tweet_id ? String(rec.tweet_id) : null,
          rec.note ? String(rec.note).slice(0, 2000) : null,
          at.toISOString(),
        ).changes,
      );
    }
    return added;
  }
}
