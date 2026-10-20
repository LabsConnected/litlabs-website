// @vitest-environment node
/**
 * Regression: Activity feed quote vs approval card quote (defect D4;
 * forensics ART-20261020-027; observed live on staging run 00808832:
 * approval cards "Estimated resume cost: 9/10/11" while the Activity
 * feed held a CONSTANT "Estimated cost: 8" for the whole run).
 *
 * Construction of the defect:
 *  1. postHandler reserves the INITIAL segment and emits ONE SSE
 *     `status` event: summary `Estimated cost: ${reservedCredits}
 *     LiTTBits — debited once on success; …` + billingQuote
 *     {estimatedBits: reservedCredits}. `status` events render in the
 *     live Activity feed, and the entry persists for the whole run.
 *  2. A resume reserves a SEPARATE amount — computeResumeQuoteBits
 *     over the frozen pausedMessages — disclosed on the approval card
 *     via resumeQuoteDisclosure and reserved verbatim by the approvals
 *     route. That card figure is the binding quote for the decision.
 *  3. The initial event presented its segment figure as the run's
 *     standing "Estimated cost" and was never superseded, so the two
 *     surfaces contradicted each other on every resume.
 *
 * The fix scopes the initial event's disclosure to the initial segment
 * and defers to the approval card for resume amounts. The reservation
 * itself is untouched (this is a display-truth fix, not billing
 * logic): the event still discloses the exact initial reservation.
 *
 * These tests drive the REAL postHandler stream (same harness shape
 * as route.test.ts) to capture the emitted quote event, then run a
 * resume cycle with the REAL billing formulas — the approvals route's
 * figure source — and assert the cross-surface invariant: the feed's
 * standing quote entry never presents a figure that contradicts the
 * card's binding resume quote.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// ── Mocks (route.test.ts scaffolding; agent-billing is a PARTIAL mock:
// reserve/settle are stubbed, the quote formulas stay REAL) ──

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

vi.mock("@/lib/agent-billing", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/agent-billing")>();
  return {
    ...actual,
    // The initial segment reservation the route will hold — the same
    // shape route.test.ts uses. estimateCredits /
    // computeResumeQuoteBits / resumeQuoteDisclosure stay REAL.
    reserveCredits: vi.fn(() =>
      Promise.resolve({ ok: true, runId: "run-1", reservedCredits: 12, reservationId: "res-1" })),
    settleRun: vi.fn(() => Promise.resolve({ ok: true })),
  };
});

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
import {
  resetExecutionRegistryForTests,
} from "@/lib/studio/execution-registry";
import { createWorkspaceTransport } from "@/lib/litt-intelligence/workspace-transport";
import { buildCanonicalRuntimeContext } from "@/lib/litt-intelligence/canonical-runtime-context";
import { buildStudioContext } from "@/lib/studio/project-resolver";
import { getConversation, insertMessage, updateMessageStatus } from "@/lib/studio/conversation-service";
import { computeResumeQuoteBits, resumeQuoteDisclosure } from "@/lib/agent-billing";

// ── Helpers (route.test.ts) ──

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

async function readSSE(response: Response): Promise<{ events: any[]; raw: string }> {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let raw = "";
  const events: any[] = [];

  while (true) {
    const { value, done: streamDone } = await reader.read();
    if (streamDone) break;
    raw += decoder.decode(value, { stream: true });
  }

  for (const chunk of raw.split("\n\n")) {
    const line = chunk.trim();
    if (!line) continue;
    if (line.startsWith(":")) continue;
    if (line.startsWith("data: ")) {
      const data = line.slice(6);
      if (data === "[DONE]") continue;
      try { events.push(JSON.parse(data)); } catch { /* ignore */ }
    }
  }

  return { events, raw };
}

/** The initial segment reservation held by the reserve mock above. */
const INITIAL_RESERVED = 12;

describe("quote consistency — run-start status event vs approval card (D4)", () => {
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
    vi.mocked(runLaunchFlow).mockImplementation(async () => ({
      success: true,
      status: "preview_ready",
      previewUrl: "https://preview.example.com",
      productionUrl: null,
      finalText: "Built your landing page.",
      agentLoopResult: {
        stepsUsed: 1,
        toolCalls: [],
        cancelled: false,
        pendingApproval: null,
      },
      cancelled: false,
      totalDurationMs: 10,
    }) as any);
  });

  it("the feed's quote entry is scoped to the initial segment and never contradicts the binding resume quote", async () => {
    const req = makeRequest({});
    const res = await POST(req, { params: Promise.resolve({ conversationId: "conv-123" }) });
    expect(res.status).toBe(200);

    const { events } = await readSSE(res);

    // Exactly one quote-bearing status event per initial segment.
    const quoteEvents = events.filter((e) => e.type === "status" && e.billingQuote);
    expect(quoteEvents).toHaveLength(1);
    const feedSummary = String(quoteEvents[0].summary);

    // The reservation itself is untouched by the fix: the event still
    // discloses the exact initial reservation the route holds.
    expect(quoteEvents[0].billingQuote.estimatedBits).toBe(INITIAL_RESERVED);
    expect(feedSummary).toContain(`${INITIAL_RESERVED} LiTTBits`);

    // A resume cycle, computed with the REAL formulas the routes use:
    // the approvals route reserves computeResumeQuoteBits over the
    // frozen pausedMessages; the card discloses the same figure via
    // resumeQuoteDisclosure. Sized so the two estimators genuinely
    // disagree — a consistent result cannot be vacuous.
    const pausedMessages = [
      { role: "user", content: "Build the Harbor Coffee site" },
      {
        role: "assistant",
        content: "",
        toolCalls: [
          {
            toolCallId: "tc-d4-1",
            toolId: "files.write",
            inputs: { path: "index.html", content: "x".repeat(40_000) },
          },
        ],
      },
    ];
    const resumeBits = computeResumeQuoteBits(pausedMessages);
    expect(resumeBits).not.toBe(INITIAL_RESERVED);
    const cardDisclosure = resumeQuoteDisclosure(pausedMessages);
    expect(cardDisclosure).toContain(`Estimated resume cost: ${resumeBits} LiTTBits`);

    // INVARIANT (the defect): the feed entry persists for the whole
    // run, so its figure must be scoped to the initial segment it
    // actually describes — never presented as the run's standing
    // cost — and it must defer to the approval card for the resume
    // amount, which is the binding figure at decision time.
    expect(feedSummary).toMatch(/initial segment/i);
    expect(feedSummary).toMatch(/approval card/i);
    // The pre-fix run-level assertion shape must be gone.
    expect(feedSummary).not.toMatch(
      new RegExp(`^Estimated cost: ${INITIAL_RESERVED} LiTTBits — debited once on success`),
    );
  });
});
