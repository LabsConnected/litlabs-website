// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  release: vi.fn(),
  reconciliations: [] as Record<string, unknown>[],
  reserveReason: "reserved",
  runError: { message: "agent_runs insert failed", code: "" },
  insertedRun: null as Record<string, unknown> | null,
}));

vi.mock("@/lib/supabase", () => ({
  supabaseAdmin: {
    rpc: (name: string) => name === "reserve_bits"
      ? Promise.resolve({ data: [{ success: true, reservation_id: "reservation-123", reason: db.reserveReason }], error: null })
      : db.release(),
    from: (table: string) => ({
      select: () => table === "users"
        ? { eq: () => ({ maybeSingle: async () => ({ data: { id: "user-123" }, error: null }) }) }
        : table === "credit_reservations"
          ? { eq: () => ({ maybeSingle: async () => ({ data: { id: "reservation-123", status: "reserved", reserved_amount: 5, settled_amount: 0, idempotency_key: context.idempotencyKey }, error: null }) }) }
        : { single: async () => ({ data: null, error: { message: "agent_runs insert failed" } }) },
      insert: (value: Record<string, unknown>) => {
        if (table === "billing_reconciliations") {
          db.reconciliations.push(value);
          return Promise.resolve({ error: null });
        }
        db.insertedRun = value;
        return { select: () => ({ single: async () => ({ data: null, error: db.runError }) }) };
      },
    }),
  },
}));
vi.mock("@/lib/owner", () => ({ isBillingExempt: () => false }));
vi.mock("@/lib/metering", () => ({ emitUsageEvent: vi.fn() }));

import { reserveCredits } from "./agent-billing";

const context = { clerkId: "clerk-123", agentInstanceId: "agent-123", agentId: null, agentVersionId: null, idempotencyKey: "request-12345678" };

describe("reservation cleanup after a run-row insert fails", () => {
  beforeEach(() => {
    db.release.mockReset();
    db.reconciliations = [];
    db.reserveReason = "reserved";
    db.runError = { message: "agent_runs insert failed", code: "" };
    db.insertedRun = null;
  });

  it("records a reconciliation when release_bits returns success=false", async () => {
    db.release.mockResolvedValue({ data: [{ success: false, released_amount: 0, reason: "reservation_already_settled" }], error: null });

    const result = await reserveCredits(context, 5);

    expect(result.ok).toBe(false);
    expect(db.reconciliations).toMatchObject([{ reason: "release_after_insert_failure", credits_expected: 5 }]);
  });

  it("records an uncertain release when the RPC throws after the insert failure", async () => {
    db.release.mockRejectedValue(new Error("connection reset"));

    const result = await reserveCredits(context, 5);

    expect(result.ok).toBe(false);
    expect(db.reconciliations).toHaveLength(1);
  });

  it("does not create a reconciliation after a confirmed release", async () => {
    db.release.mockResolvedValue({ data: [{ success: true, released_amount: 5, reason: "released" }], error: null });

    const result = await reserveCredits(context, 5);

    expect(result.ok).toBe(false);
    expect(db.reconciliations).toHaveLength(0);
  });

  it("writes the request key to the unique agent_runs column", async () => {
    db.release.mockResolvedValue({ data: [{ success: true, released_amount: 5, reason: "released" }], error: null });
    await reserveCredits(context, 5);
    expect(db.insertedRun).toMatchObject({ idempotency_key: context.idempotencyKey });
  });

  it("does not release a reservation owned by an earlier run on duplicate insert", async () => {
    db.reserveReason = "already_reserved";
    db.runError = { message: "duplicate key", code: "23505" };

    const result = await reserveCredits(context, 5);

    expect(result).toMatchObject({ ok: false, status: 409 });
    expect(db.release).not.toHaveBeenCalled();
    expect(db.reconciliations).toHaveLength(0);
  });

  it("does not release an existing reservation after a different insert failure", async () => {
    db.reserveReason = "already_reserved";

    const result = await reserveCredits(context, 5);

    expect(result.ok).toBe(false);
    expect(db.release).not.toHaveBeenCalled();
    expect(db.reconciliations).toMatchObject([{ reason: "run_insert_existing_reservation" }]);
  });
});
