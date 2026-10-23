// Credentials shared with pi through its auth.json (~/.pi/agent/auth.json): one credential per provider, the same
// shape pi writes. Every change runs under pi's own lock (proper-lockfile on the file, 30 s stale), so an OAuth
// refresh here rotates the refresh token for pi too instead of racing it.
import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import type {
  AuthOperationOptions,
  Credential,
  CredentialInfo,
  CredentialStore,
} from "@earendil-works/pi-ai";
import lockfile from "proper-lockfile";

const STALE_MS = 30_000;

/** `~/x` and relative paths to an absolute path. */
export function expandHome(path: string): string {
  return resolve(path.startsWith("~/") ? `${homedir()}${path.slice(1)}` : path);
}

export class AuthFileStore implements CredentialStore {
  readonly path: string;

  constructor(path: string) {
    this.path = expandHome(path);
  }

  private parse(text: string | undefined): Record<string, Credential> {
    if (!text?.trim()) return {};
    const data = JSON.parse(text) as unknown;
    return data && typeof data === "object" ? (data as Record<string, Credential>) : {};
  }

  private load(): Record<string, Credential> {
    return existsSync(this.path) ? this.parse(readFileSync(this.path, "utf8")) : {};
  }

  /** Waits for pi's lock up to the stale window, then runs fn on the file's current content. */
  private async locked<T>(
    fn: (
      data: Record<string, Credential>,
    ) => Promise<{ result: T; next?: Record<string, Credential> }>,
    options?: AuthOperationOptions,
  ): Promise<T> {
    if (!existsSync(this.path)) writeFileSync(this.path, "{}", { mode: 0o600 });
    const deadline = Date.now() + STALE_MS;
    let release: () => Promise<void>;
    for (let attempt = 0; ; attempt++) {
      options?.signal?.throwIfAborted();
      try {
        release = await lockfile.lock(this.path, { realpath: false, retries: 0, stale: STALE_MS });
        break;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ELOCKED" || Date.now() > deadline)
          throw error;
        await new Promise((ok) => setTimeout(ok, Math.min(10 * 2 ** attempt, 1_000)));
      }
    }
    try {
      const { result, next } = await fn(this.load());
      if (next) {
        writeFileSync(this.path, JSON.stringify(next, null, 2), { mode: 0o600 });
        chmodSync(this.path, 0o600);
      }
      return result;
    } finally {
      await release();
    }
  }

  async read(providerId: string): Promise<Credential | undefined> {
    return this.load()[providerId];
  }

  async list(): Promise<readonly CredentialInfo[]> {
    return Object.entries(this.load()).map(([providerId, c]) => ({ providerId, type: c.type }));
  }

  modify(
    providerId: string,
    fn: (current: Credential | undefined) => Promise<Credential | undefined>,
    options?: AuthOperationOptions,
  ): Promise<Credential | undefined> {
    return this.locked(async (data) => {
      const next = await fn(data[providerId]);
      if (next === undefined) return { result: data[providerId] };
      return { result: next, next: { ...data, [providerId]: next } };
    }, options);
  }

  delete(providerId: string, options?: AuthOperationOptions): Promise<void> {
    return this.locked(async (data) => {
      const { [providerId]: _gone, ...rest } = data;
      return { result: undefined, next: rest };
    }, options);
  }
}
