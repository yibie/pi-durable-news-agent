// Writer rule versions: every text of writer/RULES.md and writer/ARGMAP.md saved from the workbench, plus the text before
// the first edit and any change made to the file outside it. The file on disk is what the writer reads.
import type { WriterRuleName, WriterRuleVersion, WriterRuleVersionText } from "@dna/sdk";
import { type Db, nowIso } from "../db.ts";

const toVersion = (r: any): WriterRuleVersion => ({
  id: r.id,
  name: r.name,
  source: r.source,
  restoredFrom: r.restored_from ?? undefined,
  chars: r.chars,
  createdAt: r.created_at,
});

export class RulesRepo {
  constructor(private readonly db: Db) {}

  /** Newest first, without the texts. */
  versions(name: WriterRuleName): WriterRuleVersion[] {
    return this.db
      .prepare(
        `SELECT id, name, source, restored_from, length(body) AS chars, created_at FROM writer_rule_versions
         WHERE name = ? ORDER BY id DESC`,
      )
      .all(name)
      .map(toVersion);
  }

  version(id: number): WriterRuleVersionText | undefined {
    const r: any = this.db
      .prepare("SELECT *, length(body) AS chars FROM writer_rule_versions WHERE id = ?")
      .get(id);
    return r ? { ...toVersion(r), body: r.body } : undefined;
  }

  latest(name: WriterRuleName): { id: number; body: string } | undefined {
    return this.db
      .prepare("SELECT id, body FROM writer_rule_versions WHERE name = ? ORDER BY id DESC LIMIT 1")
      .get(name) as { id: number; body: string } | undefined;
  }

  add(
    name: WriterRuleName,
    body: string,
    source: WriterRuleVersion["source"],
    restoredFrom?: number,
  ): void {
    this.db
      .prepare(
        "INSERT INTO writer_rule_versions (name, body, source, restored_from, created_at) VALUES (?, ?, ?, ?, ?)",
      )
      .run(name, body, source, restoredFrom ?? null, nowIso());
  }
}
