/**
 * Workspace repair lock — concurrent repairs must never modify the same
 * workspace, a crashed holder's stale lock must be recoverable, and a live
 * holder's lock must never be stolen.
 */
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { repairCommand } from "../commands/repair.js";
import { acquireRepairLock, pidAlive, repairLockDir, type RepairLockOwner } from "../lib/repair/lock.js";
import type { RuntimeSession } from "../lib/runtime-session.js";

const scratch: string[] = [];
afterEach(async () => {
  await Promise.all(scratch.splice(0).map((p) => rm(p, { recursive: true, force: true })));
});

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "litt-lock-"));
  scratch.push(dir);
  return dir;
}

/** A pid that provably no longer exists — a child that already exited. */
async function deadPid(): Promise<number> {
  const child = spawn(process.execPath, ["-e", "process.exit(0)"]);
  const pid = child.pid;
  if (!pid) throw new Error("spawn failed");
  await new Promise<void>((resolve) => child.once("exit", () => resolve()));
  return pid;
}

async function writeForeignLock(root: string, owner: Partial<RepairLockOwner>): Promise<void> {
  const dir = repairLockDir(root);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "owner.json"), JSON.stringify({
    pid: 0, runId: "repair-foreign", token: "foreign-token",
    hostname: "test", startedAt: new Date().toISOString(), ...owner,
  }), "utf8");
}

/** Minimal workspace whose job.json parses; the lock must block before the pipeline runs. */
async function minimalWorkspace(): Promise<string> {
  const root = await tempDir();
  await mkdir(join(root, "src"), { recursive: true });
  await writeFile(join(root, "src", "state.txt"), "status=BROKEN\n", "utf8");
  await writeFile(join(root, "job.json"), JSON.stringify({
    version: 1,
    incident: "lock test",
    reproduction: { command: { command: "node", args: ["r.cjs"], timeoutMs: 5000 }, expectedFailure: { stream: "stderr", includes: "X" } },
    regression: { path: "t.cjs", command: { command: "node", args: ["t.cjs"], timeoutMs: 5000 } },
    editablePaths: ["src"],
    checks: [{ name: "t", kind: "focused", command: { command: "node", args: ["t.cjs"], timeoutMs: 5000 } }],
  }), "utf8");
  return root;
}

describe("workspace repair lock", () => {
  it("lets exactly one of two racing acquisitions win", async () => {
    const root = await tempDir();
    const [a, b] = await Promise.all([
      acquireRepairLock(root, "repair-a"),
      acquireRepairLock(root, "repair-b"),
    ]);
    expect([a.ok, b.ok].sort()).toEqual([false, true]);
    const winner = a.ok ? a : b;
    const loser = a.ok ? b : a;
    // The loser may read the lock before the winner finishes writing
    // owner.json — a held lock with no readable owner is still held.
    if (!loser.ok && loser.heldBy) expect(loser.heldBy.pid).toBe(process.pid);
    if (winner.ok) await winner.lock.release();
  });

  it("reports the live holder instead of stealing its lock", async () => {
    const root = await tempDir();
    const first = await acquireRepairLock(root, "repair-first");
    expect(first.ok).toBe(true);
    const second = await acquireRepairLock(root, "repair-second");
    expect(second.ok).toBe(false);
    if (!second.ok) {
      expect(second.heldBy?.pid).toBe(process.pid);
      expect(second.heldBy?.runId).toBe("repair-first");
    }
    if (first.ok) await first.lock.release();
  });

  it("does not steal a foreign lock whose pid is alive but not ours", async () => {
    const root = await tempDir();
    // A lock owned by this very pid with a token we never issued — exactly
    // what a foreign holder looks like. Reclaiming it would be stealing.
    await writeForeignLock(root, { pid: process.pid, token: "not-ours" });
    const attempt = await acquireRepairLock(root, "repair-new");
    expect(attempt.ok).toBe(false);
    const owner = JSON.parse(await readFile(join(repairLockDir(root), "owner.json"), "utf8"));
    expect(owner.token).toBe("not-ours");
  });

  it("reclaims a stale lock left by a crashed holder", async () => {
    const root = await tempDir();
    const crashed = await deadPid();
    expect(pidAlive(crashed)).toBe(false);
    await writeForeignLock(root, { pid: crashed, token: "dead-holder" });
    const attempt = await acquireRepairLock(root, "repair-new");
    expect(attempt.ok).toBe(true);
    const owner = JSON.parse(await readFile(join(repairLockDir(root), "owner.json"), "utf8"));
    expect(owner.runId).toBe("repair-new");
    if (attempt.ok) await attempt.lock.release();
  });

  it("release removes only the lock this process still owns", async () => {
    const root = await tempDir();
    const first = await acquireRepairLock(root, "repair-first");
    expect(first.ok).toBe(true);
    // Simulate the directory being taken over by a later, legitimate owner.
    await writeForeignLock(root, { pid: process.pid, token: "later-owner" });
    if (first.ok) await first.lock.release();
    const owner = JSON.parse(await readFile(join(repairLockDir(root), "owner.json"), "utf8"));
    expect(owner.token).toBe("later-owner");
  });

  it("blocks a second repair command from touching the same workspace", async () => {
    const root = await minimalWorkspace();
    await writeForeignLock(root, { pid: process.pid, token: "foreign" });
    const session = { getCwd: () => root } as RuntimeSession;
    const code = await repairCommand(
      ["start", "--job", "job.json", "--yes"], session, undefined, { isTTY: () => false },
    );
    expect(code).toBe(1);
    expect(await readFile(join(root, "src", "state.txt"), "utf8")).toBe("status=BROKEN\n");
  });

  it("released lock allows the next repair to proceed", async () => {
    const root = await minimalWorkspace();
    const held = await acquireRepairLock(root, "repair-first");
    expect(held.ok).toBe(true);
    if (held.ok) await held.lock.release();
    const next = await acquireRepairLock(root, "repair-next");
    expect(next.ok).toBe(true);
    if (next.ok) await next.lock.release();
  });
});
