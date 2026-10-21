/**
 * SessionStore reliability regressions (defects 2 and 3 from the Windows
 * session-persistence audit):
 *
 *  - Defect 2: writeAllSessions() writes straight to the live sessions.json
 *    with no temp-file+rename. An interrupted write (crash, kill, power
 *    loss) can leave a truncated/corrupt file, and the existing silent
 *    JSON.parse-catch-return-[] in readAllSessions() then discards every
 *    previously saved session with no warning.
 *  - Defect 3: sessionsFile() resolves from `homedir()` only (plus the
 *    test-only LITT_SESSIONS_FILE override) and never consults LITT_HOME,
 *    unlike config.ts / desktop.ts / provider-registry.ts, which all honor
 *    LITT_HOME as the state-home override.
 *
 * This file uses its own `vi.mock("node:fs")` to inject a mid-write
 * failure for defect 2, kept in a separate file from session-store.test.ts
 * so that mock doesn't affect the existing, unrelated passing tests there.
 */

import { existsSync, mkdtempSync, rmSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const realFns = vi.hoisted(() => ({
  writeFileSync: undefined as unknown as typeof import("node:fs").writeFileSync,
}));

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  realFns.writeFileSync = actual.writeFileSync;
  return { ...actual, writeFileSync: vi.fn(actual.writeFileSync) };
});

import { writeFileSync } from "node:fs";
import { saveSession, listSessions } from "../lib/session-store.js";

const base = {
  project: "litt-cli",
  cwd: "C:\\repos\\litt-cli",
  branch: "main",
  mode: "act" as const,
  routingMode: "auto",
  selectedModel: null,
  summary: "Fix the git-status verification",
};

function messages(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    role: (i % 2 === 0 ? "user" : "assistant") as "user" | "assistant",
    content: `message ${i}`,
    status: "complete",
    ts: 1000 + i,
  }));
}

describe("session-store — interrupted write (defect 2)", () => {
  let tempDir: string;
  let tempFile: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "litt-sessions-interrupt-"));
    tempFile = join(tempDir, "sessions.json");
    process.env.LITT_SESSIONS_FILE = tempFile;
    vi.mocked(writeFileSync).mockClear();
  });

  afterEach(() => {
    delete process.env.LITT_SESSIONS_FILE;
    try { rmSync(tempDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it("does not corrupt the previously-saved sessions file when the write is interrupted mid-way", () => {
    const first = saveSession({ ...base, messages: messages(2) });
    expect(listSessions()).toHaveLength(1);

    // Simulate a crash mid-write: the next writeFileSync call writes only
    // half its intended bytes to whatever path it's given, then throws —
    // exactly what an interrupted syscall / killed process looks like from
    // the caller's perspective.
    vi.mocked(writeFileSync).mockImplementationOnce((path, data, enc) => {
      const text = String(data);
      const truncated = text.slice(0, Math.floor(text.length / 2));
      realFns.writeFileSync(path as string, truncated, enc as BufferEncoding);
      throw new Error("simulated crash mid-write");
    });

    expect(() => saveSession({ ...base, summary: "a second conversation", messages: messages(2) })).toThrow();

    // The original, valid session must survive — not be overwritten with
    // truncated/corrupt JSON that readAllSessions() would then discard.
    const survivors = listSessions();
    expect(survivors.some((s) => s.id === first.id)).toBe(true);
  });
});

describe("session-store — LITT_HOME contract (defect 3)", () => {
  let littHomeDir: string;
  let decoyOsHomeDir: string;
  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    littHomeDir = mkdtempSync(join(tmpdir(), "litt-home-"));
    decoyOsHomeDir = mkdtempSync(join(tmpdir(), "litt-decoy-home-"));
    for (const k of ["LITT_SESSIONS_FILE", "LITT_HOME", "USERPROFILE", "HOME"]) {
      savedEnv[k] = process.env[k];
    }
    delete process.env.LITT_SESSIONS_FILE;
    process.env.LITT_HOME = littHomeDir;
    // Redirect the OS-level home directory to a second, disposable temp
    // dir — never the real ~/.litt — so a pre-fix run (which ignores
    // LITT_HOME and falls back to the OS home) is provably contained and
    // never touches real user data, while still proving the bug.
    process.env.USERPROFILE = decoyOsHomeDir;
    process.env.HOME = decoyOsHomeDir;
  });

  afterEach(() => {
    for (const [k, v] of Object.entries(savedEnv)) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
    try { rmSync(littHomeDir, { recursive: true, force: true }); } catch { /* ignore */ }
    try { rmSync(decoyOsHomeDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it("saves under LITT_HOME, not the OS home directory, when LITT_SESSIONS_FILE is unset", () => {
    saveSession({ ...base, messages: messages(1) });

    expect(existsSync(join(littHomeDir, "sessions.json"))).toBe(true);
    expect(existsSync(join(decoyOsHomeDir, ".litt", "sessions.json"))).toBe(false);
  });
});

describe("session-store — stale lock recovery (cross-process coordination)", () => {
  let tempDir: string;
  let tempFile: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "litt-stale-lock-"));
    tempFile = join(tempDir, "sessions.json");
    process.env.LITT_SESSIONS_FILE = tempFile;
  });

  afterEach(() => {
    delete process.env.LITT_SESSIONS_FILE;
    try { rmSync(tempDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it("a lock file abandoned by a crashed process (old mtime) is stolen, not waited out", () => {
    // Simulate the exact scenario acc703cc documented: a process holding
    // the lock gets a real SIGTERM/SIGHUP on Windows and is terminated
    // with zero cleanup code run, leaving sessions.json.lock behind
    // forever. Back-date its mtime well past the staleness window so
    // this test doesn't need to sleep 5+ seconds to prove the point.
    const lockPath = `${tempFile}.lock`;
    realFns.writeFileSync(lockPath, "99999", "utf8");
    const old = new Date(Date.now() - 60_000);
    utimesSync(lockPath, old, old);

    const start = Date.now();
    const saved = saveSession({ ...base, messages: messages(1) });
    const elapsed = Date.now() - start;

    expect(saved.id).toBeTruthy();
    expect(listSessions()).toHaveLength(1);
    // Stolen almost immediately — nowhere near the 2s wait-timeout this
    // would otherwise take if staleness detection didn't fire.
    expect(elapsed, "a stale lock must be reclaimed quickly, not waited out").toBeLessThan(500);
  });
});
