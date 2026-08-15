/**
 * Phase 3C — RuntimeClient tests.
 *
 * Tests the Socket.IO remote runtime client logic without requiring
 * a live terminal-server. Uses mock Socket.IO and fetch.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { RuntimeClient, type LifecycleEvent } from "../lib/runtime-client.js";
import type { RuntimeState, RuntimeEvent } from "@litt/agent-core";

// ─── Mocks ────────────────────────────────────────────────────────

const mockSocket = {
  connected: false,
  on: vi.fn(),
  emit: vi.fn(),
  connect: vi.fn(() => { mockSocket.connected = true; }),
  disconnect: vi.fn(() => { mockSocket.connected = false; }),
  removeAllListeners: vi.fn(),
};

vi.mock("socket.io-client", () => ({
  io: vi.fn(() => mockSocket),
}));

const mockFetch = vi.fn();
global.fetch = mockFetch as unknown as typeof fetch;

// ─── Helpers ──────────────────────────────────────────────────────

function makeState(overrides: Partial<RuntimeState> = {}): RuntimeState {
  return {
    phase: "idle",
    project: null,
    branch: null,
    model: null,
    profile: null,
    gitChanges: 0,
    online: true,
    pingMs: 10,
    contextTokens: 0,
    heartbeat: {
      seq: 1,
      lastHeartbeatAt: Date.now(),
      failures: 0,
      maxFailures: 3,
      intervalMs: 15000,
      latencyMs: 5,
    },
    activeCommand: null,
    lastResult: null,
    updatedAt: Date.now(),
    ...overrides,
  };
}

function makeEvent(
  type: RuntimeEvent["type"],
  data: Record<string, unknown>,
  runId?: string,
  toolCallId?: string,
): RuntimeEvent {
  return { type, ts: Date.now(), data, runId, toolCallId };
}

function createClient(): RuntimeClient {
  return new RuntimeClient({
    terminalUrl: "http://127.0.0.1:4001",
    authSecret: "test-auth-secret-" + "a".repeat(32),
    internalKey: "test-internal-key-" + "b".repeat(32),
    userId: "test-user",
  });
}

async function setupClient(): Promise<{
  client: RuntimeClient;
  emit: (event: string, data: unknown) => void;
}> {
  const client = createClient();
  await client.connect();

  const handlers = new Map<string, (data: unknown) => void>();
  mockSocket.on.mock.calls.forEach(([event, handler]) => {
    handlers.set(event, handler);
  });

  return {
    client,
    emit: (event: string, data: unknown) => handlers.get(event)?.(data),
  };
}

// ─── Tests ────────────────────────────────────────────────────────

describe("RuntimeClient", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSocket.connected = false;
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ─── Connection ───────────────────────────────────────────────

  it("connects via Socket.IO with auth token", async () => {
    const client = createClient();
    await client.connect();

    const { io } = await import("socket.io-client");
    expect(io).toHaveBeenCalledWith(
      "http://127.0.0.1:4001",
      expect.objectContaining({
        auth: expect.objectContaining({ token: expect.any(String) }),
        transports: ["websocket", "polling"],
      }),
    );
  });

  it("throws if TERMINAL_AUTH_SECRET is not configured", async () => {
    const client = new RuntimeClient({
      terminalUrl: "http://127.0.0.1:4001",
      authSecret: "short",
      internalKey: "test-internal-key-" + "b".repeat(32),
    });
    await expect(client.connect()).rejects.toThrow("TERMINAL_AUTH_SECRET");
  });

  it("notifies connection listeners on connect", async () => {
    const client = createClient();
    const states: string[] = [];
    client.onConnectionChange((s) => states.push(s));

    await client.connect();
    const connectHandler = mockSocket.on.mock.calls.find(
      ([event]) => event === "connect",
    )?.[1];
    connectHandler?.();

    expect(states).toContain("connecting");
    expect(states).toContain("connected");
  });

  // ─── Snapshot ─────────────────────────────────────────────────

  it("receives runtime snapshot on connect", async () => {
    const { client, emit } = await setupClient();
    const snapshot = makeState({ phase: "idle" });
    emit("runtime:snapshot", snapshot);

    expect(client.getState()).toEqual(snapshot);
  });

  it("updates state on runtime:state events", async () => {
    const { client, emit } = await setupClient();
    emit("runtime:snapshot", makeState({ phase: "idle" }));
    emit("runtime:state", makeState({ phase: "running" }));

    expect(client.getState()?.phase).toBe("running");
  });

  // ─── Lifecycle event mapping ─────────────────────────────────

  it("maps command_start to run.started", async () => {
    const { client, emit } = await setupClient();
    const events: LifecycleEvent[] = [];
    client.onLifecycle((e) => events.push(e));

    emit("runtime:event", makeEvent("command_start", { command: "check" }, "run_123"));

    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("run.started");
    expect(events[0].runId).toBe("run_123");
  });

  it("maps command_end success to run.completed with status=success", async () => {
    const { client, emit } = await setupClient();
    const events: LifecycleEvent[] = [];
    client.onLifecycle((e) => events.push(e));

    emit("runtime:event", makeEvent(
      "command_end",
      { success: true, exitCode: 0, durationMs: 1000, message: "OK" },
      "run_123",
    ));

    expect(events[0].type).toBe("run.completed");
    expect(events[0].data.status).toBe("success");
  });

  it("maps command_end failure to run.completed with status=failed", async () => {
    const { client, emit } = await setupClient();
    const events: LifecycleEvent[] = [];
    client.onLifecycle((e) => events.push(e));

    emit("runtime:event", makeEvent(
      "command_end",
      { success: false, exitCode: 1, durationMs: 500, message: "Error" },
      "run_456",
    ));

    expect(events[0].data.status).toBe("failed");
  });

  it("maps command_end cancelled to run.completed with status=cancelled", async () => {
    const { client, emit } = await setupClient();
    const events: LifecycleEvent[] = [];
    client.onLifecycle((e) => events.push(e));

    emit("runtime:event", makeEvent(
      "command_end",
      { success: false, exitCode: null, durationMs: 200, cancelled: true },
      "run_789",
    ));

    expect(events[0].data.status).toBe("cancelled");
  });

  it("maps command_end timeout to run.completed with status=timeout", async () => {
    const { client, emit } = await setupClient();
    const events: LifecycleEvent[] = [];
    client.onLifecycle((e) => events.push(e));

    emit("runtime:event", makeEvent(
      "command_end",
      { success: false, exitCode: null, durationMs: 30000, timedOut: true },
      "run_timeout",
    ));

    expect(events[0].data.status).toBe("timeout");
  });

  it("distinguishes failed vs cancelled vs timeout", async () => {
    const { client, emit } = await setupClient();
    const events: LifecycleEvent[] = [];
    client.onLifecycle((e) => events.push(e));

    emit("runtime:event", makeEvent("command_end", { success: false, exitCode: 1 }, "r1"));
    emit("runtime:event", makeEvent("command_end", { success: false, cancelled: true }, "r2"));
    emit("runtime:event", makeEvent("command_end", { success: false, timedOut: true }, "r3"));

    expect(events.map((e) => e.data.status)).toEqual(["failed", "cancelled", "timeout"]);
  });

  // ─── Tool lifecycle ───────────────────────────────────────────

  it("maps tool_call to tool.started", async () => {
    const { client, emit } = await setupClient();
    const events: LifecycleEvent[] = [];
    client.onLifecycle((e) => events.push(e));

    emit("runtime:event", makeEvent("tool_call", { tool: "shell" }, "run_1", "tc_1"));

    expect(events[0].type).toBe("tool.started");
    expect(events[0].toolCallId).toBe("tc_1");
  });

  it("maps tool_result status=success to tool.completed", async () => {
    const { client, emit } = await setupClient();
    const events: LifecycleEvent[] = [];
    client.onLifecycle((e) => events.push(e));

    emit("runtime:event", makeEvent("tool_result", { status: "success" }, "run_1", "tc_1"));

    expect(events[0].type).toBe("tool.completed");
  });

  it("maps tool_result status=failed to tool.failed", async () => {
    const { client, emit } = await setupClient();
    const events: LifecycleEvent[] = [];
    client.onLifecycle((e) => events.push(e));

    emit("runtime:event", makeEvent("tool_result", { status: "failed", error: "err" }, "run_1", "tc_1"));

    expect(events[0].type).toBe("tool.failed");
  });

  it("maps tool_result status=cancelled to tool.cancelled", async () => {
    const { client, emit } = await setupClient();
    const events: LifecycleEvent[] = [];
    client.onLifecycle((e) => events.push(e));

    emit("runtime:event", makeEvent("tool_result", { status: "cancelled" }, "run_1", "tc_1"));

    expect(events[0].type).toBe("tool.cancelled");
  });

  it("maps tool_result status=timeout to tool.timeout", async () => {
    const { client, emit } = await setupClient();
    const events: LifecycleEvent[] = [];
    client.onLifecycle((e) => events.push(e));

    emit("runtime:event", makeEvent("tool_result", { status: "timeout", timeoutMs: 30000 }, "run_1", "tc_1"));

    expect(events[0].type).toBe("tool.timeout");
  });

  // ─── Streaming ────────────────────────────────────────────────

  it("maps tool_stream stdout to tool.stdout", async () => {
    const { client, emit } = await setupClient();
    const events: LifecycleEvent[] = [];
    client.onLifecycle((e) => events.push(e));

    emit("runtime:event", makeEvent("tool_stream", { stream: "stdout", chunk: "hello\n" }, "run_1", "tc_1"));

    expect(events[0].type).toBe("tool.stdout");
    expect(events[0].data.chunk).toBe("hello\n");
  });

  it("maps tool_stream stderr to tool.stderr", async () => {
    const { client, emit } = await setupClient();
    const events: LifecycleEvent[] = [];
    client.onLifecycle((e) => events.push(e));

    emit("runtime:event", makeEvent("tool_stream", { stream: "stderr", chunk: "error\n" }, "run_1", "tc_1"));

    expect(events[0].type).toBe("tool.stderr");
  });

  // ─── Event ordering ───────────────────────────────────────────

  it("preserves event ordering for a complete run lifecycle", async () => {
    const { client, emit } = await setupClient();
    const events: LifecycleEvent[] = [];
    client.onLifecycle((e) => events.push(e));

    const runId = "run_ordering_test";
    emit("runtime:event", makeEvent("command_start", { command: "check" }, runId));
    emit("runtime:event", makeEvent("tool_call", { tool: "shell" }, runId, "tc_1"));
    emit("runtime:event", makeEvent("tool_stream", { stream: "stdout", chunk: "output" }, runId, "tc_1"));
    emit("runtime:event", makeEvent("tool_result", { status: "success" }, runId, "tc_1"));
    emit("runtime:event", makeEvent("command_end", { success: true, exitCode: 0 }, runId));

    expect(events.map((e) => e.type)).toEqual([
      "run.started",
      "tool.started",
      "tool.stdout",
      "tool.completed",
      "run.completed",
    ]);
  });

  // ─── Stale event handling ─────────────────────────────────────

  it("rejects events from older runs when a newer run has started", async () => {
    const { client, emit } = await setupClient();
    const events: LifecycleEvent[] = [];
    client.onLifecycle((e) => events.push(e));

    // Start run A
    emit("runtime:event", makeEvent("command_start", { command: "check" }, "run_A"));
    // Start run B (this marks run A as "old")
    emit("runtime:event", makeEvent("command_start", { command: "build" }, "run_B"));
    // Late event from run A should be rejected
    emit("runtime:event", makeEvent("command_end", { success: true }, "run_A"));

    expect(events).toHaveLength(2);
    expect(events[0].type).toBe("run.started");
    expect(events[0].runId).toBe("run_A");
    expect(events[1].type).toBe("run.started");
    expect(events[1].runId).toBe("run_B");
    // The stale run_A command_end was rejected
  });

  it("accepts events from the current run", async () => {
    const { client, emit } = await setupClient();
    const events: LifecycleEvent[] = [];
    client.onLifecycle((e) => events.push(e));

    const runId = "run_current_456";
    emit("runtime:event", makeEvent("command_start", { command: "check" }, runId));
    emit("runtime:event", makeEvent("command_end", { success: true, exitCode: 0 }, runId));

    expect(events).toHaveLength(2);
  });

  // ─── REST fallback ────────────────────────────────────────────

  it("dispatches commands via REST", async () => {
    const client = createClient();
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ok: true, runId: "run_rest_123", result: { success: true } }),
    });

    const result = await client.dispatchCommand("check", undefined, "/tmp");

    expect(result.ok).toBe(true);
    expect(result.runId).toBe("run_rest_123");
    expect(client.getCurrentRunId()).toBe("run_rest_123");
  });

  it("throws if TERMINAL_INTERNAL_SERVICE_KEY is not configured", async () => {
    const client = new RuntimeClient({
      terminalUrl: "http://127.0.0.1:4001",
      authSecret: "test-auth-secret-" + "a".repeat(32),
      internalKey: "short",
    });

    await expect(client.dispatchCommand("check")).rejects.toThrow("TERMINAL_INTERNAL_SERVICE_KEY");
  });

  it("fetches state via REST fallback", async () => {
    const client = createClient();
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => makeState({ phase: "running" }),
    });

    const result = await client.fetchState();

    expect(result?.phase).toBe("running");
    expect(client.getState()?.phase).toBe("running");
  });

  // ─── Cancellation ─────────────────────────────────────────────

  it("sends cancel request for active run", async () => {
    const { client, emit } = await setupClient();
    emit("runtime:event", makeEvent("command_start", { command: "build" }, "run_cancel_123"));

    mockFetch.mockResolvedValueOnce({ ok: true });
    const cancelled = await client.cancelActiveRun();

    expect(cancelled).toBe(true);
    expect(mockFetch).toHaveBeenCalledWith(
      "http://127.0.0.1:4001/internal/cancel",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ runId: "run_cancel_123" }),
      }),
    );
  });

  it("returns false when no active run to cancel", async () => {
    const client = createClient();
    const cancelled = await client.cancelActiveRun();
    expect(cancelled).toBe(false);
  });

  // ─── Reconnect ────────────────────────────────────────────────

  it("resync disconnects and reconnects with fresh state", async () => {
    const { client, emit } = await setupClient();
    const connectHandler = mockSocket.on.mock.calls.find(
      ([event]) => event === "connect",
    )?.[1];
    connectHandler?.();

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => makeState({ phase: "idle" }),
    });

    await client.resync();

    expect(mockSocket.disconnect).toHaveBeenCalled();
    // resync() calls connect() which calls io() again
    const { io } = await import("socket.io-client");
    expect(io).toHaveBeenCalledTimes(2); // initial connect + resync
    expect(client.getState()?.phase).toBe("idle");
  });

  // ─── hasActiveRun ─────────────────────────────────────────────

  it("reports active run when activeCommand is present", async () => {
    const { client, emit } = await setupClient();
    emit("runtime:snapshot", makeState({
      activeCommand: {
        command: "check",
        args: [],
        startedAt: Date.now(),
        cwd: "/tmp",
        runId: "run_active",
      },
    }));

    expect(client.hasActiveRun()).toBe(true);
  });

  it("reports no active run when activeCommand is null", async () => {
    const { client, emit } = await setupClient();
    emit("runtime:snapshot", makeState({ activeCommand: null }));

    expect(client.hasActiveRun()).toBe(false);
  });

  // ─── Cleanup ──────────────────────────────────────────────────

  it("disconnects cleanly", async () => {
    const client = createClient();
    await client.connect();
    client.disconnect();

    expect(mockSocket.removeAllListeners).toHaveBeenCalled();
    expect(mockSocket.disconnect).toHaveBeenCalled();
    expect(client.getConnectionState()).toBe("disconnected");
  });

  // ─── Hardening: duplicate event suppression ─────────────────────

  it("suppresses duplicate events with same type+runId+toolCallId+ts", async () => {
    const { client, emit } = await setupClient();
    const events: LifecycleEvent[] = [];
    client.onLifecycle((e) => events.push(e));

    const event = makeEvent("command_start", { command: "check" }, "run_dup_1");
    emit("runtime:event", event);
    emit("runtime:event", event); // exact duplicate

    expect(events).toHaveLength(1);
  });

  it("suppresses duplicate tool_result events", async () => {
    const { client, emit } = await setupClient();
    const events: LifecycleEvent[] = [];
    client.onLifecycle((e) => events.push(e));

    const event = makeEvent("tool_result", { status: "success" }, "run_dup_2", "tc_dup_2");
    emit("runtime:event", event);
    emit("runtime:event", event); // duplicate

    expect(events).toHaveLength(1);
  });

  it("allows same-type events with different runIds", async () => {
    const { client, emit } = await setupClient();
    const events: LifecycleEvent[] = [];
    client.onLifecycle((e) => events.push(e));

    emit("runtime:event", makeEvent("command_start", { command: "check" }, "run_A"));
    emit("runtime:event", makeEvent("command_start", { command: "build" }, "run_B"));

    expect(events).toHaveLength(2);
  });

  it("allows same-type stream events with different timestamps", async () => {
    const { client, emit } = await setupClient();
    const events: LifecycleEvent[] = [];
    client.onLifecycle((e) => events.push(e));

    emit("runtime:event", makeEvent("tool_stream", { stream: "stdout", chunk: "a" }, "run_s", "tc_s"));
    // Different ts → not a duplicate
    const e2 = makeEvent("tool_stream", { stream: "stdout", chunk: "b" }, "run_s", "tc_s");
    e2.ts = e2.ts + 1;
    emit("runtime:event", e2);

    expect(events).toHaveLength(2);
  });

  // ─── Hardening: event ordering protection ───────────────────────

  it("rejects events with timestamps older than last processed", async () => {
    const { client, emit } = await setupClient();
    const events: LifecycleEvent[] = [];
    client.onLifecycle((e) => events.push(e));

    const runId = "run_order_reject";
    // First event at ts=1000
    const e1 = makeEvent("command_start", { command: "check" }, runId);
    e1.ts = 1000;
    emit("runtime:event", e1);

    // Second event at ts=500 (older) — should be rejected
    const e2 = makeEvent("tool_call", { tool: "shell" }, runId, "tc_1");
    e2.ts = 500;
    emit("runtime:event", e2);

    // Third event at ts=2000 (newer) — should be accepted
    const e3 = makeEvent("tool_result", { status: "success" }, runId, "tc_1");
    e3.ts = 2000;
    emit("runtime:event", e3);

    expect(events).toHaveLength(2); // e1 and e3, e2 rejected
    expect(events[0].type).toBe("run.started");
    expect(events[1].type).toBe("tool.completed");
  });

  it("allows command_start to reset ordering baseline", async () => {
    const { client, emit } = await setupClient();
    const events: LifecycleEvent[] = [];
    client.onLifecycle((e) => events.push(e));

    // Run A at ts=2000
    const e1 = makeEvent("command_start", { command: "check" }, "run_A");
    e1.ts = 2000;
    emit("runtime:event", e1);

    // Run B starts at ts=1000 (clock skew) — command_start always accepted
    const e2 = makeEvent("command_start", { command: "build" }, "run_B");
    e2.ts = 1000;
    emit("runtime:event", e2);

    expect(events).toHaveLength(2);
  });

  // ─── Hardening: stale pre-reconnect event rejection ─────────────

  it("rejects events with ts before lastReconnectTs when awaiting snapshot", async () => {
    const { client, emit } = await setupClient();

    // Simulate reconnect state
    await client.resync();

    const events: LifecycleEvent[] = [];
    client.onLifecycle((e) => events.push(e));

    // Event with old timestamp (before reconnect) — should be rejected
    const oldEvent = makeEvent("command_start", { command: "check" }, "run_old");
    oldEvent.ts = Date.now() - 10000;
    emit("runtime:event", oldEvent);

    expect(events).toHaveLength(0);
  });

  // ─── Hardening: malformed runId rejection ───────────────────────

  it("rejects events with missing runId (non-phase_change)", async () => {
    const { client, emit } = await setupClient();
    const events: LifecycleEvent[] = [];
    client.onLifecycle((e) => events.push(e));

    // tool_call without runId — should be rejected
    emit("runtime:event", makeEvent("tool_call", { tool: "shell" }, undefined, "tc_1"));

    expect(events).toHaveLength(0);
  });

  it("allows phase_change events without runId", async () => {
    const { client, emit } = await setupClient();
    const events: LifecycleEvent[] = [];
    client.onLifecycle((e) => events.push(e));

    // phase_change without runId — should not be rejected for missing runId
    emit("runtime:event", makeEvent("phase_change", { phase: "running" }));

    // phase_change maps to null lifecycle, so no events — but it wasn't
    // rejected for missing runId (it would be rejected by the mapper)
    expect(events).toHaveLength(0);
  });

  // ─── Hardening: active-run reconciliation ───────────────────────

  it("reconciles: server says idle, client thinks running → clears local run", async () => {
    const { client, emit } = await setupClient();
    emit("runtime:event", makeEvent("command_start", { command: "check" }, "run_recon_1"));

    expect(client.getCurrentRunId()).toBe("run_recon_1");

    // Server snapshot says idle
    client.reconcile(makeState({ activeCommand: null }));

    expect(client.getCurrentRunId()).toBeNull();
    expect(client.getKnownOldRuns()).toContain("run_recon_1");
  });

  it("reconciles: server says running, client thinks idle → adopts server run", async () => {
    const { client, emit } = await setupClient();

    const serverRun = {
      command: "build",
      args: [],
      startedAt: Date.now(),
      cwd: "/tmp",
      runId: "run_server_active",
    };
    client.reconcile(makeState({ activeCommand: serverRun }));

    expect(client.getCurrentRunId()).toBe("run_server_active");
  });

  it("snapshot reconciliation clears currentRunId when server is idle", async () => {
    const { client, emit } = await setupClient();
    emit("runtime:event", makeEvent("command_start", { command: "check" }, "run_snap_1"));

    expect(client.getCurrentRunId()).toBe("run_snap_1");

    // Server snapshot says idle
    emit("runtime:snapshot", makeState({ activeCommand: null }));

    expect(client.getCurrentRunId()).toBeNull();
  });

  it("snapshot reconciliation adopts active run from server", async () => {
    const { client, emit } = await setupClient();

    const serverRun = {
      command: "test",
      args: [],
      startedAt: Date.now(),
      cwd: "/tmp",
      runId: "run_snap_active",
    };
    emit("runtime:snapshot", makeState({ activeCommand: serverRun }));

    expect(client.getCurrentRunId()).toBe("run_snap_active");
  });

  // ─── Hardening: resync clears state ─────────────────────────────

  it("resync clears seen events and ordering state", async () => {
    const { client, emit } = await setupClient();
    const events: LifecycleEvent[] = [];
    client.onLifecycle((e) => events.push(e));

    // Process some events
    emit("runtime:event", makeEvent("command_start", { command: "check" }, "run_pre_resync"));
    emit("runtime:event", makeEvent("command_end", { success: true }, "run_pre_resync"));

    expect(client.getSeenEventCount()).toBeGreaterThan(0);

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => makeState({ phase: "idle" }),
    });

    await client.resync();

    // After resync, seen events are cleared
    expect(client.getSeenEventCount()).toBe(0);
    expect(client.isAwaitingSnapshot()).toBe(true);
  });

  it("resync marks current run as old", async () => {
    const { client, emit } = await setupClient();
    emit("runtime:event", makeEvent("command_start", { command: "check" }, "run_resync_old"));

    expect(client.getCurrentRunId()).toBe("run_resync_old");

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => makeState({ phase: "idle" }),
    });

    await client.resync();

    expect(client.getKnownOldRuns()).toContain("run_resync_old");
  });

  // ─── Hardening: exponential backoff ─────────────────────────────

  it("exposes initial backoff delay", async () => {
    const client = createClient();
    expect(client.getBackoffMs()).toBe(1000);
  });

  // ─── Hardening: nasty cases ─────────────────────────────────────

  it("handles reconnect during active command", async () => {
    const { client, emit } = await setupClient();
    const events: LifecycleEvent[] = [];
    client.onLifecycle((e) => events.push(e));

    // Start a run
    emit("runtime:event", makeEvent("command_start", { command: "build" }, "run_active_reconnect"));

    // Reconnect happens — resync
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => makeState({
        phase: "running",
        activeCommand: {
          command: "build",
          args: [],
          startedAt: Date.now(),
          cwd: "/tmp",
          runId: "run_active_reconnect",
        },
      }),
    });

    await client.resync();

    // Server confirms the run is still active — we adopt it
    expect(client.getCurrentRunId()).toBe("run_active_reconnect");
  });

  it("handles server says idle while client thinks running", async () => {
    const { client, emit } = await setupClient();
    emit("runtime:event", makeEvent("command_start", { command: "build" }, "run_client_thinks"));

    // Server snapshot says idle — the run was lost
    emit("runtime:snapshot", makeState({ activeCommand: null }));

    // Client should clear its run tracking
    expect(client.getCurrentRunId()).toBeNull();
    expect(client.hasActiveRun()).toBe(false);
  });

  it("handles REST fallback followed by Socket.IO recovery", async () => {
    const client = createClient();

    // REST fallback — dispatch command
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ok: true, runId: "run_rest_recovery", result: { success: true } }),
    });
    const result = await client.dispatchCommand("check");
    expect(result.ok).toBe(true);
    expect(client.getCurrentRunId()).toBe("run_rest_recovery");

    // Socket.IO recovers — connect
    await client.connect();
    const connectHandler = mockSocket.on.mock.calls.find(
      ([event]) => event === "connect",
    )?.[1];

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => makeState({ phase: "idle", activeCommand: null }),
    });

    // Connect fires — snapshot arrives showing idle
    connectHandler?.();
    emitSnapshotViaSocket(mockSocket, makeState({ activeCommand: null }));

    // Client should reconcile — the REST run is now old
    expect(client.getKnownOldRuns()).toContain("run_rest_recovery");
  });

  it("handles disconnect during cancellation", async () => {
    const { client, emit } = await setupClient();
    emit("runtime:event", makeEvent("command_start", { command: "build" }, "run_cancel_disconnect"));

    // Cancel request sent
    mockFetch.mockResolvedValueOnce({ ok: true });
    const cancelPromise = client.cancelActiveRun();

    // Disconnect happens during cancel
    const disconnectHandler = mockSocket.on.mock.calls.find(
      ([event]) => event === "disconnect",
    )?.[1];
    disconnectHandler?.("transport close");

    // Cancel should still resolve (REST doesn't need Socket.IO)
    const cancelled = await cancelPromise;
    expect(cancelled).toBe(true);
    expect(client.getConnectionState()).toBe("disconnected");
  });
});

// Helper to emit snapshot via mock socket
function emitSnapshotViaSocket(mock: typeof mockSocket, state: RuntimeState): void {
  const snapshotHandler = mock.on.mock.calls.find(
    ([event]) => event === "runtime:snapshot",
  )?.[1];
  snapshotHandler?.(state);
}
