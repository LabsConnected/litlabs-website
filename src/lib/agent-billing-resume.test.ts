// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

// ACC-01 F6 (resume half): a run that pauses for approval releases its
// reservation at pause time, and the approvals route historically
// performed NO billing when the approved work resumed — approved edits
// and deploys completed for free. reserveResumeCredits/settleResumeCredits
// re-reserve under the original run's billing identity and settle at the
// resumed segment's true terminal state.

const { state, fakeAdmin } = vi.hoisted(() => {
  const state = {
    adminEnabled: true,
    priorRuns: [] as Record<string, unknown>[],
    insertedRun: null as Record<string, unknown> | null,
    rpcCalls: [] as { name: string; args: Record<string, unknown> }[],
    runRow: {} as Record<string, unknown>,
  };

  function makeChain(table: string): unknown {
    const chain: Record<string, unknown> = {
      select: () => chain,
      eq: () => chain,
      filter: () => chain,
      order: () => chain,
      limit: () => chain,
      in: () => chain,
      or: () => chain,
      update: () => chain,
      insert: (value: Record<string, unknown>) => {
        if (table === "billing_reconciliations") return Promise.resolve({ error: null });
        if (table === "agent_runs") state.insertedRun = value;
        return chain;
      },
      single: async () =>
        table === "users"
          ? { data: { id: "user-123", email: "t@example.com" }, error: null }
          : table === "agent_runs"
            ? { data: state.runRow, error: null }
            : { data: null, error: null },
      maybeSingle: async () =>
        table === "users"
          ? { data: { id: "user-123", email: "t@example.com" }, error: null }
          : table === "agent_runs"
            ? { data: state.runRow, error: null }
            : { data: null, error: null },
      // Awaiting a chain (the prior-run lookup, ledger scans, updates)
      // resolves the table's list-shaped result.
      then: (resolve: (v: unknown) => void) =>
        resolve(
          table === "agent_runs"
            ? { data: state.priorRuns, error: null }
            : { data: [], error: null },
        ),
    };
    return chain;
  }

  const fakeAdmin: {
    rpc: (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: null }>;
    from: (table: string) => unknown;
  } = {
    rpc: (name: string, args: Record<string, unknown>) => {
      state.rpcCalls.push({ name, args });
      if (name === "reserve_bits") {
        return Promise.resolve({
          data: [{ success: true, reservation_id: "res-resume-1", reason: "reserved" }],
          error: null,
        });
      }
      if (name === "settle_bits") {
        return Promise.resolve({
          data: [{ success: true, settled_amount: args.p_actual_amount, released_amount: 0, reason: "settled" }],
          error: null,
        });
      }
      if (name === "release_bits") {
        return Promise.resolve({
          data: [{ success: true, released_amount: 0, reason: "released" }],
          error: null,
        });
      }
      return Promise.resolve({ data: null, error: null });
    },
    from: (table: string) => makeChain(table),
  };

  return { state, fakeAdmin };
});

vi.mock("@/lib/supabase", () => ({
  supabaseAdmin: fakeAdmin,
  getSupabaseAdmin: () => (state.adminEnabled ? fakeAdmin : null),
}));
vi.mock("@/lib/owner", () => ({ isBillingExempt: () => false }));
vi.mock("@/lib/metering", () => ({ emitUsageEvent: vi.fn(async () => ({ id: "ue-1" })) }));

import { reserveResumeCredits, settleResumeCredits } from "./agent-billing";

const PRIOR_RUN = {
  agent_name: "builtin:litt",
  input: {
    conversation_id: "conv-1",
    agent_id: null,
    agent_version_id: null,
    model: "gemini-test",
    provider: "gemini",
  },
};

beforeEach(() => {
  state.adminEnabled = true;
  state.priorRuns = [PRIOR_RUN];
  state.insertedRun = null;
  state.rpcCalls = [];
  state.runRow = {
    id: "run-resume-1",
    user_id: "user-123",
    agent_name: "builtin:litt",
    reserved_credits: 10,
    settled_credits: 0,
    reservation_id: "res-resume-1",
    input: { conversation_id: "conv-1", provider: "gemini", model: "gemini-test" },
    output: null,
  };
});

describe("reserveResumeCredits (ACC-01 F6)", () => {
  it("does not engage when the conversation never billed", async () => {
    state.priorRuns = [];
    const result = await reserveResumeCredits({
      clerkId: "clerk-123",
      conversationId: "conv-1",
      pausedRunId: "paused-1",
      estimatedInputTokens: 1000,
    });
    expect(result).toEqual({ engaged: false });
    expect(state.rpcCalls.filter((c) => c.name === "reserve_bits")).toHaveLength(0);
  });

  it("does not engage when no billing backend is configured", async () => {
    state.adminEnabled = false;
    const result = await reserveResumeCredits({
      clerkId: "clerk-123",
      conversationId: "conv-1",
      pausedRunId: "paused-1",
      estimatedInputTokens: 1000,
    });
    expect(result).toEqual({ engaged: false });
  });

  it("re-reserves under the original run's identity with a resume-scoped key", async () => {
    const result = await reserveResumeCredits({
      clerkId: "clerk-123",
      conversationId: "conv-1",
      pausedRunId: "paused-1",
      estimatedInputTokens: 1000,
    });
    expect(result.engaged).toBe(true);
    if (!result.engaged || !result.ok) throw new Error("expected engaged ok");
    expect(result.handle.runId).toBe("run-resume-1");
    expect(result.handle.reservationId).toBe("res-resume-1");

    // The new billing run carries the ORIGINAL identity (builtin:litt)
    // and an idempotency key scoped to this paused run, so a retried
    // approval can never double-reserve.
    expect(state.insertedRun).toMatchObject({
      agent_name: "builtin:litt",
      idempotency_key: "approval-resume:paused-1",
    });
    const reserveCall = state.rpcCalls.find((c) => c.name === "reserve_bits");
    expect(reserveCall?.args.p_idempotency_key).toBe("approval-resume:paused-1");
  });

  it("surfaces an insufficient-balance reserve failure instead of running free", async () => {
    // Force reserve_bits to report insufficient balance by swapping the
    // rpc implementation for this test through a fresh module state:
    // emulate via prior run present but reserve returning failure.
    const originalRpc = fakeAdmin.rpc;
    fakeAdmin.rpc = (name: string, args: Record<string, unknown>) => {
      state.rpcCalls.push({ name, args });
      if (name === "reserve_bits") {
        return Promise.resolve({
          data: [{ success: false, reservation_id: null, reason: "insufficient_balance" }],
          error: null,
        });
      }
      return originalRpc(name, args);
    };
    try {
      const result = await reserveResumeCredits({
        clerkId: "clerk-123",
        conversationId: "conv-1",
        pausedRunId: "paused-1",
        estimatedInputTokens: 1000,
      });
      expect(result.engaged).toBe(true);
      if (!result.engaged || result.ok) throw new Error("expected engaged failure");
      expect(result.status).toBe(402);
    } finally {
      fakeAdmin.rpc = originalRpc;
    }
  });
});

describe("settleResumeCredits (ACC-01 F6)", () => {
  const handle = {
    runId: "run-resume-1",
    reservationId: "res-resume-1",
    reservedCredits: 10,
    inputTokens: 1000,
  };

  it("charges a positive estimate when the resumed segment completes", async () => {
    await settleResumeCredits(handle, { outputTokens: 500, status: "completed" });
    const settle = state.rpcCalls.find((c) => c.name === "settle_bits");
    expect(settle).toBeDefined();
    // estimateCredits(1000 in, 500 out, 1/1k, 1/run) = 1 + ceil(1500/1000) = 3
    expect(settle?.args.p_actual_amount).toBe(3);
    expect(settle?.args.p_idempotency_key).toBe("run-resume-1");
    expect(state.rpcCalls.some((c) => c.name === "release_bits")).toBe(false);
  });

  it("releases the hold in full when the resumed segment fails", async () => {
    await settleResumeCredits(handle, { outputTokens: 0, status: "failed", error: "boom" });
    expect(state.rpcCalls.some((c) => c.name === "release_bits")).toBe(true);
    expect(state.rpcCalls.some((c) => c.name === "settle_bits")).toBe(false);
  });
});
