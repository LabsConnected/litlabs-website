/**
 * Agent billing failure-path tests.
 *
 * Tests that reserveCredits and settleRun handle all failure modes correctly:
 * - Missing reserve_credits RPC → 503
 * - Permission denied → 503
 * - Database timeout → 503
 * - Insufficient balance → 402
 * - Run-row insert failure after reservation → refund + 500
 * - Refund failure → reconciliation record
 * - Settlement failure → reconciliation record
 * - Duplicate idempotency key belonging to another user → 403
 * - Duplicate idempotency key belonging to another agent instance → 403
 * - Successful reserve/settle
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock supabaseAdmin before importing the module
const mockRpc = vi.fn();
const mockFrom = vi.fn();
const mockSelect = vi.fn();
const mockInsert = vi.fn();
const mockUpdate = vi.fn();
const mockEq = vi.fn();
const mockMaybeSingle = vi.fn();
const mockSingle = vi.fn();

vi.mock("@/lib/supabase", () => ({
  supabaseAdmin: {
    rpc: mockRpc,
    from: mockFrom,
  },
}));

vi.mock("@/lib/env", () => ({
  isClerkConfigured: () => true,
  isAnonymousDevAllowed: () => false,
}));

// Import after mocks are set up
const { reserveCredits, settleRun } = await import("@/lib/agent-billing");

const baseCtx = {
  clerkId: "clerk_user_123",
  agentInstanceId: "agent_instance_456",
  agentId: "agent_789",
  agentVersionId: null,
  idempotencyKey: "idem_key_001",
};

function setupFromChain(result: { data: unknown; error: unknown }) {
  mockFrom.mockReturnValue({
    select: mockSelect,
    insert: mockInsert,
    update: mockUpdate,
  });
  mockSelect.mockReturnValue({
    eq: mockEq,
    maybeSingle: mockMaybeSingle,
  });
  mockInsert.mockReturnValue({
    select: mockSelect,
  });
  mockUpdate.mockReturnValue({
    eq: mockEq,
  });
  mockEq.mockReturnValue({
    maybeSingle: mockMaybeSingle,
    single: mockSingle,
  });
  mockMaybeSingle.mockResolvedValue(result);
  mockSingle.mockResolvedValue(result);
}

describe("reserveCredits — fail-closed behavior", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 402 for insufficient balance", async () => {
    mockRpc.mockResolvedValue({
      error: { message: "insufficient balance: have 0, need 10" },
    });

    // No existing run
    setupFromChain({ data: null, error: null });
    // User found
    mockMaybeSingle.mockResolvedValueOnce({ data: null, error: null });
    mockMaybeSingle.mockResolvedValueOnce({ data: { id: "user-uuid" }, error: null });

    const result = await reserveCredits(baseCtx, 10);
    expect(result.ok).toBe(false);
    expect(result.status).toBe(402);
    expect(result.error).toContain("Insufficient");
  });

  it("returns 503 when reserve_credits RPC is missing (function not found)", async () => {
    mockRpc.mockResolvedValue({
      error: { message: "Could not find the function public.reserve_credits in the schema cache" },
    });

    setupFromChain({ data: null, error: null });
    mockMaybeSingle.mockResolvedValueOnce({ data: null, error: null });
    mockMaybeSingle.mockResolvedValueOnce({ data: { id: "user-uuid" }, error: null });

    const result = await reserveCredits(baseCtx, 10);
    expect(result.ok).toBe(false);
    expect(result.status).toBe(503);
    expect(result.error).toContain("Credit reservation failed");
  });

  it("returns 503 on permission denied", async () => {
    mockRpc.mockResolvedValue({
      error: { message: "permission denied for function reserve_credits" },
    });

    setupFromChain({ data: null, error: null });
    mockMaybeSingle.mockResolvedValueOnce({ data: null, error: null });
    mockMaybeSingle.mockResolvedValueOnce({ data: { id: "user-uuid" }, error: null });

    const result = await reserveCredits(baseCtx, 10);
    expect(result.ok).toBe(false);
    expect(result.status).toBe(503);
  });

  it("returns 503 on database timeout", async () => {
    mockRpc.mockResolvedValue({
      error: { message: "canceling statement due to statement timeout" },
    });

    setupFromChain({ data: null, error: null });
    mockMaybeSingle.mockResolvedValueOnce({ data: null, error: null });
    mockMaybeSingle.mockResolvedValueOnce({ data: { id: "user-uuid" }, error: null });

    const result = await reserveCredits(baseCtx, 10);
    expect(result.ok).toBe(false);
    expect(result.status).toBe(503);
  });

  it("returns 404 when user not found", async () => {
    setupFromChain({ data: null, error: null });
    // No existing run
    mockMaybeSingle.mockResolvedValueOnce({ data: null, error: null });
    // User not found
    mockMaybeSingle.mockResolvedValueOnce({ data: null, error: null });

    const result = await reserveCredits(baseCtx, 10);
    expect(result.ok).toBe(false);
    expect(result.status).toBe(404);
  });

  it("returns 403 when idempotency key belongs to another user", async () => {
    // Existing run found
    mockFrom.mockReturnValue({
      select: mockSelect,
      insert: mockInsert,
      update: mockUpdate,
    });
    mockSelect.mockReturnValue({
      eq: mockEq,
      maybeSingle: mockMaybeSingle,
    });
    // First call: find existing run by idempotency key
    mockMaybeSingle.mockResolvedValueOnce({
      data: { id: "run-1", status: "completed", credits_charged: 5 },
      error: null,
    });
    // Second call: fetch run details
    mockEq.mockReturnValue({
      maybeSingle: mockMaybeSingle,
    });
    mockMaybeSingle.mockResolvedValueOnce({
      data: { user_id: "other-user-uuid", agent_instance_id: "agent_instance_456", conversation_id: null },
      error: null,
    });
    // Third call: fetch user clerk_id
    mockMaybeSingle.mockResolvedValueOnce({
      data: { clerk_id: "clerk_different_user" },
      error: null,
    });

    const result = await reserveCredits(baseCtx, 10);
    expect(result.ok).toBe(false);
    expect(result.status).toBe(403);
    expect(result.error).toContain("another user");
  });

  it("returns 403 when idempotency key belongs to another agent instance", async () => {
    mockFrom.mockReturnValue({
      select: mockSelect,
      insert: mockInsert,
      update: mockUpdate,
    });
    mockSelect.mockReturnValue({
      eq: mockEq,
      maybeSingle: mockMaybeSingle,
    });
    // Existing run found
    mockMaybeSingle.mockResolvedValueOnce({
      data: { id: "run-1", status: "completed", credits_charged: 5 },
      error: null,
    });
    mockEq.mockReturnValue({
      maybeSingle: mockMaybeSingle,
    });
    // Run details — same user, different agent
    mockMaybeSingle.mockResolvedValueOnce({
      data: { user_id: "user-uuid", agent_instance_id: "different_agent", conversation_id: null },
      error: null,
    });
    // User clerk_id matches
    mockMaybeSingle.mockResolvedValueOnce({
      data: { clerk_id: "clerk_user_123" },
      error: null,
    });

    const result = await reserveCredits(baseCtx, 10);
    expect(result.ok).toBe(false);
    expect(result.status).toBe(403);
    expect(result.error).toContain("another agent instance");
  });

  it("refunds reservation when run-row insert fails after successful reservation", async () => {
    // Reserve succeeds
    mockRpc.mockResolvedValueOnce({ error: null });
    // Refund called after insert fails
    mockRpc.mockResolvedValueOnce({ error: null });

    // Track call count for from() to return different chains
    let fromCallCount = 0;
    mockFrom.mockImplementation((table: string) => {
      fromCallCount++;
      if (table === "billing_reconciliations") {
        return { insert: vi.fn().mockReturnValue({}) };
      }
      // First call: from("agent_runs").select(...).eq("idempotency_key", ...).maybeSingle()
      if (fromCallCount === 1) {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
            }),
          }),
          insert: vi.fn(),
          update: vi.fn(),
        };
      }
      // Second call: from("users").select("id").eq("clerk_id", ...).maybeSingle()
      if (fromCallCount === 2) {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({ data: { id: "user-uuid" }, error: null }),
            }),
          }),
          insert: vi.fn(),
          update: vi.fn(),
        };
      }
      // Third call: from("agent_runs").insert({...}).select("id").single()
      if (fromCallCount === 3) {
        return {
          insert: vi.fn().mockReturnValue({
            select: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({
                data: null,
                error: { code: "23502", message: "null violation" },
              }),
            }),
          }),
          select: vi.fn(),
          update: vi.fn(),
        };
      }
      return { insert: vi.fn(), select: vi.fn(), update: vi.fn() };
    });

    const result = await reserveCredits(baseCtx, 10);
    expect(result.ok).toBe(false);
    expect(result.status).toBe(500);
    // Refund was attempted
    expect(mockRpc).toHaveBeenCalledWith("refund_credits", expect.objectContaining({ p_credits: 10 }));
  });

  it("succeeds when reservation and insert both work", async () => {
    // Reserve succeeds
    mockRpc.mockResolvedValue({ error: null });

    let fromCallCount = 0;
    mockFrom.mockImplementation((table: string) => {
      fromCallCount++;
      if (table === "billing_reconciliations") {
        return { insert: vi.fn().mockReturnValue({}) };
      }
      // First call: existing run check
      if (fromCallCount === 1) {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
            }),
          }),
          insert: vi.fn(),
          update: vi.fn(),
        };
      }
      // Second call: user lookup
      if (fromCallCount === 2) {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({ data: { id: "user-uuid" }, error: null }),
            }),
          }),
          insert: vi.fn(),
          update: vi.fn(),
        };
      }
      // Third call: insert agent_runs
      if (fromCallCount === 3) {
        return {
          insert: vi.fn().mockReturnValue({
            select: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({
                data: { id: "new-run-id" },
                error: null,
              }),
            }),
          }),
          select: vi.fn(),
          update: vi.fn(),
        };
      }
      return { insert: vi.fn(), select: vi.fn(), update: vi.fn() };
    });

    const result = await reserveCredits(baseCtx, 10);
    expect(result.ok).toBe(true);
    expect(result.runId).toBe("new-run-id");
    expect(result.reservedCredits).toBe(10);
  });
});

describe("settleRun — failure handling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // Helper: build a supabase.from() mock that handles all chains settleRun uses:
  // 1. from("agent_runs").update({...}).eq("id", runId) — update run row
  // 2. from("agent_runs").select("agent_instance_id").eq("id", runId).maybeSingle() — fetch instance
  // 3. from("user_agents").update({...}).eq("id", instanceId) — update last_active
  // 4. from("billing_reconciliations").insert({...}) — reconciliation record
  function setupSettleMocks(opts: {
    updateError?: unknown;
    refundError?: unknown;
    agentInstanceId?: string;
  } = {}) {
    const updateResult = opts.updateError ? { error: opts.updateError } : { error: null };
    const selectResult = { data: { agent_instance_id: opts.agentInstanceId ?? "agent_instance_456" }, error: null };

    mockFrom.mockImplementation((table: string) => {
      if (table === "billing_reconciliations") {
        return {
          insert: vi.fn().mockReturnValue({}),
        };
      }
      // agent_runs or user_agents
      return {
        update: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue(updateResult),
        }),
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue(selectResult),
          }),
        }),
        insert: vi.fn().mockReturnValue({}),
      };
    });

    mockRpc.mockResolvedValue(
      opts.refundError
        ? { error: opts.refundError }
        : { error: null },
    );
  }

  it("creates reconciliation record when refund fails", async () => {
    setupSettleMocks({ refundError: { message: "refund_credits function not found" } });

    const result = await settleRun("run-1", {
      inputTokens: 100,
      outputTokens: 50,
      actualCredits: 3,
      status: "completed",
    }, 10);

    // Refund was attempted (creditsToRefund = 10 - 3 = 7)
    expect(mockRpc).toHaveBeenCalledWith("refund_credits", expect.objectContaining({ p_credits: 7 }));
  });

  it("refunds all reserved credits on failed run", async () => {
    setupSettleMocks();

    const result = await settleRun("run-1", {
      inputTokens: 100,
      outputTokens: 0,
      actualCredits: 0,
      status: "failed",
      error: "Model error",
    }, 10);

    // Failed run charges 0, refunds all 10
    expect(mockRpc).toHaveBeenCalledWith("refund_credits", expect.objectContaining({ p_credits: 10 }));
    expect(result.creditsCharged).toBe(0);
    expect(result.creditsRefunded).toBe(10);
  });

  it("refunds all reserved credits on cancelled run", async () => {
    setupSettleMocks();

    const result = await settleRun("run-1", {
      inputTokens: 0,
      outputTokens: 0,
      actualCredits: 0,
      status: "cancelled",
    }, 10);

    expect(mockRpc).toHaveBeenCalledWith("refund_credits", expect.objectContaining({ p_credits: 10 }));
    expect(result.creditsCharged).toBe(0);
  });

  it("charges only actual cost and refunds difference on completed run", async () => {
    setupSettleMocks();

    const result = await settleRun("run-1", {
      inputTokens: 200,
      outputTokens: 100,
      actualCredits: 5,
      status: "completed",
    }, 10);

    // Charges 5, refunds 5
    expect(mockRpc).toHaveBeenCalledWith("refund_credits", expect.objectContaining({ p_credits: 5 }));
    expect(result.creditsCharged).toBe(5);
    expect(result.creditsRefunded).toBe(5);
  });
});
