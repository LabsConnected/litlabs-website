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
/** Every RPC call (name + args) — generic, superset of debitCalls. */
const rpcCalls: Array<{ fn: string; args: Record<string, unknown> }> = [];
/** Every insert, table-tagged — used to prove the generic claim did/didn't fire. */
const allInserts: Array<{ table: string; row: Record<string, unknown> }> = [];
/** Every update, table-tagged — used to prove auto-provision ran or was skipped. */
const allUpdates: Array<{ table: string; patch: Record<string, unknown> }> = [];

interface TableResult { data: unknown; error: unknown }
let tableRows: Record<string, TableResult> = {};

/** Settable per-test: insert error for stripe_events (e.g. 23505 race). */
let stripeEventsInsertError: { code?: string; message?: string } | null = null;
/** Reclaim result for failed/stale events (update().select() rows). */
let stripeEventsReclaimed: Array<{ id: string }> = [{ id: "e1" }];
/** Settable per-test: what fulfill_agent_purchase/refund_agent_purchase "returns". */
let agentRpcResult: { status: string } = { status: "ok" };

function makeChain(table: string) {
  const result = tableRows[table] ?? { data: null, error: null };
  const chain: Record<string, unknown> = {};
  for (const m of ["select", "eq", "order", "limit", "update"]) {
    if (m === "update") {
      chain[m] = (v: unknown) => {
        subUpdates.push(v as Record<string, unknown>);
        allUpdates.push({ table, patch: v as Record<string, unknown> });
        // update().eq().eq()[.eq()].select() must resolve rows for the
        // failed- and stale-"processing"-reclaim paths (arbitrary eq depth).
        if (table === "stripe_events") {
          const upd: Record<string, unknown> = {};
          upd.eq = () => upd;
          upd.select = () => Promise.resolve({ data: stripeEventsReclaimed });
          return upd;
        }
        return chain;
      };
    } else if (m === "select" && table === "stripe_events") {
      chain[m] = () => {
        const sel: Record<string, unknown> = {};
        sel.eq = () => sel;
        sel.maybeSingle = () => Promise.resolve(result);
        return sel;
      };
    } else {
      chain[m] = () => chain;
    }
  }
  chain.single = () => Promise.resolve(result);
  chain.maybeSingle = () => Promise.resolve(result);
  chain.insert = (row: Record<string, unknown>) => {
    allInserts.push({ table, row });
    return Promise.resolve(
      stripeEventsInsertError && table === "stripe_events"
        ? { error: stripeEventsInsertError }
        : { error: null },
    );
  };
  return chain;
}

vi.mock("@/lib/supabase-admin", () => ({
  isAdminSupabaseConfigured: () => true,
  getAdminSupabase: () => ({
    from: (t: string) => makeChain(t),
    rpc: (name: string, args: Record<string, unknown>) => {
      if (name === "debit_credits") debitCalls.push(args);
      rpcCalls.push({ fn: name, args });
      if (name === "fulfill_agent_purchase" || name === "refund_agent_purchase") {
        return Promise.resolve({ data: agentRpcResult, error: null });
      }
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

function checkoutEvent(session: Record<string, unknown>) {
  return { id: "evt_checkout_1", type: "checkout.session.completed", data: { object: session } };
}

describe("charge.refunded", () => {
  beforeEach(() => {
    debitCalls.length = 0;
    subUpdates.length = 0;
    rpcCalls.length = 0;
    allInserts.length = 0;
    allUpdates.length = 0;
    tableRows = {};
    stripeEventsInsertError = null;
    stripeEventsReclaimed = [{ id: "e1" }];
    agentRpcResult = { status: "ok" };
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

describe("stripe_events atomic claim (concurrent delivery)", () => {
  const charge = {
    id: "ch_1", customer: "cus_1", metadata: {}, payment_intent: "pi_1",
    amount: 1900, amount_refunded: 1900, refunds: { data: [{ id: "re_1" }] },
  };
  const baseRows = {
    subscriptions: { data: { plan: "creator_beta", user_id: "u1" }, error: null },
    users: { data: { id: "u1" }, error: null },
    marketplace_orders: { data: null, error: null },
  };
  beforeEach(() => {
    debitCalls.length = 0;
    rpcCalls.length = 0;
    allInserts.length = 0;
    allUpdates.length = 0;
    stripeEventsInsertError = null;
    stripeEventsReclaimed = [{ id: "e1" }];
    agentRpcResult = { status: "ok" };
    process.env.STRIPE_SECRET_KEY = "sk_test_x";
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_x";
  });

  it("second concurrent delivery loses the claim → replayed, no duplicate side effects", async () => {
    tableRows = { ...baseRows, stripe_events: { data: null, error: null } };
    currentEvent = refundEvent(charge);
    await POST(req() as never); // first delivery claims + processes
    // Second delivery: select returns the claimed row → claimed-else
    tableRows.stripe_events = { data: { id: "e1", result: "processing" }, error: null };
    const res = await POST(req() as never);
    expect(res.status).toBe(200);
    expect(debitCalls).toHaveLength(1); // no duplicate debit
  });

  it("unique-violation on claim → replayed, no duplicate side effects", async () => {
    tableRows = { ...baseRows, stripe_events: { data: null, error: null } };
    stripeEventsInsertError = { code: "23505" };
    currentEvent = refundEvent(charge);
    const res = await POST(req() as never);
    expect(res.status).toBe(200);
    expect(debitCalls).toHaveLength(0);
  });

  it("processed event → replayed, no re-processing", async () => {
    tableRows = { ...baseRows, stripe_events: { data: { id: "e1", result: "processed" }, error: null } };
    currentEvent = refundEvent(charge);
    const res = await POST(req() as never);
    expect(res.status).toBe(200);
    expect(debitCalls).toHaveLength(0);
  });

  it("failed event is reclaimed and reprocessed", async () => {
    tableRows = { ...baseRows, stripe_events: { data: { id: "e1", result: "failed" }, error: null } };
    currentEvent = refundEvent(charge);
    const res = await POST(req() as never);
    expect(res.status).toBe(200);
    expect(debitCalls).toHaveLength(1); // retried work executed once
  });

  it("failed event already reclaimed by another delivery → replayed", async () => {
    tableRows = { ...baseRows, stripe_events: { data: { id: "e1", result: "failed" }, error: null } };
    stripeEventsReclaimed = []; // update matched zero rows — someone else owns it
    currentEvent = refundEvent(charge);
    const res = await POST(req() as never);
    expect(res.status).toBe(200);
    expect(debitCalls).toHaveLength(0);
  });

  it("stale 'processing' claim (holder crashed/timed out) is reclaimed and reprocessed", async () => {
    const staleTimestamp = new Date(Date.now() - 6 * 60 * 1000).toISOString(); // > 5 min stale
    tableRows = {
      ...baseRows,
      stripe_events: { data: { id: "e1", result: "processing", processed_at: staleTimestamp }, error: null },
    };
    currentEvent = refundEvent(charge);
    const res = await POST(req() as never);
    expect(res.status).toBe(200);
    expect(debitCalls).toHaveLength(1); // the abandoned work gets done, exactly once
  });

  it("fresh 'processing' claim (not stale) is NOT reclaimed → replayed", async () => {
    const freshTimestamp = new Date(Date.now() - 10 * 1000).toISOString(); // 10s old, well under threshold
    tableRows = {
      ...baseRows,
      stripe_events: { data: { id: "e1", result: "processing", processed_at: freshTimestamp }, error: null },
    };
    currentEvent = refundEvent(charge);
    const res = await POST(req() as never);
    expect(res.status).toBe(200);
    expect(debitCalls).toHaveLength(0); // still owned by the (presumably live) first delivery
  });

  it("two deliveries racing to reclaim the same stale snapshot → only one wins", async () => {
    const staleTimestamp = new Date(Date.now() - 6 * 60 * 1000).toISOString();
    tableRows = {
      ...baseRows,
      stripe_events: { data: { id: "e1", result: "processing", processed_at: staleTimestamp }, error: null },
    };
    stripeEventsReclaimed = []; // the OCC-token UPDATE matches zero rows — the other racer already won
    currentEvent = refundEvent(charge);
    const res = await POST(req() as never);
    expect(res.status).toBe(200);
    expect(debitCalls).toHaveLength(0); // this delivery lost the race, does no work
  });
});

/**
 * Regression coverage for the fulfillment/refund collision: fulfill_agent_purchase
 * and refund_agent_purchase atomically claim the SAME stripe_events row themselves
 * (INSERT ... ON CONFLICT (stripe_event_id) DO NOTHING) as their own idempotency
 * gate. The generic webhook-level claim must never insert a row ahead of them —
 * if it did, those RPCs would see the row as already-claimed and silently skip
 * all real work (order/entitlement creation, or revocation on refund) on every
 * single delivery, not just under a race.
 */
describe("self-claiming RPC delegation (agent purchase/refund) — no claim collision", () => {
  beforeEach(() => {
    debitCalls.length = 0;
    rpcCalls.length = 0;
    allInserts.length = 0;
    allUpdates.length = 0;
    tableRows = {};
    stripeEventsInsertError = null;
    agentRpcResult = { status: "ok" };
    process.env.STRIPE_SECRET_KEY = "sk_test_x";
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_x";
  });

  it("checkout.session.completed (agent) skips the generic claim and calls fulfill_agent_purchase", async () => {
    tableRows = {
      users: { data: { id: "u1" }, error: null },
      user_agents: { data: null, error: null },
      agents: { data: { display_name: "Test Agent" }, error: null },
    };
    currentEvent = checkoutEvent({
      id: "cs_1",
      amount_total: 500,
      currency: "usd",
      customer: "cus_1",
      payment_intent: "pi_agent_1",
      metadata: {
        product_type: "agent",
        clerk_id: "clerk_1",
        agent_id: "agent_1",
        agent_version_id: "av_1",
        marketplace_order_id: "order_1",
      },
    });
    const res = await POST(req() as never);
    expect(res.status).toBe(200);
    expect(rpcCalls.map((c) => c.fn)).toContain("fulfill_agent_purchase");
    // The generic claim must NOT have inserted a stripe_events row — that
    // would collide with fulfill_agent_purchase's own atomic claim.
    expect(allInserts.filter((i) => i.table === "stripe_events")).toHaveLength(0);
  });

  it("checkout.session.completed (agent) with status 'already_processed' skips auto-provisioning", async () => {
    tableRows = {
      users: { data: { id: "u1" }, error: null },
      user_agents: { data: null, error: null },
    };
    agentRpcResult = { status: "already_processed" };
    currentEvent = checkoutEvent({
      id: "cs_2",
      amount_total: 500,
      currency: "usd",
      customer: "cus_1",
      payment_intent: "pi_agent_2",
      metadata: {
        product_type: "agent",
        clerk_id: "clerk_1",
        agent_id: "agent_1",
        agent_version_id: "av_1",
        marketplace_order_id: "order_1",
      },
    });
    const res = await POST(req() as never);
    expect(res.status).toBe(200);
    expect(rpcCalls.map((c) => c.fn)).toContain("fulfill_agent_purchase");
    // Nothing new landed — no user_agents insert/update should have run.
    expect(allInserts.filter((i) => i.table === "user_agents")).toHaveLength(0);
    expect(allUpdates.filter((u) => u.table === "user_agents")).toHaveLength(0);
  });

  it("charge.refunded matching a marketplace order skips the generic claim and calls refund_agent_purchase", async () => {
    tableRows = {
      marketplace_orders: { data: { id: "order_1" }, error: null },
    };
    currentEvent = refundEvent({
      id: "ch_agent_1",
      customer: "cus_1",
      metadata: {},
      payment_intent: "pi_agent_1",
      amount: 500,
      amount_refunded: 500,
      refunds: { data: [{ id: "re_agent_1" }] },
    });
    const res = await POST(req() as never);
    expect(res.status).toBe(200);
    expect(rpcCalls.map((c) => c.fn)).toContain("refund_agent_purchase");
    expect(allInserts.filter((i) => i.table === "stripe_events")).toHaveLength(0);
    expect(debitCalls).toHaveLength(0); // agent refunds never debit LBC
  });

  it("charge.refunded with no matching marketplace order (plan refund) still takes the generic claim", async () => {
    tableRows = {
      stripe_events: { data: null, error: null },
      marketplace_orders: { data: null, error: null },
      subscriptions: { data: { plan: "creator_beta", user_id: "u1" }, error: null },
      users: { data: { id: "u1" }, error: null },
    };
    currentEvent = refundEvent({
      id: "ch_plan_1",
      customer: "cus_1",
      metadata: {},
      payment_intent: "pi_plan_1",
      amount: 1900,
      amount_refunded: 1900,
      refunds: { data: [{ id: "re_plan_1" }] },
    });
    const res = await POST(req() as never);
    expect(res.status).toBe(200);
    expect(rpcCalls.map((c) => c.fn)).not.toContain("refund_agent_purchase");
    // Positive control: non-agent events DO still take the generic claim.
    expect(allInserts.filter((i) => i.table === "stripe_events")).toHaveLength(1);
    expect(debitCalls).toHaveLength(1);
  });
});
