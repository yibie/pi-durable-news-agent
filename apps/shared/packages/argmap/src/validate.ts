// Checks an argmap before it is drawn: the schema, at most 10 cards, every sourced card carries its source, and the
// fields each layout needs. Messages are Chinese, one problem per line, phrased as what to fix.
import {
  ARGMAP_LAYOUTS,
  EDGE_KINDS,
  NODE_KINDS,
  type ArgmapData,
  type ArgmapNode,
} from "./types.ts";

export const MAX_CARDS = 10;

/** Kinds that state what the source says: each needs the source's own words. */
const QUOTED = new Set(["thesis", "evidence", "rebuttal", "concession", "result"]);
/** Kinds that are ours or structural: no source needed. */
const UNSOURCED = new Set(["our-take", "group"]);

const isObject = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);

/** The argmap as typed data plus every problem found; draw only when `errors` is empty. */
export function validateArgmap(input: unknown): { data?: ArgmapData; errors: string[] } {
  const errors: string[] = [];
  if (!isObject(input)) return { errors: ["argmap 必须是一个 JSON 对象"] };
  const d = input as unknown as ArgmapData;
  const layout = d.layout ?? "flow";
  if (!ARGMAP_LAYOUTS.includes(layout))
    errors.push(`layout 必须是 ${ARGMAP_LAYOUTS.join(" / ")} 之一，收到 ${String(layout)}`);
  if (typeof d.landmark !== "string" || !d.landmark.trim())
    errors.push("缺 landmark：图顶那一句（问题 + 答案，外行也能说出这在讲哪类东西）");
  if (!Array.isArray(d.nodes) || !d.nodes.length) {
    errors.push("nodes 不能为空");
    return { errors };
  }
  const ids = new Set<string>();
  for (const [i, n] of d.nodes.entries()) {
    if (!isObject(n)) {
      errors.push(`nodes[${i}] 不是对象`);
      continue;
    }
    const node = n as unknown as ArgmapNode;
    const at = `节点 ${node.id ?? `#${i}`}`;
    if (typeof node.id !== "string" || !node.id) errors.push(`nodes[${i}] 缺 id`);
    else if (ids.has(node.id)) errors.push(`${at}：id 重复`);
    else ids.add(node.id);
    if (!NODE_KINDS.includes(node.kind))
      errors.push(`${at}：kind 必须是 ${NODE_KINDS.join(" / ")} 之一`);
    if (typeof node.title !== "string" || !node.title.trim()) errors.push(`${at}：缺 title`);
    if (!UNSOURCED.has(node.kind) && !node.source?.trim())
      errors.push(`${at}：缺 source（原文 URL）。这是我们自己的判断就把 kind 改成 our-take`);
    if (QUOTED.has(node.kind) && !node.quote?.trim())
      errors.push(`${at}：缺 quote（原文引文，英文照抄）`);
    if (layout === "timeline" && (node.kind === "event" || node.kind === "turn") && !node.date)
      errors.push(`${at}：timeline 的事件要带 date`);
  }
  const cards = d.nodes.filter((n) => isObject(n) && n.kind !== "group").length;
  if (cards > MAX_CARDS)
    errors.push(`卡片 ${cards} 张，上限 ${MAX_CARDS}：砍铺垫、砍换个节点也成立的内容`);
  for (const [i, e] of (d.edges ?? []).entries()) {
    if (!isObject(e) || !ids.has(String(e.from)) || !ids.has(String(e.to)))
      errors.push(`edges[${i}] 指向不存在的节点（from / to 要是节点 id）`);
    else if (e.kind && !EDGE_KINDS.includes(e.kind))
      errors.push(`edges[${i}]：kind 必须是 ${EDGE_KINDS.join(" / ")} 之一`);
  }
  if (layout === "compare") {
    const sides = Array.isArray(d.sides) ? d.sides : [];
    const dims = Array.isArray(d.dims) ? d.dims : [];
    if (sides.length < 2)
      errors.push('compare 要在顶层写 "sides": ["对象 A", "对象 B", ...]（至少两个）');
    if (!dims.length) errors.push('compare 要在顶层写 "dims": ["维度 1", ...]');
    for (const n of d.nodes.filter((x) => isObject(x) && x.side))
      if (!sides.includes(n.side!) || !dims.includes(n.dim ?? ""))
        errors.push(`节点 ${n.id}：side / dim 要分别是 sides / dims 里的一项`);
  }
  if (layout === "debate" && !(isObject(d.sides) && d.sides.A && d.sides.B))
    errors.push('debate 要在顶层写 "sides": {"A": "作者", "B": "批评者"}');
  if (layout === "loop" && d.nodes.filter((n) => isObject(n) && n.center).length > 1)
    errors.push('loop 只能有一个 "center": true 的目的节点');
  if (layout === "system")
    for (const n of d.nodes.filter((x) => isObject(x) && x.group))
      if (!d.nodes.some((g) => g.id === n.group && g.kind === "group"))
        errors.push(`节点 ${n.id}：group 指向的分组框不存在（要是 kind: group 的节点 id）`);
  return errors.length ? { errors } : { data: { ...d, layout, edges: d.edges ?? [] }, errors };
}
