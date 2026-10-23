// Repo root and the root .env. Every app reads the same .env; devices get a copy with env_keys only.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

let root: string | undefined;

/** The checkout root: the nearest directory above this file with the justfile (DNA_HOME overrides). */
export function repoRoot(): string {
  if (process.env.DNA_HOME) return resolve(process.env.DNA_HOME);
  if (root) return root;
  let dir = dirname(fileURLToPath(import.meta.url));
  while (!existsSync(join(dir, "justfile")) && dirname(dir) !== dir) dir = dirname(dir);
  root = existsSync(join(dir, "justfile"))
    ? dir
    : resolve(dirname(fileURLToPath(import.meta.url)), "../../../../../..");
  return root;
}

export function loadRootEnv(file = join(repoRoot(), ".env")): boolean {
  if (!existsSync(file)) return false;
  process.loadEnvFile(file);
  fillFromKeychain();
  return true;
}

/** `DNA_KEYCHAIN="VAR=service,VAR2=service2"`: the variables to read from macOS keychain items. */
export function keychainSpec(spec = process.env.DNA_KEYCHAIN ?? ""): [string, string][] {
  return spec
    .split(",")
    .map((pair) => pair.split("=").map((s) => s.trim()))
    .filter((p): p is [string, string] => p.length === 2 && !!p[0] && !!p[1]);
}

const securityLookup = (service: string): string | undefined => {
  const r = spawnSync("/usr/bin/security", ["find-generic-password", "-s", service, "-w"], {
    encoding: "utf8",
    timeout: 10_000,
  });
  return r.status === 0 ? r.stdout.trim() || undefined : undefined;
};

/**
 * Fill each unset variable DNA_KEYCHAIN names from its keychain item, the way a login shell would, so a launchd
 * service has the keys a terminal has without copying them into .env. Returns the variables it filled.
 */
export function fillFromKeychain(
  env: NodeJS.ProcessEnv = process.env,
  lookup: (service: string) => string | undefined = securityLookup,
): string[] {
  if (lookup === securityLookup && process.platform !== "darwin") return [];
  const filled: string[] = [];
  for (const [name, service] of keychainSpec(env.DNA_KEYCHAIN ?? "")) {
    if (env[name]?.trim()) continue;
    const value = lookup(service);
    if (value) {
      env[name] = value;
      filled.push(name);
    }
  }
  return filled;
}

export function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is not set. Add it to ${join(repoRoot(), ".env")}.`);
  return value;
}
