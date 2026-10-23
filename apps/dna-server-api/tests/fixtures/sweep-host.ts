// A server stand-in for crash tests: open the faux app on <dir>, then either start a sweep and run until killed,
// or resume whatever was in flight, wait for sweep 1 to settle, print a summary and exit.
//   sweep-host.ts <dir> start
//   sweep-host.ts <dir> resume
import { loadConfig } from "../../src/config.ts";
import { startNewsSweep } from "../../src/news/sweep.ts";
import { openApp } from "../../src/runtime.ts";
import { waitForSweep } from "../helpers.ts";

const [dir, mode] = process.argv.slice(2);
process.env.DNA_LOG_DIR = `${dir}/logs`;
const config = loadConfig([], {
  ...process.env,
  DNA_PROVIDER: "faux",
  DNA_SEARCH_MODE: "fixture",
  DNA_DATA_DIR: dir,
  // Tests run on the shipped defaults, even when .env points a device at its own config,
  // and never read the device's publish ledger or write into its archive.
  DNA_CONFIG_DIR: "",
  DNA_LEDGER_IMPORT: "",
  DNA_PUBLISHED_DIR: "",
});
const app = await openApp(config);

if (mode === "start") {
  await startNewsSweep(app, app.main, app.ctx, { trigger: "test", requestId: "crash:1" });
  await new Promise(() => {});
}
const sweep = await waitForSweep(app, 1, 60_000);
const cards = app.store.news.cards();
console.log(
  JSON.stringify({
    status: sweep.status,
    audit: sweep.audit,
    cards: cards.map((c) => ({
      kind: c.kind,
      itemId: c.itemId,
      title: c.title,
      timeline: c.timeline,
    })),
  }),
);
await app.close();
