/**
 * Dex process listing — structured `tasklist` on Windows.
 *
 * Structured argv (execFile, no shell), CSV output parsed locally,
 * bounded by a hard subprocess timeout. On non-Windows platforms
 * reports an honest "unavailable" result — Dex Stage 1A is a Windows
 * monitor; it does not pretend otherwise.
 */

import { execFile } from "node:child_process";

export interface ProcessRow {
  name: string;
  pid: number;
  /** Working set in KB, parsed from tasklist's "1,234 K" column. */
  memKb: number;
}

export type ProcessListResult =
  | { ok: true; platform: "win32"; total: number; top: ProcessRow[] }
  | { ok: false; reason: string };

/** Parse `tasklist /fo csv /nh` output. Exported for tests. */
export function parseTasklistCsv(csv: string): ProcessRow[] {
  const rows: ProcessRow[] = [];
  for (const line of csv.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('"')) continue;
    // "name.exe","1234","Console","1","12,345 K"
    const cols = trimmed.split('","');
    if (cols.length < 5) continue;
    const name = cols[0].replace(/^"/, "");
    const pid = Number(cols[1]);
    const memKb = Number(cols[4].replace(/[^\d]/g, ""));
    if (!name || !Number.isFinite(pid)) continue;
    rows.push({ name, pid, memKb: Number.isFinite(memKb) ? memKb : 0 });
  }
  return rows.sort((a, b) => b.memKb - a.memKb);
}

type ExecCallback = (
  err: (Error & { killed?: boolean; code?: string | number }) | null,
  stdout: string,
  stderr: string,
) => void;

type ExecFileImpl = (
  cmd: string,
  args: string[],
  options: { timeout: number },
  cb: ExecCallback,
) => void;

export interface ListProcessesOptions {
  run?: ExecFileImpl;
  /** Injectable platform — tests exercise the Windows path anywhere. */
  platform?: NodeJS.Platform;
  /** Hard cap on the tasklist child. Default 10s. */
  timeoutMs?: number;
  limit?: number;
}

/** List top `limit` processes by working set. */
export async function listProcesses(opts: ListProcessesOptions = {}): Promise<ProcessListResult> {
  const {
    run = execFile as ExecFileImpl,
    platform = process.platform,
    timeoutMs = 10_000,
    limit = 15,
  } = opts;
  if (platform !== "win32") {
    return {
      ok: false,
      reason: `process listing uses Windows tasklist; this platform is ${platform}`,
    };
  }
  return new Promise((resolve) => {
    run("tasklist.exe", ["/fo", "csv", "/nh"], { timeout: timeoutMs }, (err, stdout) => {
      if (err) {
        const timedOut = err.killed === true || err.code === "ETIMEDOUT";
        resolve({
          ok: false,
          reason: timedOut
            ? `tasklist timed out after ${timeoutMs}ms and was terminated`
            : `tasklist failed: ${err.message}`,
        });
        return;
      }
      const rows = parseTasklistCsv(stdout);
      resolve({ ok: true, platform: "win32", total: rows.length, top: rows.slice(0, limit) });
    });
  });
}
