/**
 * P0-2: Worktree Ownership / Collision Protection — regression tests.
 *
 * Proves:
 *   - A fresh worktree is available.
 *   - Acquiring a lease succeeds on an available worktree.
 *   - A second session is BLOCKED from acquiring the same worktree.
 *   - A stale lease (dead PID) is detected and cleaned up.
 *   - Re-entrant acquisition by the same session succeeds.
 *   - Releasing a lease frees the worktree.
 *   - Lease expiry makes the worktree available again.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

import {
  checkLease,
  acquireLease,
  releaseLease,
  removeLease,
  readLease,
  isPidAlive,
  newLeaseSessionId,
  type WorktreeLease,
} from "../lib/worktree-lease.js";

const tmpBase = path.join(os.tmpdir(), `litt-p0-lease-${Date.now()}`);
const worktreePath = path.join(tmpBase, "my-worktree");

beforeEach(() => {
  fs.mkdirSync(worktreePath, { recursive: true });
});

afterEach(() => {
  try {
    fs.rmSync(tmpBase, { recursive: true, force: true });
  } catch { /* ignore */ }
});

describe("P0-2: Worktree Lease / Collision Protection", () => {
  describe("checkLease", () => {
    it("returns available when no lease exists", () => {
      const check = checkLease(worktreePath);
      expect(check.available).toBe(true);
      expect(check.status).toBe("available");
      expect(check.activeLease).toBe(null);
    });

    it("returns in-use when a live lease from another session exists", () => {
      const sess1 = newLeaseSessionId();
      const sess2 = newLeaseSessionId();
      acquireLease(worktreePath, "main", sess1);
      const check = checkLease(worktreePath, sess2);
      expect(check.available).toBe(false);
      expect(check.status).toBe("in-use");
      expect(check.activeLease).not.toBe(null);
      expect(check.reason).toContain("WORKTREE IN USE");
      expect(check.reason).toContain(sess1);
    });

    it("returns available for re-entrant access by same session", () => {
      const sess = newLeaseSessionId();
      acquireLease(worktreePath, "main", sess);
      const check = checkLease(worktreePath, sess);
      expect(check.available).toBe(true);
      expect(check.activeLease?.sessionId).toBe(sess);
    });
  });

  describe("acquireLease", () => {
    it("succeeds on an available worktree", () => {
      const sess = newLeaseSessionId();
      const result = acquireLease(worktreePath, "feat/test", sess);
      expect(result.ok).toBe(true);
      expect(result.lease).not.toBe(undefined);
      expect(result.lease?.worktreePath).toBe(worktreePath);
      expect(result.lease?.branch).toBe("feat/test");
      expect(result.lease?.sessionId).toBe(sess);
      expect(result.lease?.pid).toBe(process.pid);
    });

    it("writes the lease file to .litt/worktree-lease.json", () => {
      const sess = newLeaseSessionId();
      acquireLease(worktreePath, "main", sess);
      const file = path.join(worktreePath, ".litt", "worktree-lease.json");
      expect(fs.existsSync(file)).toBe(true);
      const raw = JSON.parse(fs.readFileSync(file, "utf8")) as WorktreeLease;
      expect(raw.sessionId).toBe(sess);
    });

    it("fails when another live session owns the worktree", () => {
      const sess1 = newLeaseSessionId();
      const sess2 = newLeaseSessionId();
      acquireLease(worktreePath, "main", sess1);
      const result = acquireLease(worktreePath, "main", sess2);
      expect(result.ok).toBe(false);
      expect(result.reason).toContain("WORKTREE IN USE");
    });

    it("succeeds over a stale lease (dead PID)", () => {
      const sess1 = newLeaseSessionId();
      const sess2 = newLeaseSessionId();
      acquireLease(worktreePath, "main", sess1);
      // Corrupt the lease to use a dead PID
      const file = path.join(worktreePath, ".litt", "worktree-lease.json");
      const lease = JSON.parse(fs.readFileSync(file, "utf8")) as WorktreeLease;
      lease.pid = 999999; // very likely dead
      fs.writeFileSync(file, JSON.stringify(lease));
      const result = acquireLease(worktreePath, "main", sess2);
      expect(result.ok).toBe(true);
    });

    it("succeeds over an expired lease", async () => {
      const sess1 = newLeaseSessionId();
      const sess2 = newLeaseSessionId();
      acquireLease(worktreePath, "main", sess1, 1); // 1ms TTL
      // Wait for expiry
      await new Promise((r) => setTimeout(r, 50));
      const check = checkLease(worktreePath, sess2);
      expect(check.status).toBe("stale");
      const result = acquireLease(worktreePath, "main", sess2);
      expect(result.ok).toBe(true);
    });
  });

  describe("releaseLease", () => {
    it("removes the lease file", () => {
      const sess = newLeaseSessionId();
      acquireLease(worktreePath, "main", sess);
      const released = releaseLease(worktreePath, sess);
      expect(released).toBe(true);
      const file = path.join(worktreePath, ".litt", "worktree-lease.json");
      expect(fs.existsSync(file)).toBe(false);
    });

    it("does not remove a lease owned by another session", () => {
      const sess1 = newLeaseSessionId();
      const sess2 = newLeaseSessionId();
      acquireLease(worktreePath, "main", sess1);
      const released = releaseLease(worktreePath, sess2);
      expect(released).toBe(false);
    });
  });

  describe("isPidAlive", () => {
    it("returns true for the current process PID", () => {
      expect(isPidAlive(process.pid)).toBe(true);
    });

    it("returns false for a non-existent PID", () => {
      expect(isPidAlive(999999)).toBe(false);
    });

    it("returns false for PID 0", () => {
      expect(isPidAlive(0)).toBe(false);
    });
  });

  describe("readLease", () => {
    it("returns null when no lease file exists", () => {
      expect(readLease(worktreePath)).toBe(null);
    });

    it("returns the lease when it exists", () => {
      const sess = newLeaseSessionId();
      acquireLease(worktreePath, "main", sess);
      const lease = readLease(worktreePath);
      expect(lease).not.toBe(null);
      expect(lease?.sessionId).toBe(sess);
    });
  });

  describe("newLeaseSessionId", () => {
    it("generates unique IDs", () => {
      const a = newLeaseSessionId();
      const b = newLeaseSessionId();
      expect(a).not.toBe(b);
      expect(a.startsWith("sess_")).toBe(true);
    });
  });
});
