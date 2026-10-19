// @vitest-environment node
/**
 * Agent billing — REAL ledger/RPC boundary tests (PR #685 delta, Proof 6).
 *
 * The pre-existing billing suites mock "@/lib/agent-billing" wholesale,
 * so the reserve → settle/release contract against the database RPCs
 * was never exercised. These tests use the REAL agent-billing module
 * and mock only the layer below it — `supabaseAdmin` — at the RPC
 * boundary, asserting the exact RPC names, arguments, and idempotency
 * keys the ledger depends on:
 *
 *   reserve_bits  (p_idempotency_key = the run's client request key)
 *   settle_bits   (p_idempotency_key = `${runId}:settle`, overage reject,
 *                  amount = min(actual, reserved) — never above the quote)
 *   release_bits  (p_idempotency_key = `${runId}:release`, full amount)
 *
 * Exactly-once settlement is a JOINT contract: agent-billing supplies a
 * deterministic per-run idempotency key, the RPC dedupes on it. The
 * duplicate-settle test pins the half agent-billing owns (key stability)
 * against a simulated idempotent RPC.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Fake supabaseAdmin at the RPC boundary ───────────────────────

type RpcHandler = (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>;

const fake = vi.hoisted(() => {
  const rpcCalls: Array<{ fn: string; args: Record<string, unknown> }> = [];
  let rpcHandler: RpcHandler = async () => ({ data: null, error: null });

  function chain(table: string): unknown {
    const c: Record<string, unknown> = {};
    for (const m of ["select", "insert", "update", "eq", "order", "limit"]) {
      c[m] = () => c;
    }
    c.single = async () => {
      if (table === "agent_runs") return { data: { id: "run-1" }, error: null };
      return { data: null, error: null };
    };
    c.maybeSingle = async () => {
      if (table === "users") return { data: { id: "user-1" }, error: null };
      if (table === "agent_runs") {
        return {
          data: { user_id: "user-1", input: { provider: "groq", model: "openai/gpt-oss-120b" } },
          error: null,
        };
      }
      // usage_events: no pre-existing billable attempt event.
      return { data: null, error: null };
    };
    // Awaited directly (updates / inserts): resolve a neutral success.
    c.then = (resolve: (v: { data: null; error: null }) => void) => resolve({ data: null, error: null });
    return c;
  }

  const admin = {
    rpc: async (fn: string, args: Record<string, unknown>) => {
      rpcCalls.push({ fn, args });
      return rpcHandler(fn, args);
    },
    from: (table: string) => chain(table),
  };

  return {
    admin,
    rpcCalls,
    setRpcHandler: (h: RpcHandler) => {
      rpcHandler = h;
    },
    reset: () => {
      rpcCalls.length = 0;
      rpcHandler = async () => ({ data: null, error: null });
    },
    callsTo: (fn: string) => rpcCalls.filter((c) => c.fn === fn),
  };
});

vi.mock("@/lib/supabase", () => ({ supabaseAdmin: fake.admin }));
vi.mock("@/lib/owner", () => ({ isBillingExempt: () => false }));
vi.mock("@/lib/metering", () => ({ emitUsageEvent: vi.fn(async () => undefined) }));

import {
  reserveCredits,
  settleRun,
  estimateCredits,
  computeResumeQuoteBits,
  resumeQuoteDisclosure,
  type AgentRunContext,
} from "@/lib/agent-billing";

const CTX: AgentRunContext = {
  clerkId: "clerk_1",
  agentInstanceId: "studio-build",
  agentId: null,
  agentVersionId: null,
  conversationId: "conv-1",
  idempotencyKey: "req-1",
};

function happyRpc(): RpcHandler {
  return async (fn, args) => {
    if (fn === "reserve_bits") return { data: { success: true, reservation_id: "res-1" }, error: null };
    if (fn === "settle_bits") {
      return {
        data: { success: true, settled_amount: args.p_actual_amount, released_amount: 0 },
        error: null,
      };
    }
    if (fn === "release_bits") return { data: { success: true }, error: null };
    return { data: null, error: null };
  };
}

beforeEach(() => {
  fake.reset();
  fake.setRpcHandler(happyRpc());
});

describe("reserveCredits — reserve_bits boundary", () => {
  it("reserves the estimate under the run's idempotency key and returns the reservation", async () => {
    const res = await reserveCredits(CTX, 12);
    expect(res.ok).toBe(true);
    expect(res.runId).toBe("run-1");
    expect(res.reservationId).toBe("res-1");
    expect(res.reservedCredits).toBe(12);
    const calls = fake.callsTo("reserve_bits");
    expect(calls).toHaveLength(1);
    expect(calls[0].args).toMatchObject({
      p_user_id: "user-1",
      p_amount: 12,
      p_idempotency_key: "req-1",
      p_usage_type: "agent_run",
    });
  });

  it("insufficient balance aborts before any run row or settle", async () => {
    fake.setRpcHandler(async (fn) => {
      if (fn === "reserve_bits") {
        return { data: { success: false, reason: "insufficient_balance" }, error: null };
      }
      return { data: null, error: null };
    });
    const res = await reserveCredits(CTX, 12);
    expect(res.ok).toBe(false);
    expect(res.status).toBe(402);
    expect(res.reservationId).toBeNull();
    expect(fake.callsTo("settle_bits")).toHaveLength(0);
    expect(fake.callsTo("release_bits")).toHaveLength(0);
  });
});

describe("settleRun — settle_bits boundary (completed runs)", () => {
  it("settles the actual amount with the `${runId}:settle` key and overage reject", async () => {
    const out = await settleRun(
      "run-1",
      { inputTokens: 100, outputTokens: 50, actualCredits: 10, status: "completed" },
      12,
      "res-1",
    );
    expect(out.ok).toBe(true);
    expect(out.creditsCharged).toBe(10);
    const calls = fake.callsTo("settle_bits");
    expect(calls).toHaveLength(1);
    expect(calls[0].args).toMatchObject({
      p_reservation_id: "res-1",
      p_actual_amount: 10,
      p_idempotency_key: "run-1:settle",
      p_overage_policy: "reject",
    });
    expect(fake.callsTo("release_bits")).toHaveLength(0);
  });

  it("caps the settle at the reservation — an over-quote actual can never reach the RPC", async () => {
    const out = await settleRun(
      "run-1",
      { inputTokens: 100, outputTokens: 50, actualCredits: 20, status: "completed" },
      12,
      "res-1",
    );
    expect(out.ok).toBe(true);
    const calls = fake.callsTo("settle_bits");
    expect(calls).toHaveLength(1);
    // min(actual, reserved): the approved quote is the ceiling at the
    // ledger boundary itself, not just by caller convention.
    expect(calls[0].args.p_actual_amount).toBe(12);
    expect(out.creditsCharged).toBe(12);
  });

  it("a completed metered run never settles zero when the estimate is positive", async () => {
    const out = await settleRun(
      "run-1",
      { inputTokens: 10, outputTokens: 5, actualCredits: 1, status: "completed" },
      12,
      "res-1",
    );
    expect(out.creditsCharged).toBeGreaterThan(0);
    expect(fake.callsTo("settle_bits")[0].args.p_actual_amount).toBe(1);
  });

  it("duplicate settle re-presents the SAME idempotency key, so the RPC dedupes (exactly-once)", async () => {
    const settledKeys = new Set<string>();
    fake.setRpcHandler(async (fn, args) => {
      if (fn === "settle_bits") {
        const key = String(args.p_idempotency_key);
        if (settledKeys.has(key)) {
          // Simulated idempotent RPC: a replayed key settles nothing twice.
          return { data: { success: true, settled_amount: 0, released_amount: 0 }, error: null };
        }
        settledKeys.add(key);
        return { data: { success: true, settled_amount: args.p_actual_amount, released_amount: 0 }, error: null };
      }
      return { data: null, error: null };
    });
    const first = await settleRun(
      "run-1",
      { inputTokens: 1, outputTokens: 1, actualCredits: 10, status: "completed" },
      12,
      "res-1",
    );
    const second = await settleRun(
      "run-1",
      { inputTokens: 1, outputTokens: 1, actualCredits: 10, status: "completed" },
      12,
      "res-1",
    );
    const keys = fake.callsTo("settle_bits").map((c) => c.args.p_idempotency_key);
    // The half of exactly-once that agent-billing owns: the key is a
    // deterministic function of the run id, identical on every replay.
    expect(keys).toEqual(["run-1:settle", "run-1:settle"]);
    expect(first.creditsCharged).toBe(10);
    expect(second.creditsCharged).toBe(0);
  });

  it("a completed run with a zero actual (intentionally free) releases instead of settling", async () => {
    const out = await settleRun(
      "run-1",
      { inputTokens: 0, outputTokens: 0, actualCredits: 0, status: "completed" },
      12,
      "res-1",
    );
    expect(out.creditsCharged).toBe(0);
    expect(out.creditsRefunded).toBe(12);
    expect(fake.callsTo("settle_bits")).toHaveLength(0);
    const releases = fake.callsTo("release_bits");
    expect(releases).toHaveLength(1);
    expect(releases[0].args.p_idempotency_key).toBe("run-1:release-free");
  });
});

describe("settleRun — release_bits boundary (failed / cancelled / paused)", () => {
  it("a failed run releases the FULL reserved amount and never settles", async () => {
    const out = await settleRun(
      "run-1",
      { inputTokens: 0, outputTokens: 0, actualCredits: 0, status: "failed", error: "boom" },
      12,
      "res-1",
    );
    expect(out.ok).toBe(true);
    expect(out.creditsCharged).toBe(0);
    expect(out.creditsRefunded).toBe(12);
    expect(fake.callsTo("settle_bits")).toHaveLength(0);
    const releases = fake.callsTo("release_bits");
    expect(releases).toHaveLength(1);
    expect(releases[0].args).toMatchObject({
      p_reservation_id: "res-1",
      p_idempotency_key: "run-1:release",
    });
  });

  it("a cancelled run releases the FULL reserved amount", async () => {
    const out = await settleRun(
      "run-1",
      { inputTokens: 0, outputTokens: 0, actualCredits: 0, status: "cancelled" },
      12,
      "res-1",
    );
    expect(out.creditsRefunded).toBe(12);
    expect(fake.callsTo("release_bits")).toHaveLength(1);
    expect(fake.callsTo("settle_bits")).toHaveLength(0);
  });

  it("B3: a run paused for approval releases its original reservation at pause", async () => {
    // The messages route settles a paused run with status "failed"
    // (awaiting_approval maps to the release branch) at the moment the
    // run pauses — this is the exact call shape it issues. Approving
    // the gate later reserves again under a fresh key; nothing may
    // stay held across the approval boundary.
    const out = await settleRun(
      "run-1",
      { inputTokens: 40, outputTokens: 10, actualCredits: 5, status: "failed", error: undefined },
      12,
      "res-1",
    );
    expect(out.creditsCharged).toBe(0);
    expect(out.creditsRefunded).toBe(12);
    const releases = fake.callsTo("release_bits");
    expect(releases).toHaveLength(1);
    expect(releases[0].args.p_reservation_id).toBe("res-1");
    expect(fake.callsTo("settle_bits")).toHaveLength(0);
  });
});

describe("computeResumeQuoteBits — the quote on the card IS the quote reserved (B1)", () => {
  const MESSAGES = [
    { role: "user", content: "build a landing page" },
    {
      role: "assistant",
      content: "Working on it",
      tool_calls: [
        { id: "tc-1", type: "function", function: { name: "files_write", arguments: "{\"path\":\"index.html\"}" } },
      ],
    },
    { role: "tool", content: "saved", tool_call_id: "tc-1" },
  ];

  it("is deterministic and matches the documented formula", () => {
    const expected = estimateCredits(
      Math.ceil(JSON.stringify(MESSAGES).length / 4) + 2048,
      0,
      1,
      1,
    );
    expect(computeResumeQuoteBits(MESSAGES)).toBe(expected);
    expect(computeResumeQuoteBits(MESSAGES)).toBe(computeResumeQuoteBits(MESSAGES));
  });

  it("is invariant under JSON key reordering (the DB round-trip cannot change the approved figure)", () => {
    const reordered = MESSAGES.map((m) => {
      const entries = Object.entries(m).reverse();
      return Object.fromEntries(entries);
    });
    // Same serialized length, different key order — the quote derives
    // from length, so the figure the user approved cannot drift.
    expect(JSON.stringify(reordered).length).toBe(JSON.stringify(MESSAGES).length);
    expect(computeResumeQuoteBits(reordered)).toBe(computeResumeQuoteBits(MESSAGES));
  });

  it("has a positive floor and grows with the frozen conversation", () => {
    expect(computeResumeQuoteBits([])).toBe(4);
    expect(computeResumeQuoteBits(null)).toBe(4);
    const bigger = [...MESSAGES, { role: "user", content: "x".repeat(40_000) }];
    expect(computeResumeQuoteBits(bigger)).toBeGreaterThan(computeResumeQuoteBits(MESSAGES));
  });

  it("the disclosure carries the exact figure the helper computes", () => {
    const text = resumeQuoteDisclosure(MESSAGES);
    expect(text).toContain(`Estimated resume cost: ${computeResumeQuoteBits(MESSAGES)} LiTTBits`);
    expect(text).toMatch(/debited on success only/);
    expect(text).toMatch(/never more than this amount/);
  });
});
