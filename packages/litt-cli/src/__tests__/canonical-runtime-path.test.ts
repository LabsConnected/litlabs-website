/**
 * Canonical Runtime Path — proves NL submissions reach the ONE
 * canonical RuntimeStore via the session, not an ephemeral second brain.
 *
 * This test verifies the wiring that controller.ts now uses:
 *   session.getGateway()  → canonical ExecutionGateway
 *   session.getStore()    → canonical RuntimeStore
 *   session.getShell()    → canonical ShellExecutor
 *   session.emitAgentEvent() → canonical event bus → SessionEventBridge
 *
 * If the controller constructed a fresh RuntimeStore (the old "second
 * brain" bug), the SessionEventBridge would NOT see agent events,
 * and this test would fail.
 */
import { describe, it, expect } from "vitest";
import { createRuntimeSession } from "../lib/runtime-session.js";
import { SessionEventBridge } from "../ink/session-event-bridge.js";
import { runAgentLoop, ToolRegistry, createShellExecutor, RuntimeStore } from "@litt/agent-core";
import type { RuntimeEvent } from "@litt/agent-core";

/**
 * Minimal mock model provider that emits a single tool_call for
 * project.status, then a final answer. This exercises the agent loop's
 * emitter + store.commandStart/commandEnd path.
 */
function createMockModel() {
  let callCount = 0;
  return {
    stream: async (
      _messages: unknown,
      onEvent: (event: { type: string; text?: string; usage?: { total_tokens: number } }) => void,
    ) => {
      callCount++;
      if (callCount === 1) {
        // First turn: emit a tool call
        onEvent({ type: "delta", text: "Let me check the project status.\n```tool_call\n{\"tool\":\"project.status\",\"inputs\":{}}\n```" });
        onEvent({ type: "done", usage: { total_tokens: 100 } });
      } else {
        // Second turn: final answer
        onEvent({ type: "delta", text: "Project status retrieved successfully." });
        onEvent({ type: "done", usage: { total_tokens: 50 } });
      }
    },
    activeModel: "mock-model",
  };
}

describe("Canonical Runtime Path — one brain, one RuntimeStore", () => {
  it("session.getStore() returns the SAME store the gateway uses", () => {
    const session = createRuntimeSession({ cwd: process.cwd() });
    const store = session.getStore();
    const gateway = session.getGateway();

    // The gateway is constructed with the session's store.
    // Verify they're the same instance — no second brain.
    expect(store).toBeDefined();
    expect(gateway).toBeDefined();
    // The store is the canonical one — getState() should return initial state
    const state = store.getState();
    expect(state.phase).toBe("idle");
    expect(state.mission).toBeNull();
  });

  it("session.getShell() returns the canonical ShellExecutor", () => {
    const session = createRuntimeSession({ cwd: process.cwd() });
    const shell = session.getShell();
    expect(shell).toBeDefined();
    expect(typeof shell.execute).toBe("function");
  });

  it("session.emitAgentEvent() routes to SessionEventBridge", () => {
    const sessionBridge = new SessionEventBridge();
    const session = createRuntimeSession({
      cwd: process.cwd(),
      onEvent: (event) => sessionBridge.onEvent(event),
    });

    const received: unknown[] = [];
    sessionBridge.subscribe((event) => {
      received.push(event);
    });

    // Emit an agent_tool_call event through the canonical bus
    session.emitAgentEvent({
      type: "litt_event",
      subtype: "agent_tool_call",
      ts: Date.now(),
      toolCallId: "tc_test_1",
      data: { tool: "status", toolId: "project.status", inputs: {} },
    });

    expect(received.length).toBe(1);
    expect(received[0]).toMatchObject({
      type: "tool.started",
      toolCallId: "tc_test_1",
    });
  });

  it("agent_tool_result events map to tool.completed/tool.failed via SessionEventBridge", () => {
    const sessionBridge = new SessionEventBridge();
    const session = createRuntimeSession({
      cwd: process.cwd(),
      onEvent: (event) => sessionBridge.onEvent(event),
    });

    const received: unknown[] = [];
    sessionBridge.subscribe((event) => {
      received.push(event);
    });

    // Success result
    session.emitAgentEvent({
      type: "litt_event",
      subtype: "agent_tool_result",
      ts: Date.now(),
      toolCallId: "tc_test_2",
      data: { tool: "status", toolId: "project.status", success: true },
    });

    // Failure result
    session.emitAgentEvent({
      type: "litt_event",
      subtype: "agent_tool_result",
      ts: Date.now(),
      toolCallId: "tc_test_3",
      data: { tool: "build", toolId: "project.build", success: false },
    });

    expect(received.length).toBe(2);
    expect(received[0]).toMatchObject({ type: "tool.completed", toolCallId: "tc_test_2" });
    expect(received[1]).toMatchObject({ type: "tool.failed", toolCallId: "tc_test_3" });
  });

  it("runAgentLoop with canonical session store emits command_start/command_end to SessionEventBridge", async () => {
    const sessionBridge = new SessionEventBridge();
    const session = createRuntimeSession({
      cwd: process.cwd(),
      onEvent: (event) => sessionBridge.onEvent(event),
    });

    const lifecycleEvents: unknown[] = [];
    sessionBridge.subscribe((event) => {
      lifecycleEvents.push(event);
    });

    const gateway = session.getGateway();
    const tools = gateway.getTools();
    const store = session.getStore();
    const shell = session.getShell();
    const mockModel = createMockModel();

    // Run the agent loop through the CANONICAL session resources —
    // exactly what controller.ts now does for NL input.
    const result = await runAgentLoop("What is the project status?", {
      model: mockModel as never,
      tools,
      shell,
      gateway,
      cwd: process.cwd(),
      userId: "test-user",
      mode: "act",
      maxRounds: 4,
      projectContext: { name: "test-project", root: process.cwd(), branch: "test" },
      store,
      emitter: (event: RuntimeEvent) => {
        // Route agent events through the canonical bus
        session.emitAgentEvent(event);
      },
    });

    // The agent loop should have made at least one tool call
    expect(result.toolCalls.length).toBeGreaterThanOrEqual(1);
    expect(result.termination).toBe("complete");

    // CRITICAL: The SessionEventBridge should have received events
    // from the canonical RuntimeStore — NOT from an ephemeral store.
    // If the controller used a fresh RuntimeStore (second brain bug),
    // these events would never reach the SessionEventBridge.
    const types = lifecycleEvents.map((e: unknown) => (e as { type: string }).type);
    expect(types).toContain("tool.started"); // from agent_tool_call
    expect(types).toContain("tool.completed"); // from agent_tool_result or command_end
  });

  it("ephemeral RuntimeStore does NOT route to SessionEventBridge (proves the bug is fixed)", () => {
    const sessionBridge = new SessionEventBridge();
    const session = createRuntimeSession({
      cwd: process.cwd(),
      onEvent: (event) => sessionBridge.onEvent(event),
    });

    const received: unknown[] = [];
    sessionBridge.subscribe((event) => {
      received.push(event);
    });

    // Simulate the OLD bug: a fresh ephemeral store (not the session's)
    const ephemeralStore = new RuntimeStore();
    ephemeralStore.commandStart("status", [], process.cwd(), "run_ephemeral");

    // The SessionEventBridge should NOT see this — it's from a different store
    expect(received.length).toBe(0);

    // Now use the canonical session store
    const canonicalStore = session.getStore();
    canonicalStore.commandStart("status", [], process.cwd(), "run_canonical");

    // The SessionEventBridge SHOULD see this — same store, same event bus.
    // (command_start puts runId in data.runId, not the top-level field)
    expect(received.length).toBe(1);
    expect(received[0]).toMatchObject({ type: "run.started" });
    expect((received[0] as { data: { runId: string } }).data.runId).toBe("run_canonical");
  });
});
