/**
 * Dex agent bearer token — mint, store (ACL-hardened), verify.
 *
 * 256-bit random token per install. Stored under <LiTT home>/dex/ with the
 * tightest local permissions available: owner-only ACL via icacls on
 * Windows (structured argv, no shell), mode 0600 elsewhere.
 * Verification compares SHA-256 digests through timingSafeEqual so a
 * malformed/mismatched token never leaks length or prefix information.
 *
 * Two invariants beyond that:
 *   - ACL failures fail closed — the agent never serves a token that is
 *     readable by another account.
 *   - Concurrent first-time starts cannot diverge: creation is an
 *     exclusive O_EXCL write; a losing process adopts the winner's
 *     persisted token instead of overwriting it.
 */

import { execFileSync } from "node:child_process";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { chmodSync, closeSync, openSync, readFileSync, statSync, unlinkSync, writeSync } from "node:fs";
import { join } from "node:path";
import { dexHome } from "./dex-home.js";

const TOKEN_FILE = "agent-token";
const MIN_TOKEN_LEN = 32;

/** How long a losing process waits for the winner's in-flight write —
 * must comfortably outlive any legit create→write window. */
const WINNER_READ_TRIES = 125; // × PAUSE ≈ 2.5 s
const WINNER_READ_PAUSE_MS = 20;
/** An unusable token file older than this is a dead remnant that may be
 * reclaimed; anything fresher may have a live writer and is left alone. */
const TOKEN_REMNANT_STALE_MS = 30_000;
/** Init lock bounds remnant reclamation to one process at a time. */
const INIT_LOCK_FILE = "agent-token.init.lck";
const INIT_LOCK_WAIT_MS = 2_000;
const INIT_LOCK_POLL_MS = 20;
const INIT_LOCK_STALE_MS = 30_000;

/** Token could not be safely loaded/persisted — the agent fails closed
 * rather than serving a credential it cannot prove is protected or
 * consistent across processes. The reason carries only an errno code. */
export class DexTokenError extends Error {
  constructor(reason: string) {
    super(`Dex token could not be initialized (${reason}) — refusing to start the agent`);
    this.name = "DexTokenError";
  }
}

/** Injectable seams for tests — real syscalls by default. */
export interface TokenDeps {
  execFile?: typeof execFileSync;
  platform?: NodeJS.Platform;
  /** Override the account name granted access (Windows tests). */
  user?: string;
  chmod?: (path: string, mode: number) => void;
}

export function tokenPath(): string {
  return join(dexHome(), TOKEN_FILE);
}

/**
 * icacls argv sequence leaving ONLY `user` with access:
 *   /reset         — replace the DACL with inherited defaults, wiping
 *                    every stale EXPLICIT grant to other accounts
 *   /inheritance:r — then drop the inherited grants → empty DACL
 *   /grant:r u:F   — finally grant the owner full control (sole ACE)
 *
 * `/inheritance:r` alone cannot help: it strips only inherited ACEs —
 * explicit grants to other principals would survive.
 */
export function ownerOnlyAclArgv(path: string, user: string): string[][] {
  return [
    [path, "/reset"],
    [path, "/inheritance:r"],
    [path, "/grant:r", `${user}:F`],
  ];
}

/**
 * Reduce the token file to owner-only access. Throws DexTokenError on
 * any failure — the caller fails closed rather than serving a token
 * whose permissions it could not prove.
 */
function restrictTokenFile(path: string, deps: TokenDeps): void {
  if ((deps.platform ?? process.platform) === "win32") {
    const user = deps.user ?? process.env.USERNAME ?? process.env.USER ?? "";
    const run = deps.execFile ?? execFileSync;
    for (const argv of ownerOnlyAclArgv(path, user)) {
      try {
        run("icacls.exe", argv, { stdio: "pipe", timeout: 5_000 });
      } catch (err) {
        // Sanitized: errno/syscall only — never the raw message.
        const code = (err as NodeJS.ErrnoException | null)?.code ?? "ERR";
        throw new DexTokenError(`icacls ${String(code)}`);
      }
    }
    return;
  }
  try {
    (deps.chmod ?? chmodSync)(path, 0o600);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException | null)?.code ?? "ERR";
    throw new DexTokenError(`chmod ${String(code)}`);
  }
}

const sleepBuf = new Int32Array(new SharedArrayBuffer(4));
function syncPause(ms: number): void {
  Atomics.wait(sleepBuf, 0, 0, ms);
}

/** Read a usable token (>= 32 chars) or null — never throws. */
function readUsableToken(path: string): string | null {
  try {
    const t = readFileSync(path, "utf-8").trim();
    return t.length >= MIN_TOKEN_LEN ? t : null;
  } catch {
    return null;
  }
}

/**
 * Serialize the remnant-reclaim critical section across processes.
 * Exclusive create, bounded wait, mtime-based stale recovery — same
 * discipline as the audit lock. The lock holds no data; reclaiming a
 * stale one can at worst double-hold for a process whose live holder
 * exceeded 30 s inside a ~ms section — unreachable in practice, and
 * the section itself stays EEXIST/adopt-correct even then.
 */
function withInitLock<T>(dir: string, fn: () => T): T {
  const lock = join(dir, INIT_LOCK_FILE);
  const deadline = Date.now() + INIT_LOCK_WAIT_MS;
  for (;;) {
    try {
      const fd = openSync(lock, "wx");
      try {
        return fn();
      } finally {
        closeSync(fd);
        try {
          unlinkSync(lock);
        } catch {
          /* released or reaped by a peer — either way the section is over */
        }
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException | null)?.code !== "EEXIST") throw err;
    }
    // Lock exists: reclaim only if provably dead, else bounded-wait.
    try {
      if (Date.now() - statSync(lock).mtimeMs > INIT_LOCK_STALE_MS) {
        try {
          unlinkSync(lock);
        } catch {
          /* a peer may hold or have released it — the loop re-tries wx */
        }
        continue;
      }
    } catch {
      continue; // vanished between create-attempt and stat — retry
    }
    if (Date.now() >= deadline) {
      throw new DexTokenError("init lock held");
    }
    syncPause(INIT_LOCK_POLL_MS);
  }
}

/**
 * Load the existing token or mint+persist a new one. Never logged.
 *
 * Creation is an exclusive `wx` write: a concurrent first-time start
 * cannot clobber this token, and this call cannot clobber theirs. On
 * EEXIST the loser waits (bounded) for the winner's write to land and
 * adopts THAT token — the file and every in-memory copy agree.
 */
export function loadOrCreateToken(deps: TokenDeps = {}): string {
  const path = tokenPath();
  const existing = readUsableToken(path);
  if (existing) {
    restrictTokenFile(path, deps); // re-assert owner-only on every start
    return existing;
  }

  const token = randomBytes(32).toString("hex");
  // Test seam: widens the create→write window so a second process is
  // provably inside its EEXIST path (mirrors LITT_SESSIONS_LOCK_HOLD_MS).
  const holdMs = Number(process.env.LITT_DEX_TOKEN_CREATE_HOLD_MS ?? 0);
  try {
    const fd = openSync(path, "wx", 0o600);
    try {
      if (holdMs > 0) syncPause(holdMs);
      writeSync(fd, token);
    } finally {
      closeSync(fd);
    }
    restrictTokenFile(path, deps);
    return token;
  } catch (err) {
    if ((err as NodeJS.ErrnoException | null)?.code !== "EEXIST") throw err;
  }

  // Lost the exclusive create — wait (bounded) for the winner's write.
  for (let i = 0; i < WINNER_READ_TRIES; i++) {
    syncPause(WINNER_READ_PAUSE_MS);
    const winner = readUsableToken(path);
    if (winner) {
      restrictTokenFile(path, deps);
      return winner;
    }
  }

  // Still unusable after the bounded wait. The check→reclaim must be
  // serialized: without the init lock, two reclaimers could stat the
  // same stale file, one could unlink a peer's FRESH recreate in the
  // stat→unlink gap, and the processes would diverge from the disk.
  // Inside the lock the file is re-validated before anything is removed.
  return withInitLock(dexHome(), () => {
    const winner = readUsableToken(path); // winner finished during our wait
    if (winner) {
      restrictTokenFile(path, deps);
      return winner;
    }
    // Reclaim only a provably dead remnant: an mtime older than STALE
    // cannot belong to a live writer mid-create. A fresh-but-unusable
    // file may still have a slow owner — never unlink it; fail closed.
    try {
      if (Date.now() - statSync(path).mtimeMs <= TOKEN_REMNANT_STALE_MS) {
        throw new DexTokenError("unusable token file");
      }
      unlinkSync(path);
    } catch (err) {
      if (err instanceof DexTokenError) throw err;
      // stat failed — the remnant vanished under us; recreate directly.
    }
    try {
      const fd = openSync(path, "wx", 0o600);
      try {
        writeSync(fd, token);
      } finally {
        closeSync(fd);
      }
      restrictTokenFile(path, deps);
      return token;
    } catch (err) {
      // A peer beat us to the recreate — take theirs if it works.
      const late = readUsableToken(path);
      if (late) {
        restrictTokenFile(path, deps);
        return late;
      }
      const code = (err as NodeJS.ErrnoException | null)?.code ?? "ERR";
      throw new DexTokenError(String(code));
    }
  });
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
