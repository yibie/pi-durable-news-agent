// dna-server-api: load the root .env, open the stores, the durable harness and the projector, then serve HTTP.
//   tsx src/main.ts [--port 4850] [--host 127.0.0.1] [--data-dir data] [--device local]
import { createLogger, installProcessHandlers, loadRootEnv } from "@dna/sdk/node";
import { createHttpApp } from "./app.ts";
import { assertTokens, loadConfig } from "./config.ts";
import { bridge } from "./publishing/bridge.ts";
import { openApp } from "./runtime.ts";
import { packageVersion } from "./version.ts";

if (process.env.DNA_ENV_FILE !== "none") loadRootEnv(process.env.DNA_ENV_FILE || undefined);
const config = loadConfig();
const log = createLogger("api").child({ device: config.device });
installProcessHandlers(log);
assertTokens(config);

const app = await openApp(config, { log });
const { http, hub } = createHttpApp(app);
const server = http.listen(config.port, config.host);
await new Promise<void>((resolve, reject) => {
  server.once("listening", resolve);
  server.once("error", reject);
});
server.keepAliveTimeout = 65_000;
// Publishing goes through the extension in the everyday Chrome; without this port a publish says the bridge is off.
await bridge.listen().catch((error) => log.warn("bridge.listen_failed", { error: String(error) }));
const model = await app.mainModel();
const piDurable = packageVersion("@earendil-works/pi-durable");
log.info("api.listening", {
  host: config.host,
  port: config.port,
  piDurable,
  device: config.device,
  mode: config.mode,
  provider: config.provider,
  searchMode: app.search.mode,
  jev: config.jevBackend,
  model: model.id,
  window: model.window,
  dataDir: config.dataDir,
});
console.log(
  `dna-server-api on http://${config.host}:${config.port} (${config.device}, ${config.mode}, search ${app.search.mode}, model ${model.id}, pi-durable ${piDurable})`,
);

let stopping = false;
async function shutdown(signal: string) {
  if (stopping) return;
  stopping = true;
  log.info("api.stopping", { signal, streams: hub.size });
  hub.closeAll();
  server.closeIdleConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await app.close();
  log.info("api.stopped", { signal });
  process.exit(0);
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
