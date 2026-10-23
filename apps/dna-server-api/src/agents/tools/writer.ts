// The writer's tools. Each writer conversation belongs to one pick, so the tools act on that pick: read it
// (read_pick), read its sources in full (read_source), see which layouts recent posts used (recent_layouts), draw the
// argmap (render_argmap) and save a draft revision (save_draft). Publishing is the reader's button, never a tool.
import { Type } from "@earendil-works/pi-ai";
import type { ToolExecutionApi } from "@earendil-works/pi-durable";
import { defineAppTool, toolError, toolText } from "@dna/durable-agent";
import type { TopicPick } from "@dna/sdk";
import type { Deps } from "../../deps.ts";
import { draftProblems, drawArgmap, saveDraft } from "../../writing/drafts.ts";
import { ref } from "./shared.ts";

/** One page of a source: long articles are read in several calls. */
const PAGE = 12_000;
const RECENT = 5;
/** search.scrape keeps at most this much of a page. */
const SCRAPE_CAP = 40_000;

function pickOf(deps: Deps, api: ToolExecutionApi): TopicPick | undefined {
  return deps.store.picks.byConversation(String(api.conversationId));
}

const noPick = () =>
  toolError("This conversation has no pick.", [
    "The writer runs in a pick's own conversation; start it from the pick's 开始写 button.",
  ]);

export function readPick(deps: Deps) {
  return defineAppTool({
    name: "read_pick",
    returns:
      "Text: the pick's genre, status and reader note, each source (item id, title, url, source name), and the newest draft if there is one.",
    description:
      "Read the pick this conversation writes: its genre, its sources and the newest draft. Call it first, and again after the reader edited the draft.",
    parameters: Type.Object({}),
    replay: "safe",
    execute: async (_args, api) => {
      const pick = pickOf(deps, api);
      if (!pick) return noPick();
      const sources = pick.items.map((it) => {
        const card = deps.store.news.card(it.cardId);
        return `item ${card?.itemId ?? "?"} | ${it.title} | ${it.url ?? card?.url ?? "no url"}${it.sourceName ? ` | ${it.sourceName}` : ""}`;
      });
      const draft = deps.store.drafts.latest(pick.id);
      return toolText(
        [
          `pick ${pick.id}: ${pick.genre}, ${pick.status}${pick.note ? `, reader note: ${pick.note}` : ""}`,
          "sources:",
          ...sources,
          draft
            ? [
                `newest draft: revision ${draft.revision} by ${draft.author}, layout ${draft.layout ?? "none"}, image ${draft.imageId ?? "none"}${draft.quoteUrl ? `, quotes ${draft.quoteUrl}` : ""}`,
                draft.body,
              ].join("\n")
            : "no draft yet",
        ].join("\n"),
      );
    },
  });
}

export function readSource(deps: Deps) {
  return defineAppTool({
    name: "read_source",
    returns: `Text: the page title, then up to ${PAGE} characters from offset, and where the next page starts or that this is the end.`,
    description:
      "Read a source in full, page by page: give an item id from read_pick or any url (an original the item retells), and an offset to continue. Keep reading until it says the end.",
    parameters: Type.Object({
      item_id: Type.Optional(Type.Integer()),
      url: Type.Optional(Type.String()),
      offset: Type.Optional(Type.Integer({ minimum: 0 })),
    }),
    replay: "safe",
    outputLimits: { maxBytes: 60_000 },
    execute: async (args, api) => {
      const item = args.item_id ? deps.store.news.item(args.item_id) : undefined;
      if (args.item_id && !item) return toolError(`No item #${args.item_id}.`);
      const url = item?.url ?? args.url;
      if (!url) return toolError("read_source needs item_id or url.");
      try {
        const { doc, via } = await deps.search.scrape(url, ref(api));
        const text = doc.contentMd ?? "";
        const from = Math.min(args.offset ?? 0, text.length);
        const to = Math.min(from + PAGE, text.length);
        const capped =
          text.length >= SCRAPE_CAP
            ? `; the stored text stops at ${SCRAPE_CAP} characters, the original may go on`
            : "";
        const tail =
          to < text.length
            ? `[characters ${from} to ${to} of ${text.length}; continue with offset ${to}]`
            : `[the end: ${text.length} characters${capped}]`;
        return toolText(
          `${doc.title ?? url} (${url}, via ${via})\n${text.slice(from, to)}\n${tail}`,
        );
      } catch (error) {
        return toolError(`Could not read ${url}: ${String(error).slice(0, 200)}`, [
          "Try the original url, or tell the reader this source cannot be read.",
        ]);
      }
    },
  });
}

export function recentLayouts(deps: Deps) {
  return defineAppTool({
    name: "recent_layouts",
    returns: "Text: the argmap layouts of the newest drafts, newest first, one per line.",
    description: `The layouts the ${RECENT} newest drafts used, so you do not use one layout three times in a row.`,
    parameters: Type.Object({}),
    replay: "safe",
    execute: async () => {
      const recent = deps.store.drafts.recentLayouts(RECENT);
      return toolText(
        recent.length
          ? recent
              .map((r) => `${r.layout} (pick ${r.pickId}, ${r.createdAt.slice(0, 10)})`)
              .join("\n")
          : "No drafts with an image yet.",
      );
    },
  });
}

export function renderArgmapTool(deps: Deps) {
  return defineAppTool({
    name: "render_argmap",
    returns:
      "Text: the image id, layout, size and any problems the self-check found, then the image itself. Problems in the JSON come back as an error listing what to fix.",
    description:
      "Draw the argmap JSON (schema in the argmap rules) into the post's image. Fix every reported problem and render again; save_draft takes the image_id of the final render.",
    parameters: Type.Object({
      argmap: Type.Unknown({
        description: "The argmap JSON object: layout, landmark, reader, nodes, edges.",
      }),
    }),
    replay: "safe",
    execute: async (args, api) => {
      const pick = pickOf(deps, api);
      if (!pick) return noPick();
      let input = args.argmap;
      if (typeof input === "string") {
        try {
          input = JSON.parse(input);
        } catch {
          return toolError("argmap is not valid JSON.", ["Send the argmap as a JSON object."]);
        }
      }
      try {
        const { render, png, errors } = await drawArgmap(deps, pick, input);
        if (!render) return toolError("The argmap was not drawn:", errors);
        const text = [
          `image_id ${render.imageId}: layout ${render.layout}`,
          render.warnings.length
            ? `Problems to fix, then render again:\n${render.warnings.join("\n")}`
            : "The self-check found no problems.",
        ].join("\n");
        return {
          content: [
            { type: "text", text },
            { type: "image", data: png!.toString("base64"), mimeType: "image/png" },
          ],
          details: { imageId: render.imageId, layout: render.layout, warnings: render.warnings },
        };
      } catch (error) {
        deps.log.error("writing.render_failed", { pickId: pick.id, error: String(error) });
        return toolError(`Rendering failed: ${String(error).slice(0, 300)}`);
      }
    },
  });
}

export function saveDraftTool(deps: Deps) {
  return defineAppTool({
    name: "save_draft",
    returns:
      "Text: the saved revision and the text's weighted length, or the problems that stopped it from being saved.",
    description:
      "Save the post as a new draft revision: the whole text (body, the 原文 link block, the tags) and the image_id of its final render. A quote post also needs quote_url, the post on X it quotes. The text is checked first: no Markdown, under X's length limit, the 原文 block present.",
    parameters: Type.Object({
      body: Type.String({ minLength: 1 }),
      image_id: Type.Optional(Type.Integer()),
      quote_url: Type.Optional(Type.String()),
      note: Type.Optional(
        Type.String({ description: "What changed in this revision, in a few words." }),
      ),
    }),
    replay: "safe",
    execute: async (args, api) => {
      const pick = pickOf(deps, api);
      if (!pick) return noPick();
      if (args.image_id !== undefined) {
        const render = deps.store.drafts.render(args.image_id);
        if (!render || render.pickId !== pick.id)
          return toolError(`Image ${args.image_id} was not drawn for this pick.`, [
            "Use the image_id render_argmap returned in this conversation.",
          ]);
        if (render.warnings.length)
          return toolError(`Image ${args.image_id} still has problems:`, render.warnings);
      }
      const problems = draftProblems(pick, args.body, {
        imageId: args.image_id,
        quoteUrl: args.quote_url,
      });
      if (problems.length) return toolError("The draft was not saved:", problems);
      const draft = saveDraft(deps, pick, {
        body: args.body,
        imageId: args.image_id,
        quoteUrl: args.quote_url,
        author: "writer",
        note: args.note,
        toolCallId: String(api.taskId),
      });
      return toolText(
        `Saved revision ${draft.revision} of pick ${pick.id}: ${draft.lint.chars} characters, weighted ${draft.lint.weighted}.`,
      );
    },
  });
}
