/**
 * Dex audit log — append-only JSONL under ~/.litt/dex/.
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

import { appendFileSync } from "node:fs";
import { join } from "node:path";
import { redact } from "../secret-redaction.js";
import { warn } from "../utils.js";
import { dexHome } from "./dex-home.js";

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
    write(auditLogPath(), JSON.stringify(line) + "\n", "utf-8");
  } catch (err) {
    // Diagnostics must never break on audit failure — warn once,
    // sanitized, then keep serving truthful results.
    if (!warned) {
      warned = true;
      (deps.onWarn ?? warn)(sanitizedWarn(err));
    }
  }
}
