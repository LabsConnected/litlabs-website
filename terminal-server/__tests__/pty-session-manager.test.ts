/**
 * PtySessionManager tests.
 *
 * Uses an injected mock spawn factory — no real processes are spawned.
 * Uses real temp directories for workspace boundary validation tests
 * (validateWorkspacePath calls realpathSync, which requires existing paths).
 *
 * Tests cover:
 *   - create → snapshot
 *   - input updates lastActivityAt + ownership
 *   - resize is forwarded + bounds + ownership
 *   - kill cleans up timers + removes session + ownership
 *   - max concurrent per user
 *   - idle timeout kills session
 *   - absolute lifetime kills session
 *   - sweeper cleans up exited sessions
 *   - shutdown kills all
 *   - snapshot/snapshotByUser/countByUser
 *   - onExit callback fires on natural exit
 *   - snapshot has no ptyProcess handle (safe shape)
 *   - SECURITY: wrong user cannot input/resize/kill/get
 *   - SECURITY: workspace boundary — path traversal rejected
 *   - SECURITY: workspace boundary — absolute path escape rejected
 *   - SECURITY: workspace boundary — symlink escape rejected
 *   - SECURITY: stolen/guessed sessionId doesn't grant access
 *   - SECURITY: oversized input rejected
 *   - SECURITY: invalid resize values rejected
 *   - SECURITY: output chunk cap drops excess output
 *   - BACKPRESSURE: unlimited cumulative output works when consumer keeps up
 *   - BACKPRESSURE: single pathological chunk is rejected/bounded
 *   - BACKPRESSURE: thousands of normal chunks with slow consumer don't create unbounded queue
 *   - BACKPRESSURE: output resumes when consumer becomes writable again
 *   - BACKPRESSURE: dropped-output accounting/warning is bounded and doesn't leak into snapshots
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, symlinkSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  PtySessionManager,
  validateWorkspacePath,
  buildPtyEnv,
  KNOWN_SECRETS_TO_REJECT,
  MAX_INPUT_SIZE,
  MAX_COLS,
  MAX_ROWS,
  MAX_OUTPUT_CHUNK,
  MAX_PENDING_OUTPUT_BYTES,
  OUTPUT_DROP_WARN_INTERVAL_MS,
  type PtyProcessHandle,
  type PtySpawnFactory,
  type PtySessionSnapshot,
} from "../pty-session-manager.js";

// ─── Mock spawn factory ───────────────────────────────────────────

interface MockHandle extends PtyProcessHandle {
  written: string[];
  resizeCalls: Array<{ cols: number; rows: number }>;
  killed: boolean;
  /** The environment passed to spawnHost — for env isolation tests. */
  spawnEnv: Record<string, string>;
  /** Trigger a natural exit (simulates the PTY process dying). */
  simulateExit: (exitCode: number) => void;
  /** Emit output to the manager's onData callback (simulates PTY stdout). */
  emitData: (data: string) => void;
}

function createMockFactory(): PtySpawnFactory & {
  hostSpawns: MockHandle[];
  dockerSpawns: MockHandle[];
} {
  const hostSpawns: MockHandle[] = [];
  const dockerSpawns: MockHandle[] = [];

  function makeMockHandle(
    onData: (data: string) => void,
    onExit: (info: { exitCode: number | null; signal?: number }) => void,
    spawnEnv: Record<string, string> = {},
  ): MockHandle {
    let exitCb = onExit;
    let dataCb = onData;
    const handle: MockHandle = {
      written: [],
      resizeCalls: [],
      killed: false,
      spawnEnv,
      write(data: string) { handle.written.push(data); },
      resize(cols: number, rows: number) { handle.resizeCalls.push({ cols, rows }); },
      kill() { handle.killed = true; },
      simulateExit(exitCode: number) { exitCb({ exitCode }); },
      emitData(data: string) { dataCb(data); },
    };
    return handle;
  }

  return {
    hostSpawns,
    dockerSpawns,
    spawnHost({ onData, onExit, env }): PtyProcessHandle {
      const h = makeMockHandle(onData, onExit, env);
      hostSpawns.push(h);
      return h;
    },
    spawnDocker({ onData, onExit }): PtyProcessHandle {
      const h = makeMockHandle(onData, onExit);
      dockerSpawns.push(h);
      return h;
    },
  };
}

// ─── Test helpers ─────────────────────────────────────────────────

function makeTempRoot(): string {
  return mkdtempSync(join(tmpdir(), "pty-test-"));
}

function makeOpts(overrides: Partial<{
  userId: string;
  cwd: string;
  allowedRoot: string;
  useDocker: boolean;
  projectId: string | null;
  workspaceId: string | null;
  onData: (data: string) => void;
  onExit: (info: { sessionId: string; exitCode: number | null; signal?: number }) => void;
  onOutputDropped: (info: { sessionId: string; dropped: number }) => void;
  isTransportWritable: () => boolean;
  maxPendingOutputBytes: number;
  onBackpressureWarning: (info: { sessionId: string; droppedChunks: number; droppedBytes: number }) => void;
}> & { allowedRoot: string }) {
  const userId = overrides.userId ?? "user-1";
  const allowedRoot = overrides.allowedRoot;
  return {
    userId,
    projectId: overrides.projectId ?? "proj-1",
    workspaceId: overrides.workspaceId ?? "ws-1",
    cwd: overrides.cwd ?? allowedRoot,
    allowedRoot,
    useDocker: overrides.useDocker ?? false,
    onData: overrides.onData ?? vi.fn(),
    onExit: overrides.onExit ?? vi.fn(),
    onOutputDropped: overrides.onOutputDropped,
    isTransportWritable: overrides.isTransportWritable,
    maxPendingOutputBytes: overrides.maxPendingOutputBytes,
    onBackpressureWarning: overrides.onBackpressureWarning,
  };
}

// ─── Tests ────────────────────────────────────────────────────────

describe("PtySessionManager", () => {
  let factory: ReturnType<typeof createMockFactory>;
  let manager: PtySessionManager;
  let tempRoot: string;

  beforeEach(() => {
    vi.useFakeTimers();
    factory = createMockFactory();
    manager = new PtySessionManager(
      {
        maxConcurrentPerUser: 3,
        idleTimeoutMs: 10_000,
        absoluteLifetimeMs: 60_000,
      },
      factory,
    );
    tempRoot = makeTempRoot();
  });

  afterEach(() => {
    manager.shutdown();
    vi.useRealTimers();
    rmSync(tempRoot, { recursive: true, force: true });
  });

  // ─── Create + snapshot ──────────────────────────────────────────

  it("create returns a snapshot with session metadata", () => {
    const snap = manager.create(makeOpts({ allowedRoot: tempRoot }));
    expect(snap.sessionId).toBeTruthy();
    expect(snap.userId).toBe("user-1");
    expect(snap.projectId).toBe("proj-1");
    expect(snap.workspaceId).toBe("ws-1");
    expect(snap.cwd).toBe(tempRoot); // canonicalized
    expect(snap.shell).toBeTruthy();
    expect(snap.createdAt).toBeGreaterThan(0);
    expect(snap.lastActivityAt).toBe(snap.createdAt);
    expect(snap.exited).toBe(false);
    expect(snap.exitCode).toBe(null);
  });

  it("snapshot does not expose the ptyProcess handle", () => {
    const snap = manager.create(makeOpts({ allowedRoot: tempRoot }));
    const keys = Object.keys(snap);
    expect(keys).not.toContain("handle");
    expect(keys).not.toContain("ptyProcess");
    expect(keys).not.toContain("idleTimer");
    expect(keys).not.toContain("lifetimeTimer");
    expect(keys).not.toContain("outputBuffered");
  });

  // ─── Input + ownership ──────────────────────────────────────────

  it("input writes to the PTY and updates lastActivityAt", () => {
    const snap = manager.create(makeOpts({ allowedRoot: tempRoot }));
    const before = snap.lastActivityAt;
    vi.advanceTimersByTime(100);
    const ok = manager.input(snap.sessionId, "ls\r", "user-1");
    expect(ok).toBe(true);
    expect(factory.hostSpawns[0].written).toEqual(["ls\r"]);
    const updated = manager.get(snap.sessionId, "user-1");
    expect(updated!.lastActivityAt).toBeGreaterThan(before);
  });

  it("input is rejected for wrong user", () => {
    const snap = manager.create(makeOpts({ allowedRoot: tempRoot }));
    const ok = manager.input(snap.sessionId, "ls\r", "attacker");
    expect(ok).toBe(false);
    expect(factory.hostSpawns[0].written).toEqual([]);
  });

  it("input is a no-op for non-existent session", () => {
    expect(() => manager.input("nonexistent", "data", "user-1")).not.toThrow();
  });

  it("input rejects oversized payload", () => {
    const snap = manager.create(makeOpts({ allowedRoot: tempRoot }));
    const huge = "x".repeat(MAX_INPUT_SIZE + 1);
    const ok = manager.input(snap.sessionId, huge, "user-1");
    expect(ok).toBe(false);
    expect(factory.hostSpawns[0].written).toEqual([]);
  });

  // ─── Resize + bounds + ownership ────────────────────────────────

  it("resize is forwarded to the handle", () => {
    const snap = manager.create(makeOpts({ allowedRoot: tempRoot }));
    const ok = manager.resize(snap.sessionId, 80, 24, "user-1");
    expect(ok).toBe(true);
    expect(factory.hostSpawns[0].resizeCalls).toEqual([{ cols: 80, rows: 24 }]);
  });

  it("resize is rejected for wrong user", () => {
    const snap = manager.create(makeOpts({ allowedRoot: tempRoot }));
    const ok = manager.resize(snap.sessionId, 80, 24, "attacker");
    expect(ok).toBe(false);
    expect(factory.hostSpawns[0].resizeCalls).toEqual([]);
  });

  it("resize rejects cols/rows out of bounds", () => {
    const snap = manager.create(makeOpts({ allowedRoot: tempRoot }));
    expect(manager.resize(snap.sessionId, 0, 24, "user-1")).toBe(false);
    expect(manager.resize(snap.sessionId, 80, 0, "user-1")).toBe(false);
    expect(manager.resize(snap.sessionId, MAX_COLS + 1, 24, "user-1")).toBe(false);
    expect(manager.resize(snap.sessionId, 80, MAX_ROWS + 1, "user-1")).toBe(false);
    expect(manager.resize(snap.sessionId, NaN, 24, "user-1")).toBe(false);
    expect(manager.resize(snap.sessionId, 80, Infinity, "user-1")).toBe(false);
    expect(factory.hostSpawns[0].resizeCalls).toEqual([]);
  });

  // ─── Kill + ownership ───────────────────────────────────────────

  it("kill removes the session and kills the handle", () => {
    const snap = manager.create(makeOpts({ allowedRoot: tempRoot }));
    expect(manager.size).toBe(1);
    const ok = manager.kill(snap.sessionId, "test", "user-1");
    expect(ok).toBe(true);
    expect(manager.size).toBe(0);
    expect(manager.get(snap.sessionId, "user-1")).toBe(null);
    expect(factory.hostSpawns[0].killed).toBe(true);
  });

  it("kill is rejected for wrong user", () => {
    const snap = manager.create(makeOpts({ allowedRoot: tempRoot }));
    const ok = manager.kill(snap.sessionId, "test", "attacker");
    expect(ok).toBe(false);
    expect(manager.size).toBe(1); // still alive
    expect(factory.hostSpawns[0].killed).toBe(false);
  });

  // ─── Get + ownership ────────────────────────────────────────────

  it("get returns null for wrong user (stolen sessionId)", () => {
    const snap = manager.create(makeOpts({ allowedRoot: tempRoot }));
    // Attacker knows the sessionId but is not the owner
    const stolen = manager.get(snap.sessionId, "attacker");
    expect(stolen).toBe(null);
    // Real owner can still get it
    expect(manager.get(snap.sessionId, "user-1")).not.toBe(null);
  });

  // ─── Max concurrent ─────────────────────────────────────────────

  it("create throws when max concurrent per user is exceeded", () => {
    for (let i = 0; i < 3; i++) {
      manager.create(makeOpts({ allowedRoot: tempRoot }));
    }
    expect(() => manager.create(makeOpts({ allowedRoot: tempRoot }))).toThrow(/Max concurrent/);
  });

  it("different users can each have their own max", () => {
    for (let i = 0; i < 3; i++) {
      manager.create(makeOpts({ allowedRoot: tempRoot, userId: "user-a" }));
      manager.create(makeOpts({ allowedRoot: tempRoot, userId: "user-b" }));
    }
    expect(manager.countByUser("user-a")).toBe(3);
    expect(manager.countByUser("user-b")).toBe(3);
  });

  // ─── Idle timeout ───────────────────────────────────────────────

  it("idle timeout kills the session after idleTimeoutMs", () => {
    const onExit = vi.fn();
    const snap = manager.create(makeOpts({ allowedRoot: tempRoot, onExit }));
    vi.advanceTimersByTime(10_001);
    expect(manager.get(snap.sessionId, "user-1")).toBe(null);
    expect(factory.hostSpawns[0].killed).toBe(true);
  });

  it("input resets the idle timer", () => {
    const snap = manager.create(makeOpts({ allowedRoot: tempRoot }));
    vi.advanceTimersByTime(9_000);
    manager.input(snap.sessionId, "x", "user-1");
    vi.advanceTimersByTime(9_000);
    expect(manager.get(snap.sessionId, "user-1")).not.toBe(null);
    vi.advanceTimersByTime(10_001);
    expect(manager.get(snap.sessionId, "user-1")).toBe(null);
  });

  // ─── Absolute lifetime ──────────────────────────────────────────

  it("absolute lifetime kills the session regardless of activity", () => {
    const snap = manager.create(makeOpts({ allowedRoot: tempRoot }));
    for (let i = 0; i < 13; i++) {
      vi.advanceTimersByTime(5_000);
      manager.input(snap.sessionId, "x", "user-1");
    }
    expect(manager.get(snap.sessionId, "user-1")).toBe(null);
  });

  // ─── Sweeper ────────────────────────────────────────────────────

  it("sweeper cleans up exited sessions", () => {
    const snap = manager.create(makeOpts({ allowedRoot: tempRoot }));
    factory.hostSpawns[0].simulateExit(0);
    const exited = manager.get(snap.sessionId, "user-1");
    expect(exited!.exited).toBe(true);
    expect(exited!.exitCode).toBe(0);
    manager.sweep();
    expect(manager.get(snap.sessionId, "user-1")).toBe(null);
  });

  it("sweeper kills idle sessions", () => {
    manager.create(makeOpts({ allowedRoot: tempRoot }));
    vi.advanceTimersByTime(10_001);
    manager.sweep();
    expect(manager.size).toBe(0);
  });

  // ─── Shutdown ───────────────────────────────────────────────────

  it("shutdown kills all sessions", () => {
    manager.create(makeOpts({ allowedRoot: tempRoot, userId: "a" }));
    manager.create(makeOpts({ allowedRoot: tempRoot, userId: "b" }));
    manager.create(makeOpts({ allowedRoot: tempRoot, userId: "c" }));
    expect(manager.size).toBe(3);
    manager.shutdown();
    expect(manager.size).toBe(0);
    expect(factory.hostSpawns.every((h) => h.killed)).toBe(true);
  });

  // ─── Query ──────────────────────────────────────────────────────

  it("snapshot returns all sessions", () => {
    manager.create(makeOpts({ allowedRoot: tempRoot, userId: "a" }));
    manager.create(makeOpts({ allowedRoot: tempRoot, userId: "b" }));
    const all = manager.snapshot();
    expect(all).toHaveLength(2);
    expect(all.map((s) => s.userId).sort()).toEqual(["a", "b"]);
  });

  it("snapshotByUser filters by user", () => {
    manager.create(makeOpts({ allowedRoot: tempRoot, userId: "a" }));
    manager.create(makeOpts({ allowedRoot: tempRoot, userId: "a" }));
    manager.create(makeOpts({ allowedRoot: tempRoot, userId: "b" }));
    expect(manager.snapshotByUser("a")).toHaveLength(2);
    expect(manager.snapshotByUser("b")).toHaveLength(1);
    expect(manager.snapshotByUser("c")).toHaveLength(0);
  });

  // ─── onExit callback ────────────────────────────────────────────

  it("onExit callback fires when the PTY exits naturally", () => {
    const onExit = vi.fn();
    const snap = manager.create(makeOpts({ allowedRoot: tempRoot, onExit }));
    factory.hostSpawns[0].simulateExit(42);
    expect(onExit).toHaveBeenCalledWith({
      sessionId: snap.sessionId,
      exitCode: 42,
      signal: undefined,
    });
  });

  // ─── Docker mode ────────────────────────────────────────────────

  it("useDocker=true spawns via Docker factory", () => {
    const snap = manager.create(makeOpts({ allowedRoot: tempRoot, useDocker: true }));
    expect(factory.dockerSpawns).toHaveLength(1);
    expect(factory.hostSpawns).toHaveLength(0);
    expect(snap.sessionId).toBeTruthy();
  });

  // ─── Output chunk cap (per-chunk, NOT cumulative) ──────────────

  it("session can emit substantially more than MAX_OUTPUT_CHUNK cumulatively when output is consumed", () => {
    const received: string[] = [];
    const snap = manager.create(makeOpts({
      allowedRoot: tempRoot,
      onData: (data) => received.push(data),
    }));
    // Emit 10 chunks of 100 KiB each = ~1 MiB total (4x MAX_OUTPUT_CHUNK)
    // Each chunk is under MAX_OUTPUT_CHUNK, so all should be delivered.
    const chunkSize = 100 * 1024;
    const chunk = "x".repeat(chunkSize);
    for (let i = 0; i < 10; i++) {
      factory.hostSpawns[0].emitData(chunk);
    }
    // All 10 chunks delivered — cumulative output is unlimited
    expect(received).toHaveLength(10);
    expect(received.every((s) => s.length === chunkSize)).toBe(true);
    // Verify stats
    const stats = manager.getOutputStats(snap.sessionId, "user-1");
    expect(stats!.delivered).toBe(chunkSize * 10);
    expect(stats!.dropped).toBe(0);
  });

  it("genuinely excessive single chunk is bounded/dropped safely", () => {
    const received: string[] = [];
    const onOutputDropped = vi.fn();
    const snap = manager.create({
      ...makeOpts({ allowedRoot: tempRoot, onData: (data) => received.push(data) }),
      onOutputDropped,
    });
    // Emit a single chunk larger than MAX_OUTPUT_CHUNK
    const hugeChunk = "x".repeat(MAX_OUTPUT_CHUNK + 1);
    factory.hostSpawns[0].emitData(hugeChunk);
    // The oversized chunk is dropped — not delivered
    expect(received).toHaveLength(0);
    expect(onOutputDropped).toHaveBeenCalledWith({
      sessionId: snap.sessionId,
      dropped: hugeChunk.length,
    });
    // Stats show dropped
    const stats = manager.getOutputStats(snap.sessionId, "user-1");
    expect(stats!.delivered).toBe(0);
    expect(stats!.dropped).toBe(hugeChunk.length);
    // Session is still alive — a subsequent normal chunk works
    factory.hostSpawns[0].emitData("normal output\r\n");
    expect(received).toEqual(["normal output\r\n"]);
  });

  it("output stats are not exposed in session snapshot (safe shape)", () => {
    const snap = manager.create(makeOpts({ allowedRoot: tempRoot }));
    const keys = Object.keys(snap);
    expect(keys).not.toContain("totalOutputDelivered");
    expect(keys).not.toContain("totalOutputDropped");
    expect(keys).not.toContain("outputBuffered");
    expect(keys).not.toContain("pendingOutput");
    expect(keys).not.toContain("pendingOutputBytes");
    expect(keys).not.toContain("bpDroppedChunks");
    expect(keys).not.toContain("bpTotalDroppedChunks");
    expect(keys).not.toContain("bpWarnPending");
  });

  // ─── Backpressure: unbounded queue prevention ───────────────────

  it("BACKPRESSURE: thousands of normal chunks with slow consumer do NOT create an unbounded queue", () => {
    const received: string[] = [];
    let writable = false;
    const snap = manager.create(makeOpts({
      allowedRoot: tempRoot,
      onData: (data) => received.push(data),
      isTransportWritable: () => writable,
      maxPendingOutputBytes: 50 * 1024, // 50 KiB cap for fast test
    }));

    // Emit 2000 chunks of 10 KiB each = ~20 MiB total.
    // With a 50 KiB pending cap, the queue must never exceed 50 KiB.
    const chunkSize = 10 * 1024;
    const chunk = "x".repeat(chunkSize);
    let maxPendingObserved = 0;
    for (let i = 0; i < 2000; i++) {
      factory.hostSpawns[0].emitData(chunk);
      const stats = manager.getOutputStats(snap.sessionId, "user-1");
      if (stats!.pendingBytes > maxPendingObserved) {
        maxPendingObserved = stats!.pendingBytes;
      }
    }

    // The pending buffer never exceeded the cap.
    expect(maxPendingObserved).toBeLessThanOrEqual(50 * 1024);
    // Most output was dropped (transport never writable).
    const stats = manager.getOutputStats(snap.sessionId, "user-1");
    expect(stats!.bpDroppedChunks).toBeGreaterThan(0);
    expect(stats!.dropped).toBeGreaterThan(0);
    // Nothing was delivered to the consumer (transport always unwritable).
    expect(received).toHaveLength(0);
    // Total delivered + pending + dropped accounts for all emitted bytes.
    const totalEmitted = chunkSize * 2000;
    expect(stats!.delivered + stats!.pendingBytes + stats!.dropped).toBe(totalEmitted);
  });

  it("BACKPRESSURE: output resumes when consumer becomes writable again", () => {
    const received: string[] = [];
    let writable = false;
    const snap = manager.create(makeOpts({
      allowedRoot: tempRoot,
      onData: (data) => received.push(data),
      isTransportWritable: () => writable,
      maxPendingOutputBytes: 100 * 1024, // 100 KiB cap
    }));

    // Emit chunks while transport is unwritable — they get buffered.
    const chunk = "y".repeat(1024); // 1 KiB chunks
    for (let i = 0; i < 50; i++) {
      factory.hostSpawns[0].emitData(chunk);
    }
    // Some output is buffered (50 KiB < 100 KiB cap, so all buffered)
    let stats = manager.getOutputStats(snap.sessionId, "user-1");
    expect(stats!.pendingBytes).toBe(50 * 1024);
    expect(stats!.pendingChunks).toBe(50);
    expect(received).toHaveLength(0);

    // Now the transport becomes writable — emit one more chunk to trigger flush.
    writable = true;
    factory.hostSpawns[0].emitData(chunk);

    // All pending + the new chunk should be delivered.
    expect(received).toHaveLength(51);
    stats = manager.getOutputStats(snap.sessionId, "user-1");
    expect(stats!.pendingBytes).toBe(0);
    expect(stats!.pendingChunks).toBe(0);
    expect(stats!.delivered).toBe(51 * 1024);
    expect(stats!.dropped).toBe(0);
  });

  it("BACKPRESSURE: flushPendingOutput flushes buffered data without a new PTY chunk", () => {
    const received: string[] = [];
    let writable = false;
    const snap = manager.create(makeOpts({
      allowedRoot: tempRoot,
      onData: (data) => received.push(data),
      isTransportWritable: () => writable,
      maxPendingOutputBytes: 100 * 1024,
    }));

    // Buffer some output while transport is down.
    const chunk = "z".repeat(2048);
    for (let i = 0; i < 10; i++) {
      factory.hostSpawns[0].emitData(chunk);
    }
    expect(manager.getOutputStats(snap.sessionId, "user-1")!.pendingChunks).toBe(10);

    // Transport becomes writable — flush via public method (no new PTY chunk needed).
    writable = true;
    manager.flushPendingOutput(snap.sessionId);

    expect(received).toHaveLength(10);
    const stats = manager.getOutputStats(snap.sessionId, "user-1");
    expect(stats!.pendingBytes).toBe(0);
    expect(stats!.pendingChunks).toBe(0);
  });

  it("BACKPRESSURE: throttled warning is emitted once per interval on flush, not per drop", () => {
    const received: string[] = [];
    const bpWarning = vi.fn();
    let writable = false;
    const snap = manager.create(makeOpts({
      allowedRoot: tempRoot,
      onData: (data) => received.push(data),
      isTransportWritable: () => writable,
      maxPendingOutputBytes: 10 * 1024, // 10 KiB cap — drops happen fast
      onBackpressureWarning: bpWarning,
    }));

    // Emit many chunks while unwritable — most get dropped.
    const chunk = "d".repeat(1024);
    for (let i = 0; i < 100; i++) {
      factory.hostSpawns[0].emitData(chunk);
    }

    // Warning callback not fired yet (transport still unwritable).
    expect(bpWarning).not.toHaveBeenCalled();

    // Transport becomes writable — emit one more chunk to trigger flush.
    writable = true;
    factory.hostSpawns[0].emitData(chunk);

    // Exactly ONE warning was emitted (throttled), not one per dropped chunk.
    expect(bpWarning).toHaveBeenCalledTimes(1);
    const warningArg = bpWarning.mock.calls[0][0];
    expect(warningArg.sessionId).toBe(snap.sessionId);
    expect(warningArg.droppedChunks).toBeGreaterThan(0);
    expect(warningArg.droppedBytes).toBeGreaterThan(0);

    // Now drop more output while unwritable again.
    writable = false;
    for (let i = 0; i < 100; i++) {
      factory.hostSpawns[0].emitData(chunk);
    }

    // Advance time past the throttle interval.
    vi.advanceTimersByTime(OUTPUT_DROP_WARN_INTERVAL_MS + 1);

    // Transport writable again — trigger flush.
    writable = true;
    factory.hostSpawns[0].emitData(chunk);

    // Second warning fired (after throttle interval elapsed).
    expect(bpWarning).toHaveBeenCalledTimes(2);
  });

  it("BACKPRESSURE: warning is NOT emitted if no output was dropped (only buffered)", () => {
    const bpWarning = vi.fn();
    let writable = false;
    const snap = manager.create(makeOpts({
      allowedRoot: tempRoot,
      isTransportWritable: () => writable,
      maxPendingOutputBytes: 100 * 1024,
      onBackpressureWarning: bpWarning,
    }));

    // Buffer output within the cap — no drops.
    const chunk = "b".repeat(1024);
    for (let i = 0; i < 50; i++) {
      factory.hostSpawns[0].emitData(chunk);
    }

    // Transport becomes writable — flush.
    writable = true;
    manager.flushPendingOutput(snap.sessionId);

    // No warning — nothing was dropped.
    expect(bpWarning).not.toHaveBeenCalled();
    const stats = manager.getOutputStats(snap.sessionId, "user-1");
    expect(stats!.dropped).toBe(0);
    expect(stats!.bpDroppedChunks).toBe(0);
  });

  it("BACKPRESSURE: dropped-output accounting does not leak into public session snapshots", () => {
    let writable = false;
    const snap = manager.create(makeOpts({
      allowedRoot: tempRoot,
      isTransportWritable: () => writable,
      maxPendingOutputBytes: 10 * 1024,
    }));

    // Cause some drops.
    const chunk = "x".repeat(1024);
    for (let i = 0; i < 100; i++) {
      factory.hostSpawns[0].emitData(chunk);
    }

    // The public snapshot must not expose internal backpressure fields.
    const publicSnap = manager.get(snap.sessionId, "user-1");
    expect(publicSnap).not.toBe(null);
    const keys = Object.keys(publicSnap!);
    expect(keys).not.toContain("pendingOutput");
    expect(keys).not.toContain("pendingOutputBytes");
    expect(keys).not.toContain("bpDroppedChunks");
    expect(keys).not.toContain("bpDroppedBytes");
    expect(keys).not.toContain("bpTotalDroppedChunks");
    expect(keys).not.toContain("bpWarnPending");
    expect(keys).not.toContain("flushScheduled");
    expect(keys).not.toContain("emitData");
    expect(keys).not.toContain("isTransportWritable");

    // But getOutputStats DOES expose them (for observability/testing).
    const stats = manager.getOutputStats(snap.sessionId, "user-1");
    expect(stats!.bpDroppedChunks).toBeGreaterThan(0);
    expect(stats!.pendingBytes).toBeLessThanOrEqual(10 * 1024);
  });

  it("BACKPRESSURE: without isTransportWritable, behavior is unchanged (always writable)", () => {
    // No isTransportWritable predicate → backward compatible, always writable.
    const received: string[] = [];
    const snap = manager.create(makeOpts({
      allowedRoot: tempRoot,
      onData: (data) => received.push(data),
    }));

    // Emit many chunks — all should be delivered directly (no buffering).
    const chunk = "x".repeat(10 * 1024);
    for (let i = 0; i < 100; i++) {
      factory.hostSpawns[0].emitData(chunk);
    }
    expect(received).toHaveLength(100);
    const stats = manager.getOutputStats(snap.sessionId, "user-1");
    expect(stats!.pendingBytes).toBe(0);
    expect(stats!.pendingChunks).toBe(0);
    expect(stats!.dropped).toBe(0);
    expect(stats!.bpDroppedChunks).toBe(0);
  });

  it("BACKPRESSURE: pending buffer is freed on session kill", () => {
    let writable = false;
    const snap = manager.create(makeOpts({
      allowedRoot: tempRoot,
      isTransportWritable: () => writable,
      maxPendingOutputBytes: 100 * 1024,
    }));

    // Buffer some output.
    const chunk = "x".repeat(1024);
    for (let i = 0; i < 50; i++) {
      factory.hostSpawns[0].emitData(chunk);
    }
    expect(manager.getOutputStats(snap.sessionId, "user-1")!.pendingBytes).toBe(50 * 1024);

    // Kill the session — pending buffer should be freed.
    manager.kill(snap.sessionId, "test", "user-1");
    // Session is gone — getOutputStats returns null.
    expect(manager.getOutputStats(snap.sessionId, "user-1")).toBe(null);
  });

  // ─── Race condition: early PTY output during spawn ──────────────

  it("EARLY OUTPUT: data emitted synchronously during spawn is NOT dropped", () => {
    // Use a custom factory that emits data synchronously inside spawnHost,
    // before create() has returned. This simulates a PTY that writes a
    // banner or prompt immediately on spawn.
    const received: string[] = [];
    const earlyOutput = "Welcome to LiTT shell\r\n";
    const earlyExitCode = 0;

    const raceFactory: PtySpawnFactory = {
      spawnHost({ onData, onExit }): PtyProcessHandle {
        // Emit data BEFORE returning the handle — the session must
        // already be in the map for wrappedOnData to find it.
        onData(earlyOutput);
        onExit({ exitCode: earlyExitCode });
        return {
          write: () => {},
          resize: () => {},
          kill: () => {},
        };
      },
      spawnDocker(): PtyProcessHandle {
        throw new Error("not used");
      },
    };

    const raceManager = new PtySessionManager(
      { maxConcurrentPerUser: 3, idleTimeoutMs: 10_000, absoluteLifetimeMs: 60_000 },
      raceFactory,
    );

    try {
      const onExit = vi.fn();
      const snap = raceManager.create({
        userId: "user-1",
        projectId: "proj-1",
        workspaceId: "ws-1",
        cwd: tempRoot,
        allowedRoot: tempRoot,
        useDocker: false,
        onData: (data) => received.push(data),
        onExit,
      });

      // The early output was delivered, not silently dropped.
      expect(received).toEqual([earlyOutput]);

      // The early exit was recorded — the snapshot already reflects it
      // because the session was in the map before spawn (the fix).
      expect(snap.exited).toBe(true);
      expect(snap.exitCode).toBe(earlyExitCode);
      const afterExit = raceManager.get(snap.sessionId, "user-1");
      expect(afterExit).not.toBe(null);
      expect(afterExit!.exited).toBe(true);
      expect(afterExit!.exitCode).toBe(earlyExitCode);

      // onExit callback was fired.
      expect(onExit).toHaveBeenCalledWith({
        sessionId: snap.sessionId,
        exitCode: earlyExitCode,
        signal: undefined,
      });
    } finally {
      raceManager.shutdown();
    }
  });

  it("EARLY OUTPUT: spawn failure cleans up the placeholder session", () => {
    const failFactory: PtySpawnFactory = {
      spawnHost(): PtyProcessHandle {
        throw new Error("spawn failed");
      },
      spawnDocker(): PtyProcessHandle {
        throw new Error("not used");
      },
    };

    const failManager = new PtySessionManager(
      { maxConcurrentPerUser: 3, idleTimeoutMs: 10_000, absoluteLifetimeMs: 60_000 },
      failFactory,
    );

    try {
      expect(() =>
        failManager.create({
          userId: "user-1",
          projectId: "proj-1",
          workspaceId: "ws-1",
          cwd: tempRoot,
          allowedRoot: tempRoot,
          useDocker: false,
          onData: vi.fn(),
          onExit: vi.fn(),
        }),
      ).toThrow(/spawn failed/);

      // The placeholder session was cleaned up — no ghost entry.
      expect(failManager.size).toBe(0);
    } finally {
      failManager.shutdown();
    }
  });
});

// ─── PTY environment isolation tests ──────────────────────────────
//
// A remote LiTT shell must NEVER inherit the terminal server's own
// credentials. These tests prove that:
//   1. Safe env vars (PATH, HOME, TERM, etc.) reach the PTY
//   2. Known server secrets do NOT reach the PTY
//   3. An arbitrary newly-added secret does NOT automatically propagate
//   4. PATH and required shell variables still work
//   5. The synchronous early-output/early-exit regression remains fixed
//   6. Spawn failure still removes the placeholder session

describe("PTY environment isolation", () => {
  let factory: ReturnType<typeof createMockFactory>;
  let manager: PtySessionManager;
  let tempRoot: string;
  let savedEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    vi.useFakeTimers();
    factory = createMockFactory();
    manager = new PtySessionManager(
      { maxConcurrentPerUser: 3, idleTimeoutMs: 10_000, absoluteLifetimeMs: 60_000 },
      factory,
    );
    tempRoot = mkdtempSync(join(tmpdir(), "pty-env-test-"));
    // Save and restore process.env so tests can inject fake secrets
    // without leaking them to other test suites.
    savedEnv = { ...process.env };
  });

  afterEach(() => {
    // Restore process.env
    for (const key of Object.keys(process.env)) {
      if (!(key in savedEnv)) delete process.env[key];
    }
    for (const [key, val] of Object.entries(savedEnv)) {
      if (val === undefined) delete process.env[key];
      else process.env[key] = val;
    }
    manager.shutdown();
    vi.useRealTimers();
    rmSync(tempRoot, { recursive: true, force: true });
  });

  it("safe environment variables reach the PTY", () => {
    // Set safe vars in process.env
    process.env.PATH = "/usr/local/bin:/usr/bin:/bin";
    process.env.HOME = "/home/testuser";
    process.env.USER = "testuser";
    process.env.SHELL = "/bin/bash";
    process.env.LANG = "en_US.UTF-8";
    process.env.TZ = "America/New_York";
    process.env.EDITOR = "vim";

    manager.create(makeOpts({ allowedRoot: tempRoot }));

    const env = factory.hostSpawns[0].spawnEnv;
    expect(env.PATH).toBe("/usr/local/bin:/usr/bin:/bin");
    expect(env.HOME).toBe("/home/testuser");
    expect(env.USER).toBe("testuser");
    expect(env.SHELL).toBe("/bin/bash");
    expect(env.LANG).toBe("en_US.UTF-8");
    expect(env.TZ).toBe("America/New_York");
    expect(env.EDITOR).toBe("vim");
    // TERM is always forced
    expect(env.TERM).toBe("xterm-256color");
  });

  it("known server secrets do NOT reach the PTY", () => {
    // Inject all known secrets into process.env
    for (const secret of KNOWN_SECRETS_TO_REJECT) {
      process.env[secret] = `fake-${secret}-value`;
    }
    // Also add RAILWAY_* vars
    process.env.RAILWAY_PROJECT_ID = "fake-project-id";
    process.env.RAILWAY_SERVICE_ID = "fake-service-id";
    process.env.RAILWAY_ENVIRONMENT = "production";
    process.env.RAILWAY_STATIC_URL = "fake.railway.app";

    manager.create(makeOpts({ allowedRoot: tempRoot }));

    const env = factory.hostSpawns[0].spawnEnv;
    // Every known secret must be absent
    for (const secret of KNOWN_SECRETS_TO_REJECT) {
      expect(env).not.toHaveProperty(secret);
    }
    // RAILWAY_* must be absent
    expect(env).not.toHaveProperty("RAILWAY_PROJECT_ID");
    expect(env).not.toHaveProperty("RAILWAY_SERVICE_ID");
    expect(env).not.toHaveProperty("RAILWAY_ENVIRONMENT");
    expect(env).not.toHaveProperty("RAILWAY_STATIC_URL");
  });

  it("an arbitrary newly-added secret does NOT automatically propagate", () => {
    // Simulate a future secret that doesn't exist in any denylist.
    // The allowlist approach means this should NEVER leak.
    process.env.FUTURE_SECRET_API_KEY = "sk-future-12345";
    process.env.SOME_NEW_DATABASE_TOKEN = "tok-abcde";
    process.env.MY_COMPANY_INTERNAL_SECRET = "secret-xyz";

    manager.create(makeOpts({ allowedRoot: tempRoot }));

    const env = factory.hostSpawns[0].spawnEnv;
    expect(env).not.toHaveProperty("FUTURE_SECRET_API_KEY");
    expect(env).not.toHaveProperty("SOME_NEW_DATABASE_TOKEN");
    expect(env).not.toHaveProperty("MY_COMPANY_INTERNAL_SECRET");
  });

  it("PATH and required shell variables still work", () => {
    process.env.PATH = "/usr/bin:/bin";
    process.env.HOME = "/home/user";
    // Set SystemRoot with the canonical Windows casing
    process.env.SystemRoot = "C:\\Windows";

    manager.create(makeOpts({ allowedRoot: tempRoot }));

    const env = factory.hostSpawns[0].spawnEnv;
    expect(env.PATH).toBe("/usr/bin:/bin");
    expect(env.HOME).toBe("/home/user");
    // SystemRoot is in the allowlist — should pass through.
    // On Windows, env var matching is case-insensitive, so "SystemRoot"
    // in the allowlist matches "SystemRoot" in process.env.
    // The key is preserved with its original casing from process.env.
    const systemRootKey = Object.keys(env).find(
      (k) => k.toUpperCase() === "SYSTEMROOT",
    );
    expect(systemRootKey).toBeTruthy();
    expect(env[systemRootKey!]).toBe("C:\\Windows");
  });

  it("LiTT workspace variables are injected and are NOT secrets", () => {
    manager.create(makeOpts({
      allowedRoot: tempRoot,
      userId: "user-42",
      workspaceId: "ws-99",
      projectId: "proj-7",
    }));

    const env = factory.hostSpawns[0].spawnEnv;
    expect(env.LITTREE_USER_ID).toBe("user-42");
    expect(env.LITTREE_SESSION_ID).toBeTruthy();
    expect(env.LITTREE_WORKSPACE_ID).toBe("ws-99");
    expect(env.LITTREE_PROJECT_ID).toBe("proj-7");
    // These are workspace context, not secrets — no key/token/password patterns
    expect(env.LITTREE_USER_ID).not.toMatch(/key|token|secret|password/i);
  });

  it("buildPtyEnv unit test — allowlist only, no process.env spread", () => {
    const fakeServerEnv: NodeJS.ProcessEnv = {
      PATH: "/usr/bin",
      HOME: "/home/test",
      TERM: "dumb", // should be overridden to xterm-256color
      OPENAI_API_KEY: "sk-leaked",
      DATABASE_URL: "postgres://user:pass@host/db",
      RAILWAY_PROJECT_ID: "proj-123",
      TERMINAL_AUTH_SECRET: "super-secret",
      SOME_RANDOM_VAR: "should-not-pass",
    };

    const env = buildPtyEnv(fakeServerEnv, {
      userId: "u1",
      sessionId: "s1",
      workspaceId: "w1",
      projectId: "p1",
    });

    // Safe vars pass through
    expect(env.PATH).toBe("/usr/bin");
    expect(env.HOME).toBe("/home/test");
    // TERM is forced
    expect(env.TERM).toBe("xterm-256color");
    // LiTT vars injected
    expect(env.LITTREE_USER_ID).toBe("u1");
    expect(env.LITTREE_SESSION_ID).toBe("s1");
    expect(env.LITTREE_WORKSPACE_ID).toBe("w1");
    expect(env.LITTREE_PROJECT_ID).toBe("p1");

    // Secrets are absent
    expect(env).not.toHaveProperty("OPENAI_API_KEY");
    expect(env).not.toHaveProperty("DATABASE_URL");
    expect(env).not.toHaveProperty("RAILWAY_PROJECT_ID");
    expect(env).not.toHaveProperty("TERMINAL_AUTH_SECRET");
    expect(env).not.toHaveProperty("SOME_RANDOM_VAR");
  });

  it("the synchronous early-output/early-exit regression remains fixed", () => {
    // This is a re-confirmation of the race fix, in the env isolation suite,
    // to ensure the env allowlist change didn't break the spawn-before-map fix.
    const received: string[] = [];
    const earlyOutput = "banner\r\n";
    const earlyExitCode = 0;

    const raceFactory: PtySpawnFactory = {
      spawnHost({ onData, onExit }): PtyProcessHandle {
        onData(earlyOutput);
        onExit({ exitCode: earlyExitCode });
        return { write: () => {}, resize: () => {}, kill: () => {} };
      },
      spawnDocker(): PtyProcessHandle {
        throw new Error("not used");
      },
    };

    const raceManager = new PtySessionManager(
      { maxConcurrentPerUser: 3, idleTimeoutMs: 10_000, absoluteLifetimeMs: 60_000 },
      raceFactory,
    );

    try {
      const snap = raceManager.create({
        userId: "user-1",
        projectId: "proj-1",
        workspaceId: "ws-1",
        cwd: tempRoot,
        allowedRoot: tempRoot,
        useDocker: false,
        onData: (data) => received.push(data),
        onExit: vi.fn(),
      });
      expect(received).toEqual([earlyOutput]);
      expect(snap.exited).toBe(true);
      expect(snap.exitCode).toBe(earlyExitCode);
    } finally {
      raceManager.shutdown();
    }
  });

  it("spawn failure still removes the placeholder session", () => {
    const failFactory: PtySpawnFactory = {
      spawnHost(): PtyProcessHandle {
        throw new Error("spawn failed");
      },
      spawnDocker(): PtyProcessHandle {
        throw new Error("not used");
      },
    };

    const failManager = new PtySessionManager(
      { maxConcurrentPerUser: 3, idleTimeoutMs: 10_000, absoluteLifetimeMs: 60_000 },
      failFactory,
    );

    try {
      expect(() =>
        failManager.create({
          userId: "user-1",
          projectId: "proj-1",
          workspaceId: "ws-1",
          cwd: tempRoot,
          allowedRoot: tempRoot,
          useDocker: false,
          onData: vi.fn(),
          onExit: vi.fn(),
        }),
      ).toThrow(/spawn failed/);
      expect(failManager.size).toBe(0);
    } finally {
      failManager.shutdown();
    }
  });
});

// ─── Workspace boundary validation tests ──────────────────────────

describe("validateWorkspacePath", () => {
  let tempRoot: string;

  beforeEach(() => {
    tempRoot = mkdtempSync(join(tmpdir(), "pty-ws-test-"));
  });

  afterEach(() => {
    rmSync(tempRoot, { recursive: true, force: true });
  });

  it("accepts the root itself", () => {
    expect(validateWorkspacePath(tempRoot, tempRoot)).toBe(tempRoot);
  });

  it("accepts a subdirectory inside root", () => {
    const sub = join(tempRoot, "subdir");
    mkdirSync(sub);
    expect(validateWorkspacePath(tempRoot, sub)).toBe(sub);
  });

  it("accepts a relative path inside root", () => {
    const sub = join(tempRoot, "subdir");
    mkdirSync(sub);
    expect(validateWorkspacePath(tempRoot, "subdir")).toBe(sub);
  });

  it("rejects empty cwd", () => {
    expect(() => validateWorkspacePath(tempRoot, "")).toThrow(/empty path/);
  });

  it("rejects path traversal with ..", () => {
    expect(() => validateWorkspacePath(tempRoot, "../../etc/passwd")).toThrow(/escapes workspace root/);
  });

  it("rejects absolute path outside root", () => {
    expect(() => validateWorkspacePath(tempRoot, "/etc/passwd")).toThrow(/escapes workspace root/);
  });

  it("rejects non-existent path", () => {
    expect(() => validateWorkspacePath(tempRoot, join(tempRoot, "noexist"))).toThrow(/does not exist/);
  });

  it("rejects symlink escape", () => {
    // Create a symlink inside root that points outside
    const outside = mkdtempSync(join(tmpdir(), "pty-outside-"));
    try {
      const linkPath = join(tempRoot, "escape-link");
      symlinkSync(outside, linkPath, "dir");
      expect(() => validateWorkspacePath(tempRoot, "escape-link")).toThrow(/symlink escape/);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it("accepts symlink inside root (no escape)", () => {
    // Create a symlink inside root that points to another dir inside root
    const realDir = join(tempRoot, "real-dir");
    mkdirSync(realDir);
    const linkPath = join(tempRoot, "safe-link");
    symlinkSync(realDir, linkPath, "dir");
    expect(validateWorkspacePath(tempRoot, "safe-link")).toBe(realDir);
  });
});

// ─── Create security chain confirmation ───────────────────────────
//
// Proves the full chain:
//   caller-supplied userId (from JWT sub in server.ts)
//     → server-resolved allowedRoot (from WorkspaceDescriptor in server.ts)
//       → validateWorkspacePath(allowedRoot, cwd) before spawn
//         → PTY session created with verified ownership
//
// Confirms that projectId, workspaceId, userId, and allowedRoot
// are caller-controlled (server.ts passes JWT-derived values, not
// client payload values) and that session operations enforce ownership.

describe("Create security chain", () => {
  let factory: ReturnType<typeof createMockFactory>;
  let manager: PtySessionManager;
  let tempRoot: string;
  let otherRoot: string;

  beforeEach(() => {
    vi.useFakeTimers();
    factory = createMockFactory();
    manager = new PtySessionManager(
      { maxConcurrentPerUser: 3, idleTimeoutMs: 10_000, absoluteLifetimeMs: 60_000 },
      factory,
    );
    tempRoot = mkdtempSync(join(tmpdir(), "pty-chain-a-"));
    otherRoot = mkdtempSync(join(tmpdir(), "pty-chain-b-"));
  });

  afterEach(() => {
    manager.shutdown();
    vi.useRealTimers();
    rmSync(tempRoot, { recursive: true, force: true });
    rmSync(otherRoot, { recursive: true, force: true });
  });

  it("create rejects cwd outside allowedRoot (path traversal)", () => {
    expect(() =>
      manager.create({
        userId: "user-1",
        projectId: "proj-1",
        workspaceId: "ws-1",
        cwd: join(otherRoot, "escaped"),
        allowedRoot: tempRoot,
        useDocker: false,
        onData: vi.fn(),
        onExit: vi.fn(),
      }),
    ).toThrow(/escapes workspace root|does not exist/);
  });

  it("create rejects cwd with .. traversal", () => {
    expect(() =>
      manager.create({
        userId: "user-1",
        projectId: "proj-1",
        workspaceId: "ws-1",
        cwd: "../../etc/passwd",
        allowedRoot: tempRoot,
        useDocker: false,
        onData: vi.fn(),
        onExit: vi.fn(),
      }),
    ).toThrow(/escapes workspace root/);
  });

  it("create stores the caller-supplied userId — session is owned by that user", () => {
    const snap = manager.create({
      userId: "user-from-jwt",
      projectId: "proj-from-workspace",
      workspaceId: "ws-from-workspace",
      cwd: tempRoot,
      allowedRoot: tempRoot,
      useDocker: false,
      onData: vi.fn(),
      onExit: vi.fn(),
    });
    expect(snap.userId).toBe("user-from-jwt");
    expect(snap.projectId).toBe("proj-from-workspace");
    expect(snap.workspaceId).toBe("ws-from-workspace");
    // A different user cannot access this session
    expect(manager.get(snap.sessionId, "attacker")).toBe(null);
    expect(manager.input(snap.sessionId, "ls", "attacker")).toBe(false);
    expect(manager.resize(snap.sessionId, 80, 24, "attacker")).toBe(false);
    expect(manager.kill(snap.sessionId, "test", "attacker")).toBe(false);
  });

  it("create canonicalizes cwd via realpathSync — symlink escape rejected", () => {
    // Create a symlink inside tempRoot pointing to otherRoot
    symlinkSync(otherRoot, join(tempRoot, "escape"), "dir");
    expect(() =>
      manager.create({
        userId: "user-1",
        projectId: "proj-1",
        workspaceId: "ws-1",
        cwd: "escape",
        allowedRoot: tempRoot,
        useDocker: false,
        onData: vi.fn(),
        onExit: vi.fn(),
      }),
    ).toThrow(/symlink escape/);
  });

  it("create with different allowedRoot for different user — sessions are isolated", () => {
    // User A gets a session in tempRoot
    const snapA = manager.create({
      userId: "user-a",
      cwd: tempRoot,
      allowedRoot: tempRoot,
      useDocker: false,
      onData: vi.fn(),
      onExit: vi.fn(),
    });
    // User B gets a session in otherRoot
    const snapB = manager.create({
      userId: "user-b",
      cwd: otherRoot,
      allowedRoot: otherRoot,
      useDocker: false,
      onData: vi.fn(),
      onExit: vi.fn(),
    });
    // User A cannot touch User B's session
    expect(manager.input(snapB.sessionId, "ls", "user-a")).toBe(false);
    expect(manager.kill(snapB.sessionId, "test", "user-a")).toBe(false);
    // User B cannot touch User A's session
    expect(manager.input(snapA.sessionId, "ls", "user-b")).toBe(false);
    expect(manager.kill(snapA.sessionId, "test", "user-b")).toBe(false);
    // Each user can access their own
    expect(manager.input(snapA.sessionId, "ls", "user-a")).toBe(true);
    expect(manager.input(snapB.sessionId, "ls", "user-b")).toBe(true);
  });
});
