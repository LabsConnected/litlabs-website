import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * charge.refunded regression tests.
 *
 * Confirmed defects fixed in this branch:
 *  1. Stripe never copies subscription/invoice metadata onto Charge objects,
 *     so plan_id/clerk_id were absent on subscription refunds — the handler
 *     silently skipped entitlement revocation and the prorated debit.
 *     Fallback: resolve the subscriptions row by stripe_customer_id.
 *  2. debit_credits idempotency key was `refund_${charge.id}` — shared across
 *     partial refunds of one charge, so the second refund replayed as a
 *     no-op and under-debited. Now keyed per refund id.
 */

vi.mock("server-only", () => ({}));

let currentEvent: unknown;

vi.mock("stripe", () => ({
  default: class MockStripe {
    webhooks = { constructEvent: () => currentEvent };
  },
}));

const debitCalls: Array<Record<string, unknown>> = [];
const subUpdates: Array<Record<string, unknown>> = [];

interface TableResult { data: unknown; error: unknown }
let tableRows: Record<string, TableResult> = {};

function makeChain(table: string) {
  const result = tableRows[table] ?? { data: null, error: null };
  const chain: Record<string, unknown> = {};
  for (const m of ["select", "eq", "order", "limit", "update"]) {
    if (m === "update") {
      chain[m] = (v: unknown) => {
        subUpdates.push(v as Record<string, unknown>);
        return chain;
      };
    } else {
      chain[m] = () => chain;
    }
  }
  chain.single = () => Promise.resolve(result);
  chain.maybeSingle = () => Promise.resolve(result);
  chain.insert = () => Promise.resolve({ error: null });
  return chain;
}

vi.mock("@/lib/supabase-admin", () => ({
  isAdminSupabaseConfigured: () => true,
  getAdminSupabase: () => ({
    from: (t: string) => makeChain(t),
    rpc: (name: string, args: Record<string, unknown>) => {
      if (name === "debit_credits") debitCalls.push(args);
      return Promise.resolve({ data: { success: true }, error: null });
    },
  }),
}));

vi.mock("@/lib/business-operations", () => ({
  confirmBookingPayment: vi.fn(),
  recordAudit: vi.fn(),
}));

import { POST } from "@/app/api/stripe/webhook/route";

function req(): Request {
  return new Request("https://x/stripe", {
    method: "POST",
    headers: { "stripe-signature": "sig" },
    body: "{}",
  });
}

function refundEvent(charge: Record<string, unknown>) {
  return { id: "evt_1", type: "charge.refunded", data: { object: charge } };
}

describe("charge.refunded", () => {
  beforeEach(() => {
    debitCalls.length = 0;
    subUpdates.length = 0;
    tableRows = {};
    process.env.STRIPE_SECRET_KEY = "sk_test_x";
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_x";
  });

  it("resolves plan refunds without charge metadata via stripe_customer_id", async () => {
    tableRows = {
      stripe_events: { data: null, error: null },
      subscriptions: { data: { plan: "creator_beta", user_id: "u1" }, error: null },
      users: { data: { id: "u1" }, error: null },
      marketplace_orders: { data: null, error: null },
    };
    currentEvent = refundEvent({
      id: "ch_1",
      customer: "cus_1",
      metadata: {}, // no plan_id/clerk_id — the Stripe reality
      payment_intent: "pi_1",
      amount: 1900,
      amount_refunded: 1900,
      refunds: { data: [{ id: "re_1" }] },
    });
    const res = await POST(req() as never);
    expect(res.status).toBe(200);
    expect(subUpdates).toContainEqual(expect.objectContaining({ status: "refunded" }));
    expect(debitCalls).toHaveLength(1);
    expect(debitCalls[0].p_user_id).toBe("u1");
  });

  it("keys debits per refund id — partial then full refund both debit", async () => {
    tableRows = {
      stripe_events: { data: null, error: null },
      subscriptions: { data: { plan: "creator_beta", user_id: "u1" }, error: null },
      users: { data: { id: "u1" }, error: null },
      marketplace_orders: { data: null, error: null },
    };
    currentEvent = refundEvent({
      id: "ch_1", customer: "cus_1", metadata: {}, payment_intent: "pi_1",
      amount: 1900, amount_refunded: 900, refunds: { data: [{ id: "re_partial" }] },
    });
    await POST(req() as never);
    currentEvent = refundEvent({
      id: "ch_1", customer: "cus_1", metadata: {}, payment_intent: "pi_1",
      amount: 1900, amount_refunded: 1900, refunds: { data: [{ id: "re_full" }] },
    });
    await POST(req() as never);
    const keys = debitCalls.map((c) => c.p_idempotency_key);
    expect(keys).toEqual(["refund_re_partial", "refund_re_full"]);
    expect(new Set(keys).size).toBe(2);
  });

  it("replays the same refund id idempotently (same key)", async () => {
    tableRows = {
      stripe_events: { data: null, error: null },
      subscriptions: { data: { plan: "creator_beta", user_id: "u1" }, error: null },
      users: { data: { id: "u1" }, error: null },
      marketplace_orders: { data: null, error: null },
    };
    currentEvent = refundEvent({
      id: "ch_1", customer: "cus_1", metadata: {}, payment_intent: "pi_1",
      amount: 1900, amount_refunded: 1900, refunds: { data: [{ id: "re_1" }] },
    });
    await POST(req() as never);
    await POST(req() as never);
    expect(debitCalls.map((c) => c.p_idempotency_key)).toEqual(["refund_re_1", "refund_re_1"]);
  });

  it("credit_pack refunds debit LiTTBits with a per-refund key", async () => {
    tableRows = {
      stripe_events: { data: null, error: null },
      subscriptions: { data: null, error: null },
      users: { data: { id: "u2" }, error: null },
      marketplace_orders: { data: null, error: null },
    };
    currentEvent = refundEvent({
      id: "ch_2", customer: "cus_2", payment_intent: "pi_2",
      metadata: { product_type: "credit_pack", clerk_id: "clerk_2", coin_amount: "2000" },
      amount: 2000, amount_refunded: 1000,
      refunds: { data: [{ id: "re_pack" }] },
    });
    const res = await POST(req() as never);
    expect(res.status).toBe(200);
    expect(debitCalls).toHaveLength(1);
    expect(debitCalls[0].p_amount).toBe(1000);
    expect(debitCalls[0].p_idempotency_key).toBe("refund_re_pack");
  });
});
