/**
 * Real-subprocess crash/kill recovery coverage.
 *
 * Mock-only tests cannot prove a termination survives, because the thing
 * under test IS "what happens when nothing in-process gets to run."
 * These tests spawn the fixture at fixtures/session-persist-child.ts as
 * an actual separate OS process (via `node --import tsx`, not an
 * in-process import) against the REAL session-store.ts module, then:
 *   - send it a real termination signal and verify the save it already
 *     made survives intact (SIGTERM, SIGHUP — see note below), and
 *   - let it crash with an uncaught exception and verify the same.
 *
 * Platform note, confirmed empirically before writing these tests: on
 * Windows, Node has no POSIX signal delivery. `child.kill('SIGTERM')`
 * and `child.kill('SIGHUP')` terminate the process immediately —
 * `process.on('SIGTERM', ...)` / `SIGHUP` handlers are never invoked.
 * So on this platform, "SIGTERM" and "a forced kill" are the SAME event,
 * and there is no graceful-shutdown window to test — which is exactly
 * why incremental persistence (saving as data arrives, not in response
 * to termination) is the only strategy that can work here at all. These
 * tests assert that end state, not a graceful-handler path that cannot
 * exist on this platform.
 */
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { listSessions } from "../lib/session-store.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const FIXTURE = join(__dirname, "fixtures", "session-persist-child.ts");

let tempDir: string;
let sessionsFile: string;
let children: ChildProcess[] = [];

function waitForFile(path: string, expected: string, timeoutMs = 8000): Promise<void> {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const check = () => {
      if (existsSync(path) && readFileSync(path, "utf8") === expected) { resolve(); return; }
      if (Date.now() - start > timeoutMs) { reject(new Error(`timed out waiting for ${path} === ${expected}`)); return; }
      setTimeout(check, 50);
    };
    check();
  });
}

function spawnChild(content: string, mode: string, readyFile: string): ChildProcess {
  const child = spawn(
    process.execPath,
    ["--import", "tsx", FIXTURE, content, mode, readyFile],
    {
      cwd: join(__dirname, "..", ".."),
      env: { ...process.env, LITT_SESSIONS_FILE: sessionsFile },
      stdio: "ignore",
    },
  );
  children.push(child);
  return child;
}

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "litt-crash-recovery-"));
  sessionsFile = join(tempDir, "sessions.json");
  process.env.LITT_SESSIONS_FILE = sessionsFile;
  children = [];
});

afterEach(() => {
  for (const c of children) { try { c.kill(); } catch { /* already dead */ } }
  delete process.env.LITT_SESSIONS_FILE;
  try { rmSync(tempDir, { recursive: true, force: true }); } catch { /* ignore */ }
});

describe("Real-subprocess crash/kill recovery", () => {
  it("data saved before a real SIGTERM survives — the kill never reaches a handler on Windows", async () => {
    const readyFile = join(tempDir, "ready.txt");
    const child = spawnChild("hello before SIGTERM", "idle", readyFile);
    await waitForFile(readyFile, "READY_1");

    child.kill("SIGTERM");
    await new Promise((r) => setTimeout(r, 500));

    const sessions = listSessions();
    expect(sessions.length).toBeGreaterThan(0);
    expect(sessions[0].messages[0].content).toBe("hello before SIGTERM");
  }, 15_000);

  it("data saved before a real SIGHUP survives", async () => {
    const readyFile = join(tempDir, "ready.txt");
    const child = spawnChild("hello before SIGHUP", "idle", readyFile);
    await waitForFile(readyFile, "READY_1");

    child.kill("SIGHUP");
    await new Promise((r) => setTimeout(r, 500));

    const sessions = listSessions();
    expect(sessions.length).toBeGreaterThan(0);
    expect(sessions[0].messages[0].content).toBe("hello before SIGHUP");
  }, 15_000);

  it("data saved before an uncaught exception (real crash, no kill involved) survives", async () => {
    const readyFile = join(tempDir, "ready.txt");
    spawnChild("hello before crash", "crash", readyFile);
    await waitForFile(readyFile, "READY_1");

    // Let the child's scheduled throw actually happen and the process exit.
    await new Promise((r) => setTimeout(r, 600));

    const sessions = listSessions();
    expect(sessions.length).toBeGreaterThan(0);
    expect(sessions[0].messages[0].content).toBe("hello before crash");
  }, 15_000);

  it("forced termination followed by restart: the saved conversation is loadable in a fresh process", async () => {
    const readyFile = join(tempDir, "ready.txt");
    const child = spawnChild("conversation before forced kill", "idle", readyFile);
    await waitForFile(readyFile, "READY_1");

    child.kill("SIGTERM"); // the only kind of kill this platform delivers
    await new Promise((r) => setTimeout(r, 500));

    // "Restart" — a fresh read of the same sessions file, simulating the
    // next `litt cockpit` launch picking up where the dead process left off.
    const restored = listSessions();
    expect(restored.length).toBe(1);
    expect(restored[0].messages[0].content).toBe("conversation before forced kill");
    expect(restored[0].project).toBe("subprocess-fixture");
  }, 15_000);

  it("repeated restart of the SAME conversation does not create duplicate session records", async () => {
    const readyFile = join(tempDir, "ready.txt");
    const child = spawnChild("same conversation, saved twice", "two-saves", readyFile);
    await waitForFile(readyFile, "READY_1");
    await waitForFile(readyFile, "READY_2", 8000);
    child.kill("SIGTERM");
    await new Promise((r) => setTimeout(r, 300));

    const sessions = listSessions();
    // Both saves target the same project+summary within the merge
    // window — one session record, not two.
    expect(sessions.length).toBe(1);
  }, 15_000);
});
