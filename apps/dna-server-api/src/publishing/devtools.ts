// A small chrome-devtools-mcp client over stdio JSON-RPC, attached to the logged-in Chrome on 127.0.0.1:9333. The
// same tool calls the old publish scripts made (list_pages, navigate_page, type_text, upload_file, evaluate_script),
// pinned to one version. Page functions return key=value strings: the MCP wraps results in prose and a code fence.
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const CALL_TIMEOUT_MS = 120_000;

export const sleep = (ms: number) => new Promise((ok) => setTimeout(ok, ms));

function binPath(): string {
  const pkg = createRequire(import.meta.url).resolve("chrome-devtools-mcp/package.json");
  return join(dirname(pkg), "build", "src", "bin", "chrome-devtools-mcp.js");
}

export class Devtools {
  private child?: ChildProcessWithoutNullStreams;
  private buffer = "";
  private next = 0;
  private readonly pending = new Map<number, (msg: any) => void>();

  constructor(private readonly opts: { browserUrl: string; filesystemRoot?: string }) {}

  async start(): Promise<void> {
    const args = [binPath(), "--browserUrl", this.opts.browserUrl, "--no-usage-statistics"];
    if (this.opts.filesystemRoot) args.push("--filesystemRoot", this.opts.filesystemRoot);
    const child = spawn(process.execPath, args, { stdio: ["pipe", "pipe", "pipe"] });
    this.child = child;
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      this.buffer += chunk;
      let i: number;
      while ((i = this.buffer.indexOf("\n")) >= 0) {
        const line = this.buffer.slice(0, i).trim();
        this.buffer = this.buffer.slice(i + 1);
        if (!line) continue;
        try {
          const msg = JSON.parse(line);
          const done = msg.id !== undefined ? this.pending.get(msg.id) : undefined;
          if (done) {
            this.pending.delete(msg.id);
            done(msg);
          }
        } catch {}
      }
    });
    child.stderr.resume();
    await this.rpc("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "dna-publish", version: "1" },
    });
    this.child.stdin.write(
      `${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`,
    );
  }

  private rpc(method: string, params: unknown): Promise<any> {
    const child = this.child;
    if (!child) return Promise.reject(new Error("devtools not started"));
    const id = ++this.next;
    return new Promise((ok, fail) => {
      const timer = setTimeout(() => {
        if (this.pending.delete(id)) fail(new Error(`devtools timeout: ${method}`));
      }, CALL_TIMEOUT_MS);
      this.pending.set(id, (msg) => {
        clearTimeout(timer);
        ok(msg);
      });
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    });
  }

  /** One tool call's text. Tool errors throw. */
  async tool(name: string, args: Record<string, unknown> = {}): Promise<string> {
    const r = await this.rpc("tools/call", { name, arguments: args });
    if (r.error) throw new Error(`${name}: ${String(r.error.message ?? r.error).slice(0, 200)}`);
    const text = r.result?.content?.[0]?.text ?? "";
    if (r.result?.isError) throw new Error(`${name}: ${String(text).slice(0, 200)}`);
    return String(text);
  }

  /** Run a page function and pull fields out of its key=value result. */
  async probe(pageId: number, fn: string, pattern: RegExp): Promise<string[] | undefined> {
    const raw = await this.tool("evaluate_script", { pageId, function: fn });
    return raw.match(pattern)?.slice(1);
  }

  /** list_pages lines are "<id>: <title> (<url>) [selected]"; the url is the last parenthesised part. */
  async pages(): Promise<{ id: number; url: string }[]> {
    return parsePages(await this.tool("list_pages"));
  }

  close(): void {
    for (const done of this.pending.values()) done({ error: { message: "devtools closed" } });
    this.pending.clear();
    this.child?.kill();
    this.child = undefined;
  }
}

export function parsePages(text: string): { id: number; url: string }[] {
  return [...text.matchAll(/^\s*(\d+): (.*)$/gm)].map((m) => {
    const line = m[2]!.replace(/\s*\[selected\]\s*$/, "");
    return { id: Number(m[1]), url: line.match(/\((\S+)\)$/)?.[1] ?? line };
  });
}
