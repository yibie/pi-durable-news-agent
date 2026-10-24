// The reader's own edits, told to the pick's writer with the reader's next message: which revision is now the newest
// and what changed from the writer's last draft, so a revision starts from the reader's text instead of undoing it.
// Nothing is sent when the edit is saved: the writer only needs it when it is asked to work again.
import type { Draft } from "@dna/sdk";
import type { Store } from "../db/store.ts";

export const EDIT_NOTICE = "【读者手改了稿子】";
export const READER_SAYS = "【读者这次的话】";
const MAX_DIFF = 4000;

/** Lines removed (-) and added (+) going from a to b, by longest common subsequence; blank lines are ignored. */
export function lineDiff(a: string, b: string): string[] {
  const lines = (t: string) =>
    t
      .split("\n")
      .map((l) => l.trimEnd())
      .filter(Boolean);
  const x = lines(a);
  const y = lines(b);
  const lcs = Array.from({ length: x.length + 1 }, () =>
    Array.from({ length: y.length + 1 }, () => 0),
  );
  for (let i = x.length - 1; i >= 0; i--)
    for (let j = y.length - 1; j >= 0; j--)
      lcs[i][j] = x[i] === y[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
  const out: string[] = [];
  let i = 0;
  let j = 0;
  while (i < x.length && j < y.length) {
    if (x[i] === y[j]) {
      i++;
      j++;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) out.push(`- ${x[i++]}`);
    else out.push(`+ ${y[j++]}`);
  }
  while (i < x.length) out.push(`- ${x[i++]}`);
  while (j < y.length) out.push(`+ ${y[j++]}`);
  return out;
}

/** The post and its first reply as one text, so an edit to either shows in the diff. */
const whole = (d: Draft) => (d.reply ? `${d.body}\n\n【首条回复】\n${d.reply}` : d.body);

/** The notice to put before the reader's message when the newest draft is the reader's own edit and the writer has not
 * been told about it yet. Record `revision` as told (store.picks.setWriterSeen) once the message is sent. */
export function editNotice(
  store: Store,
  pickId: number,
): { text: string; revision: number } | undefined {
  const drafts = store.drafts.list(pickId);
  const latest = drafts[0];
  if (!latest || latest.author !== "reader" || latest.revision <= store.picks.writerSeen(pickId))
    return undefined;
  const mine = drafts.find((d) => d.author === "writer" && d.revision < latest.revision);
  const lines = [EDIT_NOTICE];
  if (!mine) lines.push(`现在最新的是第 ${latest.revision} 版，是读者自己改的。`);
  else {
    lines.push(
      `你最后交的是第 ${mine.revision} 版，读者之后自己改了，现在最新的是第 ${latest.revision} 版。改动如下（- 是你写的，+ 是读者改成的）：`,
    );
    const diff = lineDiff(whole(mine), whole(latest));
    let text = diff.join("\n");
    if (!diff.length) text = "（只改了空行或空格）";
    else if (text.length > MAX_DIFF)
      text = `${text.slice(0, MAX_DIFF)}\n（改动较多，后面省略；用 read_pick 读全文）`;
    lines.push(text);
  }
  lines.push(
    `改稿要在第 ${latest.revision} 版上改：先用 read_pick 读最新稿，读者改过的地方保持读者的写法，不要改回去。`,
  );
  return { text: lines.join("\n"), revision: latest.revision };
}
