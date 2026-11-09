// @vitest-environment jsdom
/**
 * Unified chat billing regression: the zero-balance spend leak fix.
 *
 * Behavior under test:
 *  - Built-in (free) agents like LiTT are debited post-call via
 *    chargeLlmUsage, so the route must run the metered-llm-call balance
 *    preflight BEFORE any provider execution — a zero-balance user must
 *    get 402 and no provider call.
 *  - If the post-call debit reports "Insufficient LiTTBits" (balance raced
 *    to zero between preflight and debit), the non-streaming response is
 *    a truthful 402, not a successful-looking reply.
 *  - Other debit failures are logged via the project logger (studioLog)
 *    and surfaced in the response/stream — never swallowed.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";

// ─── Mocks (hoisted by vitest) ────────────────────────────────────

vi.mock("@/lib/rate-limiter", () => ({
  // Pass the raw handler through — rate limiting is exercised elsewhere.
  withRateLimit: (handler: unknown) => handler,
}));

const mockAuth = vi.fn();
vi.mock("@/lib/auth", () => ({
  auth: (...args: unknown[]) => mockAuth(...args),
}));

vi.mock("@/lib/supabase", () => ({
  // logConversation tolerates a null admin (early return).
  getSupabaseAdmin: () => null,
}));

const mockResolveAgentEntitlement = vi.fn();
const mockChargeAgentRun = vi.fn();
vi.mock("@/lib/agent-entitlements", () => ({
  resolveAgentEntitlement: (...args: unknown[]) =>
    mockResolveAgentEntitlement(...args),
  chargeAgentRun: (...args: unknown[]) => mockChargeAgentRun(...args),
}));

const mockAssertSpendAuthorized = vi.fn();
vi.mock("@/lib/metered-llm-call", () => ({
  assertSpendAuthorized: (...args: unknown[]) =>
    mockAssertSpendAuthorized(...args),
}));

const mockChargeLlmUsage = vi.fn();
vi.mock("@/lib/llm-billing", () => ({
  chargeLlmUsage: (...args: unknown[]) => mockChargeLlmUsage(...args),
}));

const mockGenerateText = vi.fn();
const mockStreamText = vi.fn();
vi.mock("@/lib/llm", () => ({
  generateText: (...args: unknown[]) => mockGenerateText(...args),
  streamText: (...args: unknown[]) => mockStreamText(...args),
}));

vi.mock("@/lib/agents", () => ({
  AGENTS: {
    litt: {
      id: "litt",
      name: "LiTT",
      systemPrompt: "You are LiTT.",
    },
  },
  Agent: class {},
  orchestrator: {
    getAgent: vi.fn(),
    sendMessage: vi.fn(),
  },
}));

const mockStudioLog = vi.fn();
vi.mock("@/lib/studio/logger", () => ({
  studioLog: (...args: unknown[]) => mockStudioLog(...args),
}));

import { POST } from "@/app/api/chat/unified/route";

// ─── Helpers ──────────────────────────────────────────────────────

function post(body: Record<string, unknown>) {
  const req = {
    method: "POST",
    json: async () => body,
  } as unknown as NextRequest;
  return POST(req);
}

const llmResult = {
  text: "hi there",
  provider: "gemini",
  model: "gemini-2.5-flash",
  latencyMs: 12,
  usage: { prompt: 10, completion: 5 },
  metering: { billableIdempotencyKey: "billable-1" },
};

function allowRun() {
  mockAuth.mockResolvedValue({ userId: "u1", clerkId: "clerk_1" });
  mockResolveAgentEntitlement.mockResolvedValue({ allowed: true });
  mockAssertSpendAuthorized.mockResolvedValue({ ok: true, billingExempt: false });
  mockChargeAgentRun.mockResolvedValue({});
}

// ─── Tests ────────────────────────────────────────────────────────

describe("POST /api/chat/unified billing gate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGenerateText.mockResolvedValue(llmResult);
    mockStreamText.mockImplementation(
      async (_prompt: string, onChunk: (c: string) => void) => {
        onChunk("hi there");
        return llmResult;
      },
    );
  });

  it("returns 402 and never calls the provider when the balance preflight fails", async () => {
    mockAuth.mockResolvedValue({ userId: "u1", clerkId: "clerk_1" });
    mockResolveAgentEntitlement.mockResolvedValue({ allowed: true });
    mockAssertSpendAuthorized.mockResolvedValue({
      ok: false,
      status: 402,
      error: "Insufficient LiTTBits",
      code: "insufficient_credits",
    });

    const res = await post({ mode: "llm", agentSlug: "litt", message: "hello" });

    expect(res.status).toBe(402);
    expect(await res.json()).toMatchObject({
      error: "Insufficient LiTTBits",
      code: "insufficient_credits",
    });
    // No provider spend, no pre-charge.
    expect(mockGenerateText).not.toHaveBeenCalled();
    expect(mockStreamText).not.toHaveBeenCalled();
    expect(mockChargeAgentRun).not.toHaveBeenCalled();
  });

  it("returns 402 when the post-call debit reports insufficient balance", async () => {
    allowRun();
    mockChargeLlmUsage.mockResolvedValue({
      calculated: true,
      cost: { retailLiTTBits: 3 },
      debited: false,
      balance: 0,
      replayed: false,
      error: "Insufficient LiTTBits",
    });

    const res = await post({ mode: "llm", agentSlug: "litt", message: "hello" });

    expect(res.status).toBe(402);
    expect(await res.json()).toMatchObject({
      code: "insufficient_credits",
    });
    expect(mockGenerateText).toHaveBeenCalledTimes(1);
  });

  it("surfaces a non-insufficient debit failure in the response and via studioLog", async () => {
    allowRun();
    mockChargeLlmUsage.mockResolvedValue({
      calculated: true,
      cost: { retailLiTTBits: 3 },
      debited: false,
      balance: null,
      replayed: false,
      error: "debit_credits rpc failed",
    });

    const res = await post({ mode: "llm", agentSlug: "litt", message: "hello" });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.response).toBe("hi there");
    // The debit failure is reported, not disguised as a successful charge.
    expect(body.billing).toMatchObject({
      charged: 0,
      error: "debit_credits rpc failed",
    });
    expect(mockStudioLog).toHaveBeenCalledWith(
      "unified_chat:llm_debit_failed",
      expect.objectContaining({ userId: "clerk_1" }),
    );
  });

  it("emits the billing failure in-stream before [DONE] for streaming requests", async () => {
    allowRun();
    mockChargeLlmUsage.mockResolvedValue({
      calculated: true,
      cost: { retailLiTTBits: 3 },
      debited: false,
      balance: 0,
      replayed: false,
      error: "Insufficient LiTTBits",
    });

    const res = await post({
      mode: "llm",
      agentSlug: "litt",
      message: "hello",
      stream: true,
    });

    const body = await res.text();
    const errorIndex = body.indexOf('"code":"insufficient_credits"');
    const doneIndex = body.indexOf("[DONE]");
    // The failure is surfaced inside the stream…
    expect(errorIndex).toBeGreaterThan(-1);
    // …and lands before the terminal [DONE] frame so clients see it.
    expect(doneIndex).toBeGreaterThan(errorIndex);
    expect(mockStudioLog).toHaveBeenCalledWith(
      "unified_chat:llm_debit_failed",
      expect.objectContaining({ userId: "clerk_1" }),
    );
  });
});
