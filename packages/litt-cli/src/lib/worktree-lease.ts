/**
 * Worktree Lease — P0-2: Worktree Ownership / Collision Protection.
 *
 * Implements safe one-agent-per-write-worktree behavior.
 *
 * Tracks enough information to detect another active session:
 *   - worktree path
 *   - branch
 *   - run/session ID
 *   - PID
 *   - write ownership / lease
 *
 * If another writer owns the worktree, the caller must STOP and offer:
 *   - read only
 *   - create isolated worktree
 *   - switch worktree
 *   - cancel
 *
 * Lease file: <worktree>/.litt/worktree-lease.json
 * A lease is STALE when its PID is no longer alive (checked via process.kill
 * with signal 0 on Unix, or process existence check on Windows).
 *
 * Pure functions — no React, no Ink. Testable in node with temp dirs.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync, statSync } from "node:fs";
import { join } from "node:path";

/** A worktree write lease. */
export interface WorktreeLease {
  /** The worktree path this lease owns. */
  worktreePath: string;
  /** The branch at lease acquisition time. */
  branch: string;
  /** Unique session/run ID. */
  sessionId: string;
  /** OS process ID of the lease holder. */
  pid: number;
  /** When the lease was acquired (epoch ms). */
  acquiredAt: number;
  /** When the lease expires (epoch ms). 0 = no expiry. */
  expiresAt: number;
  /** The hostname (to distinguish machines in shared storage). */
  hostname: string;
}

/** Result of checking a worktree lease. */
export interface LeaseCheck {
  /** Whether the worktree is available for writing. */
  available: boolean;
  /** The active lease, if one exists and is alive. */
  activeLease: WorktreeLease | null;
  /** Whether the lease file exists but the holder is dead (stale). */
  staleLease: boolean;
  /** Human-readable status. */
  status: "available" | "in-use" | "stale";
  /** The collision reason (when in-use). */
  reason: string | null;
}

/** Default lease TTL: 30 minutes. */
const DEFAULT_LEASE_TTL_MS = 30 * 60_000;

/** Lease filename within the worktree's .litt directory. */
const LEASE_FILENAME = "worktree-lease.json";

function leaseFilePath(worktreePath: string): string {
  return join(worktreePath, ".litt", LEASE_FILENAME);
}

function getHostname(): string {
  try {
    return process.env.COMPUTERNAME ?? process.env.HOSTNAME ?? "unknown";
  } catch {
    return "unknown";
  }
}

/**
 * Check if a PID is alive.
 * Uses process.kill(pid, 0) which throws if the process doesn't exist.
 * On Windows, this works for the current machine's PIDs.
 */
export function isPidAlive(pid: number): boolean {
  if (!pid || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Read a lease from a worktree. Returns null if no lease file exists
 * or the file is unreadable/corrupt.
 */
export function readLease(worktreePath: string): WorktreeLease | null {
  const file = leaseFilePath(worktreePath);
  if (!existsSync(file)) return null;
  try {
    const raw = readFileSync(file, "utf8");
    const parsed = JSON.parse(raw) as WorktreeLease;
    if (
      typeof parsed.worktreePath === "string" &&
      typeof parsed.sessionId === "string" &&
      typeof parsed.pid === "number" &&
      typeof parsed.acquiredAt === "number"
    ) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Check whether a worktree is available for writing.
 *
 * A worktree is available when:
 *   - no lease file exists, OR
 *   - the lease file exists but the holder PID is dead (stale), OR
 *   - the lease has expired (expiresAt > 0 && Date.now() > expiresAt), OR
 *   - the lease belongs to THIS session (same sessionId — re-acquire is ok)
 *
 * It is NOT available when:
 *   - a live lease exists from a different session on the same host, OR
 *   - a live lease exists from a different host (shared storage — be safe)
 */
export function checkLease(worktreePath: string, currentSessionId?: string): LeaseCheck {
  const lease = readLease(worktreePath);

  if (!lease) {
    return {
      available: true,
      activeLease: null,
      staleLease: false,
      status: "available",
      reason: null,
    };
  }

  // Same session — re-entrant, always available
  if (currentSessionId && lease.sessionId === currentSessionId) {
    return {
      available: true,
      activeLease: lease,
      staleLease: false,
      status: "available",
      reason: null,
    };
  }

  // Check expiry
  if (lease.expiresAt > 0 && Date.now() > lease.expiresAt) {
    return {
      available: true,
      activeLease: null,
      staleLease: true,
      status: "stale",
      reason: `Lease expired at ${new Date(lease.expiresAt).toISOString()}`,
    };
  }

  // Check if the PID is alive
  if (!isPidAlive(lease.pid)) {
    return {
      available: true,
      activeLease: null,
      staleLease: true,
      status: "stale",
      reason: `Lease holder PID ${lease.pid} is no longer alive`,
    };
  }

  // Live lease from another session — collision
  const sameHost = lease.hostname === getHostname();
  return {
    available: false,
    activeLease: lease,
    staleLease: false,
    status: "in-use",
    reason: sameHost
      ? `WORKTREE IN USE: ${lease.worktreePath} is owned by session ${lease.sessionId} (PID ${lease.pid}, branch ${lease.branch}, acquired ${new Date(lease.acquiredAt).toISOString()})`
      : `WORKTREE IN USE: ${lease.worktreePath} is owned by session ${lease.sessionId} on host ${lease.hostname} (PID ${lease.pid}, branch ${lease.branch})`,
  };
}

/**
 * Acquire a write lease on a worktree.
 *
 * Returns { ok: true, lease } when the worktree is available.
 * Returns { ok: false, reason } when another live session owns it.
 *
 * Creates the .litt directory if it doesn't exist.
 */
export function acquireLease(
  worktreePath: string,
  branch: string,
  sessionId: string,
  ttlMs: number = DEFAULT_LEASE_TTL_MS,
): { ok: boolean; lease?: WorktreeLease; reason?: string } {
  const check = checkLease(worktreePath, sessionId);
  if (!check.available) {
    return { ok: false, reason: check.reason ?? "Worktree in use" };
  }

  // Clean up stale lease
  if (check.staleLease) {
    removeLease(worktreePath);
  }

  const now = Date.now();
  const lease: WorktreeLease = {
    worktreePath,
    branch,
    sessionId,
    pid: process.pid,
    acquiredAt: now,
    expiresAt: ttlMs > 0 ? now + ttlMs : 0,
    hostname: getHostname(),
  };

  const file = leaseFilePath(worktreePath);
  const dir = join(worktreePath, ".litt");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(file, JSON.stringify(lease, null, 2), "utf8");

  return { ok: true, lease };
}

/**
 * Release a write lease.
 * Only removes the file if the lease belongs to the given session.
 */
export function releaseLease(worktreePath: string, sessionId: string): boolean {
  const lease = readLease(worktreePath);
  if (!lease) return false;
  if (lease.sessionId !== sessionId) return false;
  try {
    unlinkSync(leaseFilePath(worktreePath));
    return true;
  } catch {
    return false;
  }
}

/**
 * Force-remove a stale lease (cleanup).
 */
export function removeLease(worktreePath: string): boolean {
  const file = leaseFilePath(worktreePath);
  if (!existsSync(file)) return false;
  try {
    unlinkSync(file);
    return true;
  } catch {
    return false;
  }
}

/**
 * Generate a new session ID for lease tracking.
 */
export function newLeaseSessionId(): string {
  return `sess_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}
