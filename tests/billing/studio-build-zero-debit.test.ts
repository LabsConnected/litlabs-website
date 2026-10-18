// @vitest-environment node
/**
 * Golden-journey debit proof.
 *
 * A builtin Studio AI build (the default LiTT agent, no marketplace
 * agentInstanceId) is the path an end-to-end website build takes:
 * POST /api/studio/conversations/:id/messages → runLaunchFlow →
 * runAgentLoopV2 → callLLMWithTools.
 *
 * Approved billability (src/lib/billing/contracts/billability.ts) charges
 * USER_REQUEST. docs/BILLING_ROUTE_AUDIT.md classifies this route as
 * METERED + CHARGED. The route only calls reserveCredits/settleRun when
 * a marketplace runtime agent is selected, and the agent loop only emits
 * cost events. emitUsageEvent does not write credit_ledger.
 *
 * These tests lock that gap. They are expected to show zero ledger
 * activity for a completed build, a failed build, a follow-up revision
 * on the same route, and a Gemini → NVIDIA/OpenRouter fallback inside
 * the launch flow. They do not invent a price.
 */
import { readFileSync } from "node:fs";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/rate-limiter", () => ({ withRateLimit: (handler: any) => handler }));

const rpcCalls: Array<{ fn: string; params: unknown }> = [];
vi.mock("@/lib/supabase", () => ({
  getSupabaseAdmin: vi.fn(() => ({
    rpc: vi.fn(async (fn: string, params: unknown) => {
      rpcCalls.push({ fn, params });
      return { data: 2, error: null };
    }),
    from: vi.fn(() => ({
      update: vi.fn(() => ({
        eq: vi.fn(() => ({ eq: vi.fn(() => ({})) })),
      })),
    })),
  })),
  supabaseAdmin: {
    rpc: vi.fn(async (fn: string, params: unknown) => {
      rpcCalls.push({ fn, params });
      return { data: null, error: null };
    }),
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
  reserveCredits: vi.fn(),
  settleRun: vi.fn(() => Promise.resolve({ ok: true })),
  estimateCredits: vi.fn(() => 12),
}));
vi.mock("@/lib/litt-runtime", () => ({
  buildPrompt: vi.fn(() => ({
    fullPrompt: "build a landing page",
    systemPrompt: "system",
    agentDisplayName: "LiTT",
    kernelResult: {
      decision: { routing: { requiresExecution: true, mode: "build" } },
    },
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
import { parseAgentSelection } from "@/lib/agent-selection";
import { resolveRuntimeAgent } from "@/lib/agent-runtime";
import { resetExecutionRegistryForTests } from "@/lib/studio/execution-registry";

function request(body: Record<string, unknown> = {}) {
  return new NextRequest("http://localhost/api/studio/conversations/conv-123/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message: "build a landing page for a coffee shop",
      clientRequestId: "req-golden-build-1",
      expectedRevision: 1,
      ...body,
    }),
  });
}

async function readDone(response: Response) {
  const raw = await response.text();
  const events = raw
    .split("\n\n")
    .map((chunk) => chunk.trim())
    .filter((chunk) => chunk.startsWith("data: ") && !chunk.includes("[DONE]"))
    .map((chunk) => JSON.parse(chunk.slice(6)));
  return { raw, events };
}

function successfulBuild(fallback: boolean) {
  vi.mocked(runLaunchFlow).mockImplementation(async (opts: any) => {
    opts.progress?.emit({ type: "model_routing", model: "gemini-2.5-flash", provider: "gemini" });
    if (fallback) {
      opts.progress?.emit({
        type: "model_routing",
        model: "nvidia/nemotron-3.5-lightning:free",
        provider: "openrouter",
        fallbackFrom: "gemini-2.5-flash",
      });
    }
    opts.progress?.emit({ type: "tool_result", toolId: "files.write", success: true, summary: "saved" });
    opts.progress?.emit({ type: "preview_result", success: true, previewUrl: "https://preview.example.com" });
    return {
      success: true,
      status: "preview_ready",
      previewUrl: "https://preview.example.com",
      productionUrl: null,
      finalText: "I built your landing page and started a preview.",
      agentLoopResult: {
        stepsUsed: fallback ? 2 : 1,
        toolCalls: [{ toolId: "files.write", toolCallId: "tc1", inputs: { path: "index.html" } }],
        cancelled: false,
        pendingApproval: null,
      },
      cancelled: false,
      totalDurationMs: 1000,
    } as any;
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  rpcCalls.length = 0;
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

describe("builtin Studio AI build LiTTBits debit", () => {
  it("completes a website build with zero reserve, settle, or debit_credits", async () => {
    successfulBuild(false);
    const res = await POST(request(), { params: Promise.resolve({ conversationId: "conv-123" }) });
    expect(res.status).toBe(200);
    const { events } = await readDone(res);
    expect(events.some((e) => e.type === "done" && e.assistantMessage?.status === "completed")).toBe(true);
    expect(runLaunchFlow).toHaveBeenCalledTimes(1);
    expect(reserveCredits).not.toHaveBeenCalled();
    expect(settleRun).not.toHaveBeenCalled();
    expect(rpcCalls.map((c) => c.fn)).not.toContain("debit_credits");
    expect(rpcCalls.map((c) => c.fn)).not.toContain("reserve_bits");
    expect(rpcCalls.map((c) => c.fn)).not.toContain("settle_bits");
  });

  it("a Gemini to NVIDIA/OpenRouter fallback inside the build still debits nothing", async () => {
    successfulBuild(true);
    const res = await POST(request(), { params: Promise.resolve({ conversationId: "conv-123" }) });
    expect(res.status).toBe(200);
    const { events } = await readDone(res);
    const routing = events.filter((e) => e.type === "model_routing");
    expect(routing[1]?.fallbackFrom).toBe("gemini-2.5-flash");
    expect(routing[1]?.model).toBe("nvidia/nemotron-3.5-lightning:free");
    expect(reserveCredits).not.toHaveBeenCalled();
    expect(settleRun).not.toHaveBeenCalled();
    expect(rpcCalls.map((c) => c.fn)).not.toContain("debit_credits");
  });

  it("a failed build does not create a debit either", async () => {
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
    const res = await POST(request(), { params: Promise.resolve({ conversationId: "conv-123" }) });
    expect(res.status).toBe(200);
    expect(reserveCredits).not.toHaveBeenCalled();
    expect(settleRun).not.toHaveBeenCalled();
    expect(rpcCalls.map((c) => c.fn)).not.toContain("debit_credits");
  });

  it("a follow-up revision on the same builtin route does not debit", async () => {
    successfulBuild(false);
    const res = await POST(
      request({ message: "change the headline to Morning Roast", clientRequestId: "req-golden-revision-1" }),
      { params: Promise.resolve({ conversationId: "conv-123" }) },
    );
    expect(res.status).toBe(200);
    expect(reserveCredits).not.toHaveBeenCalled();
    expect(settleRun).not.toHaveBeenCalled();
  });

  it("retries of the same clientRequestId return the duplicate and do not run or debit again", async () => {
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

  it("a marketplace agent on the same route does reserve, so the builtin skip is the gate", async () => {
    vi.mocked(parseAgentSelection).mockReturnValue({ kind: "instance", id: "inst-1" } as any);
    vi.mocked(resolveRuntimeAgent).mockResolvedValue({
      ok: true,
      agent: {
        agentInstanceId: "inst-1",
        agentId: "agent-1",
        agentVersionId: "ver-1",
        model: "test-model",
        memoryNamespace: "ns",
      },
    } as any);
    vi.mocked(reserveCredits).mockResolvedValue({
      ok: true,
      runId: "run-1",
      reservedCredits: 12,
      reservationId: "res-1",
    } as any);
    successfulBuild(false);
    const res = await POST(
      request({ agentInstanceId: "inst-1" }),
      { params: Promise.resolve({ conversationId: "conv-123" }) },
    );
    expect(res.status).toBe(200);
    expect(reserveCredits).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => expect(settleRun).toHaveBeenCalledTimes(1));
  });
});

describe("AI build provider path has no ledger debit", () => {
  it("callLLMWithTools and both agent loops never call chargeLlmUsage or debit_credits", () => {
    const files = [
      "src/lib/litt-intelligence/llm-tool-calling.ts",
      "src/lib/litt-intelligence/agent-loop.ts",
      "src/lib/litt-intelligence/agent-loop-v2.ts",
    ];
    for (const file of files) {
      const src = readFileSync(file, "utf8");
      expect(src).not.toMatch(/chargeLlmUsage|debit_credits|reserve_bits|settle_bits/);
    }
  });

  it("the studio messages route reserves only for a marketplace agent instance", () => {
    const src = readFileSync(
      "src/app/api/studio/conversations/[conversationId]/messages/route.ts",
      "utf8",
    );
    expect(src).toContain("if (runtimeAgent?.agentInstanceId && clerkId)");
    expect(src).not.toMatch(/chargeLlmUsage|debit_credits/);
  });
});
