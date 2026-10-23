// Writing: each pick gets its own writer conversation. picks.write starts it with the pick's sources (once) or sends
// it the reader's message; picks.stop interrupts it. drafts.list shows every revision, drafts.save keeps the reader's
// own edit as a new revision with the newest image.
import { join } from "node:path";
import { configure, type ConversationId } from "@earendil-works/pi-durable";
import { loadPrompt } from "@dna/durable-agent";
import type { TopicPick } from "@dna/sdk";
import { int, invalid, notFound } from "../errors.ts";
import { saveDraft } from "../writing/drafts.ts";
import { bodyOf, str, type Handlers, type RouteDeps } from "./types.ts";

const GENRE_NAMES: Record<TopicPick["genre"], string> = {
  single: "single post (单篇)",
  roundup: "topic roundup (主题串烧)",
  tool: "tool recommendation (工具推荐)",
  quote: "quote post (引用转发)",
};

export function writingRoutes({
  app,
}: RouteDeps): Handlers<"picks.write" | "picks.stop" | "drafts.list" | "drafts.save"> {
  const { store, harness, ctx } = app;

  const pickOf = (raw: unknown): TopicPick => {
    const id = int(raw, "id");
    const pick = store.picks.get(id);
    if (!pick) throw notFound(`No pick ${id}`);
    if (pick.status === "dropped") throw invalid(`Pick ${id} was put back into News`);
    return pick;
  };

  const conversation = async (pick: TopicPick) => {
    const c = pick.conversationId
      ? await harness.harness.conversation(Number(pick.conversationId) as ConversationId, ctx)
      : undefined;
    if (!c) throw invalid(`Pick ${pick.id} has no writer yet`);
    return c;
  };

  const startPrompt = (pick: TopicPick) =>
    loadPrompt(join(app.config.promptsDir, "agents"), "writer", "USER_PROMPT_write.md", {
      pick_id: String(pick.id),
      genre: GENRE_NAMES[pick.genre],
      sources: pick.items.map((it) => `${it.title} (${it.url ?? "no url"})`).join("; "),
      note: pick.note ?? "none",
    });

  return {
    "picks.write": async (req, res) => {
      let pick = pickOf(req.params.id);
      const message = str(bodyOf(req), "message", { max: 20_000, optional: true });
      if (!pick.conversationId) {
        // On the first start the reader's message is the brief's note, read before the first draft.
        if (message) pick = store.picks.update(pick.id, { note: message })!;
        const id = await harness.harness.commit(async (tx) => {
          const child = await tx.createConversation({ ownership: { kind: "ownerless" } });
          await configure(tx, child.id, app.agents.writerAgent());
          return child.id;
        }, ctx);
        pick = store.picks.setConversation(pick.id, String(id))!;
        // Two clicks racing: the first conversation recorded wins, the other is left unused.
        const writer = await conversation(pick);
        await writer.submit(
          {
            type: "input",
            content: startPrompt(pick),
            requestId: `write:${pick.id}`,
            whenBusy: "followUp",
          },
          ctx,
        );
        if (pick.status === "selected") pick = store.picks.update(pick.id, { status: "drafting" })!;
        app.log.info("writing.started", {
          pickId: pick.id,
          conversationId: pick.conversationId,
          note: !!message,
        });
      } else if (message) {
        const writer = await conversation(pick);
        await writer.submit(
          {
            type: "input",
            content: message,
            requestId: `write:${pick.id}:${Date.now()}`,
            whenBusy: "followUp",
          },
          ctx,
        );
        app.log.info("writing.message", { pickId: pick.id, chars: message.length });
      }
      app.bus.publish({ type: "pick", pick });
      res.json({ pick, conversationId: pick.conversationId });
    },
    "picks.stop": async (req, res) => {
      const pick = pickOf(req.params.id);
      await (await conversation(pick)).abort(ctx, { background: true });
      app.log.warn("writing.stopped", { pickId: pick.id });
      res.json({ ok: true });
    },
    "drafts.list": (req, res) => {
      const id = int(req.params.id, "id");
      if (!store.picks.get(id)) throw notFound(`No pick ${id}`);
      res.json(store.drafts.list(id));
    },
    "drafts.save": (req, res) => {
      const pick = pickOf(req.params.id);
      const body = bodyOf(req);
      const text = str(body, "body", { max: 60_000 });
      const note = str(body, "note", { max: 500, optional: true });
      const latest = store.drafts.latest(pick.id);
      const draft = saveDraft(app, pick, {
        body: text,
        imageId: latest?.imageId,
        quoteUrl: latest?.quoteUrl,
        author: "reader",
        note,
      });
      res.json(draft);
    },
  };
}
