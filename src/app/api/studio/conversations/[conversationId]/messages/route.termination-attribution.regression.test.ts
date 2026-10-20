// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

/**
 * Regression tests — truthful termination attribution at the messages
 * route's initial-segment settles (Repair R4, Diagnosis E3-S1/S6).
 *
 * The defects:
 *  1. The normal settle keyed "cancelled" / "Task cancelled by user"
 *     purely on launchFlowResult.cancelled — but the loop sets
 *     cancelled=true for non-user stops (max steps, max output,
 *     repeated-call, stall, max runtime) and carries the real reason on
 *     cancelReason, which the settle never read. A budget stop was
 *     recorded as a user cancellation.
 *  2. The error settle keyed purely on executionAbort.signal.aborted —
 *     the abort's ORIGIN was never inspected, so a graceful-shutdown
 *     abort (server restart, reason "Received SIGTERM — …") was also
 *     written back as a user cancellation (E3-S6), while the shutdown
 *     routine's own message text said "server restarted".
 *
 * Only a user-origin stop may settle as cancelled; every other stop
 * settles FAILED carrying its real reason. Billing semantics are
 * unchanged (cancelled and failed both debit zero).
 */

// ── Mocks (same harness family as route.test.ts) ──

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
  reserveCredits: vi.fn(() =>
    Promise.resolve({ ok: true, runId: "run-1", reservedCredits: 12, reservationId: "res-1" })),
  settleRun: vi.fn(() => Promise.resolve({ ok: true })),
  estimateCredits: vi.fn(() => 0),
  resumeQuoteDisclosure: vi.fn(() => ""),
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

const actionRuntimeMocks = vi.hoisted(() => ({
  createActionRun: vi.fn(),
  transitionActionRunEventActivity: vi.fn(),
  transitionActionRun: vi.fn(),
  appendActionEvent: vi.fn(),
  requestActionRunCancellation: vi.fn(),
}));

vi.mock("@/lib/action-runtime", () => actionRuntimeMocks);

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
  isEmptyProviderResponse: (err: unknown) =>
    typeof err === "object" &&
    err !== null &&
    (err as { code?: unknown }).code === "EMPTY_PROVIDER_RESPONSE",
}));

import { auth } from "@/lib/auth";
import { POST } from "./route";
import { runLaunchFlow } from "@/lib/litt-intelligence/launch-flow";
import { runAgentLoop } from "@/lib/litt-intelligence/agent-loop";
import { streamText } from "@/lib/llm";
import {
  getActiveExecution,
  resetExecutionRegistryForTests,
} from "@/lib/studio/execution-registry";
import { createWorkspaceTransport } from "@/lib/litt-intelligence/workspace-transport";
import { buildCanonicalRuntimeContext } from "@/lib/litt-intelligence/canonical-runtime-context";
import { buildStudioContext } from "@/lib/studio/project-resolver";
import { getConversation, insertMessage, updateMessageStatus } from "@/lib/studio/conversation-service";
import { buildPrompt } from "@/lib/litt-runtime";

// ── Helpers ──

function makeRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest("http://localhost/api/studio/conversations/conv-123/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message: "build a landing page",
      clientRequestId: `req-${Math.random().toString(36).slice(2)}`,
      expectedRevision: 1,
      ...body,
    }),
  });
}

async function readSSE(response: Response): Promise<{ events: any[] }> {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let raw = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    raw += decoder.decode(value, { stream: true });
  }
  const events: any[] = [];
  for (const chunk of raw.split("\n\n")) {
    const line = chunk.trim();
    if (!line || line.startsWith(":")) continue;
    if (line.startsWith("data: ")) {
      const data = line.slice(6);
      if (data === "[DONE]") continue;
      try { events.push(JSON.parse(data)); } catch { /* ignore */ }
    }
  }
  return { events };
}

function transitionCalls(status: string) {
  return actionRuntimeMocks.transitionActionRun.mock.calls.filter(
    (c) => c[2] === status,
  );
}

// ── Tests ──

describe("POST /messages — termination attribution (R4/E3-S1/S6)", () => {
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
    actionRuntimeMocks.createActionRun.mockResolvedValue({
      id: "action-run-123",
      userId: "user_123",
      projectId: "proj-123",
      conversationId: "conv-123",
      kind: "composite",
      status: "queued",
    } as any);
    actionRuntimeMocks.transitionActionRunEventActivity.mockResolvedValue({} as any);
    actionRuntimeMocks.transitionActionRun.mockResolvedValue({} as any);
    actionRuntimeMocks.requestActionRunCancellation.mockResolvedValue({} as any);
    vi.mocked(createWorkspaceTransport).mockResolvedValue({
      projectId: "proj-123",
      userId: "user_123",
      workspaceId: "ws-123",
    } as any);
  });

  it("(a3) an initial segment stopped by max steps settles FAILED with its real reason — not 'Task cancelled by user'", async () => {
    vi.mocked(runLaunchFlow).mockResolvedValue({
      success: false,
      status: "cancelled",
      finalText: "Cancelled: Max steps reached (50)",
      agentLoopResult: {
        stepsUsed: 50,
        toolCalls: [{ toolId: "files.read", success: true, summary: "read", mutating: false }],
        cancelled: true,
        cancelReason: "Max steps reached (50)",
        pendingApproval: null,
      } as any,
      cancelled: true,
      cancelReason: "Max steps reached (50)",
      repairAttempts: 0,
      runtimeRepairAttempts: 0,
      steps: [],
      totalDurationMs: 1000,
    } as any);

    const res = await POST(makeRequest({}), { params: Promise.resolve({ conversationId: "conv-123" }) });
    expect(res.status).toBe(200);
    const { events } = await readSSE(res);

    const doneEvents = events.filter((e) => e.type === "done");
    expect(doneEvents.length).toBe(1);
    expect(doneEvents[0].assistantMessage.status).toBe("failed");

    // The canonical settle: FAILED, activity naming the real stop reason.
    expect(transitionCalls("cancelled")).toHaveLength(0);
    const failed = transitionCalls("failed");
    expect(failed.length).toBe(1);
    expect(failed[0][3]).toMatchObject({
      currentActivity: expect.stringContaining("Max steps reached (50)"),
      failureMessage: expect.stringContaining("Max steps reached (50)"),
    });
    expect(
      actionRuntimeMocks.transitionActionRun.mock.calls.some(
        (c) => (c[3] as any)?.currentActivity === "Task cancelled by user",
      ),
    ).toBe(false);
    // Transcript truth matches.
    expect(updateMessageStatus).toHaveBeenCalledWith(
      expect.any(String),
      "user_123",
      "failed",
      expect.anything(),
    );
  });

  it("(a4) an initial segment stopped by the user still settles cancelled as 'Task cancelled by user'", async () => {
    vi.mocked(runLaunchFlow).mockResolvedValue({
      success: false,
      status: "cancelled",
      finalText: "Cancelled: Cancelled by user",
      agentLoopResult: {
        stepsUsed: 2,
        toolCalls: [],
        cancelled: true,
        cancelReason: "Cancelled by user",
        pendingApproval: null,
      } as any,
      cancelled: true,
      cancelReason: "Cancelled by user",
      repairAttempts: 0,
      runtimeRepairAttempts: 0,
      steps: [],
      totalDurationMs: 1000,
    } as any);

    const res = await POST(makeRequest({}), { params: Promise.resolve({ conversationId: "conv-123" }) });
    expect(res.status).toBe(200);
    const { events } = await readSSE(res);

    const doneEvents = events.filter((e) => e.type === "done");
    expect(doneEvents[0].assistantMessage.status).toBe("cancelled");
    const cancelled = transitionCalls("cancelled");
    expect(cancelled.length).toBe(1);
    expect(cancelled[0][3]).toMatchObject({ currentActivity: "Task cancelled by user" });
  });

  it("(a5) a shutdown abort (server restart) surfacing as a stream error settles FAILED — not as a user cancellation", async () => {
    // Force the V1 fallback path (no workspace execution), mirroring the
    // existing explicit-Stop V1 test — but abort the registered
    // execution the way lib/studio/shutdown.ts does: directly on the
    // controller, with the shutdown's own reason.
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
    vi.mocked(streamText).mockImplementation((_p, _c, opts: any) => {
      return new Promise((_res, rej) => {
        opts?.signal?.addEventListener(
          "abort",
          () => rej(new DOMException("The operation was aborted.", "AbortError")),
          { once: true },
        );
      }) as any;
    });

    const req = makeRequest({ message: "hello there", clientRequestId: "req-shutdown" });
    const res = await POST(req, { params: Promise.resolve({ conversationId: "conv-123" }) });
    expect(res.status).toBe(200);

    await vi.waitFor(() => {
      expect(getActiveExecution("conv-123")).not.toBeNull();
    });
    // The shutdown routine's exact move: abort with ITS reason.
    getActiveExecution("conv-123")!.controller.abort(
      new Error("Received SIGTERM — shutting down Studio executions"),
    );

    const { events } = await readSSE(res);
    // No "cancelled" SSE event for a restart — the run failed.
    expect(events.filter((e) => e.type === "cancelled")).toHaveLength(0);

    // On the V1 path there is no durable action run (ensureActionRun
    // requires a workspace transport), so the transcript row IS the
    // canonical record — before the fix it read "cancelled" for this
    // exact abort (the E3-S6 mislabel).
    await vi.waitFor(() => {
      expect(updateMessageStatus).toHaveBeenCalledWith(
        expect.any(String),
        "user_123",
        "failed",
        expect.stringContaining("The run failed"),
      );
    });
    expect(updateMessageStatus).not.toHaveBeenCalledWith(
      expect.any(String),
      "user_123",
      "cancelled",
      expect.anything(),
    );
    expect(transitionCalls("cancelled")).toHaveLength(0);
  });
});
