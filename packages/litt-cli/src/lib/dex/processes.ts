/**
 * Dex process listing — structured `tasklist` on Windows.
 *
 * Structured argv (execFile, no shell), CSV output parsed locally.
 * On non-Windows platforms reports an honest "unavailable" result —
 * Dex Stage 1A is a Windows monitor; it does not pretend otherwise.
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

type ExecFileImpl = (
  cmd: string,
  args: string[],
  cb: (err: Error | null, stdout: string, stderr: string) => void,
) => void;

/**
 * List top `limit` processes by working set. `run` is injectable for
 * tests; defaults to child_process.execFile.
 */
export async function listProcesses(
  limit = 15,
  run: ExecFileImpl = execFile,
): Promise<ProcessListResult> {
  if (process.platform !== "win32") {
    return {
      ok: false,
      reason: `process listing uses Windows tasklist; this platform is ${process.platform}`,
    };
  }
  return new Promise((resolve) => {
    run("tasklist.exe", ["/fo", "csv", "/nh"], (err, stdout) => {
      if (err) {
        resolve({ ok: false, reason: `tasklist failed: ${err.message}` });
        return;
      }
      const rows = parseTasklistCsv(stdout);
      resolve({ ok: true, platform: "win32", total: rows.length, top: rows.slice(0, limit) });
    });
  });
}
