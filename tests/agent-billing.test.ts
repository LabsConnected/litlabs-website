/**
 * Agent billing tests — canonical reserve_bits → settle_bits/release_bits flow.
 *
 * B2 migration: tests the new canonical billing RPCs.
 * - reserveCredits calls reserve_bits RPC
 * - settleRun calls settle_bits (completed) or release_bits (failed/cancelled)
 * - Idempotency, insufficient balance, DB errors, reconciliation records
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock supabaseAdmin before importing the module
const mockRpc = vi.fn();
const mockFrom = vi.fn();

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
  idempotencyKey: "idem_key_001_at_least_8",
};

// Helper: mock from("users").select("id").eq("clerk_id", ...).maybeSingle()
function mockUserFound(userId = "user-uuid") {
  mockFrom.mockImplementation((table: string) => {
    if (table === "billing_reconciliations") {
      return { insert: vi.fn().mockReturnValue({}) };
    }
    if (table === "users") {
      return {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({ data: { id: userId }, error: null }),
          }),
        }),
      };
    }
    // agent_runs
    return {
      insert: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({ data: { id: "new-run-id" }, error: null }),
        }),
      }),
      update: vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ error: null }),
      }),
      select: vi.fn(),
    };
  });
}

// Helper: mock from("users") returns null (user not found)
function mockUserNotFound() {
  mockFrom.mockImplementation((table: string) => {
    if (table === "billing_reconciliations") {
      return { insert: vi.fn().mockReturnValue({}) };
    }
    return {
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
        }),
      }),
      insert: vi.fn(),
      update: vi.fn(),
    };
  });
}

// Helper: mock agent_runs insert fails
function mockAgentRunsInsertFails() {
  mockFrom.mockImplementation((table: string) => {
    if (table === "billing_reconciliations") {
      return { insert: vi.fn().mockReturnValue({}) };
    }
    if (table === "users") {
      return {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({ data: { id: "user-uuid" }, error: null }),
          }),
        }),
      };
    }
    // agent_runs insert fails
    return {
      insert: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({
            data: null,
            error: { code: "23502", message: "null violation" },
          }),
        }),
      }),
      update: vi.fn(),
      select: vi.fn(),
    };
  });
}

// Helper: mock settleRun chains (agent_runs update + billing_reconciliations)
function mockSettleChains(updateError: unknown = null) {
  mockFrom.mockImplementation((table: string) => {
    if (table === "billing_reconciliations") {
      return { insert: vi.fn().mockReturnValue({}) };
    }
    // agent_runs update
    return {
      update: vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ error: updateError }),
      }),
      select: vi.fn(),
      insert: vi.fn(),
    };
  });
}

describe("reserveCredits — canonical reserve_bits flow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 402 for insufficient balance", async () => {
    mockUserFound();
    mockRpc.mockResolvedValue({
      data: { success: false, reason: "insufficient_balance", available_after: 0 },
      error: null,
    });

    const result = await reserveCredits(baseCtx, 10);
    expect(result.ok).toBe(false);
    expect(result.status).toBe(402);
    expect(result.error).toContain("Insufficient");
  });

  it("returns 503 when reserve_bits RPC errors", async () => {
    mockUserFound();
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: "Could not find the function public.reserve_bits" },
    });

    const result = await reserveCredits(baseCtx, 10);
    expect(result.ok).toBe(false);
    expect(result.status).toBe(503);
    expect(result.error).toContain("Credit reservation failed");
  });

  it("returns 503 on permission denied", async () => {
    mockUserFound();
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: "permission denied for function reserve_bits" },
    });

    const result = await reserveCredits(baseCtx, 10);
    expect(result.ok).toBe(false);
    expect(result.status).toBe(503);
  });

  it("returns 503 on database timeout", async () => {
    mockUserFound();
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: "canceling statement due to statement timeout" },
    });

    const result = await reserveCredits(baseCtx, 10);
    expect(result.ok).toBe(false);
    expect(result.status).toBe(503);
  });

  it("returns 404 when user not found", async () => {
    mockUserNotFound();

    const result = await reserveCredits(baseCtx, 10);
    expect(result.ok).toBe(false);
    expect(result.status).toBe(404);
  });

  it("succeeds when reserve_bits and agent_runs insert both work", async () => {
    mockUserFound();
    mockRpc.mockResolvedValue({
      data: {
        success: true,
        reservation_id: "res-uuid-123",
        available_after: 90,
        reason: "reserved",
      },
      error: null,
    });

    const result = await reserveCredits(baseCtx, 10);
    expect(result.ok).toBe(true);
    expect(result.runId).toBe("new-run-id");
    expect(result.reservationId).toBe("res-uuid-123");
    expect(result.reservedCredits).toBe(10);
  });

  it("calls reserve_bits with correct parameters", async () => {
    mockUserFound();
    mockRpc.mockResolvedValue({
      data: { success: true, reservation_id: "res-1", available_after: 90, reason: "reserved" },
      error: null,
    });

    await reserveCredits(baseCtx, 10);
    expect(mockRpc).toHaveBeenCalledWith("reserve_bits", expect.objectContaining({
      p_user_id: "user-uuid",
      p_amount: 10,
      p_idempotency_key: baseCtx.idempotencyKey,
      p_usage_type: "agent_run",
    }));
  });

  it("releases reservation when agent_runs insert fails after successful reserve", async () => {
    mockAgentRunsInsertFails();
    // reserve_bits succeeds
    mockRpc.mockResolvedValueOnce({
      data: { success: true, reservation_id: "res-uuid-fail", available_after: 90, reason: "reserved" },
      error: null,
    });
    // release_bits succeeds
    mockRpc.mockResolvedValueOnce({
      data: { success: true, released_amount: 10, available_after: 100, reason: "released" },
      error: null,
    });

    const result = await reserveCredits(baseCtx, 10);
    expect(result.ok).toBe(false);
    expect(result.status).toBe(500);
    // release_bits was called
    expect(mockRpc).toHaveBeenCalledWith("release_bits", expect.objectContaining({
      p_reservation_id: "res-uuid-fail",
    }));
  });

  it("handles idempotent retry (already_reserved)", async () => {
    mockUserFound();
    mockRpc.mockResolvedValue({
      data: {
        success: true,
        reservation_id: "res-existing",
        available_after: 90,
        reason: "already_reserved",
      },
      error: null,
    });

    const result = await reserveCredits(baseCtx, 10);
    expect(result.ok).toBe(true);
    expect(result.reservationId).toBe("res-existing");
  });
});

describe("settleRun — canonical settle_bits/release_bits flow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls settle_bits on completed run with actual cost", async () => {
    mockSettleChains();
    mockRpc.mockResolvedValue({
      data: {
        success: true,
        settled_amount: 5,
        released_amount: 5,
        available_after: 95,
        reason: "settled",
      },
      error: null,
    });

    const result = await settleRun("run-1", {
      inputTokens: 200,
      outputTokens: 100,
      actualCredits: 5,
      status: "completed",
    }, 10, "res-uuid-123");

    expect(mockRpc).toHaveBeenCalledWith("settle_bits", expect.objectContaining({
      p_reservation_id: "res-uuid-123",
      p_actual_amount: 5,
      p_overage_policy: "reject",
    }));
    expect(result.creditsCharged).toBe(5);
    expect(result.creditsRefunded).toBe(5);
  });

  it("calls release_bits on failed run", async () => {
    mockSettleChains();
    mockRpc.mockResolvedValue({
      data: { success: true, released_amount: 10, available_after: 100, reason: "released" },
      error: null,
    });

    const result = await settleRun("run-1", {
      inputTokens: 0,
      outputTokens: 0,
      actualCredits: 0,
      status: "failed",
      error: "Model error",
    }, 10, "res-uuid-123");

    expect(mockRpc).toHaveBeenCalledWith("release_bits", expect.objectContaining({
      p_reservation_id: "res-uuid-123",
    }));
    expect(result.creditsCharged).toBe(0);
    expect(result.creditsRefunded).toBe(10);
  });

  it("calls release_bits on cancelled run", async () => {
    mockSettleChains();
    mockRpc.mockResolvedValue({
      data: { success: true, released_amount: 10, available_after: 100, reason: "released" },
      error: null,
    });

    const result = await settleRun("run-1", {
      inputTokens: 0,
      outputTokens: 0,
      actualCredits: 0,
      status: "cancelled",
    }, 10, "res-uuid-123");

    expect(mockRpc).toHaveBeenCalledWith("release_bits", expect.objectContaining({
      p_reservation_id: "res-uuid-123",
    }));
    expect(result.creditsCharged).toBe(0);
  });

  it("releases reservation on completed run with 0 actual cost (free run)", async () => {
    mockSettleChains();
    mockRpc.mockResolvedValue({
      data: { success: true, released_amount: 10, available_after: 100, reason: "released" },
      error: null,
    });

    const result = await settleRun("run-1", {
      inputTokens: 100,
      outputTokens: 50,
      actualCredits: 0,
      status: "completed",
    }, 10, "res-uuid-123");

    // Should release since actual cost is 0
    expect(mockRpc).toHaveBeenCalledWith("release_bits", expect.objectContaining({
      p_reservation_id: "res-uuid-123",
    }));
    expect(result.creditsCharged).toBe(0);
    expect(result.creditsRefunded).toBe(10);
  });

  it("creates reconciliation record when settle_bits fails", async () => {
    mockSettleChains();
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: "settle_bits function not found" },
    });

    const result = await settleRun("run-1", {
      inputTokens: 100,
      outputTokens: 50,
      actualCredits: 3,
      status: "completed",
    }, 10, "res-uuid-123");

    // Reconciliation record was attempted (billing_reconciliations insert)
    expect(mockFrom).toHaveBeenCalledWith("billing_reconciliations");
  });

  it("creates reconciliation record when release_bits fails", async () => {
    mockSettleChains();
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: "release_bits function not found" },
    });

    const result = await settleRun("run-1", {
      inputTokens: 0,
      outputTokens: 0,
      actualCredits: 0,
      status: "failed",
    }, 10, "res-uuid-123");

    expect(mockFrom).toHaveBeenCalledWith("billing_reconciliations");
  });

  it("handles settle_bits returning failure (overage rejected)", async () => {
    mockSettleChains();
    mockRpc.mockResolvedValue({
      data: {
        success: false,
        settled_amount: 0,
        released_amount: 0,
        available_after: 90,
        reason: "overage_rejected",
      },
      error: null,
    });

    const result = await settleRun("run-1", {
      inputTokens: 200,
      outputTokens: 100,
      actualCredits: 15, // more than reserved 10
      status: "completed",
    }, 10, "res-uuid-123");

    // Overage was rejected — reconciliation record created
    expect(mockFrom).toHaveBeenCalledWith("billing_reconciliations");
  });

  it("handles null reservationId gracefully (no RPC call)", async () => {
    mockSettleChains();

    const result = await settleRun("run-1", {
      inputTokens: 100,
      outputTokens: 50,
      actualCredits: 5,
      status: "completed",
    }, 10, null);

    // No settle_bits or release_bits call when reservationId is null
    expect(mockRpc).not.toHaveBeenCalled();
    expect(result.creditsCharged).toBe(0);
  });

  it("updates agent_runs row with final status", async () => {
    mockSettleChains();
    mockRpc.mockResolvedValue({
      data: { success: true, settled_amount: 5, released_amount: 5, available_after: 95, reason: "settled" },
      error: null,
    });

    await settleRun("run-1", {
      inputTokens: 200,
      outputTokens: 100,
      actualCredits: 5,
      status: "completed",
    }, 10, "res-uuid-123");

    // agent_runs update was called
    expect(mockFrom).toHaveBeenCalledWith("agent_runs");
  });
});
