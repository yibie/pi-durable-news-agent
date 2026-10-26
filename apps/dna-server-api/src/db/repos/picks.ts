// Picks: cards the reader chose to write about, each with a genre and a stage. Items keep the card's url and title as
// they were when picked. A card sits in at most one pick that is not dropped; dropping a pick releases its cards.
import type { TopicPick, PickGenre, PickItem, PickStatus, ScheduleMode } from "@dna/sdk";
import { type Db, nowIso, str, tx } from "../db.ts";

/** What a pick records about a card. */
export interface PickCard {
  id: number;
  url?: string;
  title: string;
  sourceName?: string;
}

const toItem = (r: any): PickItem => ({
  cardId: r.card_id,
  position: r.position,
  url: str(r.url),
  title: r.title,
  sourceName: str(r.source_name),
  addedAt: r.added_at,
});

export class PicksRepo {
  constructor(private readonly db: Db) {}

  get(id: number): TopicPick | undefined {
    const r = this.db.prepare("SELECT * FROM picks WHERE id = ?").get(id);
    return r ? this.toPick(r) : undefined;
  }

  /** Picks newest first; dropped ones only when asked. */
  list(includeDropped = false): TopicPick[] {
    const where = includeDropped ? "" : "WHERE status != 'dropped'";
    return (this.db.prepare(`SELECT * FROM picks ${where} ORDER BY id DESC`).all() as any[]).map(
      (r) => this.toPick(r),
    );
  }

  /** The pick that is not dropped and holds this card, if any. */
  activeFor(cardId: number): TopicPick | undefined {
    const r = this.db
      .prepare(
        `SELECT p.* FROM picks p JOIN pick_items i ON i.pick_id = p.id
         WHERE i.card_id = ? AND p.status != 'dropped' ORDER BY p.id DESC LIMIT 1`,
      )
      .get(cardId);
    return r ? this.toPick(r) : undefined;
  }

  create(genre: PickGenre, cards: PickCard[], title?: string): TopicPick {
    return tx(this.db, () => {
      const now = nowIso();
      const id = Number(
        this.db
          .prepare("INSERT INTO picks (genre, title, created_at, updated_at) VALUES (?, ?, ?, ?)")
          .run(genre, title ?? null, now, now).lastInsertRowid,
      );
      cards.forEach((card, position) => this.insertItem(id, card, position, now));
      return this.get(id)!;
    });
  }

  update(
    id: number,
    patch: { genre?: PickGenre; title?: string; status?: PickStatus; note?: string },
  ): TopicPick | undefined {
    const now = nowIso();
    this.db
      .prepare(
        `UPDATE picks SET genre = COALESCE(:genre, genre), title = COALESCE(:title, title),
         status = COALESCE(:status, status), note = COALESCE(:note, note), updated_at = :now WHERE id = :id`,
      )
      .run({
        id,
        now,
        genre: patch.genre ?? null,
        title: patch.title ?? null,
        status: patch.status ?? null,
        note: patch.note ?? null,
      });
    return this.get(id);
  }

  /** A published pick back to 待发布: the publisher will post it again (the ledger keeps the first post). */
  reopen(id: number): TopicPick | undefined {
    const now = nowIso();
    this.db
      .prepare("UPDATE picks SET status = 'ready', reopened_at = ?, updated_at = ? WHERE id = ?")
      .run(now, now, id);
    return this.get(id);
  }

  addItem(id: number, card: PickCard): TopicPick | undefined {
    return tx(this.db, () => {
      const next = this.db
        .prepare("SELECT COALESCE(MAX(position) + 1, 0) AS n FROM pick_items WHERE pick_id = ?")
        .get(id) as { n: number };
      const now = nowIso();
      this.insertItem(id, card, next.n, now);
      this.touch(id, now);
      return this.get(id);
    });
  }

  removeItem(id: number, cardId: number): TopicPick | undefined {
    const now = nowIso();
    this.db.prepare("DELETE FROM pick_items WHERE pick_id = ? AND card_id = ?").run(id, cardId);
    this.touch(id, now);
    return this.get(id);
  }

  private insertItem(id: number, card: PickCard, position: number, now: string) {
    this.db
      .prepare(
        `INSERT OR IGNORE INTO pick_items (pick_id, card_id, position, url, title, source_name, added_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(id, card.id, position, card.url ?? null, card.title, card.sourceName ?? null, now);
  }

  private touch(id: number, now: string) {
    this.db.prepare("UPDATE picks SET updated_at = ? WHERE id = ?").run(now, id);
  }

  /** Remember the pick's writer conversation (set once, when writing starts). */
  setConversation(id: number, conversationId: string): TopicPick | undefined {
    this.db
      .prepare(
        "UPDATE picks SET conversation_id = ?, updated_at = ? WHERE id = ? AND conversation_id IS NULL",
      )
      .run(conversationId, nowIso(), id);
    return this.get(id);
  }

  /** The newest reader edit (draft revision) the pick's writer has been told about. */
  writerSeen(id: number): number {
    const r = this.db.prepare("SELECT writer_seen_revision FROM picks WHERE id = ?").get(id) as
      | { writer_seen_revision: number | null }
      | undefined;
    return r?.writer_seen_revision ?? 0;
  }

  setWriterSeen(id: number, revision: number): void {
    this.db.prepare("UPDATE picks SET writer_seen_revision = ? WHERE id = ?").run(revision, id);
  }

  /** Put the pick in the publish line at this time (a new time clears an old hold). */
  setSchedule(id: number, at: string, mode: ScheduleMode): TopicPick | undefined {
    this.db
      .prepare(
        "UPDATE picks SET publish_at = ?, publish_mode = ?, publish_hold = NULL, updated_at = ? WHERE id = ?",
      )
      .run(at, mode, nowIso(), id);
    return this.get(id);
  }

  /** Out of the publish line; false when it was not in it. */
  clearSchedule(id: number): boolean {
    return (
      this.db
        .prepare(
          `UPDATE picks SET publish_at = NULL, publish_mode = NULL, publish_hold = NULL, updated_at = ?
           WHERE id = ? AND (publish_at IS NOT NULL OR publish_hold IS NOT NULL)`,
        )
        .run(nowIso(), id).changes > 0
    );
  }

  /** A due pick that could not be posted: it keeps its place, marked with why, until the reader acts. */
  holdSchedule(id: number, reason: string): TopicPick | undefined {
    this.db
      .prepare("UPDATE picks SET publish_hold = ?, updated_at = ? WHERE id = ?")
      .run(reason, nowIso(), id);
    return this.get(id);
  }

  /** Picks in the publish line, soonest first (held ones included). */
  scheduled(): TopicPick[] {
    return (
      this.db
        .prepare("SELECT * FROM picks WHERE publish_at IS NOT NULL ORDER BY publish_at, id")
        .all() as any[]
    ).map((r) => this.toPick(r));
  }

  /** The pick a writer conversation belongs to. */
  byConversation(conversationId: string): TopicPick | undefined {
    const r = this.db.prepare("SELECT * FROM picks WHERE conversation_id = ?").get(conversationId);
    return r ? this.toPick(r) : undefined;
  }

  private toPick(r: any): TopicPick {
    const items = (
      this.db
        .prepare("SELECT * FROM pick_items WHERE pick_id = ? ORDER BY position, added_at")
        .all(r.id) as any[]
    ).map(toItem);
    const draft = this.db
      .prepare("SELECT MAX(revision) AS n FROM drafts WHERE pick_id = ?")
      .get(r.id) as { n: number | null };
    return {
      id: r.id,
      genre: r.genre,
      title: str(r.title),
      status: r.status,
      note: str(r.note),
      items,
      conversationId: str(r.conversation_id),
      draftRevision: draft.n ?? undefined,
      reopenedAt: str(r.reopened_at),
      scheduledAt: str(r.publish_at),
      scheduleMode: str(r.publish_mode) as TopicPick["scheduleMode"],
      scheduleHold: str(r.publish_hold),
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  }
}
