// Publishing a ready pick to X: the reader's button, never an agent tool. The gates are publish.py's, ported:
// the pick is ready with a clean draft; its ledger is not pending or unknown (a person checks X and acks first);
// 30 minutes since the last post activity unless the reader gives a reason to go now. One publish runs at a time,
// in the background, with its phases on the bus. The ledger gets pending right before the click, then ok, unknown or
// failed. A rehearsal does everything except the click and writes nothing to the ledger. Right after the post goes
// out, the draft's first reply (the 原文 links, kept out of the post because X ranks outside links lower) is posted
// under it, with its own ledger key; a reply that did not go out can be posted again without posting the post again.
// A ready pick can also wait in line: the reader takes the next free slot (30 to 60 minutes after the post or slot
// before it, at most 15 posts on a Beijing day) or names a time. A timer posts a due pick through the same gates; one
// that comes due inside the spacing is moved later, and one the gates refuse is held, with why, for the reader. A post
// the line made, or held, tells the reader with a desktop notification, since nobody is watching it.
import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { LedgerEntry, PublishState, ScheduleMode, ScheduleResult, TopicPick } from "@dna/sdk";
import type { Deps } from "../deps.ts";
import { BLOCKING, pickKey, replyKey } from "../db/repos/ledger.ts";
import { invalid, notFound } from "../errors.ts";
import { readyProblems } from "../writing/drafts.ts";
import { ensureChrome } from "./chrome.ts";
import { postToX, replyOnX, type PostInput, type PostOutcome, type ReplyInput } from "./x.ts";

export const SPACING_MINUTES = 30;
const MINUTE = 60_000;
const SPACING_MS = SPACING_MINUTES * MINUTE;
/** The queue's slots: 30 to 60 minutes after the one before, so the posts do not land like clockwork. */
export const QUEUE_GAP_MINUTES = [30, 60] as const;
/** Posts on one Beijing day the queue makes at most; later slots move to the next day. */
export const DAILY_CAP = 15;
const TICK_MS = 20_000;
const DAY_MS = 86_400_000;

/** What the publisher does on X: post, and reply under a post. */
export interface XClient {
  post(input: PostInput): Promise<PostOutcome>;
  reply(input: ReplyInput): Promise<PostOutcome>;
}

export const liveX: XClient = { post: postToX, reply: replyOnX };

/** Offline (faux, fixture): no Chrome, the click always "posts", and the post gets a made-up link. */
export const fakeX: XClient = {
  async post(input) {
    for (const p of ["compose", "type", ...(input.images.length ? ["attach"] : []), "check"])
      input.phase(p);
    if (input.rehearsal)
      return { status: "rehearsed", clean: true, detail: "ready to post (offline)" };
    input.phase("click");
    input.beforeClick();
    const url = `https://x.com/offline/status/${Date.now()}`;
    return { status: "ok", detail: `posted (offline): ${url}`, url };
  },
  async reply(input) {
    for (const p of ["open", "type", "check"]) input.phase(p);
    if (input.rehearsal)
      return { status: "rehearsed", clean: true, detail: "ready to reply (offline)" };
    input.phase("click");
    input.beforeClick();
    return { status: "ok", detail: "replied (offline)" };
  },
};

const statusId = (url?: string) => url?.match(/status\/(\d+)/)?.[1];
const POST_URL = /^https:\/\/(x|twitter)\.com\/\S+\/status\/\d+/;

const beijingDay = (d = new Date()) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(d);
const dayStart = (t: number) => Date.parse(`${beijingDay(new Date(t))}T00:00:00+08:00`);
const titleOf = (pick: TopicPick) => pick.title ?? pick.items[0]?.title ?? `选题 ${pick.id}`;

export interface PublisherOptions {
  /** A desktop notification (the queue posts while nobody watches). */
  notify?: (title: string, text: string) => void;
  /** For the queue's 30 to 60 minute gaps; tests pin it. */
  random?: () => number;
}

export class Publisher {
  private running?: { pickId: number; rehearsal: boolean; phase: string };
  private current?: Promise<void>;
  private ticking = false;
  private timer?: NodeJS.Timeout;
  private readonly rehearsals = new Map<number, NonNullable<PublishState["rehearsal"]>>();
  private readonly notify: (title: string, text: string) => void;
  private readonly random: () => number;

  constructor(
    private readonly deps: Deps,
    private readonly x: XClient = liveX,
    opts: PublisherOptions = {},
  ) {
    this.notify = opts.notify ?? (() => {});
    this.random = opts.random ?? Math.random;
  }

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
    this.timer = setInterval(() => {
      this.tick().catch((error) => log.warn("publish.tick_failed", { error: String(error) }));
    }, TICK_MS);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }

  state(pickId?: number, now = Date.now()): PublishState {
    const { ledger, drafts } = this.deps.store;
    const last = ledger.lastActivity();
    const until = last ? Date.parse(last.at) + SPACING_MS : 0;
    const post = pickId ? ledger.state(pickKey(pickId)) : undefined;
    const reply = pickId ? ledger.state(replyKey(pickId)) : undefined;
    // The reply that belongs to the post now on X: one written after it.
    const mine = post?.status === "ok" && reply && reply.at >= post.at ? reply : undefined;
    const replyDue =
      post?.status === "ok" &&
      !!drafts.latest(post.pickId ?? pickId!)?.reply &&
      (!mine || mine.status === "failed" || mine.status === "ack");
    return {
      ...(until > now ? { earliestAt: new Date(until).toISOString() } : {}),
      ...(last ? { last } : {}),
      ...(pickId ? { pick: post } : {}),
      ...(reply ? { reply } : {}),
      ...(replyDue ? { replyDue } : {}),
      ...(post?.status === "ok" && post.tweetId
        ? { postUrl: `https://x.com/i/status/${post.tweetId}` }
        : {}),
      ...(this.running ? { running: { ...this.running } } : {}),
      ...(pickId && this.rehearsals.has(pickId) ? { rehearsal: this.rehearsals.get(pickId) } : {}),
      today: { posts: ledger.postsOn(beijingDay(new Date(now))), cap: DAILY_CAP },
    };
  }

  private emit(pickId: number, phase: string, entry?: LedgerEntry) {
    if (this.running) this.running.phase = phase;
    this.deps.bus.publish({ type: "publish", pickId, phase, state: this.state(pickId), entry });
  }

  /** Check every gate, then post in the background. Throws (a 400) with what blocks it. */
  publish(
    pickId: number,
    opts: { override?: string; rehearsal?: boolean; now?: number } = {},
  ): PublishState {
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
      const blocked = this.ledgerBlock(pick);
      if (blocked) throw invalid(blocked.message);
      const state = this.state(undefined, opts.now);
      if (state.earliestAt && !opts.override?.trim())
        throw invalid(
          `Posts are ${SPACING_MINUTES} minutes apart: the next one may go at ${state.earliestAt}. Send a reason to post now`,
        );
      // Posted now: out of the line, if it was in it.
      if (store.picks.clearSchedule(pickId))
        this.deps.bus.publish({ type: "pick", pick: store.picks.get(pickId)! });
    }
    this.running = { pickId, rehearsal, phase: "preflight" };
    this.current = this.run(pick, draft.id, rehearsal, opts.override?.trim());
    return this.state(pickId);
  }

  /** What the ledger says against posting the pick: it is already out, or a last publish may have posted. */
  private ledgerBlock(pick: TopicPick): { message: string; reason: string } | undefined {
    const mine = this.deps.store.ledger.state(pickKey(pick.id));
    if (mine?.status === "ok" && !(pick.reopenedAt && pick.reopenedAt > mine.at))
      return {
        message: `Pick ${pick.id} was already published at ${mine.at}; move it back to 待发布 to post it again`,
        reason: "这条已经发过了",
      };
    if (mine && BLOCKING.includes(mine.status))
      return {
        message: `Pick ${pick.id}'s last publish is ${mine.status} (${mine.at}): it may have posted. Check X, then ack it if it did not`,
        reason: "上次发布结果不明，可能已经发出去了：先去 X 上看一眼，再在发布区确认",
      };
    return undefined;
  }

  /**
   * Put a ready pick in line: the next free slot, or the reader's own time (moved later when it is too close to the
   * last post or another slot). Throws (a 400) with what blocks it.
   */
  schedule(pickId: number, at?: string, now = Date.now()): ScheduleResult {
    const { store } = this.deps;
    const pick = store.picks.get(pickId);
    if (!pick) throw notFound(`No pick ${pickId}`);
    if (pick.status !== "ready")
      throw invalid(`Pick ${pickId} is ${pick.status}: only a pick in 待发布 (ready) is scheduled`);
    const problems = readyProblems(store, pick);
    if (problems.length) throw invalid(`Pick ${pickId} is not ready: ${problems.join("; ")}`);
    const blocked = this.ledgerBlock(pick);
    if (blocked) throw invalid(blocked.message);
    if (this.running?.pickId === pickId) throw invalid(`Pick ${pickId} is publishing now`);
    if (this.deps.config.ledgerImport) store.ledger.importJsonl(this.deps.config.ledgerImport);
    const mode: ScheduleMode = at ? "time" : "queue";
    let from = now;
    if (at) {
      from = Date.parse(at);
      if (Number.isNaN(from)) throw invalid(`at is not a time: ${at}`);
      if (from < now - MINUTE) throw invalid(`${at} has passed`);
    }
    const slot = this.slot(pickId, mode, Math.max(from, now));
    const scheduled = store.picks.setSchedule(pickId, new Date(slot).toISOString(), mode)!;
    this.deps.log.info("publish.scheduled", { pickId, mode, at: scheduled.scheduledAt });
    this.deps.bus.publish({ type: "pick", pick: scheduled });
    this.emit(pickId, "scheduled");
    return {
      pick: scheduled,
      ...(at && slot - from >= MINUTE ? { requested: new Date(from).toISOString() } : {}),
    };
  }

  /** Out of the line; the pick stays in 待发布. */
  unschedule(pickId: number): TopicPick {
    const { store } = this.deps;
    if (!store.picks.get(pickId)) throw notFound(`No pick ${pickId}`);
    store.picks.clearSchedule(pickId);
    const pick = store.picks.get(pickId)!;
    this.deps.bus.publish({ type: "pick", pick });
    this.emit(pickId, "unscheduled");
    return pick;
  }

  private gap(mode: ScheduleMode) {
    if (mode === "time") return SPACING_MS;
    const [lo, hi] = QUEUE_GAP_MINUTES;
    return Math.round((lo + this.random() * (hi - lo)) * MINUTE);
  }

  /**
   * The pick's time in line: not before from, a gap after the last post, clear of every other slot by a gap, on a
   * Beijing day with fewer than 15 posts and slots (the queue moves to the next day; a chosen time on a full day is
   * refused).
   */
  private slot(pickId: number, mode: ScheduleMode, from: number): number {
    const { store } = this.deps;
    const others = store.picks
      .scheduled()
      .filter((p) => p.id !== pickId && p.status === "ready" && p.scheduledAt)
      .map((p) => Date.parse(p.scheduledAt!))
      .sort((a, b) => a - b);
    const last = store.ledger.lastActivity();
    let at = last ? Math.max(from, Date.parse(last.at) + this.gap(mode)) : from;
    for (let days = 0; days < 60; days++) {
      for (const other of others)
        if (at > other - SPACING_MS && at < other + SPACING_MS) at = other + this.gap(mode);
      const day = beijingDay(new Date(at));
      const taken =
        store.ledger.postsOn(day) + others.filter((o) => beijingDay(new Date(o)) === day).length;
      if (taken < DAILY_CAP) return at;
      if (mode === "time")
        throw invalid(
          `${day} (Beijing) already has ${DAILY_CAP} posts and slots: choose another day`,
        );
      at = dayStart(at) + DAY_MS;
    }
    throw invalid("No free slot in the next 60 days");
  }

  /** Post the soonest due pick in line, if nothing is publishing. Returns the pick it acted on. */
  async tick(now = Date.now()): Promise<number | undefined> {
    if (this.running || this.ticking) return undefined;
    const { store, log, config } = this.deps;
    const due = store.picks
      .scheduled()
      .find((p) => !p.scheduleHold && Date.parse(p.scheduledAt!) <= now);
    if (!due) return undefined;
    this.ticking = true;
    const changed = (pick: TopicPick | undefined) =>
      pick && this.deps.bus.publish({ type: "pick", pick });
    const hold = (reason: string) => {
      changed(store.picks.holdSchedule(due.id, reason));
      log.warn("publish.schedule_held", { pickId: due.id, reason });
      this.notify("排好的帖子没发出去", `${titleOf(due)}：${reason}`);
    };
    try {
      // Moved out of 待发布 since: it no longer waits to be posted.
      if (due.status !== "ready") {
        store.picks.clearSchedule(due.id);
        changed(store.picks.get(due.id));
        return due.id;
      }
      if (config.ledgerImport) store.ledger.importJsonl(config.ledgerImport);
      const problems = readyProblems(store, due);
      if (problems.length) {
        hold(`稿子没过发布前检查：${problems.join("；")}`);
        return due.id;
      }
      const blocked = this.ledgerBlock(due);
      if (blocked) {
        hold(blocked.reason);
        return due.id;
      }
      const mode = due.scheduleMode ?? "queue";
      // The queue's day is full (posts by hand count too): the next day.
      if (mode === "queue" && store.ledger.postsOn(beijingDay(new Date(now))) >= DAILY_CAP) {
        const at = dayStart(now) + DAY_MS + this.gap("queue") - SPACING_MS;
        changed(store.picks.setSchedule(due.id, new Date(at).toISOString(), mode));
        log.info("publish.schedule_moved", { pickId: due.id, at, why: "daily cap" });
        return due.id;
      }
      // A post went out since the slot was planned: keep the spacing, go later.
      const earliest = this.state(undefined, now).earliestAt;
      if (earliest) {
        const at = Date.parse(earliest) + this.gap(mode) - SPACING_MS;
        changed(store.picks.setSchedule(due.id, new Date(at).toISOString(), mode));
        log.info("publish.schedule_moved", { pickId: due.id, at, why: "spacing" });
        return due.id;
      }
      const slot = due.scheduledAt!;
      try {
        this.publish(due.id, { now });
      } catch (error) {
        hold(`没能开始发布：${(error as Error).message}`);
        return due.id;
      }
      await this.current;
      const post = store.ledger.state(pickKey(due.id));
      if (post?.status === "ok") {
        const reply = store.ledger.state(replyKey(due.id));
        const replied = reply?.status === "ok" && reply.at >= post.at;
        const hasReply = !!store.drafts.latest(due.id)?.reply;
        this.notify(
          "排好的帖子已发出",
          `${titleOf(due)}${hasReply ? (replied ? "，首条回复也发了" : "，首条回复没发出去，去工作台补发") : ""}`,
        );
      } else {
        // It did not go out (or nobody knows): back in line where it was, held until the reader looks.
        store.picks.setSchedule(due.id, slot, mode);
        hold(
          post?.status === "unknown"
            ? "发布结果不明，可能已经发出去了：先去 X 上看一眼，再在发布区确认"
            : `发布没成功：${post?.note ?? "原因不明"}`,
        );
      }
      return due.id;
    } finally {
      this.ticking = false;
    }
  }

  private async run(pick: TopicPick, draftId: number, rehearsal: boolean, override?: string) {
    const { store, log, config } = this.deps;
    const draft = store.drafts.get(draftId)!;
    const key = pickKey(pick.id);
    const backend = draft.quoteUrl ? "cdp-quote" : draft.imageId ? "cdp-image" : "cdp";
    const hash = createHash("sha256").update(draft.body).digest("hex").slice(0, 16);
    const image = draft.imageId ? store.news.image(draft.imageId)?.filePath : undefined;
    const record = (status: LedgerEntry["status"], note: string, tweetId?: string) => {
      const entry = store.ledger.append({
        draftKey: key,
        pickId: pick.id,
        draftId,
        status,
        hash,
        backend,
        tweetId,
        note: override && status === "pending" ? `${note}; spacing override: ${override}` : note,
      });
      this.emit(pick.id, status, entry);
      return entry;
    };
    let outcome: PostOutcome;
    try {
      this.emit(pick.id, "preflight");
      if (this.x === liveX) await ensureChrome((msg) => log.info("publish.chrome", { msg }));
      outcome = await this.x.post({
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
      this.running = undefined;
      this.emit(pick.id, "rehearsed");
      return;
    }
    record(
      outcome.status === "ok" ? "ok" : outcome.status === "unknown" ? "unknown" : "failed",
      outcome.detail,
      outcome.status === "ok" ? statusId(outcome.url) : undefined,
    );
    if (outcome.status !== "ok") {
      this.running = undefined;
      return;
    }
    const published = store.picks.update(pick.id, { status: "published" })!;
    this.deps.bus.publish({ type: "pick", pick: published });
    if (config.publishedDir) {
      try {
        this.archive(published, draft.body, draft.reply, image, config.publishedDir);
      } catch (error) {
        log.warn("publish.archive_failed", { pickId: pick.id, error: String(error) });
      }
    }
    try {
      if (draft.reply)
        await this.postReply(
          pick.id,
          draftId,
          draft.reply,
          outcome.status === "ok" ? outcome.url : undefined,
        );
    } finally {
      this.running = undefined;
      this.emit(pick.id, "done");
    }
  }

  /** The first reply under the post: its own ledger key, pending right before the click, then how it went. */
  private async postReply(pickId: number, draftId: number, text: string, postUrl?: string) {
    const { store, log, config } = this.deps;
    const record = (status: LedgerEntry["status"], note: string) => {
      const entry = store.ledger.append({
        draftKey: replyKey(pickId),
        pickId,
        draftId,
        status,
        backend: "cdp-reply",
        note,
      });
      this.emit(pickId, `reply ${status}`, entry);
    };
    if (!postUrl) {
      record(
        "failed",
        "the post went out but its link was not found: paste the post's link to post the reply",
      );
      return;
    }
    let outcome: PostOutcome;
    try {
      this.emit(pickId, "reply");
      outcome = await this.x.reply({
        postUrl,
        text,
        rehearsal: false,
        filesystemRoot: config.dataDir,
        beforeClick: () => record("pending", `replying under ${postUrl}`),
        phase: (p) => this.emit(pickId, `reply ${p}`),
      });
    } catch (error) {
      outcome = {
        status: "failed",
        detail: String((error as Error).message ?? error).slice(0, 300),
      };
    }
    log.info("publish.reply", { pickId, status: outcome.status, detail: outcome.detail });
    record(
      outcome.status === "ok" ? "ok" : outcome.status === "unknown" ? "unknown" : "failed",
      `${outcome.detail} (under ${postUrl})`,
    );
  }

  /** Post the first reply again under a published pick's post, when it did not go out after the post. */
  reply(pickId: number, postUrl?: string): PublishState {
    const { store, log } = this.deps;
    if (!store.picks.get(pickId)) throw notFound(`No pick ${pickId}`);
    if (this.running)
      throw invalid(
        `Pick ${this.running.pickId} is being ${this.running.rehearsal ? "rehearsed" : "published"} now`,
      );
    const post = store.ledger.state(pickKey(pickId));
    if (post?.status !== "ok")
      throw invalid(
        `Pick ${pickId}'s post has not gone out (its ledger is ${post?.status ?? "empty"})`,
      );
    const draft = store.drafts.latest(pickId);
    if (!draft?.reply) throw invalid(`Pick ${pickId}'s draft has no first reply`);
    const mine = store.ledger.state(replyKey(pickId));
    if (mine && mine.at >= post.at) {
      if (mine.status === "ok")
        throw invalid(`Pick ${pickId}'s first reply already went out at ${mine.at}`);
      if (BLOCKING.includes(mine.status))
        throw invalid(
          `Pick ${pickId}'s first reply is ${mine.status} (${mine.at}): it may have gone out. Check X, then ack it if it did not`,
        );
    }
    const url = postUrl?.trim() || (post.tweetId ? `https://x.com/i/status/${post.tweetId}` : "");
    if (!POST_URL.test(url))
      throw invalid(
        "The post's link was not found: give it as postUrl (https://x.com/<account>/status/<id>)",
      );
    this.running = { pickId, rehearsal: false, phase: "reply" };
    void (async () => {
      try {
        if (this.x === liveX) await ensureChrome((msg) => log.info("publish.chrome", { msg }));
        await this.postReply(pickId, draft.id, draft.reply!, url);
      } catch (error) {
        log.warn("publish.reply_failed", { pickId, error: String(error) });
      } finally {
        this.running = undefined;
        this.emit(pickId, "done");
      }
    })();
    return this.state(pickId);
  }

  /** The published post as selfPromotion keeps it: front matter, the text, and the image beside it. */
  private archive(
    pick: TopicPick,
    body: string,
    reply: string | undefined,
    image: string | undefined,
    dir: string,
  ) {
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
    // The 原文 links stay in the archive: selfPromotion's scout reads them to know which sources went out.
    const text = reply ? `${body}\n\n首条回复：\n${reply}` : body;
    writeFileSync(join(dir, `${name}.md`), `${front.join("\n")}\n${text}\n`);
  }

  /** A person checked X: the pending or unknown publish (or first reply) did not post. */
  ack(pickId: number, note: string, reply = false): LedgerEntry {
    const { store } = this.deps;
    const mine = store.ledger.state(reply ? replyKey(pickId) : pickKey(pickId));
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
