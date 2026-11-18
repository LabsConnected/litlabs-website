// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

/**
 * Owner test-mode ("Testing As") simulation honesty in Studio chat.
 *
 * The diagnosis (TESTING-AS-DIAGNOSIS.md, Finding 3) found this route
 * bypassed the owner's active simulation twice:
 *   1. `allowLittPaidProviders = entitlements.isOwner || …` — isOwner is
 *      true under EVERY simulation, so paid providers never downgraded
 *      (Testing-As Starter still got premium models).
 *   2. The reserveCredits() context was built without a `simulation`
 *      field, so agent-billing's isBillingExempt(ctx.simulation) always
 *      saw "no simulation" and skipped billing entirely — even under
 *      Zero-LiTTBits, whose purpose is "balance treated as 0".
 *
 * These tests pin the fixed behavior at the route's observable seams:
 * the options handed to runLaunchFlow (allowLittPaidProviders) and the
 * context handed to reserveCredits (simulation). With no simulation
 * active everything must be exactly as before.
 */

// ── Mocks (same harness shape as route.test.ts, plus the entitlements seam) ──

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
  settleRun: vi.fn(() => Promise.resolve({ ok: true })),
  estimateCredits: vi.fn(() => 0),
}));

vi.mock("@/lib/entitlements", () => ({
  getOwnerAwareEntitlements: vi.fn(),
  getUserEntitlements: vi.fn(),
  getEntitlementsForPlan: vi.fn(),
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
import {
  resetExecutionRegistryForTests,
} from "@/lib/studio/execution-registry";
import { createWorkspaceTransport } from "@/lib/litt-intelligence/workspace-transport";
import { buildCanonicalRuntimeContext } from "@/lib/litt-intelligence/canonical-runtime-context";
import { buildStudioContext } from "@/lib/studio/project-resolver";
import { getConversation, insertMessage, updateMessageStatus } from "@/lib/studio/conversation-service";
import { parseAgentSelection } from "@/lib/agent-selection";
import { resolveRuntimeAgent } from "@/lib/agent-runtime";
import { reserveCredits } from "@/lib/agent-billing";
import { getOwnerAwareEntitlements } from "@/lib/entitlements";

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

async function drainSSE(response: Response): Promise<void> {
  const reader = response.body!.getReader();
  while (true) {
    const { done } = await reader.read();
    if (done) break;
  }
}

function findKeyDeep(value: unknown, key: string): unknown {
  if (value && typeof value === "object") {
    if (key in (value as Record<string, unknown>)) {
      return (value as Record<string, unknown>)[key];
    }
    for (const v of Object.values(value as Record<string, unknown>)) {
      const found = findKeyDeep(v, key);
      if (found !== undefined) return found;
    }
  }
  return undefined;
}

function successfulLaunchFlow() {
  return {
    success: true,
    status: "preview_ready",
    previewUrl: "https://preview.example.com",
    productionUrl: null,
    finalText: "I built your landing page and started a preview.",
    agentLoopResult: {
      stepsUsed: 1,
      toolCalls: [
        { toolId: "files.write", toolCallId: "tc1", inputs: { path: "index.html" }, success: true, mutating: true, summary: "saved", paths: ["index.html"] },
      ],
      workspaceChange: { status: "changed", files: ["index.html"], checkpointSha: "abc1234", rollbackAvailable: true },
      cancelled: false,
      pendingApproval: null,
    },
    cancelled: false,
    totalDurationMs: 10,
  } as any;
}

function setEntitlements(partial: Record<string, unknown>) {
  vi.mocked(getOwnerAwareEntitlements).mockResolvedValue({
    isOwner: true,
    simulation: null,
    simulatedZeroBalance: false,
    billingExempt: true,
    premiumModels: true,
    ...partial,
  } as any);
}

// ── Tests ──

describe("POST messages — owner test-mode simulation honesty", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetExecutionRegistryForTests();

    vi.mocked(auth).mockResolvedValue({ userId: "user_123", clerkId: "clerk_owner" } as any);
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
    vi.mocked(createWorkspaceTransport).mockResolvedValue({
      projectId: "proj-123",
      userId: "user_123",
      workspaceId: "ws-123",
    } as any);
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
    vi.mocked(runLaunchFlow).mockImplementation(async () => successfulLaunchFlow());
    setEntitlements({});
  });

  it("Starter simulation: premium models are NOT allowed (isOwner short-circuit removed)", async () => {
    setEntitlements({ simulation: "starter", premiumModels: false, billingExempt: false });

    const res = await POST(makeRequest({}), { params: Promise.resolve({ conversationId: "conv-123" }) });
    expect(res.status).toBe(200);
    await drainSSE(res);

    expect(runLaunchFlow).toHaveBeenCalledTimes(1);
    const opts = vi.mocked(runLaunchFlow).mock.calls[0][0];
    expect(findKeyDeep(opts, "allowLittPaidProviders")).toBe(false);
  });

  it("OWNER with no simulation: premium models allowed, exactly as before", async () => {
    setEntitlements({ simulation: null });

    const res = await POST(makeRequest({}), { params: Promise.resolve({ conversationId: "conv-123" }) });
    expect(res.status).toBe(200);
    await drainSSE(res);

    const opts = vi.mocked(runLaunchFlow).mock.calls[0][0];
    expect(findKeyDeep(opts, "allowLittPaidProviders")).toBe(true);
  });

  it("Zero-LiTTBits simulation: the simulation reaches reserveCredits so billing engages", async () => {
    setEntitlements({ simulation: "zero_bits", simulatedZeroBalance: true, billingExempt: false });
    // Marketplace agent → the reserve/settle billing path is active.
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

    const res = await POST(makeRequest({ agentInstanceId: "inst-1" }), {
      params: Promise.resolve({ conversationId: "conv-123" }),
    });
    expect(res.status).toBe(200);
    await drainSSE(res);

    expect(reserveCredits).toHaveBeenCalledTimes(1);
    const ctx = vi.mocked(reserveCredits).mock.calls[0][0] as any;
    // This is the exact value agent-billing feeds to isBillingExempt():
    // "zero_bits" → not exempt → the reservation is real, not skipped.
    expect(ctx.simulation).toBe("zero_bits");
  });

  it("OWNER with no simulation: reserveCredits receives simulation=null (unchanged)", async () => {
    setEntitlements({ simulation: null });
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
      reservedCredits: 0,
      reservationId: null,
    } as any);

    const res = await POST(makeRequest({ agentInstanceId: "inst-1" }), {
      params: Promise.resolve({ conversationId: "conv-123" }),
    });
    expect(res.status).toBe(200);
    await drainSSE(res);

    expect(reserveCredits).toHaveBeenCalledTimes(1);
    const ctx = vi.mocked(reserveCredits).mock.calls[0][0] as any;
    expect(ctx.simulation).toBeNull();
  });
});
