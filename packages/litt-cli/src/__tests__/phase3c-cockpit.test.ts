/**
 * Phase 3C — Cockpit and SignalHandler tests.
 *
 * Tests that the cockpit displays canonical runtime truth (no fake state)
 * and that Ctrl+C semantics work correctly.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { RuntimeClient, type LifecycleEvent } from "../lib/runtime-client.js";
import { Cockpit } from "../lib/cockpit.js";
import { SignalHandler } from "../lib/signal-handler.js";
import type { RuntimeState } from "@litt/agent-core";

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

// ─── Cockpit Tests ────────────────────────────────────────────────

describe("Cockpit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSocket.connected = false;
    mockFetch.mockReset();
  });

  it("displays canonical runtime state (no fake WORKING)", async () => {
    const { client, emit } = await setupClient();
    const cockpit = new Cockpit(client);
    cockpit.start();

    emit("runtime:snapshot", makeState({
      phase: "running",
      activeCommand: {
        command: "check",
        args: [],
        startedAt: Date.now(),
        cwd: "/tmp",
        runId: "run_123",
      },
    }));

    const display = cockpit.getDisplayState();
    expect(display.phase).toBe("running");
    expect(display.activeCommand).toBe("check");
    expect(display.runId).toBe("run_123");
    // No fake "WORKING" — the phase comes from the canonical runtime
    expect(display.phase).not.toBe("WORKING");

    cockpit.stop();
  });

  it("updates display when runtime state changes", async () => {
    const { client, emit } = await setupClient();
    const cockpit = new Cockpit(client);
    cockpit.start();

    emit("runtime:snapshot", makeState({ phase: "idle" }));
    expect(cockpit.getDisplayState().phase).toBe("idle");

    emit("runtime:state", makeState({ phase: "running" }));
    expect(cockpit.getDisplayState().phase).toBe("running");

    emit("runtime:state", makeState({ phase: "complete" }));
    expect(cockpit.getDisplayState().phase).toBe("complete");

    cockpit.stop();
  });

  it("logs lifecycle events to the activity feed", async () => {
    const { client, emit } = await setupClient();
    const cockpit = new Cockpit(client);
    cockpit.start();

    emit("runtime:event", {
      type: "command_start",
      ts: Date.now(),
      data: { command: "check" },
      runId: "run_log_123",
    });
    emit("runtime:event", {
      type: "command_end",
      ts: Date.now(),
      data: { success: true, exitCode: 0, durationMs: 500, message: "OK" },
      runId: "run_log_123",
    });

    const log = cockpit.getActivityLog();
    expect(log.length).toBeGreaterThanOrEqual(2);
    const logText = log.map((e) => e.text).join("\n");
    expect(logText).toContain("run started");
    expect(logText).toContain("run completed");

    cockpit.stop();
  });

  it("renders a status line with connection and phase", async () => {
    const { client, emit } = await setupClient();
    const cockpit = new Cockpit(client);
    cockpit.start();

    emit("runtime:snapshot", makeState({ phase: "idle" }));
    const connectHandler = mockSocket.on.mock.calls.find(
      ([event]) => event === "connect",
    )?.[1];
    connectHandler?.();

    const status = cockpit.renderStatusLine();
    expect(status).toContain("idle");
    expect(status).toMatch(/●/);

    cockpit.stop();
  });

  it("renders a full panel with runtime details", async () => {
    const { client, emit } = await setupClient();
    const cockpit = new Cockpit(client);
    cockpit.start();

    emit("runtime:snapshot", makeState({
      phase: "running",
      activeCommand: {
        command: "build",
        args: [],
        startedAt: Date.now(),
        cwd: "/project",
        runId: "run_panel_456",
      },
      heartbeat: {
        seq: 42,
        lastHeartbeatAt: Date.now(),
        failures: 0,
        maxFailures: 3,
        intervalMs: 15000,
        latencyMs: 12,
      },
    }));

    const panel = cockpit.renderPanel();
    expect(panel).toContain("LiTT Runtime Cockpit");
    expect(panel).toContain("running");
    expect(panel).toContain("build");
    expect(panel).toContain("run_panel_456");
    expect(panel).toContain("seq=42");

    cockpit.stop();
  });

  it("cleans up listeners on stop", async () => {
    const { client, emit } = await setupClient();
    const cockpit = new Cockpit(client);
    cockpit.start();

    emit("runtime:snapshot", makeState({ phase: "idle" }));
    expect(cockpit.getDisplayState().phase).toBe("idle");

    cockpit.stop();

    emit("runtime:state", makeState({ phase: "running" }));
    expect(cockpit.getDisplayState().phase).toBe("idle");
  });
});

// ─── SignalHandler Tests ──────────────────────────────────────────

describe("SignalHandler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSocket.connected = false;
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("cancels active run on first Ctrl+C (CLI stays alive)", async () => {
    const { client, emit } = await setupClient();
    const signals = new SignalHandler(client);

    emit("runtime:snapshot", makeState({
      activeCommand: {
        command: "build",
        args: [],
        startedAt: Date.now(),
        cwd: "/tmp",
        runId: "run_sigint_123",
      },
    }));
    emit("runtime:event", {
      type: "command_start",
      ts: Date.now(),
      data: { command: "build" },
      runId: "run_sigint_123",
    });

    mockFetch.mockResolvedValueOnce({ ok: true });

    const cleanup = signals.install();

    const sigintHandlers = process.listeners("SIGINT");
    expect(sigintHandlers.length).toBeGreaterThan(0);

    const handlerFn = sigintHandlers[sigintHandlers.length - 1] as (sig: string) => void;
    handlerFn("SIGINT");

    await new Promise((r) => setTimeout(r, 100));

    expect(mockFetch).toHaveBeenCalledWith(
      "http://127.0.0.1:4001/internal/cancel",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ runId: "run_sigint_123" }),
      }),
    );

    cleanup();
  });

  it("does not cancel when no active run (exits on double press)", async () => {
    const { client, emit } = await setupClient();
    const signals = new SignalHandler(client);

    emit("runtime:snapshot", makeState({ activeCommand: null }));

    const cleanup = signals.install();
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);

    const sigintHandlers = process.listeners("SIGINT");
    const handlerFn = sigintHandlers[sigintHandlers.length - 1] as (sig: string) => void;

    handlerFn("SIGINT");
    expect(exitSpy).not.toHaveBeenCalled();

    handlerFn("SIGINT");
    expect(exitSpy).toHaveBeenCalledWith(130);

    exitSpy.mockRestore();
    cleanup();
  });

  it("installs and cleans up signal handlers", async () => {
    const { client } = await setupClient();
    const signals = new SignalHandler(client);

    const beforeCount = process.listenerCount("SIGINT");
    const cleanup = signals.install();
    const afterCount = process.listenerCount("SIGINT");

    expect(afterCount).toBeGreaterThan(beforeCount);

    cleanup();

    const finalCount = process.listenerCount("SIGINT");
    expect(finalCount).toBe(beforeCount);
  });
});
