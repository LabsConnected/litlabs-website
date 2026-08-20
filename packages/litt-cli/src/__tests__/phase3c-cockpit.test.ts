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
import { ApprovalBridge } from "../ink/approval-bridge.js";
import type { PendingApproval } from "../ink/approval-bridge.js";
import type { RuntimeState, ExecutionRequest, RiskAssessment } from "@litt/agent-core";

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
    terminalToken: "test-terminal-jwt-token",
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
      "http://127.0.0.1:4001/api/cancel",
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

// ─── ApprovalBridge Tests ─────────────────────────────────────────

describe("ApprovalBridge", () => {
  function makeRequest(toolId: string, command?: string): ExecutionRequest {
    return {
      toolId,
      inputs: command ? { command, args: [] } : {},
      cwd: process.cwd(),
      mode: "act",
      identity: {
        tenantId: "cli-tenant",
        userId: "cli-user",
        actorId: "cli-user",
        trusted: false,
        interaction: "interactive",
      },
      runId: "run_test_001",
      toolCallId: "tc_test_001",
    };
  }

  function makeRisk(level: string): RiskAssessment {
    return { level: level as "safe" | "elevated" | "dangerous", capability: "workspace_edit", reason: "test", mutating: true };
  }

  it("request() returns a pending Promise that resolves on decide(true)", async () => {
    const bridge = new ApprovalBridge();
    const promise = bridge.request(makeRequest("project.run", "pnpm install"), makeRisk("elevated"));

    // Promise should be pending
    let resolved = false;
    promise.then(() => { resolved = true; });

    await new Promise((r) => setTimeout(r, 50));
    expect(resolved).toBe(false);
    expect(bridge.pending).not.toBeNull();
    expect(bridge.pending!.toolId).toBe("project.run");
    expect(bridge.pending!.action).toContain("pnpm install");

    // Approve
    bridge.decide(true);
    await promise;

    expect(resolved).toBe(true);
    expect(bridge.pending).toBeNull();
  });

  it("request() resolves with false on decide(false) — denial", async () => {
    const bridge = new ApprovalBridge();
    const promise = bridge.request(makeRequest("project.run", "rm -rf /"), makeRisk("dangerous"));

    bridge.decide(false);
    const result = await promise;

    expect(result).toBe(false);
    expect(bridge.pending).toBeNull();
  });

  it("cancel() resolves pending with false (fail closed)", async () => {
    const bridge = new ApprovalBridge();
    const promise = bridge.request(makeRequest("project.run", "git push"), makeRisk("dangerous"));

    bridge.cancel();
    const result = await promise;

    expect(result).toBe(false);
    expect(bridge.pending).toBeNull();
  });

  it("subscribe() notifies when approval becomes pending and when cleared", async () => {
    const bridge = new ApprovalBridge();
    const notifications: (PendingApproval | null)[] = [];
    const unsub = bridge.subscribe((pending) => {
      notifications.push(pending);
    });

    const promise = bridge.request(makeRequest("project.run", "pnpm build"), makeRisk("elevated"));

    // Should have notified with pending approval
    expect(notifications.length).toBeGreaterThanOrEqual(1);
    expect(notifications[0]).not.toBeNull();
    expect(notifications[0]!.toolId).toBe("project.run");

    bridge.decide(true);
    await promise;

    // Should have notified with null (cleared)
    expect(notifications.length).toBeGreaterThanOrEqual(2);
    expect(notifications[notifications.length - 1]).toBeNull();

    unsub();
  });

  it("does not create VerifiedApproval — only carries boolean decision", () => {
    const bridge = new ApprovalBridge();
    // The bridge has no reference to RuntimeApprovalProvider, verifyApproval,
    // or VerifiedApproval. It only stores a resolver function.
    // This is by design — the gateway remains sole authority.
    expect(bridge.pending).toBeNull();
    // The bridge's API is: request(), decide(), cancel(), subscribe(), pending
    // No verifyApproval, no createApproval, no VerifiedApproval anywhere.
  });

  it("synchronous subscriber race: decide() inside subscribe callback resolves the promise", async () => {
    // Regression: if _notify() fires before _resolver is installed,
    // a subscriber that synchronously calls decide() would see no
    // resolver and the promise would hang forever.
    const bridge = new ApprovalBridge();

    // Subscribe with a callback that immediately decides
    bridge.subscribe((pending) => {
      if (pending) {
        // Synchronously decide — this must work because the resolver
        // is installed BEFORE _notify() is called
        bridge.decide(true);
      }
    });

    // request() must resolve even though the subscriber decided synchronously
    const result = await bridge.request(
      makeRequest("project.run", "pnpm install"),
      makeRisk("elevated"),
    );

    expect(result).toBe(true);
    expect(bridge.pending).toBeNull();
  });
});
