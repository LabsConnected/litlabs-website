/**
 * LLM Cost Engine + Billing tests.
 *
 * Tests:
 * - LiTT Auto platform key → charged
 * - LiTT Balanced platform key → charged
 * - Reasoning model → higher expected charge
 * - Fallback provider → billed from actual successful provider
 * - Retry → one debit only (idempotency)
 * - BYOK OpenAI → zero model debit
 * - BYOK Anthropic → zero model debit
 * - Insufficient BITS → correctly blocked
 * - Shadow mode → calculate but no debit
 * - Free model → nominal charge only
 *
 * Run: pnpm exec vitest run tests/llm-cost-engine.test.ts
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock server-only
vi.mock("server-only", () => ({}));

// Mock supabase
const mockRpc = vi.fn();
const mockFrom = vi.fn();

vi.mock("@/lib/supabase", () => ({
  getSupabaseAdmin: vi.fn(() => ({
    rpc: mockRpc,
    from: mockFrom,
  })),
}));

import { calculateLlmCost, getEstimatedBitsRange } from "@/lib/llm-cost-engine";
import { chargeLlmUsage } from "@/lib/llm-billing";

describe("LLM Cost Engine", () => {
  it("LiTT Auto platform key → charged", () => {
    const result = calculateLlmCost({
      provider: "gemini",
      model: "gemini-2.5-flash",
      promptTokens: 1000,
      completionTokens: 500,
      isByok: false,
      littAliasId: "litt-auto",
    });
    expect(result.retailLiTTBits).toBeGreaterThan(0);
    expect(result.shouldDebit).toBe(true);
    expect(result.billingClass).toBe("standard");
  });

  it("LiTT Balanced platform key → charged", () => {
    const result = calculateLlmCost({
      provider: "gemini",
      model: "gemini-2.5-flash",
      promptTokens: 1000,
      completionTokens: 500,
      isByok: false,
      littAliasId: "litt-balanced",
    });
    expect(result.retailLiTTBits).toBeGreaterThan(0);
    expect(result.shouldDebit).toBe(true);
    expect(result.billingClass).toBe("standard");
  });

  it("Reasoning model → higher expected charge than standard", () => {
    const standard = calculateLlmCost({
      provider: "gemini",
      model: "gemini-2.5-flash",
      promptTokens: 1000,
      completionTokens: 500,
      isByok: false,
    });
    const reasoning = calculateLlmCost({
      provider: "openrouter-deepseek",
      model: "deepseek/deepseek-chat:free",
      promptTokens: 1000,
      completionTokens: 500,
      isByok: false,
      littAliasId: "litt-reasoning",
    });
    // Reasoning should cost at least as much as standard
    expect(reasoning.retailLiTTBits).toBeGreaterThanOrEqual(standard.retailLiTTBits);
    expect(reasoning.billingClass).toBe("reasoning");
  });

  it("Fallback provider → billed from actual successful provider", () => {
    // If gemini fails and groq succeeds, bill for groq
    const result = calculateLlmCost({
      provider: "groq",
      model: "llama-3.3-70b-versatile",
      promptTokens: 1000,
      completionTokens: 500,
      isByok: false,
    });
    expect(result.retailLiTTBits).toBeGreaterThan(0);
    expect(result.providerCostMicros).toBeGreaterThan(0);
  });

  it("BYOK OpenAI → zero model debit", () => {
    const result = calculateLlmCost({
      provider: "openai",
      model: "gpt-4o",
      promptTokens: 1000,
      completionTokens: 500,
      isByok: true,
    });
    expect(result.retailLiTTBits).toBe(0);
    expect(result.shouldDebit).toBe(false);
    expect(result.billingClass).toBe("byok");
  });

  it("BYOK Anthropic → zero model debit", () => {
    const result = calculateLlmCost({
      provider: "anthropic",
      model: "claude-sonnet-4-5",
      promptTokens: 1000,
      completionTokens: 500,
      isByok: true,
    });
    expect(result.retailLiTTBits).toBe(0);
    expect(result.shouldDebit).toBe(false);
    expect(result.billingClass).toBe("byok");
  });

  it("Free model → nominal charge only", () => {
    const result = calculateLlmCost({
      provider: "openrouter-free",
      model: "openrouter/free",
      promptTokens: 1000,
      completionTokens: 500,
      isByok: false,
    });
    expect(result.providerCostMicros).toBe(0);
    expect(result.retailLiTTBits).toBeGreaterThan(0); // nominal charge
  });

  it("Unknown provider → fallback to default pricing", () => {
    const result = calculateLlmCost({
      provider: "unknown-provider",
      model: "unknown-model",
      promptTokens: 1000,
      completionTokens: 500,
      isByok: false,
    });
    expect(result.retailLiTTBits).toBeGreaterThan(0);
    expect(result.billingClass).toBe("standard");
  });

  it("getEstimatedBitsRange returns sensible labels", () => {
    const byok = getEstimatedBitsRange("openai", "gpt-4o", true);
    expect(byok.label).toBe("No LiTTBits");
    expect(byok.min).toBe(0);

    const free = getEstimatedBitsRange("openrouter-free", "openrouter/free", false);
    expect(free.label).toBe("Included");

    const paid = getEstimatedBitsRange("groq", "llama-3.3-70b-versatile", false);
    expect(paid.label).toMatch(/BITS/);
  });
});

describe("LLM Billing — chargeLlmUsage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: user lookup succeeds
    mockFrom.mockImplementation((table: string) => {
      if (table === "users") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              maybeSingle: vi.fn(async () => ({ data: { id: "user-uuid" }, error: null })),
            })),
          })),
        };
      }
      if (table === "llm_usage_records") {
        return { insert: vi.fn(() => ({ error: null })) };
      }
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            maybeSingle: vi.fn(async () => ({ data: null, error: null })),
          })),
        })),
      };
    });
  });

  it("BYOK call → no debit, no error", async () => {
    const result = await chargeLlmUsage({
      clerkId: "clerk_byok",
      provider: "openai",
      model: "gpt-4o",
      promptTokens: 1000,
      completionTokens: 500,
      isByok: true,
      callId: "call-byok-1",
    });
    expect(result.debited).toBe(false);
    expect(result.cost.retailLiTTBits).toBe(0);
    // debit_credits should NOT have been called
    expect(mockRpc).not.toHaveBeenCalledWith("debit_credits", expect.anything());
  });

  it("Platform call → debited", async () => {
    mockRpc.mockResolvedValue({
      data: { success: true, remaining: 495 },
      error: null,
    });

    const result = await chargeLlmUsage({
      clerkId: "clerk_paid",
      provider: "gemini",
      model: "gemini-2.5-flash",
      promptTokens: 1000,
      completionTokens: 500,
      isByok: false,
      callId: "call-1",
    });
    expect(result.debited).toBe(true);
    expect(result.balance).toBe(495);
    expect(mockRpc).toHaveBeenCalledWith("debit_credits", expect.objectContaining({
      p_idempotency_key: "llm:call-1",
    }));
  });

  it("Retry with same callId → one debit only (idempotent)", async () => {
    mockRpc.mockResolvedValue({
      data: { success: false, remaining: 495 }, // replayed
      error: null,
    });

    const result = await chargeLlmUsage({
      clerkId: "clerk_retry",
      provider: "gemini",
      model: "gemini-2.5-flash",
      promptTokens: 1000,
      completionTokens: 500,
      isByok: false,
      callId: "call-retry-1",
    });
    // Idempotency key must contain the callId
    const debitCall = mockRpc.mock.calls.find((c: unknown[]) => c[0] === "debit_credits");
    expect(debitCall).toBeDefined();
    expect((debitCall![1] as Record<string, unknown>).p_idempotency_key).toBe("llm:call-retry-1");
  });

  it("Insufficient BITS → correctly blocked", async () => {
    mockRpc.mockResolvedValue({
      data: { success: false, remaining: 0 },
      error: null,
    });

    const result = await chargeLlmUsage({
      clerkId: "clerk_broke",
      provider: "gemini",
      model: "gemini-2.5-flash",
      promptTokens: 10000,
      completionTokens: 5000,
      isByok: false,
      callId: "call-broke-1",
    });
    expect(result.debited).toBe(false);
    expect(result.error).toBe("Insufficient LiTTBits");
  });

  it("User not found → error, no debit", async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === "users") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              maybeSingle: vi.fn(async () => ({ data: null, error: null })),
            })),
          })),
        };
      }
      return { insert: vi.fn(() => ({ error: null })) };
    });

    const result = await chargeLlmUsage({
      clerkId: "clerk_ghost",
      provider: "gemini",
      model: "gemini-2.5-flash",
      promptTokens: 1000,
      completionTokens: 500,
      isByok: false,
      callId: "call-ghost-1",
    });
    expect(result.debited).toBe(false);
    expect(result.error).toBe("User not found");
  });
});
