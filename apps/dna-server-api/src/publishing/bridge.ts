// The workbench's side of the 工作台发帖桥 extension in the everyday Chrome: a loopback server the extension long-polls
// for one command at a time. Web pages cannot use it: the extension sends a header a page can't send cross-site without
// a preflight this server refuses, and a page reaching it through a rebound name fails the Host check. A command that
// times out is taken off the queue, so it can never run later, after it was reported as failed.
import http from "node:http";

export const BRIDGE_PORT = 4860;
const POLL_MS = 20_000;
const COMMAND_MS = 90_000;
/** The extension wakes at least every 30 seconds, so longer than that means it is not there. */
const PING_MS = 35_000;

interface Command {
  id: number;
  op: string;
  args: unknown;
}

export class Bridge {
  private server?: http.Server;
  private waiter?: (c: Command) => void;
  private queue: Command[] = [];
  private next = 0;
  private readonly pending = new Map<number, (m: any) => void>();

  /** Resolves with the port; `port` 0 picks a free one. */
  listen(port = BRIDGE_PORT): Promise<number> {
    const server = http.createServer((req, res) => this.handle(req, res, port));
    this.server = server;
    return new Promise((ok, fail) => {
      server.once("error", fail);
      server.listen(port, "127.0.0.1", () => {
        const at = server.address();
        ok(typeof at === "object" && at ? at.port : port);
      });
    });
  }

  close(): void {
    this.server?.closeAllConnections();
    this.server?.close();
  }

  private handle(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    port: number,
  ) {
    const hostOk = port === 0 || req.headers.host === `127.0.0.1:${port}`;
    if (req.headers["x-dna-bridge"] !== "1" || !hostOk) {
      res.writeHead(403);
      res.end();
      return;
    }
    if (req.method === "GET" && req.url === "/bridge/next") {
      const send = (c: Command) => {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify(c));
      };
      const first = this.queue.shift();
      if (first) return send(first);
      const waiter = (c: Command) => {
        clearTimeout(timer);
        send(c);
      };
      const timer = setTimeout(() => {
        if (this.waiter === waiter) this.waiter = undefined;
        res.writeHead(204);
        res.end();
      }, POLL_MS);
      req.on("close", () => {
        if (this.waiter === waiter && !res.writableEnded) {
          clearTimeout(timer);
          this.waiter = undefined;
        }
      });
      this.waiter = waiter;
      return;
    }
    if (req.method === "POST" && req.url === "/bridge/result") {
      let body = "";
      req.on("data", (d) => (body += d));
      req.on("end", () => {
        try {
          const m = JSON.parse(body);
          this.pending.get(m.id)?.(m);
          this.pending.delete(m.id);
        } catch {}
        res.end("ok");
      });
      return;
    }
    res.writeHead(404);
    res.end();
  }

  /** Run one operation in the extension. Rejects with its error, or on timeout. */
  command<T = any>(
    op: string,
    args: unknown = {},
    ms = COMMAND_MS,
  ): Promise<T> {
    return new Promise((ok, fail) => {
      const c: Command = { id: ++this.next, op, args };
      const timer = setTimeout(() => {
        this.pending.delete(c.id);
        this.queue = this.queue.filter((q) => q !== c);
        fail(new Error(`no answer from the extension: ${op}`));
      }, ms);
      this.pending.set(c.id, (m) => {
        clearTimeout(timer);
        if (m.ok) ok(m.result);
        else fail(new Error(`${op}: ${String(m.error).slice(0, 200)}`));
      });
      const w = this.waiter;
      this.waiter = undefined;
      if (w) w(c);
      else this.queue.push(c);
    });
  }

  /** Throws, saying what to do, unless the extension answers. */
  async ensure(ms = PING_MS): Promise<void> {
    if (!this.server) throw new Error("工作台发帖桥没有启动");
    await this.command("ping", {}, ms).catch(() => {
      throw new Error(
        "Chrome 里的工作台发帖桥没连上：确认 Chrome 开着、扩展已启用（更新后要在 chrome://extensions 点重新加载）",
      );
    });
  }
}

export const bridge = new Bridge();
