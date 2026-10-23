import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { argmapBuilt, renderArgmap, validateArgmap } from "../src/index.ts";

const fixture = () =>
  JSON.parse(readFileSync(join(import.meta.dirname, "fixtures", "compare.argmap.json"), "utf8"));

test("a published compare argmap validates", () => {
  const { data, errors } = validateArgmap(fixture());
  assert.deepEqual(errors, []);
  assert.equal(data?.layout, "compare");
});

test("validation names what to fix", () => {
  const bad = fixture();
  delete bad.landmark;
  bad.nodes[0].source = "";
  bad.nodes.push(
    ...Array.from({ length: 10 }, (_, i) => ({ id: `X${i}`, kind: "our-take", title: "t" })),
  );
  bad.edges = [{ from: "nope", to: bad.nodes[0].id }];
  const { data, errors } = validateArgmap(bad);
  assert.equal(data, undefined);
  assert.ok(errors.some((e) => e.includes("缺 landmark")));
  assert.ok(errors.some((e) => e.includes("缺 source")));
  assert.ok(errors.some((e) => e.includes("上限 10")));
  assert.ok(errors.some((e) => e.includes("edges[0]")));
});

test("compare needs sides and dims", () => {
  const bad = fixture();
  delete bad.sides;
  const { errors } = validateArgmap(bad);
  assert.ok(errors.some((e) => e.includes("sides")));
});

test(
  "renders a PNG with no warnings",
  { skip: !argmapBuilt() && "run npm run build first" },
  async () => {
    const { data } = validateArgmap(fixture());
    const out = await renderArgmap(data!, { theme: "light" });
    assert.equal(out.png.subarray(1, 4).toString(), "PNG");
    assert.equal(out.layout, "compare");
    assert.ok(out.size.w > 0 && out.size.h > 0);
    assert.deepEqual(out.warnings, []);
  },
);
