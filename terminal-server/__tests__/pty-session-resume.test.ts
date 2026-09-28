/**
 * PTY detach/resume — the terminal session survives navigation, refresh
 * and brief network drops instead of being killed on every socket close.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  PtySessionManager,
  type PtyProcessHandle,
  type PtySpawnFactory,
} from "../pty-session-manager.js";

interface MockHandle extends PtyProcessHandle {
  killed: boolean;
  written: string[];
  emitData: (data: string) => void;
  simulateExit: (code: number) => void;
}

function createFactory(): PtySpawnFactory & { spawns: MockHandle[] } {
  const spawns: MockHandle[] = [];
  const make = (
    onData: (d: string) => void,
    onExit: (i: { exitCode: number | null; signal?: number }) => void,
  ): MockHandle => {
    const h: MockHandle = {
      killed: false,
      written: [],
      write(d) { h.written.push(d); },
      resize() {},
      kill() { h.killed = true; },
      emitData(d) { onData(d); },
      simulateExit(code) { onExit({ exitCode: code }); },
    };
    spawns.push(h);
    return h;
  };
  return {
    spawns,
    spawnHost: ({ onData, onExit }) => make(onData, onExit),
    spawnDocker: ({ onData, onExit }) => make(onData, onExit),
  };
}

describe("PtySessionManager detach / reattach", () => {
  let factory: ReturnType<typeof createFactory>;
  let manager: PtySessionManager;
  let root: string;

  beforeEach(() => {
    vi.useFakeTimers();
    factory = createFactory();
    manager = new PtySessionManager(
      { maxConcurrentPerUser: 3, idleTimeoutMs: 600_000, absoluteLifetimeMs: 3_600_000 },
      factory,
    );
    root = mkdtempSync(join(tmpdir(), "pty-resume-"));
  });

  afterEach(() => {
    manager.shutdown();
    vi.useRealTimers();
    rmSync(root, { recursive: true, force: true });
  });

  function create(onData = vi.fn(), onExit = vi.fn()) {
    const snap = manager.create({
      userId: "u1",
      projectId: "p1",
      workspaceId: "ws1",
      cwd: root,
      allowedRoot: root,
      useDocker: false,
      onData,
      onExit,
    });
    return { snap, onData, onExit, handle: factory.spawns[factory.spawns.length - 1] };
  }

  it("keeps the shell alive while detached and replays buffered output on resume", () => {
    const first = create();
    first.handle.emitData("before\n");
    expect(first.onData).toHaveBeenCalledWith("before\n");

    expect(manager.detach(first.snap.sessionId, "u1", 60_000)).toBe(true);
    expect(manager.isDetached(first.snap.sessionId, "u1")).toBe(true);

    // Output produced while nobody is listening is buffered, not delivered
    // to the dead socket.
    first.handle.emitData("while-away\n");
    expect(first.onData).not.toHaveBeenCalledWith("while-away\n");
    expect(first.handle.killed).toBe(false);

    const onData2 = vi.fn();
    const resumed = manager.reattach(first.snap.sessionId, "u1", { workspaceId: "ws1" }, {
      onData: onData2,
      onExit: vi.fn(),
    });
    expect(resumed?.sessionId).toBe(first.snap.sessionId);
    expect(onData2).toHaveBeenCalledWith("while-away\n");
    expect(manager.isDetached(first.snap.sessionId, "u1")).toBe(false);

    // New output flows to the new transport only.
    first.handle.emitData("after\n");
    expect(onData2).toHaveBeenCalledWith("after\n");
    expect(first.onData).not.toHaveBeenCalledWith("after\n");

    // Input still reaches the same shell.
    expect(manager.input(first.snap.sessionId, "ls\r", "u1")).toBe(true);
    expect(first.handle.written).toContain("ls\r");
  });

  it("kills the shell when nobody resumes within the grace window", () => {
    const s = create();
    manager.detach(s.snap.sessionId, "u1", 30_000);
    vi.advanceTimersByTime(29_999);
    expect(s.handle.killed).toBe(false);
    vi.advanceTimersByTime(2);
    expect(s.handle.killed).toBe(true);
    expect(manager.get(s.snap.sessionId, "u1")).toBeNull();
  });

  it("a resume cancels the grace timer", () => {
    const s = create();
    manager.detach(s.snap.sessionId, "u1", 30_000);
    manager.reattach(s.snap.sessionId, "u1", { workspaceId: "ws1" }, { onData: vi.fn(), onExit: vi.fn() });
    vi.advanceTimersByTime(120_000);
    expect(s.handle.killed).toBe(false);
    expect(manager.get(s.snap.sessionId, "u1")).not.toBeNull();
  });

  it("never lets another user resume a session", () => {
    const s = create();
    manager.detach(s.snap.sessionId, "u1", 30_000);
    expect(manager.reattach(s.snap.sessionId, "intruder", { workspaceId: "ws1" }, { onData: vi.fn(), onExit: vi.fn() })).toBeNull();
    expect(manager.detach(s.snap.sessionId, "intruder", 1)).toBe(false);
    expect(manager.isDetached(s.snap.sessionId, "u1")).toBe(true);
  });

  it("refuses a resume from a different workspace", () => {
    const s = create();
    manager.detach(s.snap.sessionId, "u1", 30_000);
    expect(manager.reattach(s.snap.sessionId, "u1", { workspaceId: "other" }, { onData: vi.fn(), onExit: vi.fn() })).toBeNull();
  });

  it("refuses to resume a session that is still attached", () => {
    const s = create();
    expect(manager.reattach(s.snap.sessionId, "u1", { workspaceId: "ws1" }, { onData: vi.fn(), onExit: vi.fn() })).toBeNull();
  });

  it("routes the exit notice to the resumed transport", () => {
    const s = create();
    manager.detach(s.snap.sessionId, "u1", 30_000);
    const onExit2 = vi.fn();
    manager.reattach(s.snap.sessionId, "u1", { workspaceId: "ws1" }, { onData: vi.fn(), onExit: onExit2 });
    s.handle.simulateExit(0);
    expect(onExit2).toHaveBeenCalledWith(expect.objectContaining({ sessionId: s.snap.sessionId, exitCode: 0 }));
    expect(s.onExit).not.toHaveBeenCalled();
  });

  it("detaching an exited session cleans it up immediately", () => {
    const s = create();
    s.handle.simulateExit(1);
    expect(manager.detach(s.snap.sessionId, "u1", 30_000)).toBe(true);
    expect(manager.get(s.snap.sessionId, "u1")).toBeNull();
  });
});
