// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  rpc: vi.fn(),
  runUpdates: [] as Record<string, unknown>[],
  reconciliations: [] as Record<string, unknown>[],
  reservation: null as Record<string, unknown> | null,
  ledger: null as Record<string, unknown> | Record<string, unknown>[] | null,
  runInput: null as Record<string, unknown> | null,
  selectError: null as { message: string } | null,
  updateError: null as { message: string } | null,
}));

vi.mock("@/lib/supabase", () => ({
  supabaseAdmin: {
    rpc: (...args: unknown[]) => db.rpc(...args),
    from: (table: string) => ({
      update: (value: Record<string, unknown>) => ({
        eq: async () => {
          if (table === "agent_runs") db.runUpdates.push(value);
          return { error: db.updateError };
        },
      }),
      insert: async (value: Record<string, unknown>) => {
        if (table === "billing_reconciliations") db.reconciliations.push(value);
        return { error: null };
      },
      select: () => {
        const filters: Record<string, unknown> = {};
        const query = {
          eq: (key: string, value: unknown) => { filters[key] = value; return query; },
          maybeSingle: async () => {
            if (db.selectError) return { data: null, error: db.selectError };
            const row = table === "credit_reservations" ? db.reservation
              : table === "credit_ledger" ? (Array.isArray(db.ledger) ? db.ledger[0] : db.ledger)
                : table === "agent_runs" && db.runInput ? { input: db.runInput } : null;
            if (row && Object.entries(filters).some(([key, value]) => row[key] !== value && !(table === "agent_runs" && key === "id"))) {
              return { data: null, error: null };
            }
            return { data: row, error: null };
          },
          // Thenable so queries awaited without maybeSingle() resolve to
          // { data: rows[] } — verifyPriorSettlement reads all debit rows.
          then: (onFulfilled: (value: { data: unknown; error: unknown }) => unknown) => {
            if (db.selectError) return Promise.resolve({ data: null, error: db.selectError }).then(onFulfilled);
            const rows = table === "credit_ledger"
              ? (Array.isArray(db.ledger) ? db.ledger : db.ledger ? [db.ledger] : [])
              : [];
            const filtered = (rows as Record<string, unknown>[]).filter(
              (row) => !Object.entries(filters).some(([key, value]) => row[key] !== value),
            );
            return Promise.resolve({ data: filtered, error: null }).then(onFulfilled);
          },
        };
        return query;
      },
    }),
  },
}));
vi.mock("@/lib/owner", () => ({ isBillingExempt: () => false }));
vi.mock("@/lib/metering", () => ({ emitUsageEvent: vi.fn() }));

import { settleRun } from "./agent-billing";

const completed = { inputTokens: 10, outputTokens: 20, actualCredits: 3, status: "completed" as const };

describe("agent billing settlement", () => {
  beforeEach(() => {
    db.rpc.mockReset();
    db.runUpdates = [];
    db.reconciliations = [];
    db.reservation = null;
    db.ledger = null;
    db.runInput = null;
    db.selectError = null;
    db.updateError = null;
  });

  it("does not report a confirmed charge when settle_bits returns success=false", async () => {
    db.rpc.mockResolvedValue({ data: [{ success: false, settled_amount: 0, released_amount: 0, reason: "overage_rejected" }], error: null });

    const result = await settleRun("run-12345678", completed, 2, "reservation-123");

    expect(result).toMatchObject({ ok: false, billingStatus: "failed", creditsCharged: 0, creditsRefunded: 0 });
    expect(db.runUpdates.at(-1)).toMatchObject({ status: "reconciliation_required" });
    expect(db.reconciliations).toHaveLength(1);
  });

  it.each(["returned error", "thrown exception"])("keeps an uncertain settlement pending after a %s", async (kind) => {
    if (kind === "returned error") db.rpc.mockResolvedValue({ data: null, error: { message: "connection reset" } });
    else db.rpc.mockRejectedValue(new Error("connection reset"));

    const result = await settleRun("run-12345678", completed, 5, "reservation-123");

    expect(result).toMatchObject({ ok: false, billingStatus: "pending_reconciliation", creditsCharged: 0, creditsRefunded: 0 });
    expect(db.runUpdates.at(-1)).toMatchObject({ status: "reconciliation_required" });
    expect(db.reconciliations).toHaveLength(1);
  });

  it("reports a confirmed settlement and its unused reservation only from a successful RPC", async () => {
    db.rpc.mockResolvedValue({ data: [{ success: true, settled_amount: 3, released_amount: 2, reason: "settled" }], error: null });

    const result = await settleRun("run-12345678", completed, 5, "reservation-123");

    expect(result).toMatchObject({ ok: true, billingStatus: "confirmed", creditsCharged: 3, creditsRefunded: 2 });
    expect(db.runUpdates.at(-1)).toMatchObject({ status: "completed", output: { billing_status: "confirmed", credits_charged: 3, credits_refunded: 2 } });
    expect(db.reconciliations).toHaveLength(0);
  });

  it("repeated settlement uses the same run key and original confirmed totals", async () => {
    db.rpc
      .mockResolvedValueOnce({ data: [{ success: true, settled_amount: 3, released_amount: 2, reason: "settled" }], error: null })
      .mockResolvedValueOnce({ data: [{ success: true, settled_amount: 3, released_amount: 0, reason: "already_settled" }], error: null });
    db.reservation = { id: "reservation-123", status: "settled", reserved_amount: 5, settled_amount: 3 };
    db.ledger = { idempotency_key: "run-12345678:settle", reference_id: "reservation-123", direction: "debit", amount: 3 };

    const first = await settleRun("run-12345678", completed, 5, "reservation-123");
    const retry = await settleRun("run-12345678", completed, 5, "reservation-123");

    expect(first).toMatchObject({ ok: true, creditsCharged: 3, creditsRefunded: 2 });
    expect(retry).toMatchObject({ ok: true, billingStatus: "confirmed", creditsCharged: 3, creditsRefunded: 2 });
    expect(db.rpc.mock.calls.map(([, args]) => (args as Record<string, unknown>).p_idempotency_key)).toEqual(["run-12345678", "run-12345678"]);
  });

  it("does not claim another run's prior settlement on the same reservation", async () => {
    db.rpc.mockResolvedValue({ data: [{ success: true, settled_amount: 3, released_amount: 0, reason: "already_settled" }], error: null });
    db.reservation = { id: "reservation-123", status: "settled", reserved_amount: 5, settled_amount: 3 };
    db.ledger = { idempotency_key: "other-run:settle", reference_id: "reservation-123", direction: "debit", amount: 3 };

    const result = await settleRun("run-12345678", completed, 5, "reservation-123");

    expect(result).toMatchObject({ ok: false, billingStatus: "failed", creditsCharged: 0, creditsRefunded: 0 });
  });

  it("rejects a stale already-settled response when the stored amount differs", async () => {
    db.rpc.mockResolvedValue({ data: [{ success: true, settled_amount: 3, released_amount: 0, reason: "already_settled" }], error: null });
    db.reservation = { id: "reservation-123", status: "settled", reserved_amount: 5, settled_amount: 2 };
    db.ledger = { idempotency_key: "run-12345678:settle", reference_id: "reservation-123", direction: "debit", amount: 2 };

    const result = await settleRun("run-12345678", completed, 5, "reservation-123");

    expect(result).toMatchObject({ ok: false, billingStatus: "failed", creditsCharged: 0, creditsRefunded: 0 });
    expect(db.runUpdates.at(-1)).toMatchObject({ status: "reconciliation_required" });
  });

  it("does not report a refund when release_bits returns success=false", async () => {
    db.rpc.mockResolvedValue({ data: [{ success: false, released_amount: 0, reason: "reservation_already_settled" }], error: null });

    const result = await settleRun("run-12345678", { ...completed, status: "failed" }, 5, "reservation-123");

    expect(result).toMatchObject({ ok: false, billingStatus: "failed", creditsCharged: 0, creditsRefunded: 0 });
    expect(db.runUpdates.at(-1)).toMatchObject({ status: "reconciliation_required" });
    expect(db.reconciliations).toHaveLength(1);
  });

  it.each(["returned error", "thrown exception"])("does not report a refund after a release %s", async (kind) => {
    if (kind === "returned error") db.rpc.mockResolvedValue({ data: null, error: { message: "connection reset" } });
    else db.rpc.mockRejectedValue(new Error("connection reset"));

    const result = await settleRun("run-12345678", { ...completed, status: "cancelled" }, 5, "reservation-123");

    expect(result).toMatchObject({ ok: false, billingStatus: "pending_reconciliation", creditsCharged: 0, creditsRefunded: 0 });
    expect(db.reconciliations).toHaveLength(1);
  });

  it("reports the amount returned by a confirmed release", async () => {
    db.rpc.mockResolvedValue({ data: [{ success: true, released_amount: 5, reason: "released" }], error: null });

    const result = await settleRun("run-12345678", { ...completed, status: "failed" }, 5, "reservation-123");

    expect(result).toMatchObject({ ok: true, billingStatus: "confirmed", creditsCharged: 0, creditsRefunded: 5 });
  });

  it("a duplicate release confirms the original amount without issuing a second refund", async () => {
    db.rpc.mockResolvedValue({ data: [{ success: true, released_amount: 0, reason: "already_released" }], error: null });
    db.reservation = { id: "reservation-123", status: "released", reserved_amount: 5, settled_amount: 0, idempotency_key: "request-12345678" };
    db.runInput = { reservation_id: "reservation-123", idempotency_key: "request-12345678" };

    const result = await settleRun("run-12345678", { ...completed, status: "failed" }, 5, "reservation-123");

    expect(result).toMatchObject({ ok: true, billingStatus: "confirmed", creditsCharged: 0, creditsRefunded: 5 });
    expect(db.rpc).toHaveBeenCalledTimes(1);
  });

  it("does not attribute another run's release to this run", async () => {
    db.rpc.mockResolvedValue({ data: [{ success: true, released_amount: 0, reason: "already_released" }], error: null });
    db.reservation = { id: "reservation-123", status: "released", reserved_amount: 5, settled_amount: 0, idempotency_key: "other-request" };
    db.runInput = { reservation_id: "different-reservation", idempotency_key: "request-12345678" };

    const result = await settleRun("run-12345678", { ...completed, status: "failed" }, 5, "reservation-123");

    expect(result).toMatchObject({ ok: false, billingStatus: "failed", creditsRefunded: 0 });
  });

  it("keeps an already-released response pending when the reservation cannot be verified", async () => {
    db.rpc.mockResolvedValue({ data: [{ success: true, released_amount: 0, reason: "already_released" }], error: null });
    db.selectError = { message: "read timeout" };

    const result = await settleRun("run-12345678", { ...completed, status: "failed" }, 5, "reservation-123");

    expect(result).toMatchObject({ ok: false, billingStatus: "pending_reconciliation", creditsRefunded: 0 });
    expect(db.reconciliations).toHaveLength(1);
  });

  it("does not report a refund from an inconsistent successful release row", async () => {
    db.rpc.mockResolvedValue({ data: [{ success: true, released_amount: 0, reason: "released" }], error: null });

    const result = await settleRun("run-12345678", { ...completed, status: "cancelled" }, 5, "reservation-123");

    expect(result).toMatchObject({ ok: false, billingStatus: "pending_reconciliation", creditsRefunded: 0 });
    expect(db.runUpdates.at(-1)).toMatchObject({ status: "reconciliation_required" });
  });

  it("does not mark a paid run without a reservation as billed", async () => {
    db.runInput = { billing_exempt: false };

    const result = await settleRun("run-12345678", completed, 0, null);

    expect(result).toMatchObject({ ok: false, billingStatus: "failed", creditsCharged: 0, creditsRefunded: 0 });
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it("allows a persisted billing exemption without a ledger debit", async () => {
    db.runInput = { billing_exempt: true };

    const result = await settleRun("run-12345678", completed, 0, null);

    expect(result).toMatchObject({ ok: true, billingStatus: "confirmed", creditsCharged: 0, creditsRefunded: 0 });
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it("does not claim a zero-cost release when a hold is missing", async () => {
    const result = await settleRun("run-12345678", { ...completed, status: "cancelled", actualCredits: 0 }, 5, null);

    expect(result).toMatchObject({ ok: false, billingStatus: "failed", creditsCharged: 0, creditsRefunded: 0 });
    expect(db.reconciliations).toHaveLength(1);
  });

  it("rejects an invalid negative actual charge before invoking an RPC", async () => {
    const result = await settleRun("run-12345678", { ...completed, actualCredits: -1 }, 5, "reservation-123");

    expect(result).toMatchObject({ ok: false, billingStatus: "failed", creditsCharged: 0, creditsRefunded: 0 });
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it("does not claim success from a malformed settlement success row", async () => {
    db.rpc.mockResolvedValue({ data: [{ success: true, settled_amount: 3, released_amount: 0, reason: "settled" }], error: null });

    const result = await settleRun("run-12345678", completed, 5, "reservation-123");

    expect(result).toMatchObject({ ok: false, billingStatus: "pending_reconciliation", creditsCharged: 0, creditsRefunded: 0 });
  });

  it("preserves confirmed ledger amounts when the run metadata write fails", async () => {
    db.rpc.mockResolvedValue({ data: [{ success: true, settled_amount: 3, released_amount: 2, reason: "settled" }], error: null });
    db.updateError = { message: "agent_runs unavailable" };

    const result = await settleRun("run-12345678", completed, 5, "reservation-123");

    expect(result).toMatchObject({ ok: false, billingStatus: "confirmed", creditsCharged: 3, creditsRefunded: 2 });
    expect(db.reconciliations).toHaveLength(1);
  });
});
