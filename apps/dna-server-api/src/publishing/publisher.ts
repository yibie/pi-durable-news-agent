// Publishing a ready pick to X: the reader's button, never an agent tool. The gates are publish.py's, ported:
// the pick is ready with a clean draft; its ledger is not pending or unknown (a person checks X and acks first);
// 30 minutes since the last post activity unless the reader gives a reason to go now. One publish runs at a time,
// in the background, with its phases on the bus. The ledger gets pending right before the click, then ok, unknown or
// failed. A rehearsal does everything except the click and writes nothing to the ledger.
import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { LedgerEntry, PublishState, TopicPick } from "@dna/sdk";
import type { Deps } from "../deps.ts";
import { BLOCKING, pickKey } from "../db/repos/ledger.ts";
import { invalid, notFound } from "../errors.ts";
import { readyProblems } from "../writing/drafts.ts";
import { ensureChrome } from "./chrome.ts";
import { postToX, type PostInput, type PostOutcome } from "./x.ts";

export const SPACING_MINUTES = 30;
const SPACING_MS = SPACING_MINUTES * 60_000;

export type Poster = (input: PostInput) => Promise<PostOutcome>;

/** Offline (faux, fixture): no Chrome, the click always "posts". */
export const fakePoster: Poster = async (input) => {
  for (const p of ["compose", "type", ...(input.images.length ? ["attach"] : []), "check"])
    input.phase(p);
  if (input.rehearsal)
    return { status: "rehearsed", clean: true, detail: "ready to post (offline)" };
  input.phase("click");
  input.beforeClick();
  return { status: "ok", detail: "posted (offline)" };
};

const beijingDay = (d = new Date()) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(d);

export class Publisher {
  private running?: { pickId: number; rehearsal: boolean; phase: string };
  private readonly rehearsals = new Map<number, NonNullable<PublishState["rehearsal"]>>();

  constructor(
    private readonly deps: Deps,
    private readonly poster: Poster = postToX,
  ) {}

  /** Import the old ledger and settle pendings a restart interrupted: they may have posted. */
  start(): void {
    const { store, log, config } = this.deps;
    if (config.ledgerImport) {
      const added = store.ledger.importJsonl(config.ledgerImport);
      if (added) log.info("publish.ledger_imported", { added, from: config.ledgerImport });
    }
    for (const e of store.ledger.pendingNow().filter((e) => !e.imported))
      store.ledger.append({
        draftKey: e.draftKey,
        pickId: e.pickId,
        draftId: e.draftId,
        status: "unknown",
        backend: e.backend,
        note: "the server restarted during this publish: check X, then ack if it did not post",
      });
  }

  state(pickId?: number): PublishState {
    const { ledger } = this.deps.store;
    const last = ledger.lastActivity();
    const until = last ? Date.parse(last.at) + SPACING_MS : 0;
    return {
      ...(until > Date.now() ? { earliestAt: new Date(until).toISOString() } : {}),
      ...(last ? { last } : {}),
      ...(pickId ? { pick: ledger.state(pickKey(pickId)) } : {}),
      ...(this.running ? { running: { ...this.running } } : {}),
      ...(pickId && this.rehearsals.has(pickId) ? { rehearsal: this.rehearsals.get(pickId) } : {}),
    };
  }

  private emit(pickId: number, phase: string, entry?: LedgerEntry) {
    if (this.running) this.running.phase = phase;
    this.deps.bus.publish({ type: "publish", pickId, phase, state: this.state(pickId), entry });
  }

  /** Check every gate, then post in the background. Throws (a 400) with what blocks it. */
  publish(pickId: number, opts: { override?: string; rehearsal?: boolean } = {}): PublishState {
    const { store } = this.deps;
    const pick = store.picks.get(pickId);
    if (!pick) throw notFound(`No pick ${pickId}`);
    const rehearsal = !!opts.rehearsal;
    // The old channel may still be posting until the cutover: read its newest lines before checking spacing.
    if (this.deps.config.ledgerImport) store.ledger.importJsonl(this.deps.config.ledgerImport);
    if (this.running)
      throw invalid(
        `Pick ${this.running.pickId} is being ${this.running.rehearsal ? "rehearsed" : "published"} now`,
      );
    if (!rehearsal && pick.status !== "ready")
      throw invalid(`Pick ${pickId} is ${pick.status}: only a pick in 待发布 (ready) is published`);
    if (pick.status === "published" || pick.status === "dropped")
      throw invalid(`Pick ${pickId} is ${pick.status}`);
    const problems = readyProblems(store, pick);
    if (problems.length) throw invalid(`Pick ${pickId} is not ready: ${problems.join("; ")}`);
    const draft = store.drafts.latest(pickId)!;
    if (!rehearsal) {
      const mine = store.ledger.state(pickKey(pickId));
      if (mine?.status === "ok" && !(pick.reopenedAt && pick.reopenedAt > mine.at))
        throw invalid(
          `Pick ${pickId} was already published at ${mine.at}; move it back to 待发布 to post it again`,
        );
      if (mine && BLOCKING.includes(mine.status))
        throw invalid(
          `Pick ${pickId}'s last publish is ${mine.status} (${mine.at}): it may have posted. Check X, then ack it if it did not`,
        );
      const state = this.state();
      if (state.earliestAt && !opts.override?.trim())
        throw invalid(
          `Posts are ${SPACING_MINUTES} minutes apart: the next one may go at ${state.earliestAt}. Send a reason to post now`,
        );
    }
    this.running = { pickId, rehearsal, phase: "preflight" };
    void this.run(pick, draft.id, rehearsal, opts.override?.trim());
    return this.state(pickId);
  }

  private async run(pick: TopicPick, draftId: number, rehearsal: boolean, override?: string) {
    const { store, log, config } = this.deps;
    const draft = store.drafts.get(draftId)!;
    const key = pickKey(pick.id);
    const backend = draft.quoteUrl ? "cdp-quote" : draft.imageId ? "cdp-image" : "cdp";
    const hash = createHash("sha256").update(draft.body).digest("hex").slice(0, 16);
    const image = draft.imageId ? store.news.image(draft.imageId)?.filePath : undefined;
    const record = (status: LedgerEntry["status"], note: string) => {
      const entry = store.ledger.append({
        draftKey: key,
        pickId: pick.id,
        draftId,
        status,
        hash,
        backend,
        note: override && status === "pending" ? `${note}; spacing override: ${override}` : note,
      });
      this.emit(pick.id, status, entry);
      return entry;
    };
    let outcome: PostOutcome;
    try {
      this.emit(pick.id, "preflight");
      if (this.poster === postToX) await ensureChrome((msg) => log.info("publish.chrome", { msg }));
      outcome = await this.poster({
        text: draft.body,
        images: image ? [image] : [],
        quoteUrl: draft.quoteUrl,
        rehearsal,
        filesystemRoot: config.dataDir,
        beforeClick: () => void record("pending", "clicking Post"),
        phase: (p) => this.emit(pick.id, p),
      });
    } catch (error) {
      outcome = {
        status: "failed",
        detail: String((error as Error).message ?? error).slice(0, 300),
      };
    }
    this.running = undefined;
    log.info("publish.done", {
      pickId: pick.id,
      rehearsal,
      status: outcome.status,
      detail: outcome.detail,
    });
    if (rehearsal) {
      this.rehearsals.set(pick.id, {
        at: new Date().toISOString(),
        wouldPost: outcome.status === "rehearsed" && outcome.detail.startsWith("ready to post"),
        clean: outcome.status === "rehearsed" && outcome.clean,
        detail: outcome.detail,
      });
      this.emit(pick.id, "rehearsed");
      return;
    }
    record(
      outcome.status === "ok" ? "ok" : outcome.status === "unknown" ? "unknown" : "failed",
      outcome.detail,
    );
    if (outcome.status !== "ok") return;
    const published = store.picks.update(pick.id, { status: "published" })!;
    this.deps.bus.publish({ type: "pick", pick: published });
    if (config.publishedDir) {
      try {
        this.archive(published, draft.body, image, config.publishedDir);
      } catch (error) {
        log.warn("publish.archive_failed", { pickId: pick.id, error: String(error) });
      }
    }
  }

  /** The published post as selfPromotion keeps it: front matter, the text, and the image beside it. */
  private archive(pick: TopicPick, body: string, image: string | undefined, dir: string) {
    mkdirSync(dir, { recursive: true });
    const name = `${beijingDay()}-pick-${pick.id}`;
    if (image) copyFileSync(image, join(dir, `${name}.png`));
    const front = [
      "---",
      `pick: ${pick.id}`,
      `genre: ${pick.genre}`,
      ...(image ? [`image: ${name}.png`] : []),
      "published: true",
      `published_at: ${new Date().toISOString()}`,
      "---",
    ];
    writeFileSync(join(dir, `${name}.md`), `${front.join("\n")}\n${body}\n`);
  }

  /** A person checked X: the pending or unknown publish did not post. */
  ack(pickId: number, note: string): LedgerEntry {
    const { store } = this.deps;
    const mine = store.ledger.state(pickKey(pickId));
    if (!mine || !BLOCKING.includes(mine.status))
      throw invalid(`Pick ${pickId} has nothing to ack: its ledger is ${mine?.status ?? "empty"}`);
    if (this.running?.pickId === pickId) throw invalid(`Pick ${pickId} is publishing now`);
    const entry = store.ledger.append({
      draftKey: mine.draftKey,
      pickId,
      draftId: mine.draftId,
      status: "ack",
      backend: mine.backend,
      note: `checked X, did not post (was ${mine.status} at ${mine.at}): ${note}`,
    });
    this.emit(pickId, "ack", entry);
    return entry;
  }
}
