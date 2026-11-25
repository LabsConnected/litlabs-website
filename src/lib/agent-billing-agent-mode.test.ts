// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

// ACC-01 F7: reserveCredits wrote `ctx.model ?? "default"` into
// agent_runs.agent_mode. The column is check-constrained to
// ('standard','builder','research','spark'), so every built-in Studio
// run that actually reserved (after the F6 fix made built-in runs bill)
// died on the insert with a constraint violation and the route surfaced
// "This agent requires LiTTBits to run." These tests capture the exact
// insert payload and pin agent_mode to a valid mode on every path:
// the main reserve path, the billing-exempt path, and the approval
// resume path (which re-enters reserveCredits).

const { state, fakeAdmin } = vi.hoisted(() => {
  const state = {
    exempt: false,
    priorRuns: [] as Record<string, unknown>[],
    insertedRun: null as Record<string, unknown> | null,
    insertError: null as { message: string; code?: string } | null,
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
            ? state.insertError
              ? { data: null, error: state.insertError }
              : { data: state.runRow, error: null }
            : { data: null, error: null },
      maybeSingle: async () =>
        table === "users"
          ? { data: { id: "user-123", email: "t@example.com" }, error: null }
          : table === "agent_runs"
            ? { data: state.runRow, error: null }
            : { data: null, error: null },
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
          data: [{ success: true, reservation_id: "res-1", reason: "reserved" }],
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
  getSupabaseAdmin: () => fakeAdmin,
}));
vi.mock("@/lib/owner", () => ({ isBillingExempt: () => state.exempt }));
vi.mock("@/lib/metering", () => ({ emitUsageEvent: vi.fn(async () => ({ id: "ue-1" })) }));

import { reserveCredits, reserveResumeCredits } from "./agent-billing";
import { slugToMode } from "./litt-intelligence/agent-identity";

const VALID_MODES = ["standard", "builder", "research", "spark"];

const BASE_CTX = {
  clerkId: "clerk-123",
  agentInstanceId: "builtin:litt",
  agentId: null,
  agentVersionId: null,
  conversationId: "conv-1",
  idempotencyKey: "req-1",
};

beforeEach(() => {
  state.exempt = false;
  state.priorRuns = [];
  state.insertedRun = null;
  state.insertError = null;
  state.rpcCalls = [];
  state.runRow = { id: "run-1" };
});

describe("reserveCredits agent_mode (ACC-01 F7)", () => {
  it("writes 'standard' when neither model nor mode is supplied", async () => {
    const result = await reserveCredits({ ...BASE_CTX }, 10);
    expect(result.ok).toBe(true);
    // Pre-fix this inserted "default" and violated the check constraint.
    expect(state.insertedRun?.agent_mode).toBe("standard");
  });

  it("never writes the model name into agent_mode", async () => {
    const result = await reserveCredits(
      { ...BASE_CTX, model: "gemini-2.5-flash", provider: "gemini" },
      10,
    );
    expect(result.ok).toBe(true);
    // Pre-fix this inserted "gemini-2.5-flash" — the exact production
    // failure on release 3a272e72.
    expect(state.insertedRun?.agent_mode).toBe("standard");
    expect(VALID_MODES).toContain(state.insertedRun?.agent_mode);
    // The model still lands where it belongs: input.model.
    expect((state.insertedRun?.input as Record<string, unknown>)?.model).toBe(
      "gemini-2.5-flash",
    );
  });

  it("writes the mode derived from a builder/coder slug", async () => {
    const result = await reserveCredits(
      { ...BASE_CTX, agentInstanceId: "builtin:coder", agentMode: slugToMode("coder") },
      10,
    );
    expect(result.ok).toBe(true);
    expect(state.insertedRun?.agent_mode).toBe("builder");
  });

  it("billing-exempt path also writes a valid mode", async () => {
    state.exempt = true;
    const result = await reserveCredits({ ...BASE_CTX, model: "gemini-2.5-flash" }, 10);
    expect(result.ok).toBe(true);
    expect(state.insertedRun?.agent_mode).toBe("standard");
  });

  it("billing-exempt path honors an explicit mode", async () => {
    state.exempt = true;
    const result = await reserveCredits({ ...BASE_CTX, agentMode: "research" }, 10);
    expect(result.ok).toBe(true);
    expect(state.insertedRun?.agent_mode).toBe("research");
  });
});

describe("reserveResumeCredits agent_mode (ACC-01 F7)", () => {
  const priorRun = (agent_mode: unknown) => ({
    agent_name: "builtin:coder",
    agent_mode,
    input: {
      conversation_id: "conv-1",
      agent_id: null,
      agent_version_id: null,
      model: "gemini-test",
      provider: "gemini",
    },
  });

  it("carries the paused run's stored mode into the resume run row", async () => {
    state.priorRuns = [priorRun("builder")];
    const result = await reserveResumeCredits({
      clerkId: "clerk-123",
      conversationId: "conv-1",
      pausedRunId: "paused-1",
      estimatedInputTokens: 1000,
    });
    expect(result.engaged).toBe(true);
    expect(state.insertedRun?.agent_mode).toBe("builder");
  });

  it("falls back to 'standard' when the stored mode is a legacy invalid value", async () => {
    // Rows written before the F7 fix can hold "default" or a model name.
    state.priorRuns = [priorRun("default")];
    const result = await reserveResumeCredits({
      clerkId: "clerk-123",
      conversationId: "conv-1",
      pausedRunId: "paused-1",
      estimatedInputTokens: 1000,
    });
    expect(result.engaged).toBe(true);
    expect(state.insertedRun?.agent_mode).toBe("standard");
    expect(VALID_MODES).toContain(state.insertedRun?.agent_mode);
  });
});

describe("reserveCredits billing-exempt insert failures (ACC-04)", () => {
  // The exempt branch previously destructured only `data` from the
  // agent_runs insert, so any insert error collapsed into the hard-coded
  // "Failed to create run row" — and the messages route then dressed it
  // up as a purchase-credits refusal on the owner's own account. The
  // fake insert above always succeeded, which is why the suite never
  // saw this class; state.insertError now drives the failure cases.

  it("surfaces the real insert error instead of 'Failed to create run row'", async () => {
    state.exempt = true;
    state.insertError = {
      message: 'null value in column "some_column" violates not-null constraint',
      code: "23502",
    };
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const result = await reserveCredits({ ...BASE_CTX }, 10);
      expect(result.ok).toBe(false);
      expect(result.status).toBe(500);
      expect(result.error).toBe(
        'null value in column "some_column" violates not-null constraint',
      );
      expect(result.error).not.toBe("Failed to create run row");
      expect(result.runId).toBeNull();
      expect(result.reservedCredits).toBe(0);
    } finally {
      consoleSpy.mockRestore();
    }
  });

  it("treats a duplicate idempotency key (23505) as an idempotent success returning the existing run", async () => {
    state.exempt = true;
    state.insertError = {
      message:
        'duplicate key value violates unique constraint "idx_agent_runs_idempotency_unique"',
      code: "23505",
    };
    // The lookup for (user_id, idempotency_key) finds the prior attempt's row.
    state.runRow = { id: "run-existing" };
    const result = await reserveCredits({ ...BASE_CTX }, 10);
    expect(result.ok).toBe(true);
    expect(result.runId).toBe("run-existing");
    expect(result.reservationId).toBeNull();
    expect(result.reservedCredits).toBe(0);
  });

  it("falls through to the honest error when a 23505 has no existing row to return", async () => {
    state.exempt = true;
    state.insertError = {
      message:
        'duplicate key value violates unique constraint "idx_agent_runs_idempotency_unique"',
      code: "23505",
    };
    state.runRow = null as unknown as Record<string, unknown>;
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const result = await reserveCredits({ ...BASE_CTX }, 10);
      expect(result.ok).toBe(false);
      expect(result.status).toBe(500);
      expect(result.error).toContain("idx_agent_runs_idempotency_unique");
      expect(result.error).not.toBe("Failed to create run row");
    } finally {
      consoleSpy.mockRestore();
    }
  });
});
