// The local service: this Mac runs the API and the browser hub as launchd agents (dev.dna.api, dev.dna.hub) that start
// at login and come back when they exit, from the same plist templates a mini uses. The hub listens on 127.0.0.1
// only and serves the built app. The tick stays the crontab line (`just cron install`). With JEV_BACKEND=ollama the
// local decision model's Ollama server is a third agent (dev.dna.ollama, on JEV_OLLAMA_URL's port, running
// JEV_OLLAMA_BIN), started first; a code change does not restart it.
//   install    build the app, write both plists, (re)load them, wait until both answer
//   restart    rebuild the app and restart both (after a code change)
//   uninstall  unload both and remove the plists
//   status     each agent's state and pid, and whether it answers
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { loadRootEnv, repoRoot } from "@dna/sdk/node";
import { fill, HUB_LABEL, LABEL } from "./remote.ts";

loadRootEnv();
const root = repoRoot();
const uid = process.getuid?.() ?? 0;
const apiPort = Number(process.env.DNA_PORT ?? 4850);
const hubPort = Number(process.env.DNA_HUB_PORT ?? 4851);
const agentsDir = join(homedir(), "Library", "LaunchAgents");
const plistOf = (label: string) => join(agentsDir, `${label}.plist`);

const nodeDir = dirname(process.execPath);
const PATH = [
  nodeDir,
  join(homedir(), ".local/bin"),
  "/opt/homebrew/bin",
  "/usr/local/bin",
  "/usr/bin",
  "/bin",
  "/usr/sbin",
  "/sbin",
].join(":");
const base = { NODE: process.execPath, HOME: homedir(), PATH };

type Service = {
  label: string;
  port: number;
  health: string;
  template: string;
  values: Record<string, string>;
  /** Restarted by `restart` (a code change); Ollama is not, so its model stays loaded. */
  code?: boolean;
};

const OLLAMA_LABEL = "dev.dna.ollama";
const ollama = (): Service[] => {
  if (process.env.JEV_BACKEND !== "ollama") return [];
  const url = new URL(process.env.JEV_OLLAMA_URL?.trim() || "http://127.0.0.1:11434/v1/systemone");
  return [
    {
      label: OLLAMA_LABEL,
      port: Number(url.port || 11434),
      health: `${url.origin}/api/version`,
      template: join(root, "apps/dna-server-api/deploy/dna-ollama.plist"),
      values: {
        ...base,
        LABEL: OLLAMA_LABEL,
        OLLAMA_BIN: process.env.JEV_OLLAMA_BIN?.trim() || "/usr/local/bin/ollama",
        OLLAMA_HOST: url.host,
        LOG: join(root, "logs/ollama.out"),
      },
    },
  ];
};

const services: Service[] = [
  ...ollama(),
  {
    code: true,
    label: LABEL,
    port: apiPort,
    health: `http://127.0.0.1:${apiPort}/healthz`,
    template: join(root, "apps/dna-server-api/deploy/dna-api.plist"),
    values: {
      ...base,
      LABEL,
      APP: join(root, "apps/dna-server-api"),
      LOG: join(root, "logs/api.out"),
    },
  },
  {
    code: true,
    label: HUB_LABEL,
    port: hubPort,
    health: `http://127.0.0.1:${hubPort}/hub/healthz`,
    template: join(root, "apps/dna-client-browser/deploy/dna-hub.plist"),
    values: {
      ...base,
      LABEL: HUB_LABEL,
      APP: join(root, "apps/dna-client-browser"),
      LOG: join(root, "logs/hub.out"),
      DEVICE: "local",
      HUB_HOST: "127.0.0.1",
      HUB_PORT: String(hubPort),
      HUB_HOSTS: "",
      API_URL: `http://127.0.0.1:${apiPort}`,
    },
  },
];

const run = (cmd: string, args: string[], cwd?: string) =>
  spawnSync(cmd, args, { cwd, encoding: "utf8" });

/** The agent's pid, if launchd has it loaded and running. */
function agentPid(label: string): number | undefined {
  const r = run("launchctl", ["print", `gui/${uid}/${label}`]);
  if (r.status !== 0) return undefined;
  const pid = r.stdout.match(/^\s*pid = (\d+)/m)?.[1];
  return pid ? Number(pid) : undefined;
}
const loaded = (label: string) => run("launchctl", ["print", `gui/${uid}/${label}`]).status === 0;

/** Processes listening on the port that are not the agent itself (a dev server or a terminal run). */
function strangers(port: number, label: string): number[] {
  const mine = agentPid(label);
  return run("lsof", ["-ti", `tcp:${port}`, "-sTCP:LISTEN"])
    .stdout.split("\n")
    .map(Number)
    .filter((pid) => pid && pid !== mine);
}

async function answers(url: string, ms: number): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try {
      if ((await fetch(url, { signal: AbortSignal.timeout(2000) })).ok) return true;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
}

function build(): void {
  const r = spawnSync("npm", ["run", "build"], {
    cwd: join(root, "apps/dna-client-browser"),
    stdio: "inherit",
  });
  if (r.status !== 0) throw new Error("Building the browser app failed; nothing was changed");
}

async function waitUp(): Promise<boolean> {
  let ok = true;
  for (const s of services) {
    const up = await answers(s.health, 60_000);
    console.log(`${up ? "up  " : "DOWN"}  ${s.label} on 127.0.0.1:${s.port}`);
    ok &&= up;
  }
  if (!ok) console.log(`See ${join(root, "logs/api.out")} and ${join(root, "logs/hub.out")}`);
  return ok;
}

async function install(): Promise<boolean> {
  for (const s of services) {
    const held = strangers(s.port, s.label);
    if (held.length)
      throw new Error(
        `Port ${s.port} is held by pid ${held.join(", ")}, not by ${s.label}. Stop that process first (a just api run or just browser dev).`,
      );
  }
  build();
  mkdirSync(agentsDir, { recursive: true });
  mkdirSync(join(root, "logs"), { recursive: true });
  for (const s of services) {
    writeFileSync(plistOf(s.label), fill(readFileSync(s.template, "utf8"), s.values));
    run("launchctl", ["bootout", `gui/${uid}/${s.label}`]);
    for (let i = 0; i < 30 && loaded(s.label); i++) await new Promise((r) => setTimeout(r, 1000));
    const r = run("launchctl", ["bootstrap", `gui/${uid}`, plistOf(s.label)]);
    if (r.status !== 0)
      throw new Error(`launchctl bootstrap ${s.label} failed: ${r.stderr.trim()}`);
  }
  return waitUp();
}

async function restart(): Promise<boolean> {
  if (!services.every((s) => loaded(s.label)))
    throw new Error("The service is not installed. Run: just net service install");
  build();
  for (const s of services)
    if (s.code) run("launchctl", ["kickstart", "-k", `gui/${uid}/${s.label}`]);
  return waitUp();
}

function uninstall(): void {
  for (const s of services) {
    run("launchctl", ["bootout", `gui/${uid}/${s.label}`]);
    if (existsSync(plistOf(s.label))) rmSync(plistOf(s.label));
    console.log(`removed ${s.label}`);
  }
}

async function status(): Promise<boolean> {
  let ok = true;
  for (const s of services) {
    const pid = agentPid(s.label);
    const up = await answers(s.health, 2500);
    console.log(
      `${s.label}: ${loaded(s.label) ? (pid ? `running, pid ${pid}` : "loaded, not running") : "not installed"}, ${up ? "answers" : "no answer"} on 127.0.0.1:${s.port}`,
    );
    ok &&= up && !!pid;
  }
  return ok;
}

const action = process.argv[2] ?? "status";
try {
  if (action === "install") process.exit((await install()) ? 0 : 1);
  else if (action === "restart") process.exit((await restart()) ? 0 : 1);
  else if (action === "uninstall") uninstall();
  else if (action === "status") process.exit((await status()) ? 0 : 1);
  else {
    console.error(`Unknown action ${action}. Use install, restart, uninstall or status.`);
    process.exit(2);
  }
} catch (e) {
  console.error((e as Error).message);
  process.exit(1);
}
