// The argmap schema: a landmark sentence, nodes in a backbone (row 0) and children (row 1+), typed edges, and the
// extra fields some layouts need.
export const ARGMAP_LAYOUTS = [
  "flow",
  "fishbone",
  "annotated",
  "tree",
  "steps",
  "system",
  "compare",
  "timeline",
  "loop",
  "debate",
] as const;
export type ArgmapLayout = (typeof ARGMAP_LAYOUTS)[number];

export const NODE_KINDS = [
  "thesis",
  "evidence",
  "rebuttal",
  "concession",
  "result",
  "our-take",
  "support",
  "decision",
  "question",
  "step",
  "check",
  "pitfall",
  "component",
  "data",
  "actor",
  "event",
  "turn",
  "group",
] as const;
export type NodeKind = (typeof NODE_KINDS)[number];

export const EDGE_KINDS = ["supports", "refutes", "qualifies", "enables"] as const;

export interface ArgmapNode {
  id: string;
  kind: NodeKind;
  title: string;
  point?: string;
  /** The source's own words, copied (English stays English). */
  quote?: string;
  source?: string;
  col?: number;
  row?: number;
  /** annotated: who wrote the note. */
  author?: string;
  /** timeline: the event's date. */
  date?: string;
  /** loop: the purpose at the centre. */
  center?: boolean;
  /** compare / debate: which side the cell or turn belongs to. */
  side?: string;
  /** compare: the dimension of the cell. */
  dim?: string;
  /** system: the group frame a part sits in. */
  group?: string;
}

export interface ArgmapEdge {
  from: string;
  to: string;
  kind?: (typeof EDGE_KINDS)[number];
  label?: string;
}

export interface ArgmapData {
  layout?: ArgmapLayout;
  /** One sentence at the top: the question and its answer, in words an outsider can place. */
  landmark: string;
  reader?: string;
  footnote?: string;
  article?: { title?: string; url?: string; published?: string };
  /** compare: the objects across the top; debate: { A, B } side names. */
  sides?: string[] | Record<string, string>;
  /** compare: the dimensions down the left. */
  dims?: string[];
  nodes: ArgmapNode[];
  edges?: ArgmapEdge[];
}
