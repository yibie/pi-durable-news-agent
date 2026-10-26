// A macOS notification: the publish line posts while nobody watches the workbench, so how it went shows on the desktop.
// Best effort: osascript failing (no GUI session, a sandbox) only loses the notification.
import { execFile } from "node:child_process";

const quoted = (s: string) => `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').slice(0, 300)}"`;

export function macNotify(title: string, text: string): void {
  execFile(
    "/usr/bin/osascript",
    ["-e", `display notification ${quoted(text)} with title ${quoted(title)}`],
    { timeout: 10_000 },
    () => {},
  );
}
