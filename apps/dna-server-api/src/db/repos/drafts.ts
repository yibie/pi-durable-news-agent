// Drafts: every version of a pick's post, newest revision last. An argmap render is kept with the image it drew, so a
// draft can only go out with an image together with the JSON behind it. The writer's saves are keyed by tool call:
// a replay after a crash returns the row it already wrote.
import type { Draft } from "@dna/sdk";
import { lintPost } from "../../writing/lint.ts";
import { type Db, nowIso, parse, str, tx } from "../db.ts";

export interface ArgmapRender {
  imageId: number;
  pickId: number;
  layout: string;
  argmap: unknown;
  warnings: string[];
  createdAt: string;
}

const toRender = (r: any): ArgmapRender => ({
  imageId: r.image_id,
  pickId: r.pick_id,
  layout: r.layout,
  argmap: parse(r.argmap_json, {}),
  warnings: parse<string[]>(r.warnings_json, []),
  createdAt: r.created_at,
});

export class DraftsRepo {
  constructor(private readonly db: Db) {}

  addRender(input: Omit<ArgmapRender, "createdAt">): ArgmapRender {
    this.db
      .prepare(
        `INSERT INTO argmap_renders (image_id, pick_id, layout, argmap_json, warnings_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.imageId,
        input.pickId,
        input.layout,
        JSON.stringify(input.argmap),
        JSON.stringify(input.warnings),
        nowIso(),
      );
    return this.render(input.imageId)!;
  }

  render(imageId: number): ArgmapRender | undefined {
    const r = this.db.prepare("SELECT * FROM argmap_renders WHERE image_id = ?").get(imageId);
    return r ? toRender(r) : undefined;
  }

  latestRender(pickId: number): ArgmapRender | undefined {
    const r = this.db
      .prepare(
        "SELECT * FROM argmap_renders WHERE pick_id = ? ORDER BY created_at DESC, image_id DESC LIMIT 1",
      )
      .get(pickId);
    return r ? toRender(r) : undefined;
  }

  /** Layouts of the newest drafts across picks (the image each one goes out with), newest first. */
  recentLayouts(limit: number): { pickId: number; layout: string; createdAt: string }[] {
    return (
      this.db
        .prepare(
          `SELECT d.pick_id, r.layout, d.created_at FROM drafts d
           JOIN argmap_renders r ON r.image_id = d.image_id
           WHERE d.revision = (SELECT MAX(revision) FROM drafts WHERE pick_id = d.pick_id)
           ORDER BY d.created_at DESC LIMIT ?`,
        )
        .all(limit) as any[]
    ).map((r) => ({ pickId: r.pick_id, layout: r.layout, createdAt: r.created_at }));
  }

  /** A new revision. With a tool call id, a second save from the same call returns the first. */
  add(input: {
    pickId: number;
    body: string;
    imageId?: number;
    quoteUrl?: string;
    author: Draft["author"];
    note?: string;
    reply?: string;
    toolCallId?: string;
  }): Draft {
    return tx(this.db, () => {
      if (input.toolCallId) {
        const done = this.db
          .prepare("SELECT * FROM drafts WHERE tool_call_id = ?")
          .get(input.toolCallId);
        if (done) return this.toDraft(done);
      }
      const next = this.db
        .prepare("SELECT COALESCE(MAX(revision) + 1, 1) AS n FROM drafts WHERE pick_id = ?")
        .get(input.pickId) as { n: number };
      const id = Number(
        this.db
          .prepare(
            `INSERT INTO drafts (pick_id, revision, body, image_id, quote_url, author, note, reply, tool_call_id, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            input.pickId,
            next.n,
            input.body,
            input.imageId ?? null,
            input.quoteUrl ?? null,
            input.author,
            input.note ?? null,
            input.reply ?? null,
            input.toolCallId ?? null,
            nowIso(),
          ).lastInsertRowid,
      );
      return this.get(id)!;
    });
  }

  get(id: number): Draft | undefined {
    const r = this.db.prepare("SELECT * FROM drafts WHERE id = ?").get(id);
    return r ? this.toDraft(r) : undefined;
  }

  latest(pickId: number): Draft | undefined {
    const r = this.db
      .prepare("SELECT * FROM drafts WHERE pick_id = ? ORDER BY revision DESC LIMIT 1")
      .get(pickId);
    return r ? this.toDraft(r) : undefined;
  }

  /** Every revision of a pick, newest first. */
  list(pickId: number): Draft[] {
    return (
      this.db
        .prepare("SELECT * FROM drafts WHERE pick_id = ? ORDER BY revision DESC")
        .all(pickId) as any[]
    ).map((r) => this.toDraft(r));
  }

  private toDraft(r: any): Draft {
    const render = r.image_id ? this.render(r.image_id) : undefined;
    return {
      id: r.id,
      pickId: r.pick_id,
      revision: r.revision,
      body: r.body,
      imageId: r.image_id ?? undefined,
      quoteUrl: str(r.quote_url),
      reply: str(r.reply),
      layout: render?.layout,
      warnings: render?.warnings ?? [],
      author: r.author,
      note: str(r.note),
      lint: lintPost(r.body),
      createdAt: r.created_at,
    };
  }
}
