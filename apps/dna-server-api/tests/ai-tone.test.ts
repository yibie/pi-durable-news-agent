import assert from "node:assert/strict";
import { test } from "node:test";
import { aiToneGuide, checkAiTone } from "../src/writing/ai-tone.ts";

test("a short post is still checked, and its 翻案腔 is found on its own line", async () => {
  const text = "第一段只是铺垫。\n\n真正的壁垒不是技术，而是认知。\n";
  const result = (await checkAiTone(text)) as {
    report: { meta: { short?: boolean }; hits: Record<string, { line: number }[]> };
    candidates: { meta: { n_candidates: number } };
  };
  assert.equal(result.report.meta.short, true);
  assert.deepEqual(
    result.report.hits["翻案腔"].map((h) => h.line),
    [3],
  );
  assert.equal(typeof result.candidates.meta.n_candidates, "number");
});

test("the guide carries the skill's workflow and its semantic criteria", () => {
  const guide = aiToneGuide();
  assert.match(guide, /去AI味 v2/);
  assert.match(guide, /references\/semantic-criteria\.md/);
});
