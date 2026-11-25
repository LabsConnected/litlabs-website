import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * stripe_events token-fenced claim regression tests.
 *
 * The webhook claims each Stripe event through the claim_stripe_event RPC
 * (migration 20261015240000_stripe_event_claim_token), which returns a
 * per-attempt UUID claim_token. Only that token can finalize
 * (finalize_stripe_event) or release (release_stripe_event) the row — a
 * stale worker that lost its claim to a takeover can no longer mark the
 * event processed.
 *
 * Two concurrent deliveries of the same event must not both process —
 * duplicate side effects (double credit grants, double debits, double
 * fulfillment) are the bug being prevented. Events delegated to the
 * self-claiming RPCs (fulfill_agent_purchase / refund_agent_purchase)
 * must NOT take the generic claim at all.
 */

vi.mock("server-only", () => ({}));

let currentEvent: unknown;

vi.mock("stripe", () => ({
  default: class MockStripe {
    webhooks = { constructEvent: () => currentEvent };
    invoicePayments = { list: async () => ({ data: [] }) };
    invoices = { retrieve: async () => ({}) };
    paymentIntents = { retrieve: async () => ({ metadata: {} }) };
  },
}));

const debitCalls: Array<Record<string, unknown>> = [];
const rpcCalls: Array<{ fn: string; args: Record<string, unknown> }> = [];
/** Every insert, table-tagged — proves the generic claim did/did't touch tables. */
const allInserts: Array<{ table: string; row: Record<string, unknown> }> = [];

interface TableResult { data: unknown; error: unknown }
let tableRows: Record<string, TableResult> = {};

/** Settable per-test: what fulfill_agent_purchase/refund_agent_purchase return. */
let agentRpcResult: { status: string } = { status: "ok" };
/** Settable per-test: force claim_stripe_event to return this outcome. */
let forcedClaimOutcome: string | null = null;
/** Settable per-test: make claim_stripe_event return an RPC error. */
let claimRpcError: { message: string } | null = null;
/** Settable per-test: make finalize_stripe_event return false (lost claim). */
let finalizeReturnsFalse = false;
/** Settable per-test: RPC fns that should throw when called. */
let rpcThrowFor: Set<string> = new Set();

/**
 * In-memory model of stripe_events as the migration's RPCs see it:
 * eventId -> { token, result, processedAtMs }. Stale "processing" rows
 * (older than STALE_CLAIM_MS = 5min) can be taken over by a new claim.
 */
const STALE_MS = 5 * 60 * 1000;
const claimRows = new Map<string, { token: string; result: string; processedAtMs: number }>();

function claimRpc(args: Record<string, unknown>) {
  const id = args.p_stripe_event_id as string;
  const token = args.p_claim_token as string;
  const staleBeforeMs = new Date(args.p_stale_before as string).getTime();
  const now = Date.now();

  if (forcedClaimOutcome) {
    // Still record the attempt token for fencing assertions.
    return { data: forcedClaimOutcome, error: null };
  }

  const row = claimRows.get(id);
  if (!row) {
    claimRows.set(id, { token, result: "processing", processedAtMs: now });
    return { data: "owned", error: null };
  }
  if (row.result !== "processing") return { data: "duplicate", error: null };
  if (row.processedAtMs > staleBeforeMs) return { data: "in_progress", error: null };
  // Stale claim — take over under the new token.
  row.token = token;
  row.processedAtMs = now;
  return { data: "owned", error: null };
}

function finalizeRpc(args: Record<string, unknown>) {
  const id = args.p_stripe_event_id as string;
  const row = claimRows.get(id);
  if (finalizeReturnsFalse) return { data: false, error: null };
  if (row && row.result === "processing" && row.token === args.p_claim_token) {
    row.result = args.p_result as string;
    row.processedAtMs = Date.now();
    return { data: true, error: null };
  }
  return { data: false, error: null };
}

function releaseRpc(args: Record<string, unknown>) {
  const id = args.p_stripe_event_id as string;
  const row = claimRows.get(id);
  if (row && row.result === "processing" && row.token === args.p_claim_token) {
    claimRows.delete(id);
    return { data: "released", error: null };
  }
  return { data: row ? "lost" : "absent", error: null };
}

function makeChain(table: string) {
  const result = tableRows[table] ?? { data: null, error: null };
  const chain: Record<string, unknown> = {};
  for (const m of ["select", "eq", "order", "limit", "update"]) {
    chain[m] = () => chain;
  }
  chain.single = () => Promise.resolve(result);
  chain.maybeSingle = () => Promise.resolve(result);
  chain.insert = (row: Record<string, unknown>) => {
    allInserts.push({ table, row });
    return Promise.resolve({ error: null });
  };
  return chain;
}

vi.mock("@/lib/supabase-admin", () => ({
  isAdminSupabaseConfigured: () => true,
  getAdminSupabase: () => ({
    from: (t: string) => makeChain(t),
    rpc: (name: string, args: Record<string, unknown>) => {
      rpcCalls.push({ fn: name, args });
      if (rpcThrowFor.has(name)) {
        return Promise.reject(new Error(`injected ${name} failure`));
      }
      if (name === "claim_stripe_event") {
        if (claimRpcError) return Promise.resolve({ data: null, error: claimRpcError });
        return Promise.resolve(claimRpc(args));
      }
      if (name === "finalize_stripe_event") return Promise.resolve(finalizeRpc(args));
      if (name === "release_stripe_event") return Promise.resolve(releaseRpc(args));
      if (name === "debit_credits") debitCalls.push(args);
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

function refundEvent(charge: Record<string, unknown>, id = "evt_1") {
  return { id, type: "charge.refunded", data: { object: charge } };
}

function checkoutEvent(session: Record<string, unknown>, id = "evt_checkout_1") {
  return { id, type: "checkout.session.completed", data: { object: session } };
}

/**
 * A credit_pack refund with NO payment_intent: resolveRefundContext needs
 * no Stripe API calls (metadata fully classifies it) and the observable
 * side effect is a single debit_credits RPC. No marketplace_orders row →
 * no RPC delegation → the generic claim is exercised.
 */
const creditPackCharge = {
  id: "ch_1",
  metadata: { product_type: "credit_pack", clerk_id: "clerk_1", coin_amount: "2000" },
  amount: 2000,
  amount_refunded: 1000,
  refunds: { data: [{ id: "re_1" }] },
};

const baseRows = {
  users: { data: { id: "u1" }, error: null },
  marketplace_orders: { data: null, error: null },
};

function resetClaimState() {
  debitCalls.length = 0;
  rpcCalls.length = 0;
  allInserts.length = 0;
  claimRows.clear();
  forcedClaimOutcome = null;
  claimRpcError = null;
  finalizeReturnsFalse = false;
  rpcThrowFor = new Set();
  agentRpcResult = { status: "ok" };
  tableRows = {};
  process.env.STRIPE_SECRET_KEY = "sk_test_x";
  process.env.STRIPE_WEBHOOK_SECRET = "whsec_x";
}

const claimCalls = () => rpcCalls.filter((c) => c.fn === "claim_stripe_event");
const finalizeCalls = () => rpcCalls.filter((c) => c.fn === "finalize_stripe_event");
const releaseCalls = () => rpcCalls.filter((c) => c.fn === "release_stripe_event");

describe("stripe_events token-fenced claim (concurrent delivery)", () => {
  beforeEach(resetClaimState);

  it("first delivery claims with a UUID token, processes, and finalizes with the SAME token", async () => {
    tableRows = { ...baseRows };
    currentEvent = refundEvent(creditPackCharge);
    const res = await POST(req() as never);
    expect(res.status).toBe(200);
    expect(debitCalls).toHaveLength(1);

    expect(claimCalls()).toHaveLength(1);
    const token = claimCalls()[0].args.p_claim_token as string;
    expect(token).toMatch(/^[0-9a-f-]{36}$/);
    // stale_before ≈ now - 5min
    const staleBefore = new Date(claimCalls()[0].args.p_stale_before as string).getTime();
    expect(Date.now() - staleBefore).toBeGreaterThan(STALE_MS - 60_000);
    expect(Date.now() - staleBefore).toBeLessThan(STALE_MS + 60_000);

    expect(finalizeCalls()).toHaveLength(1);
    expect(finalizeCalls()[0].args.p_claim_token).toBe(token);
    expect(finalizeCalls()[0].args.p_result).toBe("processed");
    expect(finalizeCalls()[0].args.p_stripe_event_id).toBe("evt_1");
    expect(releaseCalls()).toHaveLength(0);
    // Row is terminally "processed" in the emulated store.
    expect(claimRows.get("evt_1")?.result).toBe("processed");
  });

  it("second delivery after finalize → 'duplicate' → replayed, no duplicate debit", async () => {
    tableRows = { ...baseRows };
    currentEvent = refundEvent(creditPackCharge);
    await POST(req() as never);
    expect(debitCalls).toHaveLength(1);

    const res = await POST(req() as never);
    expect(res.status).toBe(200);
    expect((await res.json()).replayed).toBe(true);
    expect(debitCalls).toHaveLength(1); // no duplicate debit
    expect(claimCalls()).toHaveLength(2);
    expect(finalizeCalls()).toHaveLength(1); // second delivery never finalized
  });

  it("concurrent delivery while first still processing → 'in_progress' → replayed, no duplicate work", async () => {
    tableRows = { ...baseRows };
    // Simulate: first delivery claimed but hasn't finalized yet.
    claimRows.set("evt_1", { token: "other-worker-token", result: "processing", processedAtMs: Date.now() });
    forcedClaimOutcome = null;
    currentEvent = refundEvent(creditPackCharge);
    const res = await POST(req() as never);
    expect(res.status).toBe(200);
    expect((await res.json()).replayed).toBe(true);
    expect(debitCalls).toHaveLength(0);
    expect(finalizeCalls()).toHaveLength(0);
  });

  it("claim RPC returns 'duplicate' → replayed ack, no side effects", async () => {
    tableRows = { ...baseRows };
    forcedClaimOutcome = "duplicate";
    currentEvent = refundEvent(creditPackCharge);
    const res = await POST(req() as never);
    expect(res.status).toBe(200);
    expect(debitCalls).toHaveLength(0);
  });

  it("claim RPC error (e.g. migration not applied) → 500 so Stripe retries", async () => {
    tableRows = { ...baseRows };
    claimRpcError = { message: "function claim_stripe_event does not exist" };
    currentEvent = refundEvent(creditPackCharge);
    const res = await POST(req() as never);
    expect(res.status).toBe(500);
    expect(debitCalls).toHaveLength(0);
    expect(finalizeCalls()).toHaveLength(0);
  });

  it("stale 'processing' claim is taken over by a new token and reprocessed", async () => {
    tableRows = { ...baseRows };
    // Holder crashed >5min ago — claim is stale.
    claimRows.set("evt_1", {
      token: "dead-worker-token",
      result: "processing",
      processedAtMs: Date.now() - STALE_MS - 60_000,
    });
    currentEvent = refundEvent(creditPackCharge);
    const res = await POST(req() as never);
    expect(res.status).toBe(200);
    expect(debitCalls).toHaveLength(1); // abandoned work completed exactly once

    const newToken = claimCalls()[0].args.p_claim_token as string;
    expect(newToken).not.toBe("dead-worker-token");
    expect(claimRows.get("evt_1")?.token).toBe(newToken);
    expect(finalizeCalls()[0].args.p_claim_token).toBe(newToken);
  });

  it("stale-owner fencing: a worker that lost its claim cannot finalize the event", async () => {
    tableRows = { ...baseRows };
    // Worker A claims, then its claim goes stale and worker B takes over.
    claimRows.set("evt_1", { token: "token-A", result: "processing", processedAtMs: Date.now() - STALE_MS - 60_000 });
    // This delivery = worker B: claim takes over with a fresh token.
    currentEvent = refundEvent(creditPackCharge);
    const res = await POST(req() as never);
    expect(res.status).toBe(200);

    const tokenB = claimCalls()[0].args.p_claim_token as string;
    // B's finalize succeeds because B owns the row now.
    expect(finalizeCalls()[0].args.p_claim_token).toBe(tokenB);
    expect(claimRows.get("evt_1")?.result).toBe("processed");

    // Now prove the fencing directly: finalize with A's OLD token must fail.
    const staleFinalize = finalizeRpc({
      p_stripe_event_id: "evt_1",
      p_claim_token: "token-A",
      p_result: "processed",
    });
    expect(staleFinalize.data).toBe(false);
  });

  it("processing error → release_stripe_event with the claim token → Stripe retry claims fresh", async () => {
    tableRows = { ...baseRows };
    // grant_credits is awaited bare in the credit-pack grant path — an RPC
    // failure there reaches the route's catch (debit_credits deliberately
    // swallows its own errors and cannot exercise this path).
    rpcThrowFor = new Set(["grant_credits"]);
    currentEvent = checkoutEvent({
      id: "cs_err_1",
      amount_total: 999,
      currency: "usd",
      payment_intent: "pi_err_1",
      customer: "cus_1",
      metadata: { product_type: "credit_pack", clerk_id: "clerk_1", coin_amount: "500" },
    }, "evt_err_1");
    const res = await POST(req() as never);
    expect(res.status).toBe(500);

    const token = claimCalls()[0].args.p_claim_token as string;
    expect(releaseCalls()).toHaveLength(1);
    expect(releaseCalls()[0].args.p_claim_token).toBe(token);
    expect(releaseCalls()[0].args.p_stripe_event_id).toBe("evt_err_1");
    // Row deleted — a retry can claim it fresh.
    expect(claimRows.has("evt_err_1")).toBe(false);
    expect(finalizeCalls()).toHaveLength(0);

    // Retry after the fault clears → owned again, grant succeeds once.
    rpcThrowFor = new Set();
    const grantsBefore = rpcCalls.filter((c) => c.fn === "grant_credits").length;
    const retry = await POST(req() as never);
    expect(retry.status).toBe(200);
    expect(rpcCalls.filter((c) => c.fn === "grant_credits").length).toBe(grantsBefore + 1);
    expect(claimCalls()).toHaveLength(2);
    expect(finalizeCalls()).toHaveLength(1);
  });

  it("finalize returning false (claim lost mid-processing) still acks 200 — new owner finalizes", async () => {
    tableRows = { ...baseRows };
    finalizeReturnsFalse = true;
    currentEvent = refundEvent(creditPackCharge);
    const res = await POST(req() as never);
    expect(res.status).toBe(200);
    expect(debitCalls).toHaveLength(1); // side effects ran; fencing only blocks the mark
    expect(finalizeCalls()).toHaveLength(1);
  });

  it("release RPC failure on error path is non-fatal — still 500 for Stripe retry", async () => {
    tableRows = { ...baseRows };
    // Both the side effect AND the release fail — the route must still
    // return 500 (Stripe retries; the stale claim expires and is reclaimable).
    rpcThrowFor = new Set(["grant_credits", "release_stripe_event"]);
    currentEvent = checkoutEvent({
      id: "cs_err_2",
      amount_total: 999,
      currency: "usd",
      payment_intent: "pi_err_2",
      customer: "cus_1",
      metadata: { product_type: "credit_pack", clerk_id: "clerk_1", coin_amount: "500" },
    }, "evt_err_2");
    const res = await POST(req() as never);
    expect(res.status).toBe(500);
    expect(releaseCalls()).toHaveLength(1); // release was attempted
    expect(finalizeCalls()).toHaveLength(0);
  });
});

describe("self-claiming RPC delegation (agent purchase/refund) — no claim collision", () => {
  beforeEach(resetClaimState);

  it("checkout.session.completed (agent) skips claim/finalize/release and calls fulfill_agent_purchase", async () => {
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
    // The generic claim must NOT fire — the RPC's own claim is the sole gate.
    expect(claimCalls()).toHaveLength(0);
    expect(finalizeCalls()).toHaveLength(0);
    expect(releaseCalls()).toHaveLength(0);
    expect(allInserts.filter((i) => i.table === "stripe_events")).toHaveLength(0);
  });

  it("checkout.session.completed (agent) 'already_processed' still provisions (idempotent)", async () => {
    tableRows = {
      users: { data: { id: "u1" }, error: null },
      user_agents: { data: null, error: null },
      agents: { data: { display_name: "Test Agent" }, error: null },
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
    expect(allInserts.filter((i) => i.table === "user_agents")).toHaveLength(1);
    expect(claimCalls()).toHaveLength(0);
  });

  it("charge.refunded matching a marketplace order skips generic claim, calls refund_agent_purchase", async () => {
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
    expect(claimCalls()).toHaveLength(0);
    expect(finalizeCalls()).toHaveLength(0);
    expect(debitCalls).toHaveLength(0); // agent refunds never debit LBC
  });

  it("charge.refunded with no marketplace order (credit pack) takes the generic claim", async () => {
    tableRows = {
      marketplace_orders: { data: null, error: null },
      users: { data: { id: "u1" }, error: null },
    };
    currentEvent = refundEvent(creditPackCharge);
    const res = await POST(req() as never);
    expect(res.status).toBe(200);
    expect(rpcCalls.map((c) => c.fn)).not.toContain("refund_agent_purchase");
    // Positive control: non-agent events DO take the generic claim.
    expect(claimCalls()).toHaveLength(1);
    expect(finalizeCalls()).toHaveLength(1);
    expect(debitCalls).toHaveLength(1);
  });
});
