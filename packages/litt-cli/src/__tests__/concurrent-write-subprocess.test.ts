/**
 * Cross-process write-race regression — two real, separate LiTT
 * processes saving DIFFERENT sessions to the SAME sessions.json at
 * nearly the same instant must not lose either one. Reuses the real
 * fixture from crash-recovery-subprocess.test.ts (fixtures/
 * session-persist-child.ts) in its plain "idle" mode — each child does
 * exactly one saveSession() call for a conversation with its own
 * unique content (hence its own summary, hence its own session record;
 * same-conversation merging must not apply here).
 *
 * LITT_SESSIONS_LOCK_HOLD_MS widens process A's read-modify-write
 * window deterministically (a real timing race would be flaky to
 * assert on) so process B's write is guaranteed to land while A still
 * holds the file lock — exactly the scenario that silently lost data
 * before this fix.
 *
 * SYNCHRONIZATION — no fixed sleeps. Both barriers are bounded polls:
 *   1. `sessions.json.lock` exists  → A is provably inside its
 *      critical section before B is spawned (the contention ordering
 *      the test requires, independent of Windows spawn latency).
 *   2. both records in sessions.json → BOTH writes actually landed
 *      before asserting (a fixed 1200ms sleep used to sample mid-race
 *      and flake under parallel load).
 * Each wait has a deadline with a labelled error, so a genuine hang
 * fails informatively instead of timing out the whole test.
 */
import { existsSync, mkdtempSync, openSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { listSessions } from "../lib/session-store.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const FIXTURE = join(__dirname, "fixtures", "session-persist-child.ts");

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Poll `cond` every 25ms until truthy or `timeoutMs` elapses. */
async function waitFor(cond: () => boolean, timeoutMs: number, label: string): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (cond()) return;
    await sleep(25);
  }
  if (cond()) return;
  throw new Error(`Timed out after ${timeoutMs}ms waiting for: ${label}`);
}

let tempDir: string;
let sessionsFile: string;
let childLog: string;
let children: ChildProcess[] = [];

function spawnChild(content: string, extraEnv: Record<string, string> = {}): ChildProcess {
  // stdio to a per-test log so a crashed/failed child (e.g. a lock
  // timeout on an overloaded machine) shows up in the failure output
  // instead of vanishing into stdio:"ignore".
  const fd = openSync(childLog, "a");
  const child = spawn(
    process.execPath,
    ["--import", "tsx", FIXTURE, content, "idle"],
    {
      cwd: join(__dirname, "..", ".."),
      env: { ...process.env, LITT_SESSIONS_FILE: sessionsFile, ...extraEnv },
      stdio: ["ignore", fd, fd],
    },
  );
  children.push(child);
  return child;
}

function childLogContents(): string {
  try { return readFileSync(childLog, "utf8"); } catch { return "(no child log)"; }
}

function sessionContents(): unknown[] {
  return listSessions().map((s) => s.messages[0]?.content);
}

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "litt-concurrent-write-"));
  sessionsFile = join(tempDir, "sessions.json");
  childLog = join(tempDir, "children.log");
  process.env.LITT_SESSIONS_FILE = sessionsFile;
  children = [];
});

afterEach(() => {
  for (const c of children) { try { c.kill(); } catch { /* already dead */ } }
  delete process.env.LITT_SESSIONS_FILE;
  try { rmSync(tempDir, { recursive: true, force: true }); } catch { /* ignore */ }
});

describe("Real-subprocess concurrent write race", () => {
  it("two processes saving different sessions at nearly the same instant both survive", async () => {
    const lockPath = `${sessionsFile}.lock`;

    // Process A: starts its save, deliberately holds the file lock for
    // 400ms while inside the read-modify-write critical section.
    spawnChild("conversation A — must survive", { LITT_SESSIONS_LOCK_HOLD_MS: "400" });

    // BARRIER 1: A is provably inside its critical section (the lockfile
    // exists) before B is spawned. Windows process-startup latency under
    // parallel load used to break this ordering when it relied on a fixed
    // 100ms offset — B could win the lock first, then the fixed 1200ms
    // sample point read the file before A finished: exactly the flake
    // this rewrite removes.
    await waitFor(() => existsSync(lockPath), 30_000, "process A to acquire the sessions lock");

    // Process B starts while A still holds the lock — it must block on
    // the lock rather than racing straight through.
    spawnChild("conversation B — must survive");

    // BARRIER 2: both writes actually landed before asserting.
    try {
      await waitFor(
        () => {
          const contents = sessionContents();
          return contents.includes("conversation A — must survive")
            && contents.includes("conversation B — must survive");
        },
        30_000,
        "both concurrent saves to land on disk",
      );
    } catch (err) {
      throw new Error(`${(err as Error).message}\n--- child output ---\n${childLogContents()}`);
    }

    const sessions = listSessions();
    const contents = sessionContents();
    expect(contents, "both conversations must be present — neither write may silently discard the other").toEqual(
      expect.arrayContaining(["conversation A — must survive", "conversation B — must survive"]),
    );
    expect(sessions.length, "no duplicate or corrupted records").toBe(2);
  }, 60_000);

  it("no corrupted sessions.json results from the concurrent writes", async () => {
    const lockPath = `${sessionsFile}.lock`;

    spawnChild("race content A", { LITT_SESSIONS_LOCK_HOLD_MS: "300" });
    await waitFor(() => existsSync(lockPath), 30_000, "process A to acquire the sessions lock");
    spawnChild("race content B");

    // Both writes must complete (bounded) before the corruption check.
    await waitFor(() => listSessions().length === 2, 30_000, "both concurrent saves to land on disk");

    // listSessions() parses the real file — a corrupted write would
    // either throw or silently return [] (readAllSessions()'s catch),
    // not a clean 2-element array.
    expect(() => listSessions()).not.toThrow();
    expect(listSessions().length).toBe(2);
  }, 60_000);
});
