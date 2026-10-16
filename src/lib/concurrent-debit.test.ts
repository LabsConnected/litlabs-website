// @vitest-environment node
/**
 * Two parallel metered calls against a balance that covers one debit.
 * The debit_credits RPC serializes per user. Exactly one call succeeds
 * and the other is 402. The provider may run for both; the wallet does not
 * pay twice.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { generateTextMock, getCreditBalancesMock } = vi.hoisted(() => ({
  generateTextMock: vi.fn(),
  getCreditBalancesMock: vi.fn(),
}));

vi.mock("@/lib/llm", () => ({
  generateText: generateTextMock,
}));

vi.mock("@/lib/wallet-ledger", () => ({
  getCreditBalances: getCreditBalancesMock,
}));

vi.mock("@/lib/supabase", () => ({
  getSupabaseAdmin: vi.fn(),
}));

import { calculateLlmCost } from "@/lib/llm-cost-engine";
import { getSupabaseAdmin } from "@/lib/supabase";
import { meteredLlmCall } from "@/lib/metered-llm-call";

const USAGE = { prompt: 10, completion: 20 };
const ONE_CALL = calculateLlmCost({
  provider: "gemini",
  model: "gemini-2.5-flash",
  promptTokens: USAGE.prompt,
  completionTokens: USAGE.completion,
  isByok: false,
});

function atomicAdmin(startingBalance: number) {
  let balance = startingBalance;
  const debited = new Set<string>();
  const chain = (table: string) => {
    const builder: Record<string, unknown> = {};
    const self = () => builder;
    builder.select = self;
    builder.eq = self;
    builder.update = self;
    builder.insert = async () => ({ data: null, error: null });
    builder.upsert = async () => ({ data: null, error: null });
    builder.maybeSingle = async () => {
      if (table === "users") return { data: { id: "db-user" }, error: null };
      return { data: null, error: null };
    };
    builder.single = builder.maybeSingle;
    return builder;
  };
  return {
    debited,
    from: vi.fn((table: string) => chain(table)),
    rpc: vi.fn(async (name: string, params: { p_idempotency_key?: string; p_amount?: number }) => {
      if (name !== "debit_credits") return { data: null, error: null };
      const key = params.p_idempotency_key ?? "";
      const amount = params.p_amount ?? 0;
      if (debited.has(key)) {
        return { data: [{ success: true, remaining: balance }], error: null };
      }
      if (balance < amount) {
        return { data: [{ success: false, remaining: balance }], error: null };
      }
      balance -= amount;
      debited.add(key);
      return { data: [{ success: true, remaining: balance }], error: null };
    }),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.LITTLABS_VAPI_OWNER_CLERK_ID;
  delete process.env.LLM_COST_SHADOW_MODE;
  generateTextMock.mockResolvedValue({
    text: "hello world",
    provider: "gemini",
    model: "gemini-2.5-flash",
    usage: USAGE,
    latencyMs: 10,
    failover: [],
    metering: { requestId: "req", billableIdempotencyKey: "metering:req:0" },
  });
});

describe("parallel metered debits", () => {
  it("a balance that covers one call yields one success and one 402", async () => {
    expect(ONE_CALL.retailLiTTBits).toBeGreaterThan(0);
    const admin = atomicAdmin(ONE_CALL.retailLiTTBits);
    vi.mocked(getSupabaseAdmin).mockReturnValue(admin as never);
    getCreditBalancesMock.mockResolvedValue({
      total: ONE_CALL.retailLiTTBits,
      monthly: ONE_CALL.retailLiTTBits,
      purchased: 0,
      betaPromotional: 0,
      lastDailyClaim: null,
    });

    const call = (callId: string) => meteredLlmCall({
      clerkId: "clerk_parallel_debit",
      prompt: "hi",
      llmOptions: { task: "chat", maxTokens: 100 },
      feature: "parallel-debit",
      callId,
    });

    const [first, second] = await Promise.all([call("call-parallel-a"), call("call-parallel-b")]);
    const results = [first, second];
    const ok = results.filter((result) => result.ok);
    const denied = results.filter((result) => !result.ok);
    expect(ok).toHaveLength(1);
    expect(denied).toHaveLength(1);
    if (denied[0].ok) throw new Error("unreachable");
    expect(denied[0].status).toBe(402);
    expect(denied[0].code).toBe("insufficient_credits");
    expect(denied[0]).not.toHaveProperty("result");
    expect(admin.debited.size).toBe(1);
  });
});
