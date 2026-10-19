/**
 * Option B — settled-invoice webhook grant tests (PRIORITY 2, owner-approved 2026-10-19).
 *
 * Binding owner decisions under test:
 *   - Subscription credits are determined by confirmed payment (invoice.paid
 *     only), priced from the invoice — never from webhook arrival order and
 *     never from the stored plan when the invoice names a price.
 *   - $0 invoices (trial, 100% coupon, balance-covered) grant nothing.
 *   - A paid Creator→Pro upgrade grants only the prorated difference
 *     (18,000 − 7,500 = 10,500), never a second full allocation.
 *   - A failed credit grant returns HTTP 500 and the event is NOT marked
 *     processed, so Stripe retries; the grant is never silently discarded.
 *   - invoice.paid before the subscriptions row exists resolves the user via
 *     the created/updated fallback (metadata clerk_id → users, else Stripe
 *     customer match); unresolvable → 500.
 *   - Cancellation never debits or shortens earned credits.
 *
 * The Supabase fake implements the REAL grant_credits contract:
 * RETURNS TABLE(granted BOOLEAN, total_after INTEGER) → PostgREST array of
 * rows, idempotent on p_idempotency_key (a replayed key returns
 * granted=false and inserts nothing). No real Stripe/Supabase calls.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ─── Top-level mocks ─────────────────────────────────────────────────

vi.mock("@/lib/supabase", () => ({
  getSupabaseAdmin: vi.fn(),
  supabaseAdmin: null,
}));
vi.mock("@/lib/supabase-admin", () => ({
  getAdminSupabase: vi.fn(),
  isAdminSupabaseConfigured: vi.fn(),
}));

const mockConstructEvent = vi.fn();
vi.mock("stripe", () => ({
  default: vi.fn().mockImplementation(() => ({
    webhooks: { constructEvent: mockConstructEvent },
  })),
}));

import { getAdminSupabase, isAdminSupabaseConfigured } from "@/lib/supabase-admin";

// ─── Fixtures ────────────────────────────────────────────────────────

const CREATOR_PRICE = "price_creator_test";
const PRO_PRICE = "price_pro_test";
const PERIOD_START = 1700000000;
const PERIOD_END = 1702678400;
const USER_1 = "user_internal_1";
const USER_9 = "user_internal_9";

function makeWebhookRequest(body = "body"): any {
  return {
    method: "POST",
    headers: {
      get: (name: string) => (name === "stripe-signature" ? "sig" : null),
    },
    text: async () => body,
    json: async () => JSON.parse(body),
    url: "http://localhost/api/stripe/webhook",
    nextUrl: { hostname: "localhost" },
    cookies: { get: () => undefined },
  } as any;
}

function makeInvoice(overrides: any = {}): any {
  return {
    id: "in_base",
    billing_reason: "subscription_cycle",
    amount_paid: 1500,
    total: 1500,
    customer: "cus_1",
    parent: {
      subscription_details: { subscription: "sub_1", metadata: {} },
    },
    lines: {
      data: [
        {
          amount: 1500,
          price: CREATOR_PRICE,
          period: { start: PERIOD_START, end: PERIOD_END },
        },
      ],
    },
    ...overrides,
  };
}

function upgradeInvoice(overrides: any = {}): any {
  return makeInvoice({
    id: "in_upgrade",
    billing_reason: "subscription_update",
    amount_paid: 800,
    total: 800,
    lines: {
      data: [
        {
          amount: -700,
          pricing: { price_details: { price: CREATOR_PRICE } },
          period: { start: PERIOD_START, end: PERIOD_END },
        },
        {
          amount: 1500,
          price: PRO_PRICE,
          period: { start: PERIOD_START, end: PERIOD_END },
        },
      ],
    },
    ...overrides,
  });
}

function subscriptionUpdatedEvent(planId: string): any {
  return {
    id: `evt_updated_${planId}`,
    type: "customer.subscription.updated",
    data: {
      object: {
        id: "sub_1",
        status: "active",
        customer: "cus_1",
        metadata: { clerk_id: "clerk_1", plan_id: planId },
        items: {
          data: [
            {
              current_period_start: PERIOD_START,
              current_period_end: PERIOD_END,
            },
          ],
        },
      },
    },
  };
}

// ─── Stateful fake Supabase (real grant_credits semantics) ───────────

function buildFakeSupabase() {
  const processedEvents = new Set<string>();
  const subsBySubId = new Map<string, any>();
  const usersByClerkId = new Map<string, { id: string }>();
  const ledger = new Map<
    string,
    { user_id: string; amount: number; params: any }
  >();
  const rpcCalls: { fn: string; params: any }[] = [];
  const updates: { table: string; patch: any; matches: any[] }[] = [];
  const upserts: { table: string; row: any }[] = [];
  let grantFailure: "none" | "error" | "empty" = "none";

  const balance = (userId: string) => {
    let total = 0;
    for (const entry of ledger.values()) {
      if (entry.user_id === userId) total += entry.amount;
    }
    return total;
  };

  function resolveSingle(table: string, filters: Record<string, any>) {
    if (table === "stripe_events") {
      return processedEvents.has(filters.stripe_event_id)
        ? { id: "evt_row" }
        : null;
    }
    if (table === "users") {
      return usersByClerkId.get(filters.clerk_id) ?? null;
    }
    if (table === "subscriptions") {
      if (filters.stripe_subscription_id) {
        return subsBySubId.get(filters.stripe_subscription_id) ?? null;
      }
      if (filters.stripe_customer_id) {
        for (const row of subsBySubId.values()) {
          if (row.stripe_customer_id === filters.stripe_customer_id) return row;
        }
        return null;
      }
      return null;
    }
    return null;
  }

  function chain(table: string): any {
    const filters: Record<string, any> = {};
    const builder: any = {
      select: () => builder,
      eq: (col: string, val: any) => {
        filters[col] = val;
        return builder;
      },
      single: async () => ({
        data: resolveSingle(table, filters),
        error: null,
      }),
      maybeSingle: async () => ({
        data: resolveSingle(table, filters),
        error: null,
      }),
      upsert: async (row: any) => {
        upserts.push({ table, row });
        if (table === "subscriptions" && row.stripe_subscription_id) {
          subsBySubId.set(row.stripe_subscription_id, { ...row });
        }
        return { error: null };
      },
      insert: async (row: any) => {
        if (table === "stripe_events") {
          processedEvents.add(row.stripe_event_id);
        }
        return { error: null };
      },
      update: (patch: any) => {
        const matches: { col: string; val: any }[] = [];
        const updateBuilder: any = {
          eq: (col: string, val: any) => {
            matches.push({ col, val });
            return updateBuilder;
          },
          then: (resolve: (value: any) => void) => {
            updates.push({ table, patch, matches: [...matches] });
            if (table === "subscriptions") {
              for (const row of subsBySubId.values()) {
                const hit = matches.some(
                  (m) =>
                    (m.col === "user_id" && row.user_id === m.val) ||
                    (m.col === "stripe_subscription_id" &&
                      row.stripe_subscription_id === m.val),
                );
                if (hit) Object.assign(row, patch);
              }
            }
            resolve({ error: null });
          },
        };
        return updateBuilder;
      },
    };
    return builder;
  }

  const sb = {
    from: vi.fn((table: string) => chain(table)),
    rpc: vi.fn(async (fnName: string, params: any) => {
      rpcCalls.push({ fn: fnName, params });
      if (fnName === "grant_credits") {
        if (grantFailure === "error") {
          return {
            data: null,
            error: { message: "injected grant_credits failure" },
          };
        }
        if (grantFailure === "empty") {
          return { data: [], error: null };
        }
        const key = params.p_idempotency_key as string;
        if (ledger.has(key)) {
          return {
            data: [{ granted: false, total_after: balance(params.p_user_id) }],
            error: null,
          };
        }
        ledger.set(key, {
          user_id: params.p_user_id,
          amount: params.p_amount,
          params,
        });
        return {
          data: [{ granted: true, total_after: balance(params.p_user_id) }],
          error: null,
        };
      }
      return { data: null, error: null };
    }),
  };

  return {
    sb,
    processedEvents,
    subsBySubId,
    usersByClerkId,
    ledger,
    rpcCalls,
    updates,
    upserts,
    balance,
    setGrantFailure: (mode: "none" | "error" | "empty") => {
      grantFailure = mode;
    },
    grantCalls: () => rpcCalls.filter((c) => c.fn === "grant_credits"),
    seedSubscription: (row: any) => {
      subsBySubId.set(row.stripe_subscription_id, { ...row });
    },
  };
}

type Fake = ReturnType<typeof buildFakeSupabase>;

function wire(fake: Fake) {
  vi.mocked(isAdminSupabaseConfigured).mockReturnValue(true);
  vi.mocked(getAdminSupabase).mockReturnValue(fake.sb as any);
}

async function postEvent(event: any) {
  mockConstructEvent.mockReturnValue(event);
  const { POST } = await import("@/app/api/stripe/webhook/route");
  return POST(makeWebhookRequest());
}

function seedCreatorSubscription(fake: Fake) {
  fake.seedSubscription({
    user_id: USER_1,
    plan: "creator_beta",
    stripe_subscription_id: "sub_1",
    stripe_customer_id: "cus_1",
    status: "active",
  });
}

// ─── Setup/teardown ──────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  mockConstructEvent.mockReset();
  process.env.STRIPE_SECRET_KEY = "sk_test_secret";
  process.env.STRIPE_WEBHOOK_SECRET = "whsec_test";
  process.env.STRIPE_PRICE_CREATOR_BETA = CREATOR_PRICE;
  process.env.STRIPE_PRICE_PRO_BUILDER_BETA = PRO_PRICE;
});

afterEach(() => {
  delete process.env.STRIPE_SECRET_KEY;
  delete process.env.STRIPE_WEBHOOK_SECRET;
  delete process.env.STRIPE_PRICE_CREATOR_BETA;
  delete process.env.STRIPE_PRICE_PRO_BUILDER_BETA;
});

// ═════════════════════════════════════════════════════════════════════
// DUPLICATE DELIVERY
// ═════════════════════════════════════════════════════════════════════

describe("duplicate delivery", () => {
  it("same invoice.paid event twice → exactly one grant under invoice_grant_{id}", async () => {
    const fake = buildFakeSupabase();
    wire(fake);
    seedCreatorSubscription(fake);

    const event = {
      id: "evt_dup",
      type: "invoice.paid",
      data: { object: makeInvoice() },
    };

    const res1 = await postEvent(event);
    expect(res1.status).toBe(200);
    expect(fake.grantCalls().length).toBe(1);
    const grant = fake.grantCalls()[0];
    expect(grant.params.p_amount).toBe(7500);
    expect(grant.params.p_idempotency_key).toBe("invoice_grant_in_base");
    expect(grant.params.p_category).toBe("subscription_grant");
    expect(grant.params.p_balance_bucket).toBe("monthly");
    // Expiry honors the invoice's billing period end.
    expect(grant.params.p_expires_at).toBe(
      new Date(PERIOD_END * 1000).toISOString(),
    );
    expect(fake.balance(USER_1)).toBe(7500);

    const res2 = await postEvent(event);
    expect(res2.status).toBe(200);
    const body2 = await res2.json();
    expect(body2.replayed).toBe(true);
    // No second grant attempt, ledger unchanged.
    expect(fake.grantCalls().length).toBe(1);
    expect(fake.ledger.size).toBe(1);
    expect(fake.balance(USER_1)).toBe(7500);
  });

  it("concurrent pair (two event ids, same invoice) → ledger holds exactly one grant", async () => {
    const fake = buildFakeSupabase();
    wire(fake);
    seedCreatorSubscription(fake);

    const invoice = makeInvoice();
    const evtA = { id: "evt_conc_a", type: "invoice.paid", data: { object: invoice } };
    const evtB = { id: "evt_conc_b", type: "invoice.paid", data: { object: invoice } };

    mockConstructEvent
      .mockReturnValueOnce(evtA)
      .mockReturnValueOnce(evtB);
    const { POST } = await import("@/app/api/stripe/webhook/route");
    const [resA, resB] = await Promise.all([
      POST(makeWebhookRequest()),
      POST(makeWebhookRequest()),
    ]);
    expect(resA.status).toBe(200);
    expect(resB.status).toBe(200);
    // Both deliveries may reach the RPC, but the idempotency key admits
    // exactly one ledger grant (the fake enforces the real RPC contract).
    expect(fake.ledger.size).toBe(1);
    expect(fake.balance(USER_1)).toBe(7500);
    for (const call of fake.grantCalls()) {
      expect(call.params.p_idempotency_key).toBe("invoice_grant_in_base");
    }
  });
});

// ═════════════════════════════════════════════════════════════════════
// OUT-OF-ORDER CONVERGENCE
// ═════════════════════════════════════════════════════════════════════

describe("out-of-order convergence", () => {
  it("updated(Pro) BEFORE base invoice.paid(Creator) → 7,500 invoice-priced, then +10,500 upgrade → 18,000", async () => {
    const fake = buildFakeSupabase();
    wire(fake);
    fake.usersByClerkId.set("clerk_1", { id: USER_1 });

    // Subscription events land first and say Pro.
    const resUpd = await postEvent(subscriptionUpdatedEvent("pro_builder_beta"));
    expect(resUpd.status).toBe(200);
    expect(fake.subsBySubId.get("sub_1")?.plan).toBe("pro_builder_beta");
    expect(fake.grantCalls().length).toBe(0);

    // The settled base invoice prices Creator → grant 7,500, not 18,000.
    const resBase = await postEvent({
      id: "evt_oo_a_base",
      type: "invoice.paid",
      data: {
        object: makeInvoice({
          id: "in_creator_base",
          billing_reason: "subscription_create",
        }),
      },
    });
    expect(resBase.status).toBe(200);
    expect(fake.grantCalls().length).toBe(1);
    expect(fake.grantCalls()[0].params.p_amount).toBe(7500);
    expect(fake.grantCalls()[0].params.p_idempotency_key).toBe(
      "invoice_grant_in_creator_base",
    );
    expect(fake.balance(USER_1)).toBe(7500);

    // The settled upgrade invoice shows −Creator/+Pro → only the delta.
    const resUpg = await postEvent({
      id: "evt_oo_a_upg",
      type: "invoice.paid",
      data: { object: upgradeInvoice() },
    });
    expect(resUpg.status).toBe(200);
    expect(fake.grantCalls().length).toBe(2);
    expect(fake.grantCalls()[1].params.p_amount).toBe(10500);
    expect(fake.grantCalls()[1].params.p_idempotency_key).toBe(
      "invoice_grant_in_upgrade",
    );
    expect(fake.grantCalls()[1].params.p_description).toContain("Plan upgrade");
    expect(fake.balance(USER_1)).toBe(18000);
  });

  it("reverse permutation (upgrade invoice settles first) → same final 18,000", async () => {
    const fake = buildFakeSupabase();
    wire(fake);
    seedCreatorSubscription(fake);

    const resUpg = await postEvent({
      id: "evt_oo_b_upg",
      type: "invoice.paid",
      data: { object: upgradeInvoice() },
    });
    expect(resUpg.status).toBe(200);
    expect(fake.grantCalls().length).toBe(1);
    expect(fake.grantCalls()[0].params.p_amount).toBe(10500);
    expect(fake.balance(USER_1)).toBe(10500);

    const resBase = await postEvent({
      id: "evt_oo_b_base",
      type: "invoice.paid",
      data: {
        object: makeInvoice({
          id: "in_creator_base",
          billing_reason: "subscription_create",
        }),
      },
    });
    expect(resBase.status).toBe(200);
    expect(fake.grantCalls().length).toBe(2);
    expect(fake.grantCalls()[1].params.p_amount).toBe(7500);
    expect(fake.balance(USER_1)).toBe(18000);
  });
});

// ═════════════════════════════════════════════════════════════════════
// UNPAID UPGRADE
// ═════════════════════════════════════════════════════════════════════

describe("unpaid upgrade", () => {
  it("updated(Pro) with no settled upgrade invoice → no grant; later Creator renewal grants 7,500, not 18,000", async () => {
    const fake = buildFakeSupabase();
    wire(fake);
    fake.usersByClerkId.set("clerk_1", { id: USER_1 });
    seedCreatorSubscription(fake);

    const resUpd = await postEvent(subscriptionUpdatedEvent("pro_builder_beta"));
    expect(resUpd.status).toBe(200);
    expect(fake.subsBySubId.get("sub_1")?.plan).toBe("pro_builder_beta");
    expect(fake.grantCalls().length).toBe(0);

    // The upgrade invoice fails to pay.
    const resFail = await postEvent({
      id: "evt_upg_payfail",
      type: "invoice.payment_failed",
      data: {
        object: {
          id: "in_upgrade",
          parent: {
            subscription_details: { subscription: "sub_1", metadata: {} },
          },
        },
      },
    });
    expect(resFail.status).toBe(200);
    expect(fake.grantCalls().length).toBe(0);
    expect(fake.balance(USER_1)).toBe(0);

    // A later settled Creator renewal is priced from the invoice: 7,500 —
    // the stored Pro plan must not inflate it to 18,000.
    const resRenew = await postEvent({
      id: "evt_renew_creator",
      type: "invoice.paid",
      data: { object: makeInvoice({ id: "in_renewal" }) },
    });
    expect(resRenew.status).toBe(200);
    expect(fake.grantCalls().length).toBe(1);
    expect(fake.grantCalls()[0].params.p_amount).toBe(7500);
    expect(fake.balance(USER_1)).toBe(7500);
  });
});

// ═════════════════════════════════════════════════════════════════════
// $0 INVOICES
// ═════════════════════════════════════════════════════════════════════

describe("$0 invoices grant nothing", () => {
  it("trial invoice (amount_paid 0, total 0) → no grant, event processed", async () => {
    const fake = buildFakeSupabase();
    wire(fake);
    seedCreatorSubscription(fake);

    const res = await postEvent({
      id: "evt_trial",
      type: "invoice.paid",
      data: {
        object: makeInvoice({
          id: "in_trial",
          billing_reason: "subscription_create",
          amount_paid: 0,
          total: 0,
        }),
      },
    });
    expect(res.status).toBe(200);
    expect(fake.grantCalls().length).toBe(0);
    expect(fake.balance(USER_1)).toBe(0);
    expect(fake.processedEvents.has("evt_trial")).toBe(true);
  });

  it("100%-coupon / balance-covered invoice (amount_paid 0, total > 0) → no grant", async () => {
    const fake = buildFakeSupabase();
    wire(fake);
    seedCreatorSubscription(fake);

    const res = await postEvent({
      id: "evt_coupon",
      type: "invoice.paid",
      data: {
        object: makeInvoice({
          id: "in_coupon",
          amount_paid: 0,
          total: 1500,
        }),
      },
    });
    expect(res.status).toBe(200);
    expect(fake.grantCalls().length).toBe(0);
    expect(fake.balance(USER_1)).toBe(0);
    expect(fake.processedEvents.has("evt_coupon")).toBe(true);
  });
});

// ═════════════════════════════════════════════════════════════════════
// GRANT FAILURE SEMANTICS
// ═════════════════════════════════════════════════════════════════════

describe("grant failure semantics", () => {
  it("grant_credits RPC error → HTTP 500, event NOT marked processed; redelivery then grants exactly once", async () => {
    const fake = buildFakeSupabase();
    wire(fake);
    seedCreatorSubscription(fake);
    fake.setGrantFailure("error");

    const event = {
      id: "evt_grant_fail",
      type: "invoice.paid",
      data: { object: makeInvoice({ id: "in_fail" }) },
    };

    const res1 = await postEvent(event);
    expect(res1.status).toBe(500);
    expect(fake.processedEvents.has("evt_grant_fail")).toBe(false);
    expect(fake.ledger.size).toBe(0);
    expect(fake.balance(USER_1)).toBe(0);

    fake.setGrantFailure("none");
    const res2 = await postEvent(event);
    expect(res2.status).toBe(200);
    expect(fake.processedEvents.has("evt_grant_fail")).toBe(true);
    expect(fake.ledger.size).toBe(1);
    expect(fake.balance(USER_1)).toBe(7500);

    // A further redelivery is a replay: still exactly one grant.
    const res3 = await postEvent(event);
    expect(res3.status).toBe(200);
    expect(fake.ledger.size).toBe(1);
    expect(fake.balance(USER_1)).toBe(7500);
  });

  it("grant_credits returns no grant row → HTTP 500, event NOT marked processed", async () => {
    const fake = buildFakeSupabase();
    wire(fake);
    seedCreatorSubscription(fake);
    fake.setGrantFailure("empty");

    const res = await postEvent({
      id: "evt_grant_empty",
      type: "invoice.paid",
      data: { object: makeInvoice({ id: "in_empty" }) },
    });
    expect(res.status).toBe(500);
    expect(fake.processedEvents.has("evt_grant_empty")).toBe(false);
    expect(fake.ledger.size).toBe(0);
  });
});
// ═════════════════════════════════════════════════════════════════════
// MISSING SUBSCRIPTION ROW
// ═════════════════════════════════════════════════════════════════════

describe("missing subscription row", () => {
  it("resolves via subscription metadata clerk_id → users and grants, invoice-priced", async () => {
    const fake = buildFakeSupabase();
    wire(fake);
    fake.usersByClerkId.set("clerk_9", { id: USER_9 });
    // No subscriptions row seeded.

    const res = await postEvent({
      id: "evt_missing_meta",
      type: "invoice.paid",
      data: {
        object: makeInvoice({
          id: "in_early",
          billing_reason: "subscription_create",
          customer: "cus_9",
          parent: {
            subscription_details: {
              subscription: "sub_1",
              metadata: { clerk_id: "clerk_9" },
            },
          },
        }),
      },
    });
    expect(res.status).toBe(200);
    expect(fake.grantCalls().length).toBe(1);
    expect(fake.grantCalls()[0].params.p_user_id).toBe(USER_9);
    expect(fake.grantCalls()[0].params.p_amount).toBe(7500);
    expect(fake.grantCalls()[0].params.p_idempotency_key).toBe(
      "invoice_grant_in_early",
    );
    expect(fake.balance(USER_9)).toBe(7500);
  });

  it("resolves via Stripe customer match when no metadata is present", async () => {
    const fake = buildFakeSupabase();
    wire(fake);
    // A different subscription row carries the same Stripe customer.
    fake.seedSubscription({
      user_id: USER_9,
      plan: "creator_beta",
      stripe_subscription_id: "sub_other",
      stripe_customer_id: "cus_9",
      status: "active",
    });

    const res = await postEvent({
      id: "evt_missing_cust",
      type: "invoice.paid",
      data: {
        object: makeInvoice({
          id: "in_cust_match",
          customer: "cus_9",
          parent: {
            subscription_details: { subscription: "sub_1", metadata: {} },
          },
        }),
      },
    });
    expect(res.status).toBe(200);
    expect(fake.grantCalls().length).toBe(1);
    expect(fake.grantCalls()[0].params.p_user_id).toBe(USER_9);
    expect(fake.balance(USER_9)).toBe(7500);
  });

  it("unresolvable user → HTTP 500, event NOT marked processed, no grant", async () => {
    const fake = buildFakeSupabase();
    wire(fake);
    // No users, no subscription rows, unknown customer.

    const res = await postEvent({
      id: "evt_missing_none",
      type: "invoice.paid",
      data: {
        object: makeInvoice({
          id: "in_orphan",
          customer: "cus_unknown",
          parent: {
            subscription_details: { subscription: "sub_1", metadata: {} },
          },
        }),
      },
    });
    expect(res.status).toBe(500);
    expect(fake.processedEvents.has("evt_missing_none")).toBe(false);
    expect(fake.grantCalls().length).toBe(0);
    expect(fake.ledger.size).toBe(0);
  });
});

// ═════════════════════════════════════════════════════════════════════
// CANCELLATION + DOWNGRADE
// ═════════════════════════════════════════════════════════════════════

describe("cancellation never touches earned credits", () => {
  it("subscription.deleted after a grant → no debit, balance unchanged", async () => {
    const fake = buildFakeSupabase();
    wire(fake);
    seedCreatorSubscription(fake);

    const resGrant = await postEvent({
      id: "evt_pre_cancel",
      type: "invoice.paid",
      data: { object: makeInvoice({ id: "in_pre_cancel" }) },
    });
    expect(resGrant.status).toBe(200);
    expect(fake.balance(USER_1)).toBe(7500);

    const resDel = await postEvent({
      id: "evt_cancel",
      type: "customer.subscription.deleted",
      data: { object: { id: "sub_1" } },
    });
    expect(resDel.status).toBe(200);
    expect(fake.subsBySubId.get("sub_1")?.status).toBe("canceled");
    // No debit RPC of any kind; the earned grant stands untouched.
    expect(
      fake.rpcCalls.filter((c) => c.fn === "debit_credits").length,
    ).toBe(0);
    expect(fake.ledger.size).toBe(1);
    expect(fake.balance(USER_1)).toBe(7500);
  });
});

describe("settled downgrade update grants nothing", () => {
  it("subscription_update invoice with −Pro/+Creator lines → no grant (delta ≤ 0)", async () => {
    const fake = buildFakeSupabase();
    wire(fake);
    fake.seedSubscription({
      user_id: USER_1,
      plan: "pro_builder_beta",
      stripe_subscription_id: "sub_1",
      stripe_customer_id: "cus_1",
      status: "active",
    });

    const res = await postEvent({
      id: "evt_downgrade",
      type: "invoice.paid",
      data: {
        object: makeInvoice({
          id: "in_downgrade",
          billing_reason: "subscription_update",
          amount_paid: 1, // nonzero so the $0 guard cannot mask the delta branch
          total: 1,
          lines: {
            data: [
              {
                amount: -1500,
                price: PRO_PRICE,
                period: { start: PERIOD_START, end: PERIOD_END },
              },
              {
                amount: 700,
                price: CREATOR_PRICE,
                period: { start: PERIOD_START, end: PERIOD_END },
              },
            ],
          },
        }),
      },
    });
    expect(res.status).toBe(200);
    expect(fake.grantCalls().length).toBe(0);
    expect(fake.balance(USER_1)).toBe(0);
    expect(fake.processedEvents.has("evt_downgrade")).toBe(true);
  });
});
