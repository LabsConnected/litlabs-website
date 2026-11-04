/**
 * Workspace repair lock — guarantees at most one repair pipeline modifies a
 * workspace at a time. The lock is a directory (atomic mkdir on every
 * supported platform, including Termux) under `.litt/repairs/`, which is
 * repair-owned and ignored by the workspace manifest.
 *
 * Stale-lock recovery: the owner record carries the holder PID. A lock whose
 * PID is provably dead (ESRCH) is reclaimed by removing the directory and
 * retrying the atomic mkdir; a lock whose PID answers signal 0 — including a
 * PID that was reused by an unrelated process — is NEVER stolen. That fails
 * safe: the worst case is a stale lock a human deletes by hand, never two
 * repairs writing the same files.
 */
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { hostname } from "node:os";
import { dirname, join } from "node:path";

export interface RepairLockHandle {
  readonly runId: string;
  release(): Promise<void>;
}

export interface RepairLockOwner {
  pid: number;
  runId: string;
  token: string;
  hostname: string;
  startedAt: string;
}

export type RepairLockResult =
  | { ok: true; lock: RepairLockHandle }
  | { ok: false; heldBy: RepairLockOwner | null };

const MAX_ATTEMPTS = 3;

export function repairLockDir(root: string): string {
  return join(root, ".litt", "repairs", "LOCK");
}

export function pidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

async function readOwner(lockDir: string): Promise<RepairLockOwner | null> {
  try {
    const parsed = JSON.parse(await readFile(join(lockDir, "owner.json"), "utf8")) as Partial<RepairLockOwner>;
    if (typeof parsed.pid !== "number" || typeof parsed.token !== "string") return null;
    return {
      pid: parsed.pid,
      runId: typeof parsed.runId === "string" ? parsed.runId : "unknown",
      token: parsed.token,
      hostname: typeof parsed.hostname === "string" ? parsed.hostname : "unknown",
      startedAt: typeof parsed.startedAt === "string" ? parsed.startedAt : "unknown",
    };
  } catch {
    return null;
  }
}

export async function acquireRepairLock(root: string, runId: string): Promise<RepairLockResult> {
  const lockDir = repairLockDir(root);
  await mkdir(dirname(lockDir), { recursive: true });
  const owner: RepairLockOwner = {
    pid: process.pid,
    runId,
    token: randomUUID(),
    hostname: hostname(),
    startedAt: new Date().toISOString(),
  };
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      await mkdir(lockDir);
      await writeFile(join(lockDir, "owner.json"), JSON.stringify(owner, null, 2) + "\n", "utf8");
      let released = false;
      return {
        ok: true,
        lock: {
          runId,
          async release() {
            if (released) return;
            released = true;
            // Only remove the lock while we are still its recorded owner —
            // never delete a lock a later process legitimately took.
            const current = await readOwner(lockDir);
            if (current?.token === owner.token) {
              await rm(lockDir, { recursive: true, force: true });
            }
          },
        },
      };
    } catch {
      const holder = await readOwner(lockDir);
      if (holder && !pidAlive(holder.pid)) {
        // Holder crashed or was killed — reclaim the stale directory and retry
        // the atomic mkdir so a second reclaimer loses cleanly instead of
        // corrupting the owner's record.
        await rm(lockDir, { recursive: true, force: true });
        continue;
      }
      return { ok: false, heldBy: holder };
    }
  }
  const holder = await readOwner(lockDir);
  return { ok: false, heldBy: holder };
}
