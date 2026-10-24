// Checks a post's text must pass before it is saved as ready or published. X renders no Markdown, so any Markdown
// syntax shows up as literal symbols: it is refused, not silently stripped (stripping it made the archived text
// differ from what went out). X counts CJK characters twice; a blue-check post holds 25,000 weighted characters. X also
// ranks a post with an outside link lower, so links in the post are refused: they go in its first reply.
import type { PostLint } from "@dna/sdk";

export const WEIGHT_LIMIT = 25_000;

type LintHit = PostLint["markdown"][number];

const MARKDOWN_LINE = /^(#{1,6} |[*>] |```|\| |- )/;

/** Markdown lines, skipping indented code and the inside of fences (a fence line itself is a hit). */
export function markdownHits(text: string): LintHit[] {
  const hits: LintHit[] = [];
  let fence = false;
  text.split("\n").forEach((line, i) => {
    const stripped = line.trim();
    if (stripped.startsWith("```")) {
      hits.push({ line: i + 1, text: stripped.slice(0, 80) });
      fence = !fence;
      return;
    }
    if (fence || line.startsWith("    ") || line.startsWith("\t")) return;
    if (MARKDOWN_LINE.test(line) || line.includes("**"))
      hits.push({ line: i + 1, text: stripped.slice(0, 80) });
  });
  // Tables written without a space after the pipe: two or more lines in a row that start with |.
  const lines = text.split("\n");
  lines.forEach((line, i) => {
    const pipe = (j: number) => lines[j]?.trim().startsWith("|") ?? false;
    if (pipe(i) && (pipe(i - 1) || pipe(i + 1)) && !hits.some((h) => h.line === i + 1))
      hits.push({ line: i + 1, text: line.trim().slice(0, 80) });
  });
  return hits.sort((a, b) => a.line - b.line);
}

const isCjk = (o: number) =>
  (o >= 0x1100 && o <= 0x11ff) ||
  (o >= 0x2e80 && o <= 0xa4cf) ||
  (o >= 0xac00 && o <= 0xd7a3) ||
  (o >= 0xf900 && o <= 0xfaff) ||
  (o >= 0xfe30 && o <= 0xfe4f) ||
  (o >= 0xff00 && o <= 0xff60) ||
  (o >= 0xffe0 && o <= 0xffe6) ||
  (o >= 0x20000 && o <= 0x3fffd);

export function weightedLength(text: string): number {
  let w = 0;
  for (const ch of text) w += isCjk(ch.codePointAt(0)!) ? 2 : 1;
  return w;
}

const LINK = /\bhttps?:\/\/[^\s<>）)」]+|\bwww\.[^\s<>）)」]+/gi;

/** Links in the text, each once. */
export const linksIn = (text: string) => [...new Set(text.match(LINK) ?? [])];

export function lintPost(text: string): PostLint {
  const weighted = weightedLength(text);
  return {
    markdown: markdownHits(text),
    links: linksIn(text),
    weighted,
    chars: [...text].length,
    overLimit: weighted > WEIGHT_LIMIT,
  };
}

/** Problems that block publishing, as lines a person or the writer can act on. Empty means clean. */
export function lintProblems(lint: PostLint): string[] {
  return [
    ...lint.markdown.map((h) => `第 ${h.line} 行有 Markdown（X 会原样显示）：${h.text}`),
    ...lint.links.map((l) => `正文里有链接（带站外链接的帖子会被降权，放进首条回复）：${l}`),
    ...(lint.overLimit
      ? [`加权长度 ${lint.weighted} 超过上限 ${WEIGHT_LIMIT}（中文按 2 计）`]
      : []),
  ];
}
