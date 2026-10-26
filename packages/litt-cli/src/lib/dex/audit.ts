/**
 * Dex audit log — append-only JSONL under <LiTT home>/dex/.
 *
 * Every dex verb writes one record: what was asked, whether it worked,
 * how long it took. Details pass through the CLI's canonical secret
 * redaction before hitting disk — a diagnostic that echoes an env value
 * can never become a secret store.
 *
 * If the write fails, diagnostics keep working: a sanitized warning is
 * emitted once per process. The warning carries only the errno code —
 * never the raw exception message, which could contain file content or
 * other sensitive detail.
 */

import { appendFileSync, existsSync, renameSync, statSync } from "node:fs";
import { join } from "node:path";
import { redact } from "../secret-redaction.js";
import { warn } from "../utils.js";
import { dexHome } from "./dex-home.js";

/** Bounded retention: at most `MAX_BYTES` live + `MAX_BACKUPS` rotated files. */
export const AUDIT_MAX_BYTES = 10 * 1024 * 1024; // 10 MB
export const AUDIT_MAX_BACKUPS = 3;

export interface DexAuditRecord {
  ts: string;
  verb: string;
  ok: boolean;
  ms: number;
  /** Free-form result detail — secret-redacted before write. */
  detail?: string;
}

export function auditLogPath(): string {
  return join(dexHome(), "audit.jsonl");
}

let warned = false;

/** Errno code only — raw messages may carry paths/content, never emit. */
function sanitizedWarn(err: unknown): string {
  const code = (err as NodeJS.ErrnoException | null)?.code ?? "ERR";
  return `Dex audit write failed (${String(code)}) — diagnostics continue but are not being recorded.`;
}

export interface AuditDeps {
  /** Injectable sink for tests. */
  write?: (path: string, data: string, encoding: "utf-8") => void;
  /** Injectable warning sink for tests. */
  onWarn?: (msg: string) => void;
}

/**
 * Rotate audit.jsonl → audit.N.jsonl when it exceeds AUDIT_MAX_BYTES.
 * Shifts backups audit.1→.2→.3 and drops the oldest — the log is
 * bounded, the newest records always survive. Rotation failure degrades
 * to "keep appending", never to losing diagnostics.
 */
export function rotateAuditIfNeeded(
  path = auditLogPath(),
  maxBytes = AUDIT_MAX_BYTES,
  maxBackups = AUDIT_MAX_BACKUPS,
): boolean {
  try {
    if (!existsSync(path) || statSync(path).size < maxBytes) return false;
    for (let i = maxBackups; i >= 1; i--) {
      const src = i === 1 ? path : `${path}.${i - 1}`;
      const dst = `${path}.${i}`;
      if (existsSync(src)) renameSync(src, dst);
    }
    return true;
  } catch {
    return false;
  }
}

export function audit(record: Omit<DexAuditRecord, "ts">, deps: AuditDeps = {}): void {
  const write = deps.write ?? appendFileSync;
  const line: DexAuditRecord = {
    ts: new Date().toISOString(),
    verb: record.verb,
    ok: record.ok,
    ms: Math.round(record.ms),
    detail: record.detail === undefined ? undefined : redact(record.detail),
  };
  try {
    const path = auditLogPath();
    rotateAuditIfNeeded(path);
    write(path, JSON.stringify(line) + "\n", "utf-8");
  } catch (err) {
    // Diagnostics must never break on audit failure — warn once,
    // sanitized, then keep serving truthful results.
    if (!warned) {
      warned = true;
      (deps.onWarn ?? warn)(sanitizedWarn(err));
    }
  }
}
