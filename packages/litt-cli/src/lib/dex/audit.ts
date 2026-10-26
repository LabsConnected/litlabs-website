/**
 * Dex audit log — append-only JSONL under ~/.litt/dex/.
 *
 * Every dex verb writes one record: what was asked, whether it worked,
 * how long it took. Details pass through the CLI's canonical secret
 * redaction before hitting disk — a diagnostic that echoes an env value
 * can never become a secret store.
 */

import { appendFileSync } from "node:fs";
import { join } from "node:path";
import { redact } from "../secret-redaction.js";
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

export function audit(record: Omit<DexAuditRecord, "ts">): void {
  const line: DexAuditRecord = {
    ts: new Date().toISOString(),
    verb: record.verb,
    ok: record.ok,
    ms: Math.round(record.ms),
    detail: record.detail === undefined ? undefined : redact(record.detail),
  };
  try {
    appendFileSync(auditLogPath(), JSON.stringify(line) + "\n", "utf-8");
  } catch {
    // Audit must never break the diagnostic itself — a full/locked disk
    // degrades to "no audit", which is visible in the file's absence.
  }
}
