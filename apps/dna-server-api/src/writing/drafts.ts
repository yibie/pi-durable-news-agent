// Writing a pick: drawing its argmap into an image, and saving a draft revision with the checks a post must pass.
// The writer's tools and the reader's routes both come through here, so the checks and the frames are the same.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { renderArgmap, validateArgmap, type ArgmapData } from "@dna/argmap";
import type { Draft, TopicPick } from "@dna/sdk";
import type { Deps } from "../deps.ts";
import type { Store } from "../db/store.ts";
import type { ArgmapRender } from "../db/repos/drafts.ts";
import { PLACEHOLDER_PNG } from "../news/images.ts";
import { linksIn, lintPost, lintProblems } from "./lint.ts";

const QUOTE_URL = /^https:\/\/(x|twitter)\.com\/[A-Za-z0-9_]+\/status\/\d+/;

/** The argmap rendered into data/images/<id>.png, or what to fix in the JSON first. */
export async function drawArgmap(
  deps: Deps,
  pick: TopicPick,
  input: unknown,
): Promise<{ render?: ArgmapRender; png?: Buffer; errors: string[] }> {
  const { data, errors } = validateArgmap(input);
  if (!data) return { errors };
  const offline = deps.config.provider === "faux" || deps.config.searchMode === "fixture";
  const drawn = offline
    ? { png: PLACEHOLDER_PNG, layout: data.layout ?? "flow", warnings: [] as string[] }
    : await renderArgmap(data as ArgmapData);
  const imageId = deps.store.news.addImage({
    origin: "generated",
    status: "pending",
    model: "argmap",
    prompt: data.landmark,
  });
  const dir = join(deps.config.dataDir, "images");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${imageId}.png`);
  writeFileSync(file, drawn.png);
  deps.store.news.updateImage(imageId, {
    status: "ready",
    filePath: file,
    costUsd: 0,
    model: "argmap",
  });
  const render = deps.store.drafts.addRender({
    imageId,
    pickId: pick.id,
    layout: drawn.layout,
    argmap: data,
    warnings: drawn.warnings,
  });
  deps.log.info("writing.render", {
    pickId: pick.id,
    imageId,
    layout: drawn.layout,
    warnings: drawn.warnings.length,
  });
  return { render, png: drawn.png, errors: [] };
}

/** Why this text cannot be saved for this pick, one line each; empty means it can. */
export function draftProblems(
  pick: TopicPick,
  body: string,
  opts: { imageId?: number; quoteUrl?: string; reply?: string },
): string[] {
  const problems = lintProblems(lintPost(body));
  if (!body.trim()) problems.push("正文是空的");
  if (!/评论区/.test(body)) problems.push("正文末尾缺一句「原文链接在评论区」");
  const reply = opts.reply?.trim() ?? "";
  if (!/原文[:：]/.test(reply) || !linksIn(reply).length)
    problems.push("首条回复要有「原文：」和原文链接（链接不放正文，放首条回复）");
  problems.push(
    ...lintPost(reply).markdown.map((h) => `首条回复第 ${h.line} 行有 Markdown：${h.text}`),
  );
  if (pick.genre === "roundup" && pick.items.length < 3)
    problems.push(`主题串烧至少要 3 条素材，这个选题只有 ${pick.items.length} 条`);
  if (pick.genre === "quote" && !(opts.quoteUrl && QUOTE_URL.test(opts.quoteUrl)))
    problems.push("引用转发要给被引推文的链接（https://x.com/<账号>/status/<数字>）");
  if (pick.genre !== "quote" && opts.imageId === undefined)
    problems.push("缺配图：先用 render_argmap 出图，再带上它的 image_id");
  return problems;
}

/** Save a revision, move a selected pick to drafting, and tell every client. */
export function saveDraft(
  deps: Deps,
  pick: TopicPick,
  input: {
    body: string;
    imageId?: number;
    quoteUrl?: string;
    author: Draft["author"];
    note?: string;
    reply?: string;
    toolCallId?: string;
  },
): Draft {
  const draft = deps.store.drafts.add({
    pickId: pick.id,
    ...input,
    body: input.body.trim(),
    reply: input.reply?.trim() || undefined,
  });
  const moved =
    pick.status === "selected"
      ? deps.store.picks.update(pick.id, { status: "drafting" })
      : undefined;
  deps.bus.publish({ type: "draft", draft });
  deps.bus.publish({ type: "pick", pick: moved ?? deps.store.picks.get(pick.id)! });
  deps.log.info("writing.draft", {
    pickId: pick.id,
    revision: draft.revision,
    author: draft.author,
    weighted: draft.lint.weighted,
  });
  return draft;
}

/** Why the pick's newest draft cannot go to 待发布 yet; empty means it can. */
export function readyProblems(store: Store, pick: TopicPick): string[] {
  const draft = store.drafts.latest(pick.id);
  if (!draft) return ["还没有稿子"];
  return [
    ...draftProblems(pick, draft.body, {
      imageId: draft.imageId,
      quoteUrl: draft.quoteUrl,
      reply: draft.reply,
    }),
    ...draft.warnings.map((w) => `配图：${w}`),
  ];
}
