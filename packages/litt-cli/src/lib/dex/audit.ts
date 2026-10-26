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
 *
 * Rotation and append run under an O_EXCL lockfile so concurrent
 * processes (the agent and separately invoked `litt dex` verbs) never
 * interleave a mid-rotation file: a peer waits — bounded — for the
 * holder, and a lock whose holder died is reclaimed once stale.
 */

import { appendFileSync, closeSync, existsSync, openSync, renameSync, statSync, unlinkSync, writeSync } from "node:fs";
import { join } from "node:path";
import { redact } from "../secret-redaction.js";
import { warn } from "../utils.js";
import { dexHome } from "./dex-home.js";

/** Bounded retention: at most `MAX_BYTES` live + `MAX_BACKUPS` rotated files. */
export const AUDIT_MAX_BYTES = 10 * 1024 * 1024; // 10 MB
export const AUDIT_MAX_BACKUPS = 3;

/** Cross-process coordination: wait at most WAIT for a peer's critical
 * section, and reclaim a lock whose holder died (mtime older than STALE). */
export const AUDIT_LOCK_WAIT_MS = 2_000;
export const AUDIT_LOCK_STALE_MS = 30_000;
const AUDIT_LOCK_POLL_MS = 10;

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

export function auditLockPath(path = auditLogPath()): string {
  return `${path}.lock`;
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
  /** Test seams — override the rotation cap and backup count. */
  maxBytes?: number;
  maxBackups?: number;
}

const sleepBuf = new Int32Array(new SharedArrayBuffer(4));
function syncPause(ms: number): void {
  Atomics.wait(sleepBuf, 0, 0, ms);
}

export interface AuditLockOpts {
  waitMs?: number;
  staleMs?: number;
  pollMs?: number;
}

/**
 * Run `fn` while holding `path`'s lockfile. The lock is an exclusive
 * `wx` create — atomic on every target platform (CreateFile CREATE_NEW
 * on Windows). A peer that finds the lock held waits up to `waitMs`
 * (poll intervals), reclaiming it only when it is older than `staleMs`
 * — i.e. its holder died mid-write. On timeout the EEXIST propagates so
 * the caller degrades honestly rather than racing through.
 */
export function auditWithLock<T>(path: string, fn: () => T, opts: AuditLockOpts = {}): T {
  const waitMs = opts.waitMs ?? AUDIT_LOCK_WAIT_MS;
  const staleMs = opts.staleMs ?? AUDIT_LOCK_STALE_MS;
  const pollMs = opts.pollMs ?? AUDIT_LOCK_POLL_MS;
  const lock = auditLockPath(path);
  const deadline = Date.now() + waitMs;
  for (;;) {
    let fd: number;
    try {
      fd = openSync(lock, "wx", 0o600);
    } catch (err) {
      if ((err as NodeJS.ErrnoException | null)?.code !== "EEXIST") throw err;
      try {
        if (Date.now() - statSync(lock).mtimeMs > staleMs) {
          unlinkSync(lock); // abandoned lock — holder died mid-write
          continue;
        }
      } catch {
        /* stat/unlink raced with another waiter — loop and re-try */
      }
      if (Date.now() >= deadline) throw err;
      syncPause(pollMs);
      continue;
    }
    // Lock acquired. The fd stays OPEN through the section: on Windows an
    // open lock cannot be unlinked by a stale-reclaimer at all (EPERM),
    // and everywhere it proves the lock is owned by a live process.
    try {
      writeSync(fd, String(process.pid)); // diagnosis aid, not security
    } catch {
      /* pid write is best-effort */
    }
    // Test seam: widen the held window so a second process is provably
    // blocked on the lock (mirrors LITT_SESSIONS_LOCK_HOLD_MS).
    const holdMs = Number(process.env.LITT_DEX_AUDIT_LOCK_HOLD_MS ?? 0);
    try {
      if (holdMs > 0) syncPause(holdMs);
      return fn();
    } finally {
      closeSync(fd); // close BEFORE unlink — an open file cannot be removed on Windows
      try {
        unlinkSync(lock);
      } catch {
        /* released — a recovering waiter may already own it */
      }
    }
  }
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
    const rotateAndWrite = () => {
      rotateAuditIfNeeded(path, deps.maxBytes, deps.maxBackups);
      write(path, JSON.stringify(line) + "\n", "utf-8");
    };
    // The real on-disk path serializes rotation+append under the lockfile
    // so concurrent processes never see a half-rotated log; an injected
    // sink runs lock-free for tests.
    if (deps.write) rotateAndWrite();
    else auditWithLock(path, rotateAndWrite);
  } catch (err) {
    // Diagnostics must never break on audit failure — warn once,
    // sanitized, then keep serving truthful results.
    if (!warned) {
      warned = true;
      (deps.onWarn ?? warn)(sanitizedWarn(err));
    }
  }
}
