// The 去 AI 味 check: 「去AI味 v2」 (lieflat-less-ai-tone, CC BY-NC 4.0, vendored with its notice in
// vendor/lieflat-less-ai-tone). Its detect.py counts the phrasings a 5.2-million-character corpus study found AI text
// uses more than people do, and pulls out the sentences a model then judges by references/semantic-criteria.md. The
// writer reads the skill's own SKILL.md for the workflow: report first, rewrite only after the reader says so.
import { execFile } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);
export const AI_TONE_DIR = resolve(import.meta.dirname, "..", "..", "vendor", "lieflat-less-ai-tone");
const DETECT = join(AI_TONE_DIR, "scripts", "detect.py");
const python = () => process.env.DNA_PYTHON?.trim() || "python3";

/** The skill's workflow and the judging criteria for its semantic layer, as the writer reads them. */
export function aiToneGuide(): string {
  const read = (path: string) => readFileSync(join(AI_TONE_DIR, path), "utf8").trim();
  return [
    read("SKILL.md"),
    "---\n# references/semantic-criteria.md\n",
    read("references/semantic-criteria.md"),
    "---\n# DETECT.md\n",
    read("DETECT.md"),
  ].join("\n\n");
}

export interface AiToneResult {
  /** detect.py --json: densities, locatable hits by rule, fingerprints and structure; meta.short under 500 汉字. */
  report: unknown;
  /** detect.py --candidates: the sentences the semantic layer judges (rename / cohesion / colon / iso3). */
  candidates: unknown;
}

/** Run the check on a post's text. Lines are the post's own lines, so a hit's line number points into it. */
export async function checkAiTone(text: string): Promise<AiToneResult> {
  const dir = mkdtempSync(join(tmpdir(), "dna-ai-tone-"));
  try {
    const file = join(dir, "draft.md");
    const out = join(dir, "candidates.json");
    writeFileSync(file, text);
    const opts = { timeout: 60_000, maxBuffer: 8 * 1024 * 1024 };
    // -I: the script runs isolated from the current directory and user site-packages.
    const { stdout } = await run(
      python(),
      ["-I", DETECT, file, "--json", "--short", "--max-hits", "20"],
      opts,
    );
    await run(python(), ["-I", DETECT, file, "--candidates", "--out", out], opts);
    return { report: JSON.parse(stdout), candidates: JSON.parse(readFileSync(out, "utf8")) };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
