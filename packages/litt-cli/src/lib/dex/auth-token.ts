/**
 * Dex agent bearer token — mint, store (ACL-hardened), verify.
 *
 * 256-bit random token per install. Stored under <LiTT home>/dex/ with the
 * tightest local permissions available: owner-only ACL via icacls on
 * Windows (structured argv, no shell), mode 0600 elsewhere.
 * Verification compares SHA-256 digests through timingSafeEqual so a
 * malformed/mismatched token never leaks length or prefix information.
 */

import { execFileSync } from "node:child_process";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { warn } from "../utils.js";
import { dexHome } from "./dex-home.js";

const TOKEN_FILE = "agent-token";

export function tokenPath(): string {
  return join(dexHome(), TOKEN_FILE);
}

function restrictTokenFile(path: string): { ok: boolean; reason?: string } {
  if (process.platform === "win32") {
    // Owner-only ACL: strip inheritance, grant the current user full,
    // nobody else anything. Structured argv — path is ours, never
    // caller-controlled.
    const user = process.env.USERNAME ?? process.env.USER ?? "";
    try {
      execFileSync("icacls.exe", [path, "/inheritance:r", "/grant:r", `${user}:F`], {
        stdio: "pipe",
        timeout: 5_000,
      });
      return { ok: true };
    } catch (err) {
      // Honest degradation: errno/syscall only — never the raw message.
      const code = (err as NodeJS.ErrnoException | null)?.code ?? "ERR";
      return { ok: false, reason: `icacls failed (${String(code)})` };
    }
  }
  try {
    chmodSync(path, 0o600);
    return { ok: true };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException | null)?.code ?? "ERR";
    return { ok: false, reason: `chmod failed (${String(code)})` };
  }
}

/** True once per process — the ACL-degraded warning fires once. */
let aclWarned = false;

/** Load the existing token or mint+persist a new one. Never logged. */
export function loadOrCreateToken(): string {
  const path = tokenPath();
  if (existsSync(path)) {
    const existing = readFileSync(path, "utf-8").trim();
    if (existing.length >= 32) {
      reportAclResult(restrictTokenFile(path)); // re-assert on every start
      return existing;
    }
  }
  const token = randomBytes(32).toString("hex");
  writeFileSync(path, token, { encoding: "utf-8", mode: 0o600 });
  reportAclResult(restrictTokenFile(path));
  return token;
}

function reportAclResult(result: { ok: boolean; reason?: string }): void {
  if (result.ok || aclWarned) return;
  aclWarned = true;
  // Honest degradation — sanitized reason only, token never appears.
  warn(`Dex token file could not be ACL-restricted (${result.reason ?? "unknown"}) — it remains inside the user profile directory.`);
}

/**
 * Timing-safe token check. Both sides are hashed first so length
 * differences and prefix information never reach the comparison.
 */
export function verifyToken(presented: string | undefined, expected: string): boolean {
  if (!presented || presented.length > 256) return false;
  const a = createHash("sha256").update(presented).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}
