/**
 * Canonical metering (P0) — agent loop per-step emission.
 *
 * The v2 agent loop must emit exactly one usage_events + cost_events pair
 * per loop step's LLM call (one per provider attempt), via the canonical
 * emitter:
 *   - success -> billable=true, capability "llm", idempotency key
 *     `metering:llm:{meteringRunId}:{step}`
 *   - failure -> billable=false (cost still recorded), same key shape
 *   - no identity (no ALS context AND no cfg.userId) -> no emission
 *
 * `@/lib/metering` and `../llm-tool-calling` are mocked; the loop itself
 * runs for real with a single no-tool-call step.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { emitUsageEventMock, getMeteringContextMock } = vi.hoisted(() => ({
  emitUsageEventMock: vi.fn(),
  getMeteringContextMock: vi.fn(),
}));
const { callLLMWithToolsMock } = vi.hoisted(() => ({
  callLLMWithToolsMock: vi.fn(),
}));

vi.mock("@/lib/metering", () => ({
  emitUsageEvent: emitUsageEventMock,
  getMeteringContext: getMeteringContextMock,
  runWithMeteringContext: (_ctx: unknown, fn: () => unknown) => fn(),
}));

vi.mock("../llm-tool-calling", () => ({
  callLLMWithTools: callLLMWithToolsMock,
  buildToolResultMessage: vi.fn(),
  buildAssistantToolCallMessage: vi.fn(),
  summarizeToolResult: vi.fn(),
  AllRoutesFailedError: class AllRoutesFailedError extends Error {
    userMessage = "all routes failed";
  },
  AgentBudgetExhaustedError: class AgentBudgetExhaustedError extends Error {},
}));

import { runAgentLoopV2, type AgentLoopConfig } from "../agent-loop-v2";
import type { WorkspaceTransport } from "../workspace-transport";

function makeTransport(): WorkspaceTransport {
  const ok = (v: unknown) => vi.fn().mockResolvedValue(v);
  return {
    workspaceId: "ws-test",
    userId: "clerk-test-1",
    workspaceRoot: "/workspace/test",
    projectId: "proj-test",
    readFile: ok({ content: "x", size: 1 }),
    writeFile: ok({ saved: true }),
    exec: ok({ exitCode: 0, stdout: "ok", stderr: "", durationMs: 10 }),
    gitStatus: ok({ branch: "main", ahead: 0, behind: 0, staged: [], modified: [], untracked: [], clean: true }),
    gitCommit: ok({ committed: true, sha: "abc123" }),
    createCheckpointBeforeMutation: ok({ checkpointId: "cp-1", label: "x", gitSha: "abc123" }),
    applyPatch: ok({ applied: true }),
    discoverPackageInfo: ok({ packageManager: "pnpm", scripts: {}, hasPackageJson: false, hasTypecheck: false, hasLint: false, hasBuild: false, hasTest: false }),
    runCheck: ok({ exitCode: 0, stdout: "ok", stderr: "", durationMs: 10 }),
    listFiles: ok({ entries: [] }),
    deleteFile: ok({ deleted: true }),
    mkdir: ok({ created: true }),
    rename: ok({ renamed: true }),
    gitDiff: ok({ diff: "" }),
    gitLog: ok({ commits: [] }),
    searchCode: ok({ results: [] }),
  } as unknown as WorkspaceTransport;
}

function makeConfig(overrides: Partial<AgentLoopConfig> = {}): AgentLoopConfig {
  return {
    maxSteps: 1,
    maxRuntimeMs: 60_000,
    maxOutputChars: 8_000,
    maxRetries: 0,
    executionMode: "act",
    systemPrompt: "test system prompt",
    enableBuildFix: false,
    userId: "clerk-test-1",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  emitUsageEventMock.mockResolvedValue({ status: "ok", usageEventId: "ue-test" });
  getMeteringContextMock.mockReturnValue(null);
});

describe("agent loop canonical metering (P0)", () => {
  it("emits one billable usage event per successful step with the canonical idempotency key", async () => {
    callLLMWithToolsMock.mockResolvedValue({
      text: "Done.",
      toolCalls: [],
      finishReason: "stop",
      model: "test-model",
      provider: "openrouter",
    });

    await runAgentLoopV2("do nothing", makeTransport(), makeConfig());

    expect(callLLMWithToolsMock).toHaveBeenCalledTimes(1);
    expect(emitUsageEventMock).toHaveBeenCalledTimes(1);
    const payload = emitUsageEventMock.mock.calls[0][0];
    expect(payload.billable).toBe(true);
    expect(payload.status).toBe("success");
    expect(payload.capability).toBe("llm");
    expect(payload.provider).toBe("openrouter");
    expect(payload.model).toBe("test-model");
    expect(payload.clerkId).toBe("clerk-test-1");
    // No ambient metering context in this test — the loop falls back to its
    // own default feature ("agent-chat"); the messages route sets
    // "studio-chat" via runWithMeteringContext (asserted below).
    expect(payload.feature).toBe("agent-chat");
    // One logical action = one step: original_request_id mirrors the
    // idempotency key so the P0 <=1 billable check keys on it. Steps are
    // 1-based (stepsUsed is incremented before the LLM call).
    expect(payload.idempotencyKey).toMatch(/^metering:llm:[0-9a-f-]{36}:\d+$/);
    expect(payload.originalRequestId).toBe(payload.idempotencyKey);
    expect(typeof payload.providerCostMicros).toBe("number");
    expect(typeof payload.inputTokens).toBe("number");
    expect(typeof payload.outputTokens).toBe("number");
  });

  it("emits a non-billable event with cost when the step fails", async () => {
    callLLMWithToolsMock.mockRejectedValue(new Error("provider exploded"));

    await runAgentLoopV2("do nothing", makeTransport(), makeConfig());

    expect(emitUsageEventMock).toHaveBeenCalledTimes(1);
    const payload = emitUsageEventMock.mock.calls[0][0];
    // P0 invariant: failed attempts are recorded billable=false; the
    // attempt still happened so the event exists.
    expect(payload.billable).toBe(false);
    expect(payload.status).toBe("failed");
    expect(payload.error).toContain("provider exploded");
    expect(payload.idempotencyKey).toMatch(/^metering:llm:[0-9a-f-]{36}:\d+$/);
    expect(payload.originalRequestId).toBe(payload.idempotencyKey);
  });

  it("emits nothing when no identity is available", async () => {
    callLLMWithToolsMock.mockResolvedValue({
      text: "Done.",
      toolCalls: [],
      finishReason: "stop",
      model: "test-model",
      provider: "openrouter",
    });

    // No ALS context (mock returns null) and no cfg.userId.
    await runAgentLoopV2("do nothing", makeTransport(), makeConfig({ userId: undefined }));

    expect(callLLMWithToolsMock).toHaveBeenCalledTimes(1);
    expect(emitUsageEventMock).not.toHaveBeenCalled();
  });

  it("uses the browser-session idempotency key shape for browser-agent runs", async () => {
    // Production path: the browser agent runs the loop inside a metering
    // context with feature "browser-agent" (set by the browser session
    // manager), plus cfg.browserSessionId for the key.
    getMeteringContextMock.mockReturnValue({
      clerkId: "clerk-test-1",
      feature: "browser-agent",
      runId: "run-browser-1",
    });
    callLLMWithToolsMock.mockResolvedValue({
      text: "Done.",
      toolCalls: [],
      finishReason: "stop",
      model: "test-model",
      provider: "openrouter",
    });

    await runAgentLoopV2(
      "do nothing",
      makeTransport(),
      makeConfig({ browserSessionId: "sess-123" }),
    );

    expect(emitUsageEventMock).toHaveBeenCalledTimes(1);
    const payload = emitUsageEventMock.mock.calls[0][0];
    expect(payload.idempotencyKey).toBe("metering:browser:sess-123:1");
    expect(payload.originalRequestId).toBe("metering:browser:sess-123:1");
    expect(payload.capability).toBe("browser");
    expect(payload.billable).toBe(true);
  });

  it("prefers the ambient metering context (feature + run linkage) when present", async () => {
    // Production path: the messages route wraps runLaunchFlow in
    // runWithMeteringContext({ feature: "studio-chat", runId: agentRunId }).
    getMeteringContextMock.mockReturnValue({
      clerkId: "clerk-test-1",
      feature: "studio-chat",
      runId: "agent-run-abc",
      projectId: "proj-test",
    });
    callLLMWithToolsMock.mockResolvedValue({
      text: "Done.",
      toolCalls: [],
      finishReason: "stop",
      model: "test-model",
      provider: "openrouter",
    });

    await runAgentLoopV2("do nothing", makeTransport(), makeConfig());

    expect(emitUsageEventMock).toHaveBeenCalledTimes(1);
    const payload = emitUsageEventMock.mock.calls[0][0];
    expect(payload.feature).toBe("studio-chat");
    expect(payload.runId).toBe("agent-run-abc");
    expect(payload.projectId).toBe("proj-test");
    expect(payload.capability).toBe("llm");
    expect(payload.billable).toBe(true);
  });
});
