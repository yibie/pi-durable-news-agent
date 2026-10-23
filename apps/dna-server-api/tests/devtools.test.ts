import assert from "node:assert/strict";
import { test } from "node:test";
import { parsePages } from "../src/publishing/devtools.ts";

test("list_pages lines give each page's url, not its title", () => {
  const text =
    "## Pages\n1: (2) 主页 / X (https://x.com/home) [selected]\n2: Hallmark, design taste (for agents) (https://www.usehallmark.com/)\n3: 发帖 / X (https://x.com/compose/post)";
  assert.deepEqual(parsePages(text), [
    { id: 1, url: "https://x.com/home" },
    { id: 2, url: "https://www.usehallmark.com/" },
    { id: 3, url: "https://x.com/compose/post" },
  ]);
});
