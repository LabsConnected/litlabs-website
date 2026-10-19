/**
 * P0 billing recovery — regression tests for:
 *  WS1: PostgREST RETURNS TABLE array responses (reserve/settle/release)
 *  WS2: p_expires_seconds 3600 on reserve
 *  WS3: settleRun truthfulness (failed settle → ok:false, reconciliation)
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockRpc = vi.fn();
const mockFrom = vi.fn();
const reconInsert = vi.fn().mockReturnValue({});

vi.mock("@/lib/supabase", () => ({
  supabaseAdmin: { rpc: mockRpc, from: mockFrom },
}));
vi.mock("@/lib/env", () => ({
  isClerkConfigured: () => true,
  isAnonymousDevAllowed: () => false,
}));

const { reserveCredits, settleRun } = await import("@/lib/agent-billing");

const ctx = {
  clerkId: "clerk_u", agentInstanceId: "inst", agentId: null,
  agentVersionId: null, idempotencyKey: "test-idempotency-key-001",
};

function mockUser() {
  mockFrom.mockImplementation((t: string) => {
    if (t === "billing_reconciliations") return { insert: reconInsert };
    if (t === "users")
      return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: "u1" } }) }) }) };
    return {
      insert: () => ({ select: () => ({ single: async () => ({ data: { id: "run-1" } }) }) }),
      update: () => ({ eq: async () => ({ error: null }) }),
      select: vi.fn(),
    };
  });
}

const arr = (r: Record<string, unknown>) => [r]; // PostgREST RETURNS TABLE shape

describe("WS1 — array-shaped RPC responses", () => {
  beforeEach(() => vi.clearAllMocks());

  it("reserve succeeds on array response and passes p_expires_seconds 3600", async () => {
    mockUser();
    mockRpc.mockResolvedValue({ data: arr({ success: true, reservation_id: "res-a", available_after: 90, reason: "reserved" }), error: null });
    const r = await reserveCredits(ctx, 10);
    expect(r.ok).toBe(true);
    expect(r.reservationId).toBe("res-a");
    expect(mockRpc).toHaveBeenCalledWith("reserve_bits", expect.objectContaining({ p_expires_seconds: 3600 }));
  });

  it("reserve 402 on insufficient_balance (array)", async () => {
    mockUser();
    mockRpc.mockResolvedValue({ data: arr({ success: false, reason: "insufficient_balance" }), error: null });
    const r = await reserveCredits(ctx, 10);
    expect(r.status).toBe(402);
  });

  it("reserve fails closed on malformed response (empty array)", async () => {
    mockUser();
    mockRpc.mockResolvedValue({ data: [], error: null });
    const r = await reserveCredits(ctx, 10);
    expect(r.ok).toBe(false);
    expect(r.error).toContain("invalid_reserve_response");
  });

  it("reserve fails closed on row missing boolean success", async () => {
    mockUser();
    mockRpc.mockResolvedValue({ data: arr({ reservation_id: "x" }), error: null });
    const r = await reserveCredits(ctx, 10);
    expect(r.ok).toBe(false);
  });

  it("idempotent already_reserved on array response returns same id", async () => {
    mockUser();
    mockRpc.mockResolvedValue({ data: arr({ success: false, reason: "already_reserved", reservation_id: "res-orig" }), error: null });
    const r = await reserveCredits(ctx, 10);
    expect(r.reservationId).toBe("res-orig");
  });
});

describe("WS3 — settle truthfulness", () => {
  beforeEach(() => { vi.clearAllMocks(); mockUser(); });

  it("settle succeeds on array response", async () => {
    mockRpc.mockResolvedValue({ data: arr({ success: true, settled_amount: 5, released_amount: 5 }), error: null });
    const r = await settleRun("run-1", { inputTokens: 1, outputTokens: 1, actualCredits: 5, status: "completed" }, 10, "res-1");
    expect(r.ok).toBe(true);
    expect(r.creditsCharged).toBe(5);
  });

  it("settle RPC error → ok:false, charged 0, reconciliation_pending", async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: "conn reset" } });
    const r = await settleRun("run-1", { inputTokens: 1, outputTokens: 1, actualCredits: 5, status: "completed" }, 10, "res-1");
    expect(r.ok).toBe(false);
    expect(r.creditsCharged).toBe(0);
    expect(reconInsert).toHaveBeenCalled();
  });

  it("settle rejected (reservation_expired) → ok:false, reconciliation row", async () => {
    mockRpc.mockResolvedValue({ data: arr({ success: false, reason: "reservation_expired" }), error: null });
    const r = await settleRun("run-1", { inputTokens: 1, outputTokens: 1, actualCredits: 5, status: "completed" }, 10, "res-1");
    expect(r.ok).toBe(false);
    expect(r.creditsCharged).toBe(0);
    expect(reconInsert).toHaveBeenCalled();
  });

  it("settle malformed (empty array) → ok:false", async () => {
    mockRpc.mockResolvedValue({ data: [], error: null });
    const r = await settleRun("run-1", { inputTokens: 1, outputTokens: 1, actualCredits: 5, status: "completed" }, 10, "res-1");
    expect(r.ok).toBe(false);
  });

  it("release on array response marks refunded", async () => {
    mockRpc.mockResolvedValue({ data: arr({ success: true, released_amount: 10 }), error: null });
    const r = await settleRun("run-1", { inputTokens: 0, outputTokens: 0, actualCredits: 0, status: "failed" }, 10, "res-1");
    expect(r.creditsRefunded).toBe(10);
  });

  it("release malformed → reconciliation row written", async () => {
    mockRpc.mockResolvedValue({ data: [], error: null });
    await settleRun("run-1", { inputTokens: 0, outputTokens: 0, actualCredits: 0, status: "failed" }, 10, "res-1");
    expect(reconInsert).toHaveBeenCalled();
  });

  it("duplicate settle replay stays idempotent via runId:settle key", async () => {
    mockRpc.mockResolvedValue({ data: arr({ success: true, settled_amount: 5, released_amount: 5, reason: "already_settled" }), error: null });
    await settleRun("run-1", { inputTokens: 1, outputTokens: 1, actualCredits: 5, status: "completed" }, 10, "res-1");
    expect(mockRpc).toHaveBeenCalledWith("settle_bits", expect.objectContaining({ p_idempotency_key: "run-1:settle" }));
  });
});
