// @vitest-environment node
/**
 * P0 BYPASS TESTS: the metered-LLM gateway must make free provider spend
 * impossible.
 *
 * Proves:
 *  1. Unfunded user (balance 0) → provider NEVER called, 402 returned.
 *  2. Spend-ceiling exceeded → provider NEVER called, 403 returned.
 *  3. Wallet lookup failure → fail closed (402), provider NEVER called.
 *  4. Funded user → provider called WITH canonical metering context.
 *  5. Charge reuses the billable usage_event key (no double billing).
 *  6. Post-call charge race (insufficient at debit time) → 402, no text.
 *  7. Owner-exempt user skips the balance gate but still meters + records.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { generateTextMock, preflightBillingAuthMock, chargeLlmUsageMock, getCreditBalancesMock } = vi.hoisted(() => ({
  generateTextMock: vi.fn(),
  preflightBillingAuthMock: vi.fn(),
  chargeLlmUsageMock: vi.fn(),
  getCreditBalancesMock: vi.fn(),
}));

vi.mock("@/lib/llm", () => ({
  generateText: generateTextMock,
}));

vi.mock("@/lib/llm-billing", () => ({
  preflightBillingAuth: preflightBillingAuthMock,
  chargeLlmUsage: chargeLlmUsageMock,
}));

vi.mock("@/lib/wallet-ledger", () => ({
  getCreditBalances: getCreditBalancesMock,
}));

import { meteredLlmCall } from "./metered-llm-call";

const CLERK_ID = "clerk_test_user_123";
const CALL_ID = "call-test-uuid-1";

const LLM_RESULT = {
  text: "hello world",
  provider: "gemini",
  model: "gemini-2.5-flash",
  usage: { prompt: 10, completion: 20 },
  latencyMs: 123,
  failover: [],
  metering: {
    requestId: "req-abc",
    billableIdempotencyKey: "metering:llm:req-abc:0",
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  preflightBillingAuthMock.mockResolvedValue({ allowed: true, billingExempt: false });
  getCreditBalancesMock.mockResolvedValue({ total: 1500, monthly: 1500, purchased: 0, betaPromotional: 0, lastDailyClaim: null });
  generateTextMock.mockResolvedValue(LLM_RESULT);
  chargeLlmUsageMock.mockResolvedValue({ calculated: true, debited: true, balance: 1490, replayed: false });
});

function call(overrides = {}) {
  return meteredLlmCall({
    clerkId: CLERK_ID,
    prompt: "hi",
    llmOptions: { task: "chat", maxTokens: 100 },
    feature: "test-feature",
    callId: CALL_ID,
    ...overrides,
  });
}

describe("meteredLlmCall — bypass prevention", () => {
  it("unfunded user: provider NEVER called, returns 402", async () => {
    getCreditBalancesMock.mockResolvedValue({ total: 0, monthly: 0, purchased: 0, betaPromotional: 0, lastDailyClaim: null });

    const res = await call();

    expect(res.ok).toBe(false);
    if (res.ok) throw new Error("unreachable");
    expect(res.status).toBe(402);
    expect(res.code).toBe("insufficient_credits");
    expect(generateTextMock).not.toHaveBeenCalled();
    expect(chargeLlmUsageMock).not.toHaveBeenCalled();
  });

  it("spend ceiling exceeded: provider NEVER called, returns 403", async () => {
    preflightBillingAuthMock.mockResolvedValue({ allowed: false, reason: "spend_ceiling_exceeded" });

    const res = await call();

    expect(res.ok).toBe(false);
    if (res.ok) throw new Error("unreachable");
    expect(res.status).toBe(403);
    expect(res.code).toBe("spend_ceiling_exceeded");
    expect(generateTextMock).not.toHaveBeenCalled();
    expect(chargeLlmUsageMock).not.toHaveBeenCalled();
  });

  it("wallet lookup failure: fail closed, provider NEVER called", async () => {
    getCreditBalancesMock.mockRejectedValue(new Error("db down"));

    const res = await call();

    expect(res.ok).toBe(false);
    if (res.ok) throw new Error("unreachable");
    expect(res.status).toBe(402);
    expect(generateTextMock).not.toHaveBeenCalled();
    expect(chargeLlmUsageMock).not.toHaveBeenCalled();
  });

  it("funded user: provider called WITH canonical metering context", async () => {
    const res = await call();

    expect(res.ok).toBe(true);
    expect(generateTextMock).toHaveBeenCalledTimes(1);
    const [, options] = generateTextMock.mock.calls[0];
    expect(options.metering).toEqual({ clerkId: CLERK_ID, feature: "test-feature" });
  });

  it("charge reuses the billable usage_event key (no double billing)", async () => {
    const res = await call();

    expect(res.ok).toBe(true);
    expect(chargeLlmUsageMock).toHaveBeenCalledTimes(1);
    expect(chargeLlmUsageMock).toHaveBeenCalledWith(
      expect.objectContaining({
        clerkId: CLERK_ID,
        provider: "gemini",
        model: "gemini-2.5-flash",
        promptTokens: 10,
        completionTokens: 20,
        isByok: false,
        callId: CALL_ID,
        meteringBillableKey: "metering:llm:req-abc:0",
      }),
    );
  });

  it("post-call charge race (insufficient at debit): 402, no free text", async () => {
    chargeLlmUsageMock.mockResolvedValue({
      calculated: true,
      debited: false,
      balance: 0,
      replayed: false,
      error: "Insufficient LiTTBits",
    });

    const res = await call();

    expect(res.ok).toBe(false);
    if (res.ok) throw new Error("unreachable");
    expect(res.status).toBe(402);
    expect(res.code).toBe("insufficient_credits");
    // The provider WAS called (race), but the user gets no free value.
    expect(generateTextMock).toHaveBeenCalledTimes(1);
  });

  it("owner-exempt user skips balance gate but still meters + charges", async () => {
    preflightBillingAuthMock.mockResolvedValue({ allowed: true, billingExempt: true });
    getCreditBalancesMock.mockResolvedValue({ total: 0, monthly: 0, purchased: 0, betaPromotional: 0, lastDailyClaim: null });

    const res = await call();

    expect(res.ok).toBe(true);
    // Balance gate skipped for exempt owners…
    expect(getCreditBalancesMock).not.toHaveBeenCalled();
    // …but metering + charge recording still happen.
    expect(generateTextMock).toHaveBeenCalledTimes(1);
    const [, options] = generateTextMock.mock.calls[0];
    expect(options.metering).toBeDefined();
    expect(chargeLlmUsageMock).toHaveBeenCalledTimes(1);
  });

  it("transient charge errors do not block the response", async () => {
    chargeLlmUsageMock.mockResolvedValue({
      calculated: true,
      debited: false,
      balance: null,
      replayed: false,
      error: "Billing service unavailable",
    });

    const res = await call();

    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error("unreachable");
    expect(res.result.text).toBe("hello world");
  });
});
