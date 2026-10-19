// @vitest-environment node
/**
 * Builtin Studio build LiTTBits debit — route-level integration.
 *
 * Inverts the PR #684 zero-debit proof: a builtin Studio build (default
 * LiTT agent, no agentInstanceId) must reserve before execution and
 * settle exactly once on success, release on failure/cancel, show the
 * approved quote on every metered path, and never double-debit on
 * duplicate requests. Uses the real route + real agent-billing module
 * boundary (reserveCredits/settleRun are mocked at their export, as in
 * the route's own test harness — no Playwright routes).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/rate-limiter", () => ({ withRateLimit: (handler: any) => handler }));

vi.mock("@/lib/supabase", () => ({
  getSupabaseAdmin: vi.fn(() => ({
    rpc: vi.fn(async () => ({ data: 2, error: null })),
    from: vi.fn(() => ({
      update: vi.fn(() => ({ eq: vi.fn(() => ({ eq: vi.fn(() => ({})) })) })),
    })),
  })),
  supabaseAdmin: {
    rpc: vi.fn(async () => ({ data: null, error: null })),
    from: vi.fn(),
  },
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
vi.mock("@/lib/studio/project-resolver", () => ({ buildStudioContext: vi.fn() }));
vi.mock("@/lib/projects/resolve-current-project", () => ({ resolveCurrentProject: vi.fn() }));
vi.mock("@/lib/studio/memory-service", () => ({
  recallMemories: vi.fn(() => []),
  formatMemoryContext: vi.fn(() => ""),
  persistMemory: vi.fn(() => Promise.resolve()),
  harvestUserPreferences: vi.fn(() => Promise.resolve()),
}));
vi.mock("@/lib/studio/logger", () => ({ studioLog: vi.fn() }));
vi.mock("@/lib/agent-selection", () => ({ parseAgentSelection: vi.fn() }));
vi.mock("@/lib/agent-runtime", () => ({ resolveRuntimeAgent: vi.fn() }));
vi.mock("@/lib/agent-billing", () => ({
  reserveCredits: vi.fn(() =>
    Promise.resolve({ ok: true, runId: "run-1", reservedCredits: 12, reservationId: "res-1" })),
  settleRun: vi.fn(() => Promise.resolve({ ok: true, creditsCharged: 0, creditsRefunded: 0 })),
  estimateCredits: vi.fn((inTok: number, outTok: number) => 1 + Math.ceil((inTok + outTok) / 1000)),
  resumeQuoteDisclosure: vi.fn(() => ""),
}));
vi.mock("@/lib/litt-runtime", () => ({
  buildPrompt: vi.fn(() => ({
    fullPrompt: "build a landing page",
    systemPrompt: "system",
    agentDisplayName: "LiTT",
    kernelResult: { decision: { routing: { requiresExecution: true, mode: "build" } } },
  })),
  buildRunContextFromStudio: vi.fn(() => ({})),
  parseRuntimeContextHint: vi.fn(() => ({})),
  HISTORY_LIMIT: 10,
}));
vi.mock("@/lib/litt-intelligence/launch-flow", () => ({ runLaunchFlow: vi.fn() }));
const actionRuntimeMocks = vi.hoisted(() => ({
  createActionRun: vi.fn(),
  transitionActionRunEventActivity: vi.fn(),
  transitionActionRun: vi.fn(),
  appendActionEvent: vi.fn(),
  requestActionRunCancellation: vi.fn(),
}));
vi.mock("@/lib/action-runtime", () => actionRuntimeMocks);
vi.mock("@/lib/studio/task-service", () => ({
  attachActionRunToConversationTask: vi.fn(() => Promise.resolve()),
  settleConversationTask: vi.fn(() => Promise.resolve()),
}));
vi.mock("@/lib/entitlements", () => ({
  getOwnerAwareEntitlements: vi.fn(async () => ({ isOwner: false, premiumModels: false })),
}));
vi.mock("@/lib/litt-intelligence/agent-loop", () => ({ runAgentLoop: vi.fn() }));
vi.mock("@/lib/litt-intelligence/agent-loop-v2", () => ({ runAgentLoopV2: vi.fn() }));
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
vi.mock("@/lib/litt-intelligence/paused-run-store", () => ({
  createPausedRun: vi.fn(),
  getPendingPausedRunForConversation: vi.fn(),
  getLatestPausedRunForConversation: vi.fn(),
  pausedRunBelongsToMessage: vi.fn(() => false),
}));
vi.mock("@/lib/litt-intelligence/turn-resolver", () => ({
  resolveTurn: vi.fn((input: { message?: string }) => ({ resolved: input.message ?? "build a landing page" })),
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
  isEmptyProviderResponse: () => false,
}));

import { auth } from "@/lib/auth";
import { POST } from "@/app/api/studio/conversations/[conversationId]/messages/route";
import { runLaunchFlow } from "@/lib/litt-intelligence/launch-flow";
import { createWorkspaceTransport } from "@/lib/litt-intelligence/workspace-transport";
import { buildCanonicalRuntimeContext } from "@/lib/litt-intelligence/canonical-runtime-context";
import { buildStudioContext } from "@/lib/studio/project-resolver";
import { getConversation, insertMessage, updateMessageStatus } from "@/lib/studio/conversation-service";
import { reserveCredits, settleRun } from "@/lib/agent-billing";
import { resetExecutionRegistryForTests } from "@/lib/studio/execution-registry";

function request(body: Record<string, unknown> = {}) {
  return new NextRequest("http://localhost/api/studio/conversations/conv-123/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message: "build a landing page for a coffee shop",
      clientRequestId: "req-debit-1",
      expectedRevision: 1,
      ...body,
    }),
  });
}

async function readEvents(response: Response) {
  const raw = await response.text();
  return raw
    .split("\n\n")
    .map((c) => c.trim())
    .filter((c) => c.startsWith("data: ") && !c.includes("[DONE]"))
    .map((c) => JSON.parse(c.slice(6)));
}

function successfulBuild() {
  vi.mocked(runLaunchFlow).mockImplementation(async (opts: any) => {
    opts.progress?.emit({ type: "tool_result", toolId: "files.write", success: true, summary: "saved" });
    return {
      success: true,
      status: "preview_ready",
      previewUrl: "https://preview.example.com",
      productionUrl: null,
      finalText: "I built your landing page and started a preview.",
      agentLoopResult: {
        stepsUsed: 1,
        toolCalls: [{ toolId: "files.write", toolCallId: "tc1", success: true, mutating: true, inputs: { path: "index.html" } }],
        cancelled: false,
        pendingApproval: null,
      },
      cancelled: false,
      totalDurationMs: 1000,
    } as any;
  });
}

function failedBuild() {
  vi.mocked(runLaunchFlow).mockResolvedValue({
    success: false,
    status: "failed",
    previewUrl: null,
    productionUrl: null,
    finalText: "The build failed before a preview.",
    agentLoopResult: { stepsUsed: 1, toolCalls: [], cancelled: false, pendingApproval: null, failedHonestly: true },
    cancelled: false,
    totalDurationMs: 40,
  } as any);
}

beforeEach(() => {
  vi.clearAllMocks();
  resetExecutionRegistryForTests();
  vi.mocked(auth).mockResolvedValue({ userId: "user_123", clerkId: "clerk_customer" } as any);
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
    framework: "static",
  } as any);
  vi.mocked(createWorkspaceTransport).mockResolvedValue({
    projectId: "proj-123",
    userId: "user_123",
    workspaceId: "ws-123",
  } as any);
  vi.mocked(insertMessage).mockImplementation(async (args: any) => ({
    message: { id: `msg-${args.role}`, ...args },
    duplicate: false,
    error: null,
  }) as any);
  vi.mocked(updateMessageStatus).mockResolvedValue(true as any);
  actionRuntimeMocks.createActionRun.mockResolvedValue({ id: "action-run-123" } as any);
  actionRuntimeMocks.transitionActionRun.mockResolvedValue({} as any);
  actionRuntimeMocks.transitionActionRunEventActivity.mockResolvedValue({} as any);
});

describe("builtin Studio build LiTTBits debit (PR #684 cases, inverted)", () => {
  it("a successful builtin build reserves once, shows the quote, and settles as completed", async () => {
    successfulBuild();
    const res = await POST(request(), { params: Promise.resolve({ conversationId: "conv-123" }) });
    expect(res.status).toBe(200);
    const events = await readEvents(res);
    expect(events.some((e) => e.type === "done" && e.assistantMessage?.status === "completed")).toBe(true);
    // Quote disclosed before execution — no approval pause required.
    expect(events.some((e) => e.type === "status" && e.billingQuote?.estimatedBits === 12)).toBe(true);
    expect(reserveCredits).toHaveBeenCalledTimes(1);
    expect(vi.mocked(reserveCredits).mock.calls[0][0].idempotencyKey).toBe("req-debit-1");
    await vi.waitFor(() => expect(settleRun).toHaveBeenCalledTimes(1));
    expect(settleRun).toHaveBeenCalledWith(
      "run-1",
      expect.objectContaining({ status: "completed", actualCredits: expect.any(Number) }),
      12,
      "res-1",
    );
    const charged = vi.mocked(settleRun).mock.calls[0][1].actualCredits;
    expect(charged).toBeGreaterThan(0);
    expect(charged).toBeLessThanOrEqual(12);
  });

  it("a follow-up revision on the same route debits once under its own clientRequestId", async () => {
    successfulBuild();
    const res = await POST(
      request({ message: "change the headline to Morning Roast", clientRequestId: "req-debit-rev-1" }),
      { params: Promise.resolve({ conversationId: "conv-123" }) },
    );
    expect(res.status).toBe(200);
    expect(reserveCredits).toHaveBeenCalledTimes(1);
    expect(vi.mocked(reserveCredits).mock.calls[0][0].idempotencyKey).toBe("req-debit-rev-1");
    await vi.waitFor(() => expect(settleRun).toHaveBeenCalledTimes(1));
  });

  it("a failed build releases the reservation — settle as failed, wallet unchanged", async () => {
    failedBuild();
    const res = await POST(request(), { params: Promise.resolve({ conversationId: "conv-123" }) });
    expect(res.status).toBe(200);
    expect(reserveCredits).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => expect(settleRun).toHaveBeenCalledTimes(1));
    expect(settleRun).toHaveBeenCalledWith(
      "run-1",
      // status "failed" makes settleRun release the reservation — the
      // wallet balance stays unchanged regardless of the estimate.
      expect.objectContaining({ status: "failed" }),
      12,
      "res-1",
    );
  });

  it("a duplicate clientRequestId returns early — no reserve, no settle, no run", async () => {
    vi.mocked(insertMessage).mockResolvedValue({
      message: { id: "msg-user", role: "user", content: "build a landing page" },
      duplicate: true,
      error: null,
    } as any);
    const res = await POST(request(), { params: Promise.resolve({ conversationId: "conv-123" }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.duplicate).toBe(true);
    expect(runLaunchFlow).not.toHaveBeenCalled();
    expect(reserveCredits).not.toHaveBeenCalled();
    expect(settleRun).not.toHaveBeenCalled();
  });

  it("insufficient balance blocks execution before the model call and reports the shortfall", async () => {
    vi.mocked(reserveCredits).mockResolvedValue({
      ok: false,
      runId: null,
      reservationId: null,
      reservedCredits: 0,
      status: 402,
      error: "Insufficient LiTTBits balance",
    } as any);
    successfulBuild();
    const res = await POST(request(), { params: Promise.resolve({ conversationId: "conv-123" }) });
    expect(res.status).toBe(402);
    const body = await res.json();
    expect(body.error).toMatch(/Insufficient/i);
    expect(body.assistantMessage.status).toBe("failed");
    expect(runLaunchFlow).not.toHaveBeenCalled();
    expect(settleRun).not.toHaveBeenCalled();
  });

  it("billing-exempt runs settle at zero with an auditable exempt quote", async () => {
    vi.mocked(reserveCredits).mockResolvedValue({
      ok: true,
      runId: "run-exempt",
      reservedCredits: 0,
      reservationId: null,
    } as any);
    successfulBuild();
    const res = await POST(request(), { params: Promise.resolve({ conversationId: "conv-123" }) });
    expect(res.status).toBe(200);
    const events = await readEvents(res);
    expect(events.some((e) => e.type === "status" && e.billingQuote?.estimatedBits === 0)).toBe(true);
    await vi.waitFor(() => expect(settleRun).toHaveBeenCalledTimes(1));
    expect(settleRun).toHaveBeenCalledWith(
      "run-exempt",
      expect.objectContaining({ status: "completed" }),
      0,
      null,
    );
  });

  it("a provider-fallback build still debits once — never both attempts' charges", async () => {
    vi.mocked(runLaunchFlow).mockImplementation(async (opts: any) => {
      opts.progress?.emit({ type: "model_routing", model: "gemini-2.5-flash", provider: "gemini" });
      opts.progress?.emit({
        type: "model_routing",
        model: "nvidia/nemotron-3.5-lightning:free",
        provider: "openrouter",
        fallbackFrom: "gemini-2.5-flash",
      });
      opts.progress?.emit({ type: "tool_result", toolId: "files.write", success: true, summary: "saved" });
      return {
        success: true,
        status: "preview_ready",
        previewUrl: "https://preview.example.com",
        productionUrl: null,
        finalText: "Built via fallback provider.",
        agentLoopResult: {
          stepsUsed: 2,
          toolCalls: [{ toolId: "files.write", toolCallId: "tc1", success: true, mutating: true }],
          cancelled: false,
          pendingApproval: null,
        },
        cancelled: false,
        totalDurationMs: 1200,
      } as any;
    });
    const res = await POST(request(), { params: Promise.resolve({ conversationId: "conv-123" }) });
    expect(res.status).toBe(200);
    expect(reserveCredits).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => expect(settleRun).toHaveBeenCalledTimes(1));
    const charged = vi.mocked(settleRun).mock.calls[0][1].actualCredits;
    expect(charged).toBeLessThanOrEqual(12);
  });
});
