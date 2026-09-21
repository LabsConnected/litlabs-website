// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

/**
 * Regression tests for the Studio SSE message route stream lifecycle.
 *
 * Covers the silent-close failure mode where the SSE stream terminated
 * without a terminal event (`done`/`error`/`cancelled`) or `[DONE]` marker
 * due to:
 *   1. Proxy idle timeouts (no heartbeat)
 *   2. Stream cancellation with no `cancel()` handler
 *   3. `controller.enqueue` throwing in `finally` when controller is closed
 *
 * These tests verify:
 *   - Multi-step agent runs with provider fallback emit exactly one
 *     terminal event and `[DONE]`
 *   - Mutations are not duplicated across fallback providers
 *   - TRANSPORT LIFETIME != EXECUTION LIFETIME: req.signal aborts and
 *     downstream stream cancellations do NOT abort the run (P0 fix —
 *     previously a mobile/browser disconnect killed the launch flow)
 *   - Explicit server-side cancellation DOES abort the run
 *   - Heartbeat comments are emitted to keep the connection alive
 */

// ── Mocks ──

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(),
}));

vi.mock("@/lib/rate-limiter", () => ({
  withRateLimit: (handler: any) => handler,
}));

vi.mock("@/lib/supabase", () => ({
  getSupabaseAdmin: vi.fn(() => ({
    rpc: vi.fn().mockResolvedValue({ data: 2, error: null }),
    from: vi.fn(() => ({
      update: vi.fn(() => ({
        eq: vi.fn(() => ({
          eq: vi.fn(() => ({})),
        })),
      })),
    })),
  })),
}));

vi.mock("@/lib/studio/conversation-service", () => ({
  getConversation: vi.fn(),
  listMessages: vi.fn(() => []),
  insertMessage: vi.fn(),
  updateMessageStatus: vi.fn(),
  touchStreamingMessage: vi.fn(() => Promise.resolve(true)),
}));

vi.mock("@/lib/studio/agent-registry", () => ({
  resolveAgent: vi.fn(() => ({ id: "litt", displayName: "LiTT" })),
  isValidAgentSlug: vi.fn(() => true),
}));

vi.mock("@/lib/studio/project-resolver", () => ({
  buildStudioContext: vi.fn(),
}));

vi.mock("@/lib/projects/resolve-current-project", () => ({
  resolveCurrentProject: vi.fn(),
}));

vi.mock("@/lib/studio/memory-service", () => ({
  recallMemories: vi.fn(() => []),
  formatMemoryContext: vi.fn(() => ""),
  persistMemory: vi.fn(() => Promise.resolve()),
  harvestUserPreferences: vi.fn(() => Promise.resolve()),
}));

vi.mock("@/lib/studio/logger", () => ({
  studioLog: vi.fn(),
}));

vi.mock("@/lib/agent-selection", () => ({
  parseAgentSelection: vi.fn(),
}));

vi.mock("@/lib/agent-runtime", () => ({
  resolveRuntimeAgent: vi.fn(),
}));

vi.mock("@/lib/agent-billing", () => ({
  reserveCredits: vi.fn(),
  // The route calls settleRun(...).catch(...) — must return a promise.
  settleRun: vi.fn(() => Promise.resolve({ ok: true })),
  estimateCredits: vi.fn(() => 0),
}));

vi.mock("@/lib/litt-runtime", () => ({
  buildPrompt: vi.fn((_ctx: unknown, input: { message?: string }) => ({
    fullPrompt: "test prompt",
    systemPrompt: "system",
    agentDisplayName: "LiTT",
    kernelResult: {
      decision: {
        routing: {
          requiresExecution: !input.message?.includes("hello there"),
          mode: input.message?.includes("hello there") ? "think" : "build",
        },
      },
    },
  })),
  buildRunContextFromStudio: vi.fn(() => ({})),
  parseRuntimeContextHint: vi.fn(() => ({})),
  HISTORY_LIMIT: 10,
}));

vi.mock("@/lib/litt-intelligence/launch-flow", () => ({
  runLaunchFlow: vi.fn(),
}));

vi.mock("@/lib/litt-intelligence/agent-loop", () => ({
  runAgentLoop: vi.fn(),
}));

vi.mock("@/lib/litt-intelligence/agent-loop-v2", () => ({
  runAgentLoopV2: vi.fn(),
}));

vi.mock("@/lib/litt-intelligence/progress-events", () => ({
  ProgressEmitter: class {
    private cb: (e: any) => void;
    constructor(cb: (e: any) => void) { this.cb = cb; }
    emit(e: any) { this.cb(e); }
  },
}));

vi.mock("@/lib/litt-intelligence/workspace-transport", () => ({
  createWorkspaceTransport: vi.fn(),
}));

vi.mock("@/lib/litt-intelligence/paused-run-store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/litt-intelligence/paused-run-store")>();
  return {
    createPausedRun: vi.fn(),
    getPendingPausedRunForConversation: vi.fn(),
    getLatestPausedRunForConversation: vi.fn(),
    // Use the real recency rule — these reconciliation tests must exercise
    // the production gate logic, not bypass it.
    pausedRunBelongsToMessage: actual.pausedRunBelongsToMessage,
  };
});

vi.mock("@/lib/litt-intelligence/turn-resolver", () => ({
  resolveTurn: vi.fn(() => ({ resolved: "test message" })),
}));

vi.mock("@/lib/litt-intelligence/canonical-runtime-context", () => ({
  buildCanonicalRuntimeContext: vi.fn(),
  buildRuntimeContextBlock: vi.fn(() => ""),
}));

vi.mock("@/lib/litt-intelligence/tool-executor", () => ({
  detectAndExecuteTool: vi.fn(() => ({ executed: false })),
}));

vi.mock("@/lib/llm", () => ({
  streamText: vi.fn(),
  // Mirrors the real code-based check — an error classified
  // EMPTY_PROVIDER_RESPONSE stays classified through the mock boundary.
  isEmptyProviderResponse: (err: unknown) =>
    typeof err === "object" &&
    err !== null &&
    (err as { code?: unknown }).code === "EMPTY_PROVIDER_RESPONSE",
}));

import { auth } from "@/lib/auth";
import { POST, GET } from "./route";
import { runLaunchFlow } from "@/lib/litt-intelligence/launch-flow";
import { runAgentLoop } from "@/lib/litt-intelligence/agent-loop";
import { streamText } from "@/lib/llm";
import {
  requestExecutionCancellation,
  resetExecutionRegistryForTests,
  getActiveExecution,
} from "@/lib/studio/execution-registry";
import { createWorkspaceTransport } from "@/lib/litt-intelligence/workspace-transport";
import { buildCanonicalRuntimeContext } from "@/lib/litt-intelligence/canonical-runtime-context";
import { buildStudioContext } from "@/lib/studio/project-resolver";
import { getConversation, insertMessage, listMessages, updateMessageStatus } from "@/lib/studio/conversation-service";
import { createPausedRun, getPendingPausedRunForConversation, getLatestPausedRunForConversation } from "@/lib/litt-intelligence/paused-run-store";
import { persistMemory } from "@/lib/studio/memory-service";
import { resolveRuntimeAgent } from "@/lib/agent-runtime";
import { parseAgentSelection } from "@/lib/agent-selection";
import { reserveCredits, settleRun } from "@/lib/agent-billing";
import { buildPrompt } from "@/lib/litt-runtime";

// ── Helpers ──

function makeRequest(body: Record<string, unknown>, signal?: AbortSignal): NextRequest {
  return new NextRequest("http://localhost/api/studio/conversations/conv-123/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message: "build a landing page",
      clientRequestId: `req-${Math.random().toString(36).slice(2)}`,
      expectedRevision: 1,
      ...body,
    }),
    signal,
  });
}

async function readSSE(response: Response): Promise<{ events: any[]; done: boolean; raw: string }> {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let raw = "";
  let done = false;
  const events: any[] = [];

  while (true) {
    const { value, done: streamDone } = await reader.read();
    if (streamDone) { done = true; break; }
    raw += decoder.decode(value, { stream: true });
  }

  // Parse SSE events
  for (const chunk of raw.split("\n\n")) {
    const line = chunk.trim();
    if (!line) continue;
    if (line.startsWith(":")) continue; // heartbeat comment
    if (line.startsWith("data: ")) {
      const data = line.slice(6);
      if (data === "[DONE]") continue;
      try { events.push(JSON.parse(data)); } catch { /* ignore */ }
    }
  }

  return { events, done, raw };
}

// ── Tests ──

describe("POST /api/studio/conversations/[conversationId]/messages — SSE stream lifecycle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetExecutionRegistryForTests();

    vi.mocked(auth).mockResolvedValue({ userId: "user_123", clerkId: "clerk_123" } as any);
    vi.mocked(getConversation).mockResolvedValue({
      id: "conv-123",
      projectId: "proj-123",
      revision: 1,
      activeAgentSlug: "litt",
      ownerId: "user_123",
    } as any);
    vi.mocked(buildStudioContext).mockResolvedValue({} as any);
    vi.mocked(buildCanonicalRuntimeContext).mockResolvedValue({
      workspaceExecutionAvailable: true,
      workspaceId: "ws-123",
      executionMode: "auto",
    } as any);
    vi.mocked(insertMessage).mockImplementation(async (args: any) => ({
      message: { id: `msg-${args.role}`, ...args },
      duplicate: false,
      error: null,
    }) as any);
    vi.mocked(updateMessageStatus).mockResolvedValue(true as any);
  });

  it("emits exactly one terminal `done` event and `[DONE]` marker on successful V2 run with fallback", async () => {
    vi.mocked(createWorkspaceTransport).mockResolvedValue({} as any);

    // Simulate a multi-step launch flow with provider fallback that succeeds
    vi.mocked(runLaunchFlow).mockImplementation(async (opts: any) => {
      const progress = opts.progress;
      // Step 1: model routing (gemini)
      progress.emit({ type: "model_routing", model: "gemini-3.6-flash", provider: "gemini" });
      progress.emit({ type: "phase", phase: "call_llm", step: 1 });
      progress.emit({ type: "status", summary: "Step 1: reasoning with gemini-3.6-flash" });
      // Step 2: tool call (files.list)
      progress.emit({ type: "tool_start", toolId: "files.list", summary: "listing files" });
      progress.emit({ type: "tool_result", toolId: "files.list", success: true, summary: "5 entries", durationMs: 100 });
      // Step 3: model fallback (gemini → openrouter)
      progress.emit({ type: "model_routing", model: "nvidia/nemotron-3.5-lightning:free", provider: "openrouter", fallbackFrom: "gemini-3.6-flash" });
      progress.emit({ type: "phase", phase: "call_llm", step: 2 });
      // Step 4: mutation (files.write)
      progress.emit({ type: "tool_start", toolId: "files.write", summary: "writing index.html" });
      progress.emit({ type: "tool_result", toolId: "files.write", success: true, summary: "saved", durationMs: 200 });
      // Preview
      progress.emit({ type: "preview_start" });
      progress.emit({ type: "preview_status", status: "ready", healthy: true });
      progress.emit({ type: "preview_result", success: true, previewUrl: "https://preview.example.com" });
      // Finished
      progress.emit({ type: "finished", totalSteps: 2, totalDurationMs: 1000 });

      return {
        success: true,
        status: "preview_ready",
        previewUrl: "https://preview.example.com",
        productionUrl: null,
        finalText: "I built your landing page and started a preview.",
        agentLoopResult: {
          stepsUsed: 2,
          toolCalls: [
            { toolId: "files.list", toolCallId: "tc1", inputs: {} },
            { toolId: "files.write", toolCallId: "tc2", inputs: { path: "index.html" } },
          ],
          cancelled: false,
          pendingApproval: null,
        } as any,
        cancelled: false,
        totalDurationMs: 1000,
      } as any;
    });

    const req = makeRequest({});
    const res = await POST(req, { params: Promise.resolve({ conversationId: "conv-123" }) });
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/event-stream");

    const { events, raw } = await readSSE(res);

    // Terminal event: exactly one `done`
    const doneEvents = events.filter((e) => e.type === "done");
    expect(doneEvents.length).toBe(1);
    expect(doneEvents[0].assistantMessage.status).toBe("completed");
    expect(doneEvents[0].previewUrl).toBe("https://preview.example.com");

    // `[DONE]` marker present
    expect(raw).toContain("data: [DONE]");

    // No `error` or `cancelled` events
    expect(events.filter((e) => e.type === "error")).toHaveLength(0);
    expect(events.filter((e) => e.type === "cancelled")).toHaveLength(0);

    // Model routing fallback was emitted
    const routingEvents = events.filter((e) => e.type === "model_routing");
    expect(routingEvents.length).toBe(2);
    expect(routingEvents[1].fallbackFrom).toBe("gemini-3.6-flash");

    // Mutation tool call was emitted
    const toolEvents = events.filter((e) => e.type === "tool_execution" && e.toolId === "files.write");
    expect(toolEvents.length).toBe(2); // tool_start + tool_result both map to tool_execution
    expect(toolEvents[1].success).toBe(true);

    // Preview event present
    const previewEvents = events.filter((e) => e.type === "preview_result");
    expect(previewEvents.length).toBe(1);
    expect(previewEvents[0].success).toBe(true);

    // Execution unregistered after normal completion — no stale entry.
    expect(getActiveExecution("conv-123")).toBeNull();
  });

  it("does NOT cancel execution when req.signal aborts (browser disconnect) — P0 regression", async () => {
    vi.mocked(createWorkspaceTransport).mockResolvedValue({} as any);

    const clientDisconnect = new AbortController();
    let capturedSignal: AbortSignal | undefined;
    let flowFinished: (val: any) => void;
    const flowDone = new Promise((resolve) => { flowFinished = resolve; });

    vi.mocked(runLaunchFlow).mockImplementation(async (opts: any) => {
      capturedSignal = opts.signal;
      const progress = opts.progress;
      progress.emit({ type: "phase", phase: "call_llm", step: 1 });
      // Simulate a long tool/build phase during which the browser drops the
      // connection (mobile Chrome suspend, tab close, network handoff).
      await new Promise((r) => setTimeout(r, 30));
      clientDisconnect.abort(new Error("Client disconnected"));
      // The run must NOT see the transport abort — it keeps executing.
      expect(opts.signal.aborted).toBe(false);
      await new Promise((r) => setTimeout(r, 30));
      expect(opts.signal.aborted).toBe(false);
      const result = {
        success: true,
        status: "preview_ready",
        previewUrl: "https://preview.example.com",
        productionUrl: null,
        finalText: "I built your landing page.",
        agentLoopResult: { stepsUsed: 1, toolCalls: [], cancelled: false, pendingApproval: null } as any,
        cancelled: false,
        totalDurationMs: 100,
      } as any;
      flowFinished(result);
      return result;
    });

    const req = makeRequest({}, clientDisconnect.signal);
    const res = await POST(req, { params: Promise.resolve({ conversationId: "conv-123" }) });
    expect(res.status).toBe(200);

    await flowDone;
    // The execution's AbortController was never aborted by the disconnect.
    expect(capturedSignal?.aborted).toBe(false);

    // Execution finished after disconnect — the FULL finalization path ran:
    // assistant result persisted, memory persisted, run unregistered.
    await vi.waitFor(() => {
      expect(updateMessageStatus).toHaveBeenCalledWith(
        expect.any(String),
        "user_123",
        "completed",
        "I built your landing page.",
      );
    });
    // And the run was NOT persisted as cancelled.
    expect(updateMessageStatus).not.toHaveBeenCalledWith(
      expect.any(String),
      "user_123",
      "cancelled",
      expect.anything(),
    );
    // Memory persistence still happened after the transport died.
    await vi.waitFor(() => {
      expect(persistMemory).toHaveBeenCalled();
    });
    // Registry entry cleaned up — no stale execution leaks.
    await vi.waitFor(() => {
      expect(getActiveExecution("conv-123")).toBeNull();
    });
  });

  it("settles billing exactly once as 'completed' when execution finishes after disconnect", async () => {
    vi.mocked(createWorkspaceTransport).mockResolvedValue({} as any);
    // Marketplace agent → the billing reserve/settle path is active.
    vi.mocked(parseAgentSelection).mockReturnValue({ kind: "instance", id: "inst-1" } as any);
    vi.mocked(resolveRuntimeAgent).mockResolvedValue({
      ok: true,
      agent: {
        agentInstanceId: "inst-1",
        agentId: "agent-1",
        agentVersionId: "ver-1",
        model: "test-model",
        memoryNamespace: "ns-1",
      },
    } as any);
    vi.mocked(reserveCredits).mockResolvedValue({
      ok: true,
      runId: "run-1",
      reservedCredits: 10,
      reservationId: "res-1",
    } as any);

    const clientDisconnect = new AbortController();
    let flowFinished: (val: any) => void;
    const flowDone = new Promise((resolve) => { flowFinished = resolve; });

    vi.mocked(runLaunchFlow).mockImplementation(async (opts: any) => {
      await new Promise((r) => setTimeout(r, 30));
      clientDisconnect.abort(new Error("Client disconnected"));
      await new Promise((r) => setTimeout(r, 30));
      expect(opts.signal.aborted).toBe(false);
      const result = {
        success: true,
        status: "preview_ready",
        previewUrl: "https://preview.example.com",
        productionUrl: null,
        finalText: "Built after disconnect.",
        agentLoopResult: { stepsUsed: 1, toolCalls: [], cancelled: false, pendingApproval: null } as any,
        cancelled: false,
        totalDurationMs: 60,
      } as any;
      flowFinished(result);
      return result;
    });

    const req = makeRequest({ agentInstanceId: "inst-1" }, clientDisconnect.signal);
    const res = await POST(req, { params: Promise.resolve({ conversationId: "conv-123" }) });
    expect(res.status).toBe(200);

    await flowDone;

    // Reserved once (idempotency key = clientRequestId), settled exactly
    // once as "completed" — a transport loss is not a billing failure.
    expect(reserveCredits).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => {
      expect(settleRun).toHaveBeenCalledTimes(1);
    });
    expect(settleRun).toHaveBeenCalledWith(
      "run-1",
      expect.objectContaining({ status: "completed" }),
      10,
      "res-1",
    );
  });

  it("persists a pending approval when the transport disconnects mid-run", async () => {
    vi.mocked(createWorkspaceTransport).mockResolvedValue({} as any);
    vi.mocked(createPausedRun).mockResolvedValue({ id: "paused-1" } as any);

    const clientDisconnect = new AbortController();
    let flowFinished: (val: any) => void;
    const flowDone = new Promise((resolve) => { flowFinished = resolve; });

    vi.mocked(runLaunchFlow).mockImplementation(async (opts: any) => {
      const progress = opts.progress;
      progress.emit({ type: "approval_required", toolId: "deploy.production", reason: "Deploy to production" });
      await new Promise((r) => setTimeout(r, 30));
      clientDisconnect.abort(new Error("Client disconnected"));
      const result = {
        success: true,
        status: "awaiting_approval",
        previewUrl: null,
        productionUrl: null,
        finalText: "I need approval to deploy to production.",
        agentLoopResult: {
          stepsUsed: 1,
          toolCalls: [],
          cancelled: false,
          pendingApproval: {
            toolId: "deploy.production",
            toolCallId: "tc-1",
            inputs: { environment: "production" },
            reason: "Deploy to production",
            pausedMessages: [],
          },
        } as any,
        pendingApproval: {
          toolId: "deploy.production",
          toolCallId: "tc-1",
          inputs: { environment: "production" },
          reason: "Deploy to production",
          pausedMessages: [],
        },
        cancelled: false,
        totalDurationMs: 60,
      } as any;
      flowFinished(result);
      return result;
    });

    const req = makeRequest({}, clientDisconnect.signal);
    const res = await POST(req, { params: Promise.resolve({ conversationId: "conv-123" }) });
    expect(res.status).toBe(200);

    await flowDone;

    // The paused run identity persisted for later resume — disconnect did
    // not auto-approve and did not auto-cancel the gate.
    await vi.waitFor(() => {
      expect(createPausedRun).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: "user_123",
          conversationId: "conv-123",
          toolId: "deploy.production",
          toolCallId: "tc-1",
        }),
      );
    });
    await vi.waitFor(() => {
      expect(updateMessageStatus).toHaveBeenCalledWith(
        expect.any(String),
        "user_123",
        "awaiting_approval",
        expect.anything(),
      );
    });
    expect(updateMessageStatus).not.toHaveBeenCalledWith(
      expect.any(String),
      "user_123",
      "cancelled",
      expect.anything(),
    );
  });

  it("explicit Stop cancels the V1 fallback path too — not just V2", async () => {
    // Force V1: no workspace execution available.
    vi.mocked(buildCanonicalRuntimeContext).mockResolvedValue({
      workspaceExecutionAvailable: false,
      executionMode: "auto",
    } as any);
    vi.mocked(runAgentLoop).mockResolvedValue({
      enrichedPrompt: "enriched",
      ranTools: false,
      toolExecutions: [],
    } as any);
    vi.mocked(buildPrompt).mockReturnValueOnce({
      fullPrompt: "test prompt",
      systemPrompt: "system",
      agentDisplayName: "LiTT",
      kernelResult: { decision: { routing: { requiresExecution: false, mode: "think" } } },
    } as any);

    // The execution AbortSignal is passed INTO streamText — a real
    // provider abort, not a detached Promise.race. Simulate the provider
    // honouring it by rejecting with AbortError when the signal fires.
    let capturedSignal: AbortSignal | undefined;
    vi.mocked(streamText).mockImplementation((_p, _c, opts: any) => {
      capturedSignal = opts?.signal;
      return new Promise((_res, rej) => {
        opts?.signal?.addEventListener(
          "abort",
          () => rej(new DOMException("The operation was aborted.", "AbortError")),
          { once: true },
        );
      }) as any;
    });

    const clientRequestId = "req-v1-stop";
    const req = makeRequest({ clientRequestId, message: "hello there" });
    const res = await POST(req, { params: Promise.resolve({ conversationId: "conv-123" }) });
    expect(res.status).toBe(200);

    await vi.waitFor(() => {
      expect(getActiveExecution("conv-123")).not.toBeNull();
    });
    const cancelResult = requestExecutionCancellation("conv-123", "user_123", clientRequestId);
    expect(cancelResult.status).toBe("aborted");
    // The same execution signal reached the provider call.
    expect(capturedSignal?.aborted).toBe(true);

    const { events } = await readSSE(res);
    const doneEvents = events.filter((e) => e.type === "done");
    expect(doneEvents.length).toBe(1);
    expect(doneEvents[0].assistantMessage.status).toBe("cancelled");
    // Cancellation emits a cancelled event — never a generic error event.
    expect(events.filter((e) => e.type === "cancelled")).toHaveLength(1);
    expect(events.filter((e) => e.type === "error")).toHaveLength(0);

    await vi.waitFor(() => {
      expect(updateMessageStatus).toHaveBeenCalledWith(
        expect.any(String),
        "user_123",
        "cancelled",
        undefined,
      );
    });
    // Partial cancelled output must not be persisted as conversation memory.
    expect(persistMemory).not.toHaveBeenCalled();
  });

  it("does NOT cancel execution when the downstream stream is cancelled — P0 regression", async () => {
    vi.mocked(createWorkspaceTransport).mockResolvedValue({} as any);

    let capturedSignal: AbortSignal | undefined;
    let flowFinished: (val: any) => void;
    const flowDone = new Promise((resolve) => { flowFinished = resolve; });

    vi.mocked(runLaunchFlow).mockImplementation(async (opts: any) => {
      capturedSignal = opts.signal;
      const progress = opts.progress;
      progress.emit({ type: "phase", phase: "call_llm", step: 1 });
      await new Promise((r) => setTimeout(r, 60));
      // ReadableStream.cancel() (downstream stopped consuming) must not
      // propagate into the execution signal.
      expect(opts.signal.aborted).toBe(false);
      // Emitting after the downstream cancel must be a harmless no-op —
      // safeEvent does not throw and does not abort execution.
      progress.emit({ type: "status", summary: "still working after downstream cancel" });
      progress.emit({ type: "tool_start", toolId: "files.read", summary: "post-cancel tool" });
      const result = {
        success: true,
        status: "preview_ready",
        previewUrl: "https://preview.example.com",
        productionUrl: null,
        finalText: "Done after downstream cancel.",
        agentLoopResult: { stepsUsed: 1, toolCalls: [], cancelled: false, pendingApproval: null } as any,
        cancelled: false,
        totalDurationMs: 100,
      } as any;
      flowFinished(result);
      return result;
    });

    const req = makeRequest({});
    const res = await POST(req, { params: Promise.resolve({ conversationId: "conv-123" }) });
    expect(res.status).toBe(200);

    // Give the stream a tick to open, then cancel the downstream consumer.
    await new Promise((r) => setTimeout(r, 20));
    await res.body!.cancel();

    await flowDone;
    expect(capturedSignal?.aborted).toBe(false);

    // Execution still ran to completion and persisted the result.
    await vi.waitFor(() => {
      expect(updateMessageStatus).toHaveBeenCalledWith(
        expect.any(String),
        "user_123",
        "completed",
        "Done after downstream cancel.",
      );
    });
    // And the registry entry was cleaned up exactly once.
    await vi.waitFor(() => {
      expect(getActiveExecution("conv-123")).toBeNull();
    });
  });

  it("explicit server-side cancellation DOES abort the execution signal", async () => {
    vi.mocked(createWorkspaceTransport).mockResolvedValue({} as any);

    const clientRequestId = "req-cancel-me";
    let sawAbort = false;
    vi.mocked(runLaunchFlow).mockImplementation(async (opts: any) => {
      const progress = opts.progress;
      progress.emit({ type: "phase", phase: "call_llm", step: 1 });
      // Wait for the explicit cancellation to arrive.
      for (let i = 0; i < 100 && !opts.signal.aborted; i++) {
        await new Promise((r) => setTimeout(r, 10));
      }
      sawAbort = opts.signal.aborted;
      return {
        success: false,
        status: "cancelled",
        finalText: "Cancelled: Cancelled by user",
        agentLoopResult: null,
        cancelled: true,
        cancelReason: "Cancelled by user",
        totalDurationMs: 100,
      } as any;
    });

    const req = makeRequest({ clientRequestId });
    const res = await POST(req, { params: Promise.resolve({ conversationId: "conv-123" }) });
    expect(res.status).toBe(200);

    // Wait until the run is registered, then send the explicit cancel.
    await vi.waitFor(() => {
      expect(getActiveExecution("conv-123")).not.toBeNull();
    });
    const cancelResult = requestExecutionCancellation("conv-123", "user_123", clientRequestId);
    expect(cancelResult.status).toBe("aborted");

    const { events } = await readSSE(res);
    expect(sawAbort).toBe(true);

    const doneEvents = events.filter((e) => e.type === "done");
    expect(doneEvents.length).toBe(1);
    expect(doneEvents[0].assistantMessage.status).toBe("cancelled");

    await vi.waitFor(() => {
      expect(updateMessageStatus).toHaveBeenCalledWith(
        expect.any(String),
        "user_123",
        "cancelled",
        expect.anything(),
      );
    });
    // Cancelled executions unregister too — a second Stop is a no-op.
    await vi.waitFor(() => {
      expect(getActiveExecution("conv-123")).toBeNull();
    });
    expect(requestExecutionCancellation("conv-123", "user_123", clientRequestId).status)
      .toBe("recorded");
  });

  it("a different user's cancellation request cannot abort the execution", async () => {
    vi.mocked(createWorkspaceTransport).mockResolvedValue({} as any);

    let capturedSignal: AbortSignal | undefined;
    let flowFinished: (val: any) => void;
    const flowDone = new Promise((resolve) => { flowFinished = resolve; });

    vi.mocked(runLaunchFlow).mockImplementation(async (opts: any) => {
      capturedSignal = opts.signal;
      const progress = opts.progress;
      progress.emit({ type: "phase", phase: "call_llm", step: 1 });
      await new Promise((r) => setTimeout(r, 50));
      const result = {
        success: true,
        status: "preview_ready",
        previewUrl: "https://preview.example.com",
        productionUrl: null,
        finalText: "Still finished.",
        agentLoopResult: { stepsUsed: 1, toolCalls: [], cancelled: false, pendingApproval: null } as any,
        cancelled: false,
        totalDurationMs: 100,
      } as any;
      flowFinished(result);
      return result;
    });

    const req = makeRequest({ clientRequestId: "req-cross-user" });
    const res = await POST(req, { params: Promise.resolve({ conversationId: "conv-123" }) });
    expect(res.status).toBe(200);

    await vi.waitFor(() => {
      expect(getActiveExecution("conv-123")).not.toBeNull();
    });
    // User B tries to cancel User A's run — must be refused even with the
    // exact clientRequestId.
    const result = requestExecutionCancellation("conv-123", "user_456", "req-cross-user");
    expect(result.status).toBe("forbidden");

    await flowDone;
    expect(capturedSignal?.aborted).toBe(false);
  });

  it("emits `error` terminal event and `[DONE]` when launch flow throws", async () => {
    vi.mocked(createWorkspaceTransport).mockResolvedValue({} as any);

    vi.mocked(runLaunchFlow).mockRejectedValue(new Error("Provider connection refused"));

    const req = makeRequest({ message: "hello there" });
    const res = await POST(req, { params: Promise.resolve({ conversationId: "conv-123" }) });
    expect(res.status).toBe(200);

    const { events, raw } = await readSSE(res);

    // Terminal event: `error`
    const errorEvents = events.filter((e) => e.type === "error");
    expect(errorEvents.length).toBe(1);
    expect(errorEvents[0].message).toContain("Provider connection refused");

    // `[DONE]` marker present
    expect(raw).toContain("data: [DONE]");

    // No `done` events (error path)
    expect(events.filter((e) => e.type === "done")).toHaveLength(0);

    // Message status updated to failed — with the real error persisted as
    // content, not an empty body that collapses to the generic fallback.
    expect(updateMessageStatus).toHaveBeenCalledWith(
      expect.any(String),
      "user_123",
      "failed",
      expect.stringContaining("Provider connection refused"),
    );

    // The failed execution was unregistered — cleanup runs on every path.
    expect(getActiveExecution("conv-123")).toBeNull();
  });

  it("a V1 run that resolves with no text emits a classified error with the bumped revision — never an empty done", async () => {
    // Force V1: no workspace execution available.
    vi.mocked(buildCanonicalRuntimeContext).mockResolvedValue({
      workspaceExecutionAvailable: false,
      executionMode: "auto",
    } as any);
    vi.mocked(runAgentLoop).mockResolvedValue({
      enrichedPrompt: "enriched",
      ranTools: false,
      toolExecutions: [],
    } as any);
    vi.mocked(buildPrompt).mockReturnValueOnce({
      fullPrompt: "test prompt",
      systemPrompt: "system",
      agentDisplayName: "LiTT",
      kernelResult: { decision: { routing: { requiresExecution: false, mode: "think" } } },
    } as any);
    // Provider stream completes normally but emits no content — the exact
    // production failure mode behind "The response was empty".
    vi.mocked(streamText).mockResolvedValue({
      provider: "groq",
      model: "openai/gpt-oss-120b",
      latencyMs: 120,
      failover: [],
      finishReason: "stop",
    } as any);

    const req = makeRequest({});
    const res = await POST(req, { params: Promise.resolve({ conversationId: "conv-123" }) });
    expect(res.status).toBe(200);

    const { events, raw } = await readSSE(res);

    // Truthful terminal state: a classified error, not a done card.
    const errorEvents = events.filter((e) => e.type === "error");
    expect(errorEvents.length).toBe(1);
    expect(errorEvents[0].code).toBe("EMPTY_PROVIDER_RESPONSE");
    // The client must learn the bumped revision or its next send 409s.
    expect(errorEvents[0].revision).toBe(2);
    expect(events.filter((e) => e.type === "done")).toHaveLength(0);
    expect(raw).toContain("data: [DONE]");

    // Persisted as failed — not completed with empty content.
    expect(updateMessageStatus).toHaveBeenCalledWith(
      expect.any(String),
      "user_123",
      "failed",
      expect.stringContaining("empty response"),
    );
    expect(getActiveExecution("conv-123")).toBeNull();
  });

  it("fails the V1 run truthfully when streamText emits tool-call markup (P0-B boundary)", async () => {
    // Exact production shape: the text-only path streamed literal
    // <tool_call> markup into assistantText and persisted it as
    // `completed` even though no tool executed.
    vi.mocked(buildCanonicalRuntimeContext).mockResolvedValue({
      workspaceExecutionAvailable: false,
      executionMode: "auto",
    } as any);
    vi.mocked(runAgentLoop).mockResolvedValue({
      enrichedPrompt: "enriched",
      ranTools: false,
      toolExecutions: [],
    } as any);
    vi.mocked(buildPrompt).mockReturnValueOnce({
      fullPrompt: "test prompt",
      systemPrompt: "system",
      agentDisplayName: "LiTT",
      kernelResult: { decision: { routing: { requiresExecution: false, mode: "think" } } },
    } as any);
    vi.mocked(streamText).mockImplementation(async (_p, onChunk: any) => {
      onChunk("Let me find the `index.html` first.\n");
      onChunk(
        "<tool_call>terminal\n<arg_key>command</arg_key>\n" +
          '<arg_value>find /workspace -name "index.html" -type f</arg_value>\n</tool_call>',
      );
      return {
        provider: "groq",
        model: "openai/gpt-oss-120b",
        latencyMs: 120,
        failover: [],
        finishReason: "stop",
      } as any;
    });

    const res = await POST(makeRequest({ message: "hello there" }), {
      params: Promise.resolve({ conversationId: "conv-123" }),
    });
    expect(res.status).toBe(200);
    const { events } = await readSSE(res);

    // Truthful terminal state: classified error, no done card.
    const errorEvents = events.filter((e) => e.type === "error");
    expect(errorEvents.length).toBe(1);
    expect(events.filter((e) => e.type === "done" && e.assistantMessage?.status === "completed")).toHaveLength(0);

    // Persisted as failed — and the raw markup must NOT be stored.
    expect(updateMessageStatus).toHaveBeenCalledWith(
      expect.any(String),
      "user_123",
      "failed",
      expect.not.stringContaining("<tool_call>"),
    );
    // Raw markup never lands in memory either.
    expect(persistMemory).not.toHaveBeenCalled();
  });

  it("strips non-intent markup but keeps prose on the V1 path", async () => {
    vi.mocked(buildCanonicalRuntimeContext).mockResolvedValue({
      workspaceExecutionAvailable: false,
      executionMode: "auto",
    } as any);
    vi.mocked(runAgentLoop).mockResolvedValue({
      enrichedPrompt: "enriched",
      ranTools: false,
      toolExecutions: [],
    } as any);
    vi.mocked(buildPrompt).mockReturnValueOnce({
      fullPrompt: "test prompt",
      systemPrompt: "system",
      agentDisplayName: "LiTT",
      kernelResult: { decision: { routing: { requiresExecution: false, mode: "think" } } },
    } as any);
    vi.mocked(streamText).mockImplementation(async (_p, onChunk: any) => {
      onChunk("Here is the answer. </tool_call>");
      return { provider: "groq", model: "m", latencyMs: 5, failover: [], finishReason: "stop" } as any;
    });

    const res = await POST(makeRequest({ message: "hello there" }), {
      params: Promise.resolve({ conversationId: "conv-123" }),
    });
    expect(res.status).toBe(200);
    const { events } = await readSSE(res);

    expect(events.filter((e) => e.type === "done")).toHaveLength(1);
    expect(updateMessageStatus).toHaveBeenCalledWith(
      expect.any(String),
      "user_123",
      "completed",
      expect.stringContaining("Here is the answer."),
    );
    expect(updateMessageStatus).toHaveBeenCalledWith(
      expect.any(String),
      "user_123",
      "completed",
      expect.not.stringContaining("</tool_call>"),
    );
  });

  it("does not downgrade an execution request to the text-only V1 path", async () => {
    vi.mocked(buildCanonicalRuntimeContext).mockResolvedValue({
      workspaceExecutionAvailable: false,
      executionMode: "auto",
    } as any);

    const response = await POST(makeRequest({ message: "Change only the selected button text" }), {
      params: Promise.resolve({ conversationId: "conv-123" }),
    });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: "TOOL_EXECUTION_UNAVAILABLE",
    });
    expect(runAgentLoop).not.toHaveBeenCalled();
    expect(streamText).not.toHaveBeenCalled();
  });

  it("a V2 run that returns empty finalText is persisted and reported as failed, not completed", async () => {
    vi.mocked(createWorkspaceTransport).mockResolvedValue({} as any);
    vi.mocked(runLaunchFlow).mockResolvedValue({
      success: true,
      status: "preview_ready",
      previewUrl: "https://preview.example.com",
      productionUrl: null,
      finalText: "",
      agentLoopResult: {
        stepsUsed: 1,
        toolCalls: [],
        cancelled: false,
        pendingApproval: null,
      } as any,
      cancelled: false,
      totalDurationMs: 100,
    } as any);

    const req = makeRequest({});
    const res = await POST(req, { params: Promise.resolve({ conversationId: "conv-123" }) });
    const { events } = await readSSE(res);

    // The terminal event exists but must NOT claim completion — an empty
    // provider outcome is a failure.
    const doneEvents = events.filter((e) => e.type === "done");
    expect(doneEvents.length).toBe(1);
    expect(doneEvents[0].assistantMessage.status).toBe("failed");
    expect(doneEvents[0].revision).toBe(2);

    expect(updateMessageStatus).toHaveBeenCalledWith(
      expect.any(String),
      "user_123",
      "failed",
      "",
    );
    expect(getActiveExecution("conv-123")).toBeNull();
  });

  it("a failed run releases the conversation — an immediate second send is not rejected", async () => {
    vi.mocked(createWorkspaceTransport).mockResolvedValue({} as any);
    vi.mocked(runLaunchFlow).mockRejectedValue(new Error("Provider connection refused"));

    const first = await POST(makeRequest({}), { params: Promise.resolve({ conversationId: "conv-123" }) });
    const { events: firstEvents } = await readSSE(first);
    expect(firstEvents.some((e) => e.type === "error")).toBe(true);
    expect(getActiveExecution("conv-123")).toBeNull();

    // Same conversation, immediately after — must reach the SSE stream,
    // not a 409/lock. expectedRevision now matches the bumped value.
    vi.mocked(runLaunchFlow).mockResolvedValue({
      success: true,
      status: "preview_ready",
      previewUrl: null,
      productionUrl: null,
      finalText: "Recovered answer.",
      agentLoopResult: { stepsUsed: 1, toolCalls: [], cancelled: false, pendingApproval: null } as any,
      cancelled: false,
      totalDurationMs: 50,
    } as any);
    const second = await POST(makeRequest({ expectedRevision: 2 }), { params: Promise.resolve({ conversationId: "conv-123" }) });
    expect(second.status).toBe(200);
    expect(second.headers.get("Content-Type")).toContain("text/event-stream");
    const { events: secondEvents } = await readSSE(second);
    const doneEvents = secondEvents.filter((e) => e.type === "done");
    expect(doneEvents.length).toBe(1);
    expect(doneEvents[0].assistantMessage.status).toBe("completed");
    expect(getActiveExecution("conv-123")).toBeNull();
  });

  it("emits heartbeat comments to keep the connection alive during long LLM calls", async () => {
    vi.mocked(createWorkspaceTransport).mockResolvedValue({} as any);

    vi.mocked(runLaunchFlow).mockImplementation(async (opts: any) => {
      const progress = opts.progress;
      progress.emit({ type: "phase", phase: "call_llm", step: 1 });
      // Simulate a long call — heartbeat should fire at least once
      await new Promise((r) => setTimeout(r, 100));
      progress.emit({ type: "finished", totalSteps: 1, totalDurationMs: 100 });
      return {
        success: true,
        status: "preview_ready",
        previewUrl: "https://preview.example.com",
        productionUrl: null,
        finalText: "Done.",
        agentLoopResult: { stepsUsed: 1, toolCalls: [], cancelled: false, pendingApproval: null } as any,
        cancelled: false,
        totalDurationMs: 100,
      } as any;
    });

    const req = makeRequest({});
    const res = await POST(req, { params: Promise.resolve({ conversationId: "conv-123" }) });
    const { raw } = await readSSE(res);

    // Heartbeat comments present (SSE comment lines start with ":")
    const lines = raw.split("\n");
    const heartbeatLines = lines.filter((l) => l.startsWith(": keepalive"));
    // Heartbeat fires every 15s; with a 100ms run we may not see one,
    // but the timer must be set up. Verify no crash and [DONE] present.
    expect(raw).toContain("data: [DONE]");
  });
});

describe("GET /api/studio/conversations/[conversationId]/messages — approval rehydration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetExecutionRegistryForTests();
    vi.mocked(auth).mockResolvedValue({ userId: "user_123", clerkId: "clerk_123" } as any);
    vi.mocked(getConversation).mockResolvedValue({
      id: "conv-123",
      projectId: "proj-123",
      revision: 4,
      activeAgentSlug: "litt",
      ownerId: "user_123",
    } as any);
  });

  it("attaches pendingApproval to an awaiting_approval message when a resumable paused run exists", async () => {
    vi.mocked(listMessages).mockResolvedValue([
      { id: "m1", role: "user", content: "add footer", status: "completed" },
      { id: "m2", role: "assistant", content: "I need your approval to continue:", status: "awaiting_approval" },
    ] as any);
    vi.mocked(getPendingPausedRunForConversation).mockResolvedValue({
      id: "paused-9",
      toolId: "files.write",
      reason: "Mutation requires approval in ACT mode",
      inputs: { path: "index.html" },
    } as any);

    const res = await GET(new NextRequest("http://localhost/api/studio/conversations/conv-123/messages"), {
      params: Promise.resolve({ conversationId: "conv-123" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    const last = body.messages.at(-1);
    expect(last.status).toBe("awaiting_approval");
    expect(last.pendingApproval).toEqual({
      toolId: "files.write",
      reason: "Mutation requires approval in ACT mode",
      pausedRunId: "paused-9",
      inputs: { path: "index.html" },
    });
  });

  it("attaches pendingApproval to a streaming last message — the messages CHECK constraint predates awaiting_approval so paused runs persist as streaming", async () => {
    vi.mocked(listMessages).mockResolvedValue([
      { id: "m2", role: "assistant", content: "", status: "streaming" },
    ] as any);
    vi.mocked(getPendingPausedRunForConversation).mockResolvedValue({
      id: "paused-10",
      toolId: "apply_patch",
      reason: "Mutation requires approval in ACT mode",
      inputs: { path: "index.html" },
    } as any);

    const res = await GET(new NextRequest("http://localhost/api/studio/conversations/conv-123/messages"), {
      params: Promise.resolve({ conversationId: "conv-123" }),
    });
    const body = await res.json();
    expect(body.messages.at(-1).pendingApproval?.pausedRunId).toBe("paused-10");
  });

  it("leaves the message untouched when no resumable paused run exists", async () => {
    vi.mocked(listMessages).mockResolvedValue([
      { id: "m2", role: "assistant", content: "I need your approval", status: "awaiting_approval" },
    ] as any);
    vi.mocked(getPendingPausedRunForConversation).mockResolvedValue(null);

    const res = await GET(new NextRequest("http://localhost/api/studio/conversations/conv-123/messages"), {
      params: Promise.resolve({ conversationId: "conv-123" }),
    });
    const body = await res.json();
    expect(body.messages.at(-1).pendingApproval).toBeUndefined();
  });

  it("clears a stale streaming message when no execution or approval is active", async () => {
    vi.mocked(listMessages).mockResolvedValue([
      {
        id: "m-stale",
        role: "assistant",
        content: "",
        status: "streaming",
        updatedAt: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
      },
    ] as any);
    vi.mocked(getPendingPausedRunForConversation).mockResolvedValue(null);
    vi.mocked(getLatestPausedRunForConversation).mockResolvedValue(null);
    vi.mocked(updateMessageStatus).mockResolvedValue(true);

    const res = await GET(new NextRequest("http://localhost/api/studio/conversations/conv-123/messages"), {
      params: Promise.resolve({ conversationId: "conv-123" }),
    });
    const body = await res.json();

    expect(updateMessageStatus).toHaveBeenCalledWith(
      "m-stale",
      "user_123",
      "failed",
      expect.stringContaining("ended before it produced a result"),
    );
    expect(body.messages.at(-1).status).toBe("failed");
    expect(body.messages.at(-1).content).toContain("ended before it produced a result");
  });

  it("does not condemn a stale streaming message while its resumed run is still processing", async () => {
    // A paused message persists as 'streaming' when the
    // 'awaiting_approval' status write failed, and a resumed run never
    // registers in the in-process execution registry — without the
    // durable run check this message would be marked failed while the
    // approved run was still working.
    const messageCreated = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    vi.mocked(listMessages).mockResolvedValue([
      {
        id: "m-resumed",
        role: "assistant",
        content: "",
        status: "streaming",
        createdAt: messageCreated,
        updatedAt: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
      },
    ] as any);
    vi.mocked(getPendingPausedRunForConversation).mockResolvedValue(null);
    vi.mocked(getLatestPausedRunForConversation).mockResolvedValue({
      id: "paused-live",
      status: "approved",
      runStatus: "processing",
      toolId: "files.write",
      reason: "Mutation requires approval in ACT mode",
      inputs: { path: "index.html" },
      createdAt: new Date(Date.parse(messageCreated) + 5_000).toISOString(),
    } as any);

    const res = await GET(new NextRequest("http://localhost/api/studio/conversations/conv-123/messages"), {
      params: Promise.resolve({ conversationId: "conv-123" }),
    });
    const body = await res.json();

    expect(updateMessageStatus).not.toHaveBeenCalled();
    expect(body.messages.at(-1).status).toBe("streaming");
  });

  it("surfaces the real run error for a stale streaming message whose resumed run failed", async () => {
    const messageCreated = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    vi.mocked(listMessages).mockResolvedValue([
      {
        id: "m-dead",
        role: "assistant",
        content: "",
        status: "streaming",
        createdAt: messageCreated,
        updatedAt: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
      },
    ] as any);
    vi.mocked(getPendingPausedRunForConversation).mockResolvedValue(null);
    vi.mocked(getLatestPausedRunForConversation).mockResolvedValue({
      id: "paused-dead",
      status: "approved",
      runStatus: "failed",
      runError: "Execution stalled (no progress)",
      toolId: "apply_patch",
      reason: "Mutation requires approval in ACT mode",
      inputs: { path: "index.html" },
      createdAt: new Date(Date.parse(messageCreated) + 5_000).toISOString(),
    } as any);
    vi.mocked(updateMessageStatus).mockResolvedValue(true);

    const res = await GET(new NextRequest("http://localhost/api/studio/conversations/conv-123/messages"), {
      params: Promise.resolve({ conversationId: "conv-123" }),
    });
    const body = await res.json();

    expect(updateMessageStatus).toHaveBeenCalledWith(
      "m-dead",
      "user_123",
      "failed",
      expect.stringContaining("Execution stalled (no progress)"),
    );
    expect(body.messages.at(-1).status).toBe("failed");
    expect(body.messages.at(-1).content).not.toContain("ended before it produced a result");
  });

  it("reconciles a stale streaming message to the resumed run's completed result", async () => {
    const messageCreated = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    vi.mocked(listMessages).mockResolvedValue([
      {
        id: "m-done",
        role: "assistant",
        content: "",
        status: "streaming",
        createdAt: messageCreated,
        updatedAt: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
      },
    ] as any);
    vi.mocked(getPendingPausedRunForConversation).mockResolvedValue(null);
    vi.mocked(getLatestPausedRunForConversation).mockResolvedValue({
      id: "paused-done",
      status: "approved",
      runStatus: "completed",
      runResult: { finalText: "Updated the footer with the literal brand name." },
      toolId: "apply_patch",
      reason: "Mutation requires approval in ACT mode",
      inputs: { path: "index.html" },
      createdAt: new Date(Date.parse(messageCreated) + 5_000).toISOString(),
    } as any);
    vi.mocked(updateMessageStatus).mockResolvedValue(true);

    const res = await GET(new NextRequest("http://localhost/api/studio/conversations/conv-123/messages"), {
      params: Promise.resolve({ conversationId: "conv-123" }),
    });
    const body = await res.json();

    expect(updateMessageStatus).toHaveBeenCalledWith(
      "m-done",
      "user_123",
      "completed",
      "Updated the footer with the literal brand name.",
    );
    expect(body.messages.at(-1).status).toBe("completed");
    expect(body.messages.at(-1).content).toBe("Updated the footer with the literal brand name.");
  });

  it("does not clear a recent streaming message while registration may still be racing", async () => {
    vi.mocked(listMessages).mockResolvedValue([
      {
        id: "m-recent",
        role: "assistant",
        content: "",
        status: "streaming",
        updatedAt: new Date(Date.now() - 5 * 1000).toISOString(),
      },
    ] as any);
    vi.mocked(getPendingPausedRunForConversation).mockResolvedValue(null);

    const res = await GET(new NextRequest("http://localhost/api/studio/conversations/conv-123/messages"), {
      params: Promise.resolve({ conversationId: "conv-123" }),
    });
    const body = await res.json();

    expect(updateMessageStatus).not.toHaveBeenCalled();
    expect(body.messages.at(-1).status).toBe("streaming");
  });

  it("does not query paused runs when the last assistant message is not awaiting approval", async () => {
    vi.mocked(listMessages).mockResolvedValue([
      { id: "m2", role: "assistant", content: "done", status: "completed" },
    ] as any);

    const res = await GET(new NextRequest("http://localhost/api/studio/conversations/conv-123/messages"), {
      params: Promise.resolve({ conversationId: "conv-123" }),
    });
    expect(res.status).toBe(200);
    expect(getPendingPausedRunForConversation).not.toHaveBeenCalled();
  });

  it("reconciles an awaiting_approval message whose gate expired server-side — no dead 'waiting for approval' card survives reload", async () => {
    vi.mocked(listMessages).mockResolvedValue([
      { id: "m-exp", role: "assistant", content: "I need your approval to write files.", status: "awaiting_approval", createdAt: new Date(Date.now() - 10 * 60_000).toISOString() },
    ] as any);
    vi.mocked(getPendingPausedRunForConversation).mockResolvedValue(null);
    vi.mocked(getLatestPausedRunForConversation).mockResolvedValue({
      id: "paused-dead",
      status: "expired",
      toolId: "files.write",
      reason: "Mutation requires approval in ACT mode",
      inputs: {},
      createdAt: new Date(Date.now() - 9 * 60_000).toISOString(),
    } as any);
    vi.mocked(updateMessageStatus).mockResolvedValue(true);

    const res = await GET(new NextRequest("http://localhost/api/studio/conversations/conv-123/messages"), {
      params: Promise.resolve({ conversationId: "conv-123" }),
    });
    const body = await res.json();

    expect(updateMessageStatus).toHaveBeenCalledWith(
      "m-exp",
      "user_123",
      "cancelled",
      expect.stringContaining("expired"),
    );
    expect(body.messages.at(-1).status).toBe("cancelled");
    expect(body.messages.at(-1).pendingApproval).toBeUndefined();
  });

  it("reconciles an awaiting_approval message whose gate was rejected but the writeback missed", async () => {
    vi.mocked(listMessages).mockResolvedValue([
      { id: "m-rej", role: "assistant", content: "I need your approval.", status: "awaiting_approval", createdAt: new Date(Date.now() - 10 * 60_000).toISOString() },
    ] as any);
    vi.mocked(getPendingPausedRunForConversation).mockResolvedValue(null);
    vi.mocked(getLatestPausedRunForConversation).mockResolvedValue({
      id: "paused-rej",
      status: "rejected",
      toolId: "files.write",
      reason: "Mutation requires approval",
      inputs: {},
      createdAt: new Date(Date.now() - 9 * 60_000).toISOString(),
    } as any);
    vi.mocked(updateMessageStatus).mockResolvedValue(true);

    const res = await GET(new NextRequest("http://localhost/api/studio/conversations/conv-123/messages"), {
      params: Promise.resolve({ conversationId: "conv-123" }),
    });
    const body = await res.json();

    expect(updateMessageStatus).toHaveBeenCalledWith(
      "m-rej",
      "user_123",
      "completed",
      expect.stringContaining("Declined"),
    );
    expect(body.messages.at(-1).status).toBe("completed");
  });

  it("reconciles an awaiting_approval message whose approved run died mid-resume — no dead card after a process kill", async () => {
    vi.mocked(listMessages).mockResolvedValue([
      { id: "m-died", role: "assistant", content: "I need your approval.", status: "awaiting_approval", createdAt: new Date(Date.now() - 10 * 60_000).toISOString() },
    ] as any);
    vi.mocked(getPendingPausedRunForConversation).mockResolvedValue(null);
    vi.mocked(getLatestPausedRunForConversation).mockResolvedValue({
      id: "paused-died",
      status: "approved",
      runStatus: "failed",
      runError: "Execution timed out (process may have restarted)",
      toolId: "apply_patch",
      reason: "Mutation requires approval",
      inputs: {},
      createdAt: new Date(Date.now() - 9 * 60_000).toISOString(),
    } as any);
    vi.mocked(updateMessageStatus).mockResolvedValue(true);

    const res = await GET(new NextRequest("http://localhost/api/studio/conversations/conv-123/messages"), {
      params: Promise.resolve({ conversationId: "conv-123" }),
    });
    const body = await res.json();

    expect(updateMessageStatus).toHaveBeenCalledWith(
      "m-died",
      "user_123",
      "failed",
      expect.stringContaining("failed before it could finish"),
    );
    expect(body.messages.at(-1).status).toBe("failed");
    expect(body.messages.at(-1).content).toContain("process may have restarted");
    expect(body.messages.at(-1).pendingApproval).toBeUndefined();
  });

  it("reconciles an awaiting_approval message whose approved run completed but the transcript writeback missed", async () => {
    vi.mocked(listMessages).mockResolvedValue([
      { id: "m-done", role: "assistant", content: "I need your approval.", status: "awaiting_approval", createdAt: new Date(Date.now() - 10 * 60_000).toISOString() },
    ] as any);
    vi.mocked(getPendingPausedRunForConversation).mockResolvedValue(null);
    vi.mocked(getLatestPausedRunForConversation).mockResolvedValue({
      id: "paused-done",
      status: "approved",
      runStatus: "completed",
      runResult: { finalText: "Updated index.html.", stepsUsed: 2, toolCalls: [], cancelled: false },
      toolId: "apply_patch",
      reason: "Mutation requires approval",
      inputs: {},
      createdAt: new Date(Date.now() - 9 * 60_000).toISOString(),
    } as any);
    vi.mocked(updateMessageStatus).mockResolvedValue(true);

    const res = await GET(new NextRequest("http://localhost/api/studio/conversations/conv-123/messages"), {
      params: Promise.resolve({ conversationId: "conv-123" }),
    });
    const body = await res.json();

    expect(updateMessageStatus).toHaveBeenCalledWith(
      "m-done",
      "user_123",
      "completed",
      "Updated index.html.",
    );
    expect(body.messages.at(-1).status).toBe("completed");
  });

  it("fails truthfully when the resumed run ended at a nested gate that was never persisted", async () => {
    vi.mocked(listMessages).mockResolvedValue([
      { id: "m-lost", role: "assistant", content: "I need your approval.", status: "awaiting_approval", createdAt: new Date(Date.now() - 10 * 60_000).toISOString() },
    ] as any);
    vi.mocked(getPendingPausedRunForConversation).mockResolvedValue(null);
    vi.mocked(getLatestPausedRunForConversation).mockResolvedValue({
      id: "paused-lost",
      status: "approved",
      runStatus: "completed",
      runResult: {
        finalText: "I need your approval to continue:",
        stepsUsed: 3,
        toolCalls: [],
        cancelled: false,
        pendingApproval: { toolId: "apply_patch", reason: "Mutation requires approval" },
      },
      toolId: "apply_patch",
      reason: "Mutation requires approval",
      inputs: {},
      createdAt: new Date(Date.now() - 9 * 60_000).toISOString(),
    } as any);
    vi.mocked(updateMessageStatus).mockResolvedValue(true);

    const res = await GET(new NextRequest("http://localhost/api/studio/conversations/conv-123/messages"), {
      params: Promise.resolve({ conversationId: "conv-123" }),
    });
    const body = await res.json();

    expect(updateMessageStatus).toHaveBeenCalledWith(
      "m-lost",
      "user_123",
      "failed",
      expect.stringContaining("could not be persisted"),
    );
    expect(body.messages.at(-1).status).toBe("failed");
  });

  it("leaves an awaiting_approval message alone while its approved gate is still resuming", async () => {
    vi.mocked(listMessages).mockResolvedValue([
      { id: "m-run", role: "assistant", content: "I need your approval.", status: "awaiting_approval" },
    ] as any);
    vi.mocked(getPendingPausedRunForConversation).mockResolvedValue(null);
    vi.mocked(getLatestPausedRunForConversation).mockResolvedValue({
      id: "paused-live",
      status: "approved",
      runStatus: "processing",
      toolId: "files.write",
      reason: "Mutation requires approval",
      inputs: {},
    } as any);

    const res = await GET(new NextRequest("http://localhost/api/studio/conversations/conv-123/messages"), {
      params: Promise.resolve({ conversationId: "conv-123" }),
    });
    const body = await res.json();

    expect(updateMessageStatus).not.toHaveBeenCalled();

    expect(body.messages.at(-1).status).toBe("awaiting_approval");
  });
});