// @vitest-environment node
/**
 * Studio approval pause — billing contract at the route boundary
 * (PR #685 delta, Proofs for B1 + B3).
 *
 * B3: when a metered Studio run pauses for approval, its ORIGINAL
 * reservation is released at pause — nothing stays held across the
 * approval boundary. The route expresses that by settling the run with
 * status "failed" (the release branch); the ledger-level proof that
 * this call shape releases the full reservation via release_bits lives
 * in tests/billing/agent-billing-rpc.test.ts.
 *
 * B1: the approval card must disclose the RESUME cost before the user
 * approves. The route computes it at pause time from the frozen
 * pausedMessages via the REAL computeResumeQuoteBits (this harness
 * keeps agent-billing's pure helpers real via importActual and stubs
 * only the DB-touching reserve/settle), appends it to the approval
 * reason, and every card surface — stored record, live event, done
 * payload — carries that same disclosed reason.
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
vi.mock("@/lib/agent-billing", async (importActual) => {
  const actual = (await importActual()) as Record<string, unknown>;
  return {
    ...actual,
    reserveCredits: vi.fn(() =>
      Promise.resolve({ ok: true, runId: "run-1", reservedCredits: 12, reservationId: "res-1" })),
    settleRun: vi.fn(() => Promise.resolve({ ok: true, creditsCharged: 0, creditsRefunded: 12 })),
  };
});
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
import { settleRun, computeResumeQuoteBits } from "@/lib/agent-billing";
import { createPausedRun } from "@/lib/litt-intelligence/paused-run-store";
import { resetExecutionRegistryForTests } from "@/lib/studio/execution-registry";

const PAUSED_MESSAGES = [
  { role: "user", content: "build a landing page for a coffee shop" },
  {
    role: "assistant",
    content: "Building the page now.",
    tool_calls: [
      {
        id: "tc-1",
        type: "function",
        function: { name: "files_write", arguments: "{\"path\":\"index.html\",\"content\":\"<html>…</html>\"}" },
      },
    ],
  },
  { role: "tool", content: "saved", tool_call_id: "tc-1" },
];

function request(body: Record<string, unknown> = {}) {
  return new NextRequest("http://localhost/api/studio/conversations/conv-123/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message: "build a landing page for a coffee shop",
      clientRequestId: "req-pause-1",
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

function pausedBuild() {
  vi.mocked(runLaunchFlow).mockImplementation(async (opts: any) => {
    opts.progress?.emit({ type: "tool_result", toolId: "files.write", success: true, summary: "saved" });
    return {
      success: false,
      status: "failed",
      previewUrl: null,
      productionUrl: null,
      finalText: "I need your approval to continue: Deploy requires approval",
      agentLoopResult: {
        stepsUsed: 2,
        toolCalls: [{ toolId: "files.write", toolCallId: "tc-1", success: true, mutating: true, inputs: { path: "index.html" } }],
        cancelled: false,
        pendingApproval: {
          toolId: "project.deploy",
          toolCallId: "tc-9",
          inputs: { projectId: "proj-123" },
          reason: "Deploy requires approval",
          pausedMessages: PAUSED_MESSAGES,
          deferredToolCalls: [],
          stepsUsedAtPause: 2,
          hadInterveningMutationAtPause: true,
        },
      },
      cancelled: false,
      totalDurationMs: 900,
    } as any;
  });
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
  vi.mocked(createPausedRun).mockResolvedValue({ id: "paused-1" } as any);
  actionRuntimeMocks.createActionRun.mockResolvedValue({ id: "action-run-123" } as any);
  actionRuntimeMocks.transitionActionRun.mockResolvedValue({} as any);
  actionRuntimeMocks.transitionActionRunEventActivity.mockResolvedValue({} as any);
});

describe("Studio approval pause — reservation release + resume quote disclosure", () => {
  it("B3: pausing releases the original reservation (settle as failed, never a debit)", async () => {
    pausedBuild();
    const res = await POST(request(), { params: Promise.resolve({ conversationId: "conv-123" }) });
    expect(res.status).toBe(200);
    const events = await readEvents(res);
    expect(
      events.some((e) => e.type === "done" && e.assistantMessage?.status === "awaiting_approval"),
    ).toBe(true);
    await vi.waitFor(() => expect(settleRun).toHaveBeenCalledTimes(1));
    // The release call shape: status "failed" routes settleRun to
    // release_bits for the full reserved amount (proven at the RPC
    // boundary in agent-billing-rpc.test.ts). The reservation does NOT
    // ride across the approval boundary.
    expect(settleRun).toHaveBeenCalledWith(
      "run-1",
      expect.objectContaining({ status: "failed" }),
      12,
      "res-1",
    );
  });

  it("B1: the approval card discloses the resume quote — computed from the frozen pausedMessages — before approval", async () => {
    pausedBuild();
    const res = await POST(request(), { params: Promise.resolve({ conversationId: "conv-123" }) });
    expect(res.status).toBe(200);
    const events = await readEvents(res);

    const expectedQuote = computeResumeQuoteBits(PAUSED_MESSAGES);
    const disclosure = `Estimated resume cost: ${expectedQuote} LiTTBits`;

    // Stored record: the reason the card rehydrates from after reload.
    expect(createPausedRun).toHaveBeenCalledTimes(1);
    const storedArgs = vi.mocked(createPausedRun).mock.calls[0][0] as any;
    expect(storedArgs.reason).toContain("Deploy requires approval");
    expect(storedArgs.reason).toContain(disclosure);
    expect(storedArgs.pausedMessages).toEqual(PAUSED_MESSAGES);

    // Live card surface.
    const pending = events.find((e) => e.type === "pending_approval");
    expect(pending).toBeDefined();
    expect(pending.reason).toContain(disclosure);
    expect(pending.pausedRunId).toBe("paused-1");

    // Done payload card surface carries the same disclosed reason.
    const done = events.find((e) => e.type === "done");
    expect(done.pendingApproval?.reason).toContain(disclosure);
  });
});
