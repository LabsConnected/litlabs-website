/**
 * Docker PTY session safety.
 *
 * P0 data loss: createDockerSession used to rmSync() the bind-mounted
 * workspace — the user's REAL project directory — whenever the container
 * exited. These tests prove that normal exit, crash, kill and spawn failure
 * all leave project files untouched, and that a failing `docker` process can
 * never raise an unhandled error that would take terminal-server down.
 *
 * A fake child process is injected: no `docker` binary is ever started.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "events";
import { PassThrough } from "stream";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync, readFileSync } from "fs";
import { tmpdir } from "os";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { createDockerSession } from "../docker-manager";

class FakeProc extends EventEmitter {
  stdin = new PassThrough();
  stdout = new PassThrough();
  stderr = new PassThrough();
  pid = 4242;
  killed = false;
  kill = vi.fn((_sig?: string) => {
    this.killed = true;
    return true;
  });
}

let root: string;
let workspace: string;
let proc: FakeProc;
let spawnFn: ReturnType<typeof vi.fn>;

function seedProject() {
  mkdirSync(join(workspace, "src"), { recursive: true });
  writeFileSync(join(workspace, "package.json"), '{"name":"user-project"}');
  writeFileSync(join(workspace, "src", "index.ts"), "export const precious = 1;\n");
  writeFileSync(join(workspace, ".env.local"), "SECRET=keep\n");
}

function expectProjectIntact() {
  expect(existsSync(workspace)).toBe(true);
  expect(readFileSync(join(workspace, "package.json"), "utf-8")).toBe('{"name":"user-project"}');
  expect(readFileSync(join(workspace, "src", "index.ts"), "utf-8")).toBe("export const precious = 1;\n");
  expect(readFileSync(join(workspace, ".env.local"), "utf-8")).toBe("SECRET=keep\n");
}

function start(onData: (d: string) => void = () => {}) {
  const session = createDockerSession(
    { userId: "user_1234567890", sessionId: "sess-abcdef12", workspace, onData },
    { spawn: spawnFn as never },
  );
  const exits: Array<{ exitCode: number; signal?: number }> = [];
  (session as unknown as { onExit: (cb: (e: { exitCode: number; signal?: number }) => void) => void }).onExit(
    (e) => exits.push(e),
  );
  return { session, exits };
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "docker-session-safety-"));
  workspace = join(root, "user-project");
  seedProject();
  proc = new FakeProc();
  spawnFn = vi.fn(() => proc);
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(root, { recursive: true, force: true });
});

describe("workspace preservation (P0 data loss)", () => {
  it("preserves project files on normal exit", () => {
    const { exits } = start();
    proc.emit("exit", 0, null);
    expect(exits).toEqual([{ exitCode: 0, signal: undefined }]);
    expectProjectIntact();
  });

  it("preserves project files when the container crashes (non-zero exit)", () => {
    const { exits } = start();
    proc.emit("exit", 137, null);
    expect(exits[0].exitCode).toBe(137);
    expectProjectIntact();
  });

  it("preserves project files when the process is killed by a signal", () => {
    const { exits } = start();
    proc.emit("exit", null, "SIGKILL");
    expect(exits).toHaveLength(1);
    expectProjectIntact();
  });

  it("preserves project files on client disconnect (kill requested)", () => {
    vi.useFakeTimers();
    try {
      const { session } = start();
      session.kill();
      expect(proc.kill).toHaveBeenCalledWith("SIGTERM");
      proc.emit("exit", 143, null);
      vi.advanceTimersByTime(6000);
      expectProjectIntact();
    } finally {
      vi.useRealTimers();
    }
  });

  it("preserves project files when docker itself fails to start", () => {
    const { exits } = start();
    proc.emit("error", Object.assign(new Error("spawn docker ENOENT"), { code: "ENOENT" }));
    expect(exits).toHaveLength(1);
    expectProjectIntact();
  });

  it("creates a missing workspace directory but never removes an existing one", () => {
    const fresh = join(root, "brand-new");
    createDockerSession(
      { userId: "u", sessionId: "s1234567", workspace: fresh, onData: () => {} },
      { spawn: spawnFn as never },
    );
    expect(existsSync(fresh)).toBe(true);
    proc.emit("exit", 0, null);
    expect(existsSync(fresh)).toBe(true);
  });

  it("contains no recursive-delete call on the workspace anywhere in the module", () => {
    const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "docker-manager.ts"), "utf-8");
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    expect(code).not.toMatch(/\brmSync\b|\brmdirSync\b|\brimraf\b|fs\.rm\b|\bunlinkSync\b/);
  });
});

describe("spawn failure cannot crash terminal-server", () => {
  it("an 'error' event on the docker process is handled, not thrown", () => {
    const onData = vi.fn();
    const { exits } = start(onData);
    expect(() =>
      proc.emit("error", Object.assign(new Error("spawn docker ENOENT"), { code: "ENOENT" })),
    ).not.toThrow();

    // Explicit, non-success outcome — never a silent "success".
    expect(exits).toHaveLength(1);
    expect(exits[0].exitCode).not.toBe(0);
    expect(onData.mock.calls.map((c) => c[0]).join("")).toMatch(/terminal unavailable/);
  });

  it("reports exit exactly once when error is followed by exit", () => {
    const { exits } = start();
    proc.emit("error", new Error("boom"));
    proc.emit("exit", 1, null);
    expect(exits).toHaveLength(1);
  });

  it("a listener registered after failure still learns about it", () => {
    const { session } = start();
    proc.emit("error", new Error("boom"));
    const late = vi.fn();
    (session as unknown as { onExit: (cb: (e: unknown) => void) => void }).onExit(late);
    expect(late).toHaveBeenCalledTimes(1);
  });

  it("stream errors (EPIPE on stdin, closed stdout/stderr) are swallowed", () => {
    start();
    expect(() => {
      proc.stdin.emit("error", new Error("write EPIPE"));
      proc.stdout.emit("error", new Error("read ECONNRESET"));
      proc.stderr.emit("error", new Error("read ECONNRESET"));
    }).not.toThrow();
  });

  it("writing to a dead session is a no-op, not an exception", () => {
    const { session } = start();
    proc.emit("exit", 1, null);
    expect(() => session.write("echo hi\n")).not.toThrow();
  });

  it("redacts nothing away from normal output but never throws on binary chunks", () => {
    const onData = vi.fn();
    start(onData);
    expect(() => proc.stdout.emit("data", Buffer.from([0xff, 0xfe, 0x41]))).not.toThrow();
  });
});
