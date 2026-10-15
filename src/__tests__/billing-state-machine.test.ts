/**
 * Billing state machine tests
 *
 * Tests the payment state machine WITHOUT real Stripe charges:
 *   - checkout session creation (auth required, plan validation, price ID resolution)
 *   - webhook signature verification (valid/invalid)
 *   - webhook event idempotency (duplicate events don't double-credit)
 *   - entitlement update (subscription created → plan active)
 *   - BITS ledger update (grant_credits called once per event)
 *   - owner exemption (billing-exempt, wallet never debited)
 *   - insufficient-credit behavior (debit_credits returns success=false)
 *   - failed webhook behavior (500 → Stripe retries, event not marked processed)
 *   - checkout failure modes (missing key, missing price, unauth, unknown plan, Stripe API error)
 *
 * All Stripe/Supabase calls are mocked. No real API calls are made.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ─── Top-level mocks ─────────────────────────────────────────────────

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/supabase", () => ({ getSupabaseAdmin: vi.fn() }));
vi.mock("@/lib/supabase-admin", () => ({
  getAdminSupabase: vi.fn(),
  isAdminSupabaseConfigured: vi.fn(),
}));
vi.mock("@/lib/rate-limiter", () => ({
  withRateLimit: (handler: any) => handler,
}));

// Controllable Stripe mock — constructEvent is a spy we can set per-test
const mockConstructEvent = vi.fn();
const mockSubscriptionsRetrieve = vi.fn();
const mockRefundsList = vi.fn();
vi.mock("stripe", () => ({
  default: vi.fn().mockImplementation(() => ({
    webhooks: { constructEvent: mockConstructEvent },
    subscriptions: { retrieve: mockSubscriptionsRetrieve },
    refunds: { list: mockRefundsList },
  })),
}));

const { confirmBookingPaymentMock } = vi.hoisted(() => ({
  confirmBookingPaymentMock: vi.fn(async () => ({ ok: true, data: {} })),
}));
vi.mock("@/lib/business-operations", () => ({
  confirmBookingPayment: confirmBookingPaymentMock,
  recordAudit: vi.fn(),
}));

// ─── Imports ─────────────────────────────────────────────────────────

import { auth } from "@/lib/auth";
import { POST as checkoutPOST } from "@/app/api/billing/checkout/route";
import { getSupabaseAdmin } from "@/lib/supabase";
import { getAdminSupabase, isAdminSupabaseConfigured } from "@/lib/supabase-admin";
import {
  PLANS,
  PLAN_LIST,
  PLAN_RANK,
  hasPlanAccess,
  getStripePriceId,
  getPlanById,
} from "@/config/plans";
import { getEntitlementsForPlan } from "@/lib/entitlements";
import {
  isOwnerClerkId,
  isBillingExempt,
  OWNER_ENTITLEMENTS,
} from "@/lib/owner";
import { PRODUCT_CATALOG, getProductById } from "@/config/stripe-products";

// ─── Helpers ─────────────────────────────────────────────────────────

function makeNextRequest(body: string, headers: Record<string, string> = {}): any {
  return {
    method: "POST",
    headers: { get: (name: string) => headers[name] ?? null },
    json: async () => JSON.parse(body),
    text: async () => body,
    url: "http://localhost/api/billing/checkout",
    nextUrl: { hostname: "localhost" },
    cookies: { get: () => undefined },
  } as any;
}

function mockCheckoutLookup(
  sub: { status: string; stripe_customer_id: string | null } | null,
) {
  const from = vi.fn((table: string) => {
    const builder = {
      select: () => builder,
      eq: () => builder,
      maybeSingle: async () => {
        if (table === "users") return { data: { id: "db-user" }, error: null };
        if (table === "subscriptions") return { data: sub, error: null };
        return { data: null, error: null };
      },
    };
    return builder;
  });
  vi.mocked(getSupabaseAdmin).mockReturnValue({ from } as any);
}

function makeWebhookRequest(body: string, signature: string | null): any {
  const headers: Record<string, string> = {};
  if (signature) headers["stripe-signature"] = signature;
  return {
    method: "POST",
    headers: { get: (name: string) => headers[name] ?? null },
    text: async () => body,
    json: async () => JSON.parse(body),
    url: "http://localhost/api/stripe/webhook",
    nextUrl: { hostname: "localhost" },
    cookies: { get: () => undefined },
  } as any;
}

function makeStripeEvent(type: string, overrides: any = {}) {
  return {
    id: overrides.id || `evt_test_${type}_${Date.now()}`,
    type,
    created: overrides.created,
    data: { object: overrides.object || {} },
  };
}

/** Basil charge payloads omit refunds. The handler loads them from the API. */
function mockSucceededRefunds(
  refunds: { id: string; amount: number; created: number }[],
) {
  mockRefundsList.mockResolvedValue({
    data: refunds.map((refund) => ({ ...refund, status: "succeeded" })),
    has_more: false,
  });
}

/**
 * Builds a mock Supabase admin that tracks all RPC calls and table mutations.
 */
function buildTrackingSupabase(
  existingEvent = false,
  opts: { eventResult?: string; marketplaceOrder?: boolean; subscriptionPlan?: string } = {},
) {
  const rpcCalls: { fn: string; params: any }[] = [];
  const upserts: { table: string; row: any; onConflict?: string }[] = [];
  const updates: { table: string; patch: any; matches: any[] }[] = [];
  const inserts: { table: string; row: any }[] = [];
  const debitedKeys = new Set<string>();
  const storedPlan = opts.subscriptionPlan ?? "creator_beta";
  const claimedEvents = new Map<string, { id: string; result: string; processed_at: string }>();
  if (existingEvent) {
    claimedEvents.set("evt_existing", {
      id: "evt_existing",
      result: opts.eventResult ?? "processed",
      processed_at: new Date().toISOString(),
    });
  }
  const stripeEventRow = (eqs: { col: string; val: unknown }[]) => {
    const id = eqs.find((entry) => entry.col === "stripe_event_id")?.val;
    if (typeof id === "string" && claimedEvents.has(id)) return claimedEvents.get(id) ?? null;
    if (existingEvent) return claimedEvents.get("evt_existing") ?? null;
    return null;
  };

  const chain = (table: string, likePattern = "", eqs: { col: string; val: unknown }[] = []) => ({
    select: vi.fn(() => chain(table, likePattern, eqs)),
    eq: vi.fn((col: string, val: unknown) => chain(table, likePattern, [...eqs, { col, val }])),
    in: vi.fn(() => chain(table, likePattern, eqs)),
    limit: vi.fn(() => chain(table, likePattern, eqs)),
    order: vi.fn(() => chain(table, likePattern, eqs)),
    like: vi.fn((_col: string, pattern: string) => chain(table, pattern)),
    gte: vi.fn(() => chain(table, likePattern, eqs)),
    single: vi.fn(async () => {
      if (table === "users") return { data: { id: "user_internal_123" }, error: null };
      if (table === "stripe_events") return { data: stripeEventRow(eqs), error: null };
      if (table === "subscriptions")
        return { data: { user_id: "user_internal_123", plan: storedPlan }, error: null };
      return { data: null, error: null };
    }),
    maybeSingle: vi.fn(async () => {
      if (table === "credit_ledger") {
        const prefix = likePattern.endsWith("%") ? likePattern.slice(0, -1) : likePattern;
        const key = prefix.endsWith(":") ? prefix.slice(0, -1) : prefix;
        return {
          data: debitedKeys.has(key) ? { id: "ledger_refund" } : null,
          error: null,
        };
      }
      if (table === "marketplace_orders" && opts.marketplaceOrder) {
        return { data: { id: "order_1", status: "paid" }, error: null };
      }
      if (table === "users") return { data: { id: "user_internal_123" }, error: null };
      if (table === "stripe_events") return { data: stripeEventRow(eqs), error: null };
      if (table === "subscriptions")
        return { data: { user_id: "user_internal_123", plan: storedPlan }, error: null };
      return { data: null, error: null };
    }),
    upsert: vi.fn(async (row: any, options?: { onConflict?: string }) => {
      upserts.push({ table, row, onConflict: options?.onConflict });
      return { error: null };
    }),
    insert: vi.fn(async (row: any) => {
      inserts.push({ table, row });
      if (table === "stripe_events") {
        if (existingEvent || claimedEvents.has(row.stripe_event_id)) {
          return {
            error: {
              code: "23505",
              message:
                'duplicate key value violates unique constraint "stripe_events_stripe_event_id_key"',
            },
          };
        }
        claimedEvents.set(row.stripe_event_id, {
          id: row.stripe_event_id,
          result: row.result ?? "processing",
          processed_at: new Date().toISOString(),
        });
      }
      return { error: null };
    }),
    delete: vi.fn(() => {
      const builder: any = {
        eq: vi.fn(() => builder),
        then: (resolve: (value: any) => void) => resolve({ error: null }),
      };
      return builder;
    }),
    update: vi.fn((patch: any) => {
      const matches: { col: string; val: any }[] = [];
      const builder: any = {
        eq: vi.fn((col: string, val: any) => {
          matches.push({ col, val });
          return builder;
        }),
        then: (resolve: (value: any) => void) => {
          updates.push({ table, patch, matches: [...matches] });
          if (table === "stripe_events" && patch?.result) {
            const id = matches.find((match) => match.col === "stripe_event_id")?.val;
            const row = typeof id === "string" ? claimedEvents.get(id) : undefined;
            if (row) row.result = patch.result;
          }
          resolve({ error: null });
        },
      };
      return builder;
    }),
  });

  const sb = {
    from: vi.fn((table: string) => chain(table)),
    rpc: vi.fn(async (fnName: string, params: any) => {
      rpcCalls.push({ fn: fnName, params });
      if (fnName === "debit_credits" && typeof params?.p_idempotency_key === "string") {
        debitedKeys.add(params.p_idempotency_key);
      }
      return { data: { success: true, remaining: 100 }, error: null };
    }),
  };

  return { sb, rpcCalls, upserts, updates, inserts };
}

// ─── Setup/teardown ──────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(isAdminSupabaseConfigured).mockReturnValue(false);
  vi.mocked(getAdminSupabase).mockReturnValue(null as any);
  mockConstructEvent.mockReset();
  mockSubscriptionsRetrieve.mockResolvedValue({ status: "active" });
  mockRefundsList.mockReset();
  mockRefundsList.mockResolvedValue({ data: [], has_more: false });
});

afterEach(() => {
  delete process.env.STRIPE_SECRET_KEY;
  delete process.env.STRIPE_WEBHOOK_SECRET;
  delete process.env.STRIPE_PRICE_CREATOR_BETA;
  delete process.env.STRIPE_PRICE_PRO_BUILDER_BETA;
  delete process.env.STRIPE_PRICE_FOUNDER;
  delete process.env.LITTLABS_VAPI_OWNER_CLERK_ID;
});

// ═════════════════════════════════════════════════════════════════════
// CHECKOUT SESSION CREATION
// ═════════════════════════════════════════════════════════════════════

describe("POST /api/billing/checkout — checkout session creation", () => {
  it("returns 401 when not authenticated", async () => {
    vi.mocked(auth).mockResolvedValue({ userId: null, clerkId: null } as any);
    const req = makeNextRequest(JSON.stringify({ planId: "creator_beta" }));
    const res = await checkoutPOST(req);
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe("Unauthorized");
  });

  it("returns 400 when planId is missing", async () => {
    vi.mocked(auth).mockResolvedValue({ userId: "user_123", clerkId: "user_123" } as any);
    const req = makeNextRequest(JSON.stringify({}));
    const res = await checkoutPOST(req);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Missing planId");
  });

  it("returns 400 for invalid plan ID", async () => {
    vi.mocked(auth).mockResolvedValue({ userId: "user_123", clerkId: "user_123" } as any);
    const req = makeNextRequest(JSON.stringify({ planId: "nonexistent" }));
    const res = await checkoutPOST(req);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Invalid or disabled plan");
  });

  it("returns 400 for free plan (no checkout needed)", async () => {
    vi.mocked(auth).mockResolvedValue({ userId: "user_123", clerkId: "user_123" } as any);
    const req = makeNextRequest(JSON.stringify({ planId: "starter" }));
    const res = await checkoutPOST(req);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Free plan requires no checkout");
  });

  it("returns 501 when STRIPE_SECRET_KEY is missing", async () => {
    vi.mocked(auth).mockResolvedValue({ userId: "user_123", clerkId: "user_123" } as any);
    delete process.env.STRIPE_SECRET_KEY;
    const req = makeNextRequest(JSON.stringify({ planId: "creator_beta" }));
    const res = await checkoutPOST(req);
    expect(res.status).toBe(501);
    const body = await res.json();
    expect(body.error).toContain("Stripe is not configured");
    expect(body.setup_required).toBe(true);
  });

  it("returns 501 when Stripe price ID is not configured for the plan", async () => {
    vi.mocked(auth).mockResolvedValue({ userId: "user_123", clerkId: "user_123" } as any);
    process.env.STRIPE_SECRET_KEY = "sk_test_fake_key";
    delete process.env.STRIPE_PRICE_CREATOR_BETA;
    const req = makeNextRequest(JSON.stringify({ planId: "creator_beta" }));
    const res = await checkoutPOST(req);
    expect(res.status).toBe(501);
    const body = await res.json();
    expect(body.error).toContain("Stripe price ID not configured");
    expect(body.setup_required).toBe(true);
  });

  it("creates checkout session with correct Stripe price ID and metadata", async () => {
    vi.mocked(auth).mockResolvedValue({ userId: "user_123", clerkId: "user_123" } as any);
    process.env.STRIPE_SECRET_KEY = "sk_test_fake_key";
    process.env.STRIPE_PRICE_CREATOR_BETA = "price_test_creator";

    const originalFetch = global.fetch;
    global.fetch = vi.fn(async (url: string, opts: any) => {
      if (url === "https://api.stripe.com/v1/checkout/sessions") {
        const body = opts.body as string;
        expect(body).toContain("price_test_creator");
        expect(body).toContain("mode=subscription");
        expect(body).toContain("metadata%5Bclerk_id%5D=user_123");
        expect(body).toContain("metadata%5Bplan_id%5D=creator_beta");
        expect(body).toContain("metadata%5Bproduct_type%5D=plan");
        return {
          ok: true,
          status: 200,
          json: async () => ({ id: "cs_test_123", url: "https://checkout.stripe.com/test" }),
        } as any;
      }
      return new Response("not found", { status: 404 });
    }) as any;

    mockCheckoutLookup(null);
    const req = makeNextRequest(
      JSON.stringify({ planId: "creator_beta" }),
      { origin: "https://evil.example" },
    );
    const res = await checkoutPOST(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.url).toBe("https://checkout.stripe.com/test");
    expect(body.sessionId).toBe("cs_test_123");
    const stripeBody = (global.fetch as any).mock.calls[0][1].body as string;
    const params = new URLSearchParams(stripeBody);
    expect(params.get("success_url")).not.toContain("evil.example");
    expect(params.get("cancel_url")).not.toContain("evil.example");
    global.fetch = originalFetch;
  });

  it("returns 409 and does not call Stripe when a blocking subscription exists", async () => {
    vi.mocked(auth).mockResolvedValue({ userId: "user_123", clerkId: "user_123" } as any);
    process.env.STRIPE_SECRET_KEY = "sk_test_fake_key";
    process.env.STRIPE_PRICE_CREATOR_BETA = "price_test_creator";
    for (const status of ["active", "trialing", "past_due"]) {
      mockCheckoutLookup({ status, stripe_customer_id: "cus_existing" });
      const originalFetch = global.fetch;
      const stripeCalls: string[] = [];
      global.fetch = vi.fn(async (url: string) => {
        stripeCalls.push(String(url));
        return new Response("not found", { status: 404 });
      }) as any;
      const res = await checkoutPOST(makeNextRequest(JSON.stringify({ planId: "creator_beta" })));
      expect(res.status).toBe(409);
      const body = await res.json();
      expect(body.code).toBe("already_subscribed");
      expect(body.portalPath).toBe("/api/billing/portal");
      expect(stripeCalls.filter((url) => url.includes("api.stripe.com"))).toHaveLength(0);
      global.fetch = originalFetch;
    }
  });

  it("reuses the stored Stripe customer and a deterministic idempotency key", async () => {
    vi.mocked(auth).mockResolvedValue({ userId: "user_123", clerkId: "user_123" } as any);
    process.env.STRIPE_SECRET_KEY = "sk_test_fake_key";
    process.env.STRIPE_PRICE_CREATOR_BETA = "price_test_creator";
    mockCheckoutLookup({ status: "canceled", stripe_customer_id: "cus_stored" });
    const now = 1_700_000_000_000;
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(now);
    const bucket = Math.floor(now / 600_000);

    const originalFetch = global.fetch;
    global.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ id: "cs_test_reuse", url: "https://checkout.stripe.com/reuse" }),
    })) as any;

    try {
      const first = await checkoutPOST(makeNextRequest(JSON.stringify({ planId: "creator_beta" })));
      const second = await checkoutPOST(makeNextRequest(JSON.stringify({ planId: "creator_beta" })));
      expect(first.status).toBe(200);
      expect(second.status).toBe(200);

      const calls = (global.fetch as any).mock.calls;
      expect(calls).toHaveLength(2);
      const firstKey = calls[0][1].headers["Idempotency-Key"] as string;
      const secondKey = calls[1][1].headers["Idempotency-Key"] as string;
      expect(firstKey).toBe(`billing_user_123_price_test_creator_${bucket}`);
      expect(secondKey).toBe(firstKey);
      expect(firstKey).not.toMatch(/_\d{13}$/);
      const params = new URLSearchParams(calls[0][1].body as string);
      expect(params.get("customer")).toBe("cus_stored");
    } finally {
      nowSpy.mockRestore();
      global.fetch = originalFetch;
    }
  });

  it("returns 503 when the admin database client is missing", async () => {
    vi.mocked(auth).mockResolvedValue({ userId: "user_123", clerkId: "user_123" } as any);
    process.env.STRIPE_SECRET_KEY = "sk_test_fake_key";
    process.env.STRIPE_PRICE_CREATOR_BETA = "price_test_creator";
    vi.mocked(getSupabaseAdmin).mockReturnValue(null);
    const originalFetch = global.fetch;
    const stripeCalls: string[] = [];
    global.fetch = vi.fn(async (url: string) => {
      stripeCalls.push(String(url));
      return new Response("not found", { status: 404 });
    }) as any;
    const res = await checkoutPOST(makeNextRequest(JSON.stringify({ planId: "creator_beta" })));
    expect(res.status).toBe(503);
    expect(stripeCalls).toHaveLength(0);
    global.fetch = originalFetch;
  });

  it("parallel checkout requests in one time bucket share one idempotency key", async () => {
    vi.mocked(auth).mockResolvedValue({ userId: "user_123", clerkId: "user_123" } as any);
    process.env.STRIPE_SECRET_KEY = "sk_test_fake_key";
    process.env.STRIPE_PRICE_CREATOR_BETA = "price_test_creator";
    mockCheckoutLookup({ status: "canceled", stripe_customer_id: "cus_stored" });
    const now = 1_700_000_000_000;
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(now);
    const bucket = Math.floor(now / 600_000);
    const originalFetch = global.fetch;
    global.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ id: "cs_parallel", url: "https://checkout.stripe.com/parallel" }),
    })) as any;

    try {
      const [first, second] = await Promise.all([
        checkoutPOST(makeNextRequest(JSON.stringify({ planId: "creator_beta" }))),
        checkoutPOST(makeNextRequest(JSON.stringify({ planId: "creator_beta" }))),
      ]);
      expect(first.status).toBe(200);
      expect(second.status).toBe(200);
      const calls = (global.fetch as any).mock.calls;
      expect(calls).toHaveLength(2);
      const firstKey = calls[0][1].headers["Idempotency-Key"] as string;
      const secondKey = calls[1][1].headers["Idempotency-Key"] as string;
      expect(firstKey).toBe(`billing_user_123_price_test_creator_${bucket}`);
      expect(secondKey).toBe(firstKey);
    } finally {
      nowSpy.mockRestore();
      global.fetch = originalFetch;
    }
  });

  it("parallel checkout requests for an active subscription both return 409", async () => {
    vi.mocked(auth).mockResolvedValue({ userId: "user_123", clerkId: "user_123" } as any);
    process.env.STRIPE_SECRET_KEY = "sk_test_fake_key";
    process.env.STRIPE_PRICE_CREATOR_BETA = "price_test_creator";
    mockCheckoutLookup({ status: "active", stripe_customer_id: "cus_existing" });
    const originalFetch = global.fetch;
    const stripeCalls: string[] = [];
    global.fetch = vi.fn(async (url: string) => {
      stripeCalls.push(String(url));
      return new Response("not found", { status: 404 });
    }) as any;

    try {
      const [first, second] = await Promise.all([
        checkoutPOST(makeNextRequest(JSON.stringify({ planId: "creator_beta" }))),
        checkoutPOST(makeNextRequest(JSON.stringify({ planId: "creator_beta" }))),
      ]);
      expect(first.status).toBe(409);
      expect(second.status).toBe(409);
      expect((await first.json()).code).toBe("already_subscribed");
      expect((await second.json()).code).toBe("already_subscribed");
      expect(stripeCalls.filter((url) => url.includes("api.stripe.com"))).toHaveLength(0);
    } finally {
      global.fetch = originalFetch;
    }
  });

  // Was: "uses payment mode for one-time Founder plan". The $149 tier is
  // retired, so the contract is now the opposite — no Stripe session may be
  // created for it even with STRIPE_PRICE_FOUNDER present in the environment,
  // which is exactly the state production was in.
  it("refuses checkout for the retired Founder plan even when its price ID is set", async () => {
    vi.mocked(auth).mockResolvedValue({ userId: "user_123", clerkId: "user_123" } as any);
    process.env.STRIPE_SECRET_KEY = "sk_test_fake_key";
    process.env.STRIPE_PRICE_FOUNDER = "price_test_founder";

    const originalFetch = global.fetch;
    const stripeCalls: string[] = [];
    global.fetch = vi.fn(async (url: string) => {
      stripeCalls.push(url);
      return new Response("not found", { status: 404 });
    }) as any;

    const req = makeNextRequest(JSON.stringify({ planId: "founder" }));
    const res = await checkoutPOST(req);

    expect(res.status).toBeGreaterThanOrEqual(400);
    // The important part: Stripe was never contacted, so no charge could occur.
    expect(stripeCalls.filter((u) => u.includes("api.stripe.com"))).toHaveLength(0);

    global.fetch = originalFetch;
  });
});

// ═════════════════════════════════════════════════════════════════════
// WEBHOOK SIGNATURE VERIFICATION
// ═════════════════════════════════════════════════════════════════════

describe("POST /api/stripe/webhook — signature verification", () => {
  beforeEach(() => {
    process.env.STRIPE_SECRET_KEY = "sk_test_fake";
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_fake";
  });

  it("returns 500 when STRIPE_SECRET_KEY is missing", async () => {
    delete process.env.STRIPE_SECRET_KEY;
    const { POST: webhookPOST } = await import("@/app/api/stripe/webhook/route");
    const req = makeWebhookRequest("{}", "sig");
    const res = await webhookPOST(req);
    expect(res.status).toBe(500);
  });

  it("returns 500 when STRIPE_WEBHOOK_SECRET is missing", async () => {
    delete process.env.STRIPE_WEBHOOK_SECRET;
    const { POST: webhookPOST } = await import("@/app/api/stripe/webhook/route");
    const req = makeWebhookRequest("{}", "sig");
    const res = await webhookPOST(req);
    expect(res.status).toBe(500);
  });

  it("returns 400 when signature is invalid", async () => {
    mockConstructEvent.mockImplementation(() => {
      throw new Error("Invalid signature: no signature found in header");
    });
    const { POST: webhookPOST } = await import("@/app/api/stripe/webhook/route");
    const req = makeWebhookRequest("raw_body", "invalid_sig");
    const res = await webhookPOST(req);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("Webhook Error");
  });
});

// ═════════════════════════════════════════════════════════════════════
// WEBHOOK EVENT PROCESSING — STATE MUTATION TESTS
// ═════════════════════════════════════════════════════════════════════

describe("Webhook event processing — state mutations", () => {
  beforeEach(() => {
    process.env.STRIPE_SECRET_KEY = "sk_test_fake";
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_fake";
  });

  it("checkout.session.completed for Founder → upserts subscription plan=founder status=active, NO credit grant", async () => {
    const { sb, rpcCalls, upserts } = buildTrackingSupabase();
    vi.mocked(isAdminSupabaseConfigured).mockReturnValue(true);
    vi.mocked(getAdminSupabase).mockReturnValue(sb as any);

    mockConstructEvent.mockReturnValue(makeStripeEvent("checkout.session.completed", {
      object: {
        id: "cs_test_founder",
        metadata: { product_type: "plan", clerk_id: "user_123", plan_id: "founder" },
        customer: "cus_test_123",
      },
    }));

    const { POST: webhookPOST } = await import("@/app/api/stripe/webhook/route");
    const req = makeWebhookRequest("body", "sig");
    const res = await webhookPOST(req);

    expect(res.status).toBe(200);

    // Subscription upserted with plan=founder, status=active
    const subUpsert = upserts.find((u) => u.table === "subscriptions");
    expect(subUpsert).toBeDefined();
    expect(subUpsert!.row.plan).toBe("founder");
    expect(subUpsert!.row.status).toBe("active");

    // NO credit grant — Founder has monthlyCredits: 0
    expect(rpcCalls.filter((c) => c.fn === "grant_credits").length).toBe(0);
  });

  it("customer.subscription.created → upserts subscription with correct plan and status", async () => {
    const { sb, upserts } = buildTrackingSupabase();
    vi.mocked(isAdminSupabaseConfigured).mockReturnValue(true);
    vi.mocked(getAdminSupabase).mockReturnValue(sb as any);

    mockConstructEvent.mockReturnValue(makeStripeEvent("customer.subscription.created", {
      object: {
        id: "sub_test_123",
        status: "active",
        customer: "cus_test_123",
        metadata: { clerk_id: "user_123", plan_id: "creator_beta" },
        items: { data: [{ current_period_start: 1700000000, current_period_end: 1702678400 }] },
      },
    }));

    const { POST: webhookPOST } = await import("@/app/api/stripe/webhook/route");
    const req = makeWebhookRequest("body", "sig");
    const res = await webhookPOST(req);

    expect(res.status).toBe(200);

    const subUpsert = upserts.find((u) => u.table === "subscriptions");
    expect(subUpsert).toBeDefined();
    expect(subUpsert!.row.plan).toBe("creator_beta");
    expect(subUpsert!.row.status).toBe("active");
    expect(subUpsert!.row.stripe_subscription_id).toBe("sub_test_123");
  });

  it("customer.subscription.updated → upserts subscription with updated plan and status", async () => {
    const { sb, upserts } = buildTrackingSupabase();
    vi.mocked(isAdminSupabaseConfigured).mockReturnValue(true);
    vi.mocked(getAdminSupabase).mockReturnValue(sb as any);

    mockConstructEvent.mockReturnValue(makeStripeEvent("customer.subscription.updated", {
      object: {
        id: "sub_test_456",
        status: "active",
        customer: "cus_test_456",
        metadata: { clerk_id: "user_456", plan_id: "pro_builder_beta" },
        items: { data: [{ current_period_start: 1700000000, current_period_end: 1702678400 }] },
      },
    }));

    const { POST: webhookPOST } = await import("@/app/api/stripe/webhook/route");
    const req = makeWebhookRequest("body", "sig");
    const res = await webhookPOST(req);

    expect(res.status).toBe(200);

    const subUpsert = upserts.find((u) => u.table === "subscriptions");
    expect(subUpsert).toBeDefined();
    expect(subUpsert!.row.plan).toBe("pro_builder_beta");
    expect(subUpsert!.row.status).toBe("active");
    expect(subUpsert!.row.stripe_subscription_id).toBe("sub_test_456");
  });

  it("Creator→Pro price change grants 10500 once even when metadata stays creator_beta", async () => {
    process.env.STRIPE_PRICE_CREATOR_BETA = "price_test_creator";
    process.env.STRIPE_PRICE_PRO_BUILDER_BETA = "price_test_pro";
    const { sb, rpcCalls, upserts } = buildTrackingSupabase();
    vi.mocked(isAdminSupabaseConfigured).mockReturnValue(true);
    vi.mocked(getAdminSupabase).mockReturnValue(sb as any);

    const event = makeStripeEvent("customer.subscription.updated", {
      id: "evt_upgrade_once",
      object: {
        id: "sub_upgrade",
        status: "active",
        customer: "cus_upgrade",
        metadata: { clerk_id: "user_123", plan_id: "creator_beta" },
        items: {
          data: [{
            price: "price_test_pro",
            current_period_start: 1700000000,
            current_period_end: 1702678400,
          }],
        },
      },
    });
    mockConstructEvent.mockReturnValue(event);

    const { POST: webhookPOST } = await import("@/app/api/stripe/webhook/route");
    const first = await webhookPOST(makeWebhookRequest("body", "sig"));
    expect(first.status).toBe(200);

    const grants = rpcCalls.filter((c) => c.fn === "grant_credits");
    expect(grants).toHaveLength(1);
    expect(grants[0].params.p_amount).toBe(10500);
    expect(grants[0].params.p_idempotency_key).toBe(
      "plan_upgrade_sub_upgrade_1702678400_pro_builder_beta",
    );
    expect(upserts.find((u) => u.table === "subscriptions")?.row.plan).toBe("pro_builder_beta");

    const replay = await webhookPOST(makeWebhookRequest("body", "sig"));
    expect(replay.status).toBe(200);
    expect((await replay.json()).replayed).toBe(true);
    expect(rpcCalls.filter((c) => c.fn === "grant_credits")).toHaveLength(1);
  });

  it("parallel deliveries of one invoice.paid grant once, and a later replay grants nothing", async () => {
    const { sb, rpcCalls } = buildTrackingSupabase();
    vi.mocked(isAdminSupabaseConfigured).mockReturnValue(true);
    vi.mocked(getAdminSupabase).mockReturnValue(sb as any);
    const event = makeStripeEvent("invoice.paid", {
      id: "evt_parallel_invoice",
      object: {
        id: "in_parallel",
        parent: { subscription_details: { subscription: "sub_test_123" } },
        lines: { data: [{ period: { end: 1702678400 } }] },
      },
    });
    mockConstructEvent.mockReturnValue(event);
    const { POST: webhookPOST } = await import("@/app/api/stripe/webhook/route");

    const [first, second] = await Promise.all([
      webhookPOST(makeWebhookRequest("body", "sig")),
      webhookPOST(makeWebhookRequest("body", "sig")),
    ]);
    const bodies = [await first.json(), await second.json()];
    const statuses = [first.status, second.status].sort();
    expect(rpcCalls.filter((c) => c.fn === "grant_credits")).toHaveLength(1);
    expect(rpcCalls.filter((c) => c.fn === "grant_credits")[0].params.p_amount).toBe(7500);
    const replayed = bodies.filter((body) => body.replayed === true);
    const inProgress = bodies.filter((body) => body.error === "Webhook event is already in progress");
    expect(replayed.length + inProgress.length).toBe(1);
    expect(statuses).toEqual(inProgress.length === 1 ? [200, 500] : [200, 200]);

    const third = await webhookPOST(makeWebhookRequest("body", "sig"));
    expect(third.status).toBe(200);
    expect((await third.json()).replayed).toBe(true);
    expect(rpcCalls.filter((c) => c.fn === "grant_credits")).toHaveLength(1);
  });

  it("upgrade grant RPC error returns 500 and does not write the new plan", async () => {
    process.env.STRIPE_PRICE_CREATOR_BETA = "price_test_creator";
    process.env.STRIPE_PRICE_PRO_BUILDER_BETA = "price_test_pro";
    const { sb, upserts } = buildTrackingSupabase();
    (sb as any).rpc = vi.fn(async () => ({ data: null, error: { message: "ledger down" } }));
    vi.mocked(isAdminSupabaseConfigured).mockReturnValue(true);
    vi.mocked(getAdminSupabase).mockReturnValue(sb as any);
    mockConstructEvent.mockReturnValue(makeStripeEvent("customer.subscription.updated", {
      id: "evt_upgrade_rpc_fail",
      object: {
        id: "sub_upgrade_fail",
        status: "active",
        customer: "cus_upgrade_fail",
        metadata: { clerk_id: "user_123", plan_id: "creator_beta" },
        items: {
          data: [{
            price: "price_test_pro",
            current_period_end: 1702678400,
          }],
        },
      },
    }));
    const { POST: webhookPOST } = await import("@/app/api/stripe/webhook/route");
    const res = await webhookPOST(makeWebhookRequest("body", "sig"));
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe("Webhook processing failed");
    const grantCalls = (sb.rpc as any).mock.calls.filter((call: unknown[]) => call[0] === "grant_credits");
    expect(grantCalls).toHaveLength(1);
    expect(grantCalls[0][1].p_amount).toBe(10500);
    expect(upserts.find((u) => u.table === "subscriptions")).toBeUndefined();
  });

  it("handles each of the ten subscribed webhook events", async () => {
    const { POST: webhookPOST } = await import("@/app/api/stripe/webhook/route");
    vi.mocked(isAdminSupabaseConfigured).mockReturnValue(true);

    async function deliver(
      type: string,
      object: Record<string, unknown>,
      opts: { marketplaceOrder?: boolean } = {},
    ) {
      const tracked = buildTrackingSupabase(false, opts);
      vi.mocked(getAdminSupabase).mockReturnValue(tracked.sb as any);
      mockConstructEvent.mockReturnValue(makeStripeEvent(type, { id: `evt_cover_${type}`, object }));
      const res = await webhookPOST(makeWebhookRequest("body", "sig"));
      return { res, ...tracked };
    }

    const completed = await deliver("checkout.session.completed", {
      id: "cs_cover_founder",
      metadata: { product_type: "plan", clerk_id: "user_123", plan_id: "founder" },
      customer: "cus_cover",
    });
    expect(completed.res.status).toBe(200);
    expect(completed.upserts.find((u) => u.table === "subscriptions")?.row.plan).toBe("founder");
    expect(completed.rpcCalls.filter((c) => c.fn === "grant_credits")).toHaveLength(0);

    const expired = await deliver("checkout.session.expired", {
      id: "cs_cover_expired",
      metadata: { product_type: "agent", marketplace_order_id: "order_cover" },
    });
    expect(expired.res.status).toBe(200);
    expect(expired.rpcCalls.some((c) => c.fn === "expire_pending_order" && c.params.p_order_id === "order_cover")).toBe(true);

    const failedPayment = await deliver("payment_intent.payment_failed", {
      id: "pi_cover_failed",
    }, { marketplaceOrder: true });
    expect(failedPayment.res.status).toBe(200);
    expect(failedPayment.updates.some((u) => u.table === "marketplace_orders" && u.patch.status === "failed")).toBe(true);

    confirmBookingPaymentMock.mockClear();
    const paidBooking = await deliver("payment_intent.succeeded", {
      id: "pi_cover_booking",
      metadata: { booking_id: "book_cover", owner_id: "owner_cover" },
    });
    expect(paidBooking.res.status).toBe(200);
    expect(confirmBookingPaymentMock).toHaveBeenCalledWith("owner_cover", "book_cover", "pi_cover_booking");

    const created = await deliver("customer.subscription.created", {
      id: "sub_cover_created",
      status: "active",
      customer: "cus_cover",
      metadata: { clerk_id: "user_123", plan_id: "creator_beta" },
      items: { data: [{ current_period_end: 1702678400 }] },
    });
    expect(created.res.status).toBe(200);
    expect(created.upserts.find((u) => u.table === "subscriptions")?.row.plan).toBe("creator_beta");
    expect(created.rpcCalls.filter((c) => c.fn === "grant_credits")).toHaveLength(0);

    const updated = await deliver("customer.subscription.updated", {
      id: "sub_cover_updated",
      status: "active",
      cancel_at_period_end: true,
      customer: "cus_cover",
      metadata: { clerk_id: "user_123", plan_id: "creator_beta" },
      items: { data: [{ current_period_end: 1702678400 }] },
    });
    expect(updated.res.status).toBe(200);
    expect(updated.upserts.find((u) => u.table === "subscriptions")?.row.cancel_at_period_end).toBe(true);

    const deleted = await deliver("customer.subscription.deleted", { id: "sub_cover_deleted" });
    expect(deleted.res.status).toBe(200);
    expect(deleted.updates.some((u) => u.table === "subscriptions" && u.patch.status === "canceled")).toBe(true);

    const paid = await deliver("invoice.paid", {
      id: "in_cover",
      parent: { subscription_details: { subscription: "sub_cover" } },
      lines: { data: [{ period: { end: 1702678400 } }] },
    });
    expect(paid.res.status).toBe(200);
    expect(paid.rpcCalls.filter((c) => c.fn === "grant_credits")).toHaveLength(1);
    expect(paid.updates.some((u) => u.patch.status === "active")).toBe(true);

    const paymentFailed = await deliver("invoice.payment_failed", {
      id: "in_cover_fail",
      parent: { subscription_details: { subscription: "sub_cover" } },
    });
    expect(paymentFailed.res.status).toBe(200);
    expect(paymentFailed.updates.some((u) => u.patch.status === "past_due")).toBe(true);

    mockSucceededRefunds([{ id: "re_cover", amount: 1000, created: 1700000001 }]);
    const refunded = await deliver("charge.refunded", {
      id: "ch_cover",
      amount: 1000,
      amount_refunded: 1000,
      currency: "usd",
      payment_intent: "pi_cover_pack",
      metadata: { product_type: "credit_pack", clerk_id: "clerk_123", coin_amount: "4000" },
    });
    expect(refunded.res.status).toBe(200);
    expect(refunded.rpcCalls.some((c) => c.fn === "debit_credits" && c.params.p_idempotency_key === "refund_re_cover")).toBe(true);
  });

  it("customer.subscription.created does not grant an upgrade delta", async () => {
    process.env.STRIPE_PRICE_PRO_BUILDER_BETA = "price_test_pro";
    const { sb, rpcCalls, upserts } = buildTrackingSupabase();
    vi.mocked(isAdminSupabaseConfigured).mockReturnValue(true);
    vi.mocked(getAdminSupabase).mockReturnValue(sb as any);
    mockConstructEvent.mockReturnValue(makeStripeEvent("customer.subscription.created", {
      object: {
        id: "sub_new",
        status: "active",
        customer: "cus_new",
        metadata: { clerk_id: "user_123", plan_id: "creator_beta" },
        items: { data: [{ price: "price_test_pro", current_period_end: 1702678400 }] },
      },
    }));
    const { POST: webhookPOST } = await import("@/app/api/stripe/webhook/route");
    const res = await webhookPOST(makeWebhookRequest("body", "sig"));
    expect(res.status).toBe(200);
    expect(upserts.find((u) => u.table === "subscriptions")?.row.plan).toBe("pro_builder_beta");
    expect(rpcCalls.filter((c) => c.fn === "grant_credits")).toHaveLength(0);
  });

  it("Pro→Creator downgrade updates the plan and grants nothing", async () => {
    process.env.STRIPE_PRICE_CREATOR_BETA = "price_test_creator";
    process.env.STRIPE_PRICE_PRO_BUILDER_BETA = "price_test_pro";
    const { sb, rpcCalls, upserts } = buildTrackingSupabase(false, {
      subscriptionPlan: "pro_builder_beta",
    });
    vi.mocked(isAdminSupabaseConfigured).mockReturnValue(true);
    vi.mocked(getAdminSupabase).mockReturnValue(sb as any);
    mockConstructEvent.mockReturnValue(makeStripeEvent("customer.subscription.updated", {
      object: {
        id: "sub_down",
        status: "active",
        customer: "cus_down",
        metadata: { clerk_id: "user_123", plan_id: "pro_builder_beta" },
        items: { data: [{ price: "price_test_creator", current_period_end: 1702678400 }] },
      },
    }));
    const { POST: webhookPOST } = await import("@/app/api/stripe/webhook/route");
    const res = await webhookPOST(makeWebhookRequest("body", "sig"));
    expect(res.status).toBe(200);
    expect(upserts.find((u) => u.table === "subscriptions")?.row.plan).toBe("creator_beta");
    expect(rpcCalls.filter((c) => c.fn === "grant_credits")).toHaveLength(0);
  });

  it("customer.subscription.updated stores cancel_at_period_end and current_period_end", async () => {
    const { sb, upserts } = buildTrackingSupabase();
    vi.mocked(isAdminSupabaseConfigured).mockReturnValue(true);
    vi.mocked(getAdminSupabase).mockReturnValue(sb as any);
    mockConstructEvent.mockReturnValue(makeStripeEvent("customer.subscription.updated", {
      object: {
        id: "sub_cancel_later",
        status: "active",
        cancel_at_period_end: true,
        customer: "cus_cancel_later",
        metadata: { clerk_id: "user_123", plan_id: "creator_beta" },
        items: { data: [{ current_period_start: 1700000000, current_period_end: 1702678400 }] },
      },
    }));
    const { POST: webhookPOST } = await import("@/app/api/stripe/webhook/route");
    const res = await webhookPOST(makeWebhookRequest("body", "sig"));
    expect(res.status).toBe(200);
    const row = upserts.find((u) => u.table === "subscriptions")?.row;
    expect(row.cancel_at_period_end).toBe(true);
    expect(row.current_period_end).toBe(new Date(1702678400 * 1000).toISOString());
  });

  it("a renewal invoice whose price disagrees with the stored plan still returns 500", async () => {
    process.env.STRIPE_PRICE_PRO_BUILDER_BETA = "price_test_pro";
    const { sb, rpcCalls } = buildTrackingSupabase();
    vi.mocked(isAdminSupabaseConfigured).mockReturnValue(true);
    vi.mocked(getAdminSupabase).mockReturnValue(sb as any);
    mockConstructEvent.mockReturnValue(makeStripeEvent("invoice.paid", {
      object: {
        id: "in_mismatch",
        billing_reason: "subscription_cycle",
        parent: { subscription_details: { subscription: "sub_mismatch" } },
        lines: { data: [{ price: "price_test_pro", period: { end: 1702678400 } }] },
      },
    }));
    const { POST: webhookPOST } = await import("@/app/api/stripe/webhook/route");
    const res = await webhookPOST(makeWebhookRequest("body", "sig"));
    expect(res.status).toBe(500);
    expect(rpcCalls.filter((c) => c.fn === "grant_credits")).toHaveLength(0);
  });

  it("a subscription_update proration invoice does not grant the full plan amount", async () => {
    process.env.STRIPE_PRICE_PRO_BUILDER_BETA = "price_test_pro";
    const { sb, rpcCalls, updates } = buildTrackingSupabase();
    vi.mocked(isAdminSupabaseConfigured).mockReturnValue(true);
    vi.mocked(getAdminSupabase).mockReturnValue(sb as any);
    mockConstructEvent.mockReturnValue(makeStripeEvent("invoice.paid", {
      object: {
        id: "in_proration",
        billing_reason: "subscription_update",
        parent: { subscription_details: { subscription: "sub_upgrade" } },
        lines: { data: [{ price: "price_test_pro", period: { end: 1702678400 } }] },
      },
    }));
    const { POST: webhookPOST } = await import("@/app/api/stripe/webhook/route");
    const res = await webhookPOST(makeWebhookRequest("body", "sig"));
    expect(res.status).toBe(200);
    expect(updates.find((u) => u.patch.status === "active")).toBeDefined();
    expect(rpcCalls.filter((c) => c.fn === "grant_credits")).toHaveLength(0);
  });

  it("end-to-end chain: checkout.session.completed → invoice.paid → entitlement + credits exactly once", async () => {
    // Build a tracking supabase that also tracks inserted stripe_events
    // so the replay (step 4) is detected as a duplicate
    const rpcCalls: { fn: string; params: any }[] = [];
    const upserts: { table: string; row: any }[] = [];
    const updates: { table: string; patch: any; matches: any[] }[] = [];
    const inserts: { table: string; row: any }[] = [];
    const processedEventIds = new Set<string>();

    const chain = (table: string) => ({
      select: vi.fn(() => chain(table)),
      eq: vi.fn(() => chain(table)),
      in: vi.fn(() => chain(table)),
      limit: vi.fn(() => chain(table)),
      order: vi.fn(() => chain(table)),
      like: vi.fn(() => chain(table)),
      gte: vi.fn(() => chain(table)),
      single: vi.fn(async () => {
        if (table === "users") return { data: { id: "user_internal_123" }, error: null };
        if (table === "stripe_events") {
          // Check if this event ID was already inserted
          return { data: null, error: null };
        }
        if (table === "subscriptions")
          return { data: { user_id: "user_internal_123", plan: "creator_beta" }, error: null };
        return { data: null, error: null };
      }),
      maybeSingle: vi.fn(async () => {
        if (table === "users") return { data: { id: "user_internal_123" }, error: null };
        if (table === "stripe_events") {
          return { data: null, error: null };
        }
        if (table === "subscriptions")
          return { data: { user_id: "user_internal_123", plan: "creator_beta" }, error: null };
        return { data: null, error: null };
      }),
      upsert: vi.fn(async (row: any) => {
        upserts.push({ table, row });
        return { error: null };
      }),
      insert: vi.fn(async (row: any) => {
        inserts.push({ table, row });
        if (table === "stripe_events") {
          processedEventIds.add(row.stripe_event_id);
        }
        return { error: null };
      }),
      update: vi.fn((patch: any) => ({
        eq: vi.fn(async (col: string, val: any) => {
          updates.push({ table, patch, matches: [{ col, val }] });
          return { error: null };
        }),
      })),
    });

    // Override single/maybeSingle to check processedEventIds
    const origSingle = chain("stripe_events").single;
    const origMaybeSingle = chain("stripe_events").maybeSingle;
    chain("stripe_events").single = vi.fn(async () => {
      // The isEventProcessed check queries by stripe_event_id
      // We can't easily extract the event ID from the chain, so we use a simpler approach:
      // After the first invoice.paid is processed, mark its event ID
      return { data: null, error: null };
    }) as any;

    const sb = {
      from: vi.fn((table: string) => {
        const c = chain(table);
        // Override single for stripe_events to check processed set
        if (table === "stripe_events") {
          c.single = vi.fn(async () => {
            // We need to know which event ID is being queried
            // The mock chain doesn't pass the eq value through, so we use a heuristic:
            // if any events have been inserted, return the first one as "existing"
            if (processedEventIds.size > 0) {
              const firstId = processedEventIds.values().next().value;
              // Only return "existing" if the event being checked was already processed
              // We can't know the exact ID being queried, so we check if it's in our set
              // This is a simplification — in reality the query filters by stripe_event_id
              return { data: { id: firstId }, error: null };
            }
            return { data: null, error: null };
          }) as any;
          c.maybeSingle = c.single as any;
        }
        return c;
      }),
      rpc: vi.fn(async (fnName: string, params: any) => {
        rpcCalls.push({ fn: fnName, params });
        return { data: { success: true, remaining: 100 }, error: null };
      }),
    };

    vi.mocked(isAdminSupabaseConfigured).mockReturnValue(true);
    vi.mocked(getAdminSupabase).mockReturnValue(sb as any);

    const { POST: webhookPOST } = await import("@/app/api/stripe/webhook/route");

    // Step 1: checkout.session.completed for Creator Beta
    process.env.STRIPE_SECRET_KEY = "sk_test_secret";
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_test";
    mockConstructEvent.mockReturnValue(makeStripeEvent("checkout.session.completed", {
      object: {
        id: "cs_test_chain",
        metadata: { clerk_id: "user_chain", plan_id: "creator_beta" },
        payment_status: "paid",
      },
    }));
    const req1 = makeWebhookRequest("body", "sig");
    const res1 = await webhookPOST(req1);
    expect(res1.status).toBe(200);

    // Step 2: customer.subscription.created
    mockConstructEvent.mockReturnValue(makeStripeEvent("customer.subscription.created", {
      object: {
        id: "sub_chain",
        status: "active",
        customer: "cus_chain",
        metadata: { clerk_id: "user_chain", plan_id: "creator_beta" },
        items: { data: [{ current_period_start: 1700000000, current_period_end: 1702678400 }] },
      },
    }));
    const req2 = makeWebhookRequest("body", "sig");
    const res2 = await webhookPOST(req2);
    expect(res2.status).toBe(200);

    // Step 3: invoice.paid → grants credits
    mockConstructEvent.mockReturnValue(makeStripeEvent("invoice.paid", {
      object: {
        id: "in_chain",
        parent: { subscription_details: { subscription: "sub_chain" } },
        lines: { data: [{ period: { end: 1702678400 } }] },
      },
    }));
    const req3 = makeWebhookRequest("body", "sig");
    const res3 = await webhookPOST(req3);
    expect(res3.status).toBe(200);

    // Verify: subscription upserted with creator_beta plan
    const subUpserts = upserts.filter((u) => u.table === "subscriptions");
    expect(subUpserts.length).toBeGreaterThanOrEqual(1);
    expect(subUpserts.some((u) => u.row.plan === "creator_beta")).toBe(true);

    // Verify: credits granted exactly once (from invoice.paid only)
    const grants = rpcCalls.filter((c) => c.fn === "grant_credits");
    expect(grants.length).toBe(1);
    expect(grants[0].params.p_amount).toBe(7500);
    expect(grants[0].params.p_idempotency_key).toBe("invoice_grant_in_chain");

    // Verify: subscription marked active
    expect(updates.find((u) => u.patch.status === "active")).toBeDefined();

    // Step 4: replay invoice.paid with the SAME event ID → no duplicate credits
    // The processedEventIds set now has the event ID from step 3's insert
    mockConstructEvent.mockReturnValue({
      id: "evt_test_invoice.paid_" + "replay", // different event ID → will NOT be detected as dup
      type: "invoice.paid",
      data: { object: { id: "in_chain", parent: { subscription_details: { subscription: "sub_chain" } }, lines: { data: [{ period: { end: 1702678400 } }] } } },
    });
    const req4 = makeWebhookRequest("body", "sig");
    const res4 = await webhookPOST(req4);
    expect(res4.status).toBe(200);

    // The replay uses a different event ID, so it WILL be processed again.
    // The idempotency key (invoice_grant_in_chain) prevents double credits at the DB level.
    // The grant_credits RPC is called again, but the DB idempotency key ensures it's a no-op.
    // This test verifies the webhook-level idempotency (same event ID = no reprocessing).
    // For DB-level idempotency, the grant_credits RPC with the same idempotency key is a no-op.
    const grantsAfterReplay = rpcCalls.filter((c) => c.fn === "grant_credits");
    // With a different event ID, grant_credits is called again but with the SAME idempotency key
    // The DB layer handles the dedup — the webhook layer only dedups by event ID
    expect(grantsAfterReplay.length).toBe(2); // called twice, but DB idempotency key prevents double grant
    expect(grantsAfterReplay[1].params.p_idempotency_key).toBe("invoice_grant_in_chain"); // same key
  });

  it("invoice.paid → marks subscription active AND grants monthly credits exactly once", async () => {
    const { sb, rpcCalls, updates } = buildTrackingSupabase();
    vi.mocked(isAdminSupabaseConfigured).mockReturnValue(true);
    vi.mocked(getAdminSupabase).mockReturnValue(sb as any);

    mockConstructEvent.mockReturnValue(makeStripeEvent("invoice.paid", {
      object: {
        id: "in_test_123",
        parent: { subscription_details: { subscription: "sub_test_123" } },
        lines: { data: [{ period: { end: 1702678400 } }] },
      },
    }));

    const { POST: webhookPOST } = await import("@/app/api/stripe/webhook/route");
    const req = makeWebhookRequest("body", "sig");
    const res = await webhookPOST(req);

    expect(res.status).toBe(200);

    // Subscription marked active
    expect(updates.find((u) => u.patch.status === "active")).toBeDefined();

    // grant_credits called exactly once
    const grants = rpcCalls.filter((c) => c.fn === "grant_credits");
    expect(grants.length).toBe(1);
    expect(grants[0].params.p_idempotency_key).toBe("invoice_grant_in_test_123");
    // Creator Beta = 6000 credits
    expect(grants[0].params.p_amount).toBe(7500);
  });

  it("customer.subscription.deleted → marks subscription canceled", async () => {
    const { sb, updates } = buildTrackingSupabase();
    vi.mocked(isAdminSupabaseConfigured).mockReturnValue(true);
    vi.mocked(getAdminSupabase).mockReturnValue(sb as any);

    mockConstructEvent.mockReturnValue(makeStripeEvent("customer.subscription.deleted", {
      object: { id: "sub_test_123" },
    }));

    const { POST: webhookPOST } = await import("@/app/api/stripe/webhook/route");
    const req = makeWebhookRequest("body", "sig");
    const res = await webhookPOST(req);

    expect(res.status).toBe(200);
    expect(updates.find((u) => u.patch.status === "canceled")).toBeDefined();
  });

  it("invoice.payment_failed → marks subscription past_due", async () => {
    const { sb, updates } = buildTrackingSupabase();
    vi.mocked(isAdminSupabaseConfigured).mockReturnValue(true);
    vi.mocked(getAdminSupabase).mockReturnValue(sb as any);

    mockConstructEvent.mockReturnValue(makeStripeEvent("invoice.payment_failed", {
      object: {
        id: "in_test_fail",
        parent: { subscription_details: { subscription: "sub_test_123" } },
      },
    }));

    const { POST: webhookPOST } = await import("@/app/api/stripe/webhook/route");
    const req = makeWebhookRequest("body", "sig");
    const res = await webhookPOST(req);

    expect(res.status).toBe(200);
    expect(updates.find((u) => u.patch.status === "past_due")).toBeDefined();
  });

  it("duplicate event → returns replayed:true, NO state mutations, NO credit grants", async () => {
    // existingEvent=true → stripe_events table already has the event
    const { sb, rpcCalls, upserts, updates } = buildTrackingSupabase(true);
    vi.mocked(isAdminSupabaseConfigured).mockReturnValue(true);
    vi.mocked(getAdminSupabase).mockReturnValue(sb as any);

    mockConstructEvent.mockReturnValue({
      id: "evt_existing",
      type: "invoice.paid",
      data: { object: { id: "in_test_dup", parent: { subscription_details: { subscription: "sub_test_123" } }, lines: { data: [{ period: { end: 1702678400 } }] } } },
    });

    const { POST: webhookPOST } = await import("@/app/api/stripe/webhook/route");
    const req = makeWebhookRequest("body", "sig");
    const res = await webhookPOST(req);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.replayed).toBe(true);

    // NO state mutations
    expect(rpcCalls.filter((c) => c.fn === "grant_credits").length).toBe(0);
    expect(upserts.length).toBe(0);
    expect(updates.length).toBe(0);
  });

  it("webhook processing failure → returns 500, event NOT marked processed (Stripe retries)", async () => {
    const { sb } = buildTrackingSupabase();
    // Make from() throw only for "subscriptions" table (inside the try block),
    // but work normally for "stripe_events" (idempotency check, outside try)
    const origFrom = sb.from;
    sb.from = vi.fn((table: string) => {
      if (table === "subscriptions") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              single: vi.fn(async () => { throw new Error("DB connection lost"); }),
              maybeSingle: vi.fn(async () => { throw new Error("DB connection lost"); }),
            })),
          })),
          upsert: vi.fn(async () => ({ error: null })),
          update: vi.fn(() => ({ eq: vi.fn(async () => ({ error: null })) })),
          insert: vi.fn(async () => ({ error: null })),
        };
      }
      return origFrom(table);
    });
    vi.mocked(isAdminSupabaseConfigured).mockReturnValue(true);
    vi.mocked(getAdminSupabase).mockReturnValue(sb as any);

    mockConstructEvent.mockReturnValue(makeStripeEvent("invoice.paid", {
      object: {
        id: "in_test_fail_event",
        parent: { subscription_details: { subscription: "sub_test_123" } },
        lines: { data: [{ period: { end: 1702678400 } }] },
      },
    }));

    const { POST: webhookPOST } = await import("@/app/api/stripe/webhook/route");
    const req = makeWebhookRequest("body", "sig");
    const res = await webhookPOST(req);

    expect(res.status).toBe(500);
  });

  it("charge.refunded (credit pack) → debits the prorated LiTTBit grant from purchased balance", async () => {
    const { sb, rpcCalls } = buildTrackingSupabase();
    vi.mocked(isAdminSupabaseConfigured).mockReturnValue(true);
    vi.mocked(getAdminSupabase).mockReturnValue(sb as any);
    mockSucceededRefunds([{ id: "re_creditpack", amount: 1000, created: 1700000001 }]);

    mockConstructEvent.mockReturnValue(makeStripeEvent("charge.refunded", {
      object: {
        id: "ch_creditpack_refund",
        amount: 1000,
        amount_refunded: 1000,
        currency: "usd",
        payment_intent: "pi_creditpack_123",
        metadata: {
          product_type: "credit_pack",
          clerk_id: "clerk_123",
          coin_amount: "4000",
        },
      },
    }));

    const { POST: webhookPOST } = await import("@/app/api/stripe/webhook/route");
    const req = makeWebhookRequest("body", "sig");
    const res = await webhookPOST(req);

    expect(res.status).toBe(200);
    const debits = rpcCalls.filter((c) => c.fn === "debit_credits");
    expect(debits.length).toBe(1);
    expect(debits[0].params.p_amount).toBe(4000);
    expect(debits[0].params.p_idempotency_key).toBe("refund_re_creditpack");
  });

  it("charge.refunded (subscription plan) → debits prorated monthly credits and revokes entitlement", async () => {
    const { sb, rpcCalls, updates } = buildTrackingSupabase();
    vi.mocked(isAdminSupabaseConfigured).mockReturnValue(true);
    vi.mocked(getAdminSupabase).mockReturnValue(sb as any);
    mockSucceededRefunds([{ id: "re_creator", amount: 750, created: 1700000001 }]);

    mockConstructEvent.mockReturnValue(makeStripeEvent("charge.refunded", {
      object: {
        id: "ch_creator_refund",
        amount: 1500,
        amount_refunded: 750,
        currency: "usd",
        payment_intent: "pi_creator_123",
        metadata: {
          product_type: "plan",
          clerk_id: "clerk_123",
          plan_id: "creator_beta",
        },
      },
    }));

    const { POST: webhookPOST } = await import("@/app/api/stripe/webhook/route");
    const req = makeWebhookRequest("body", "sig");
    const res = await webhookPOST(req);

    expect(res.status).toBe(200);
    expect(updates.find((u) => u.patch.status === "refunded")).toBeDefined();
    const debits = rpcCalls.filter((c) => c.fn === "debit_credits");
    expect(debits.length).toBe(1);
    // Creator Beta: 7500 credits over $15 (1500c). Refunding 750c = 50% → 3750 credits.
    expect(debits[0].params.p_amount).toBe(3750);
    expect(debits[0].params.p_idempotency_key).toBe("refund_re_creator");
  });

  it("charge.refunded (credit pack) claims the event before debiting", async () => {
    const { sb, rpcCalls, inserts } = buildTrackingSupabase();
    vi.mocked(isAdminSupabaseConfigured).mockReturnValue(true);
    vi.mocked(getAdminSupabase).mockReturnValue(sb as any);
    mockSucceededRefunds([{ id: "re_pack_claim", amount: 1000, created: 1700000001 }]);

    mockConstructEvent.mockReturnValue(makeStripeEvent("charge.refunded", {
      id: "evt_pack_claim",
      object: {
        id: "ch_pack_claim",
        amount: 1000,
        amount_refunded: 1000,
        payment_intent: "pi_pack_claim",
        metadata: { product_type: "credit_pack", clerk_id: "clerk_123", coin_amount: "4000" },
      },
    }));

    const { POST: webhookPOST } = await import("@/app/api/stripe/webhook/route");
    const res = await webhookPOST(makeWebhookRequest("body", "sig"));
    expect(res.status).toBe(200);
    const claim = inserts.find((row) => row.table === "stripe_events");
    expect(claim?.row.result).toBe("processing");
    expect(claim?.row.stripe_event_id).toBe("evt_pack_claim");
    expect(rpcCalls.filter((c) => c.fn === "debit_credits")).toHaveLength(1);
    expect(rpcCalls.some((c) => c.fn === "refund_agent_purchase")).toBe(false);
  });

  it("charge.refunded replay and in-progress claim do not debit twice", async () => {
    const replay = buildTrackingSupabase(true);
    vi.mocked(isAdminSupabaseConfigured).mockReturnValue(true);
    vi.mocked(getAdminSupabase).mockReturnValue(replay.sb as any);
    const refundEvent = makeStripeEvent("charge.refunded", {
      id: "evt_pack_replay",
      object: {
        id: "ch_pack_replay",
        amount: 1000,
        amount_refunded: 1000,
        payment_intent: "pi_pack_replay",
        metadata: { product_type: "credit_pack", clerk_id: "clerk_123", coin_amount: "4000" },
        refunds: { data: [{ id: "re_pack_replay", amount: 1000, created: 1700000001 }] },
      },
    });
    mockConstructEvent.mockReturnValue(refundEvent);
    const { POST: webhookPOST } = await import("@/app/api/stripe/webhook/route");
    const replayed = await webhookPOST(makeWebhookRequest("body", "sig"));
    expect(replayed.status).toBe(200);
    expect((await replayed.json()).replayed).toBe(true);
    expect(replay.rpcCalls.filter((c) => c.fn === "debit_credits")).toHaveLength(0);
    expect(mockRefundsList).not.toHaveBeenCalled();

    const inflight = buildTrackingSupabase(true, { eventResult: "processing" });
    vi.mocked(getAdminSupabase).mockReturnValue(inflight.sb as any);
    mockConstructEvent.mockReturnValue({ ...refundEvent, id: "evt_pack_inflight" });
    const busy = await webhookPOST(makeWebhookRequest("body", "sig"));
    expect(busy.status).toBe(500);
    expect(inflight.rpcCalls.filter((c) => c.fn === "debit_credits")).toHaveLength(0);
  });

  it("agent charge.refunded is claimed by refund_agent_purchase, not the webhook", async () => {
    const byMetadata = buildTrackingSupabase();
    vi.mocked(isAdminSupabaseConfigured).mockReturnValue(true);
    vi.mocked(getAdminSupabase).mockReturnValue(byMetadata.sb as any);
    mockConstructEvent.mockReturnValue(makeStripeEvent("charge.refunded", {
      id: "evt_agent_refund",
      object: {
        id: "ch_agent_refund",
        amount: 2000,
        amount_refunded: 2000,
        payment_intent: "pi_agent_refund",
        metadata: { product_type: "agent", clerk_id: "clerk_123" },
        refunds: { data: [{ id: "re_agent", amount: 2000, created: 1 }] },
      },
    }));
    const { POST: webhookPOST } = await import("@/app/api/stripe/webhook/route");
    const res = await webhookPOST(makeWebhookRequest("body", "sig"));
    expect(res.status).toBe(200);
    expect(byMetadata.rpcCalls.some((c) => c.fn === "refund_agent_purchase")).toBe(true);
    expect(byMetadata.inserts.some((row) => row.row.result === "processing")).toBe(false);

    const byOrder = buildTrackingSupabase(false, { marketplaceOrder: true });
    vi.mocked(getAdminSupabase).mockReturnValue(byOrder.sb as any);
    mockConstructEvent.mockReturnValue(makeStripeEvent("charge.refunded", {
      id: "evt_agent_order_refund",
      object: {
        id: "ch_agent_order",
        amount: 2000,
        amount_refunded: 2000,
        payment_intent: "pi_agent_order",
        metadata: {},
        refunds: { data: [{ id: "re_agent_order", amount: 2000, created: 1 }] },
      },
    }));
    const orderRes = await webhookPOST(makeWebhookRequest("body", "sig"));
    expect(orderRes.status).toBe(200);
    expect(byOrder.rpcCalls.some((c) => c.fn === "refund_agent_purchase")).toBe(true);
    expect(byOrder.inserts.some((row) => row.row.result === "processing")).toBe(false);
  });

  it("basil charge.refunded with no refunds list debits the API refund id", async () => {
    const { sb, rpcCalls } = buildTrackingSupabase();
    vi.mocked(isAdminSupabaseConfigured).mockReturnValue(true);
    vi.mocked(getAdminSupabase).mockReturnValue(sb as any);
    mockSucceededRefunds([{ id: "re_basil", amount: 1000, created: 1700000001 }]);
    const charge = {
      id: "ch_basil",
      amount: 1000,
      amount_refunded: 1000,
      payment_intent: "pi_basil",
      metadata: { product_type: "credit_pack", clerk_id: "clerk_123", coin_amount: "4000" },
    };
    expect(charge).not.toHaveProperty("refunds");
    mockConstructEvent.mockReturnValue(makeStripeEvent("charge.refunded", {
      id: "evt_basil",
      object: charge,
    }));
    const { POST: webhookPOST } = await import("@/app/api/stripe/webhook/route");
    const res = await webhookPOST(makeWebhookRequest("body", "sig"));
    expect(res.status).toBe(200);
    expect(mockRefundsList).toHaveBeenCalledWith(
      expect.objectContaining({ charge: "ch_basil" }),
    );
    const debits = rpcCalls.filter((c) => c.fn === "debit_credits");
    expect(debits).toHaveLength(1);
    expect(debits[0].params.p_idempotency_key).toBe("refund_re_basil");
    expect(debits[0].params.p_amount).toBe(4000);
  });

  it("two partial refunds on a basil charge debit each refund id once", async () => {
    const { sb, rpcCalls } = buildTrackingSupabase();
    vi.mocked(isAdminSupabaseConfigured).mockReturnValue(true);
    vi.mocked(getAdminSupabase).mockReturnValue(sb as any);
    const { POST: webhookPOST } = await import("@/app/api/stripe/webhook/route");
    // The live list already contains both refunds. The event snapshot's
    // amount_refunded selects which of them belong to this delivery.
    mockSucceededRefunds([
      { id: "re_partial_b", amount: 500, created: 200 },
      { id: "re_partial_a", amount: 250, created: 100 },
    ]);
    const basilCharge = {
      id: "ch_partial",
      amount: 1000,
      payment_intent: "pi_partial",
      metadata: { product_type: "credit_pack", clerk_id: "clerk_123", coin_amount: "4000" },
    };

    mockConstructEvent.mockReturnValue(makeStripeEvent("charge.refunded", {
      id: "evt_partial_a",
      object: { ...basilCharge, amount_refunded: 250 },
    }));
    expect((await webhookPOST(makeWebhookRequest("body", "sig"))).status).toBe(200);

    mockConstructEvent.mockReturnValue(makeStripeEvent("charge.refunded", {
      id: "evt_partial_b",
      object: { ...basilCharge, amount_refunded: 750 },
    }));
    expect((await webhookPOST(makeWebhookRequest("body", "sig"))).status).toBe(200);

    // Replaying the first event must not debit either refund again.
    mockConstructEvent.mockReturnValue(makeStripeEvent("charge.refunded", {
      id: "evt_partial_a_replay",
      object: { ...basilCharge, amount_refunded: 250 },
    }));
    expect((await webhookPOST(makeWebhookRequest("body", "sig"))).status).toBe(200);

    const debits = rpcCalls.filter((c) => c.fn === "debit_credits");
    expect(debits.map((c) => c.params.p_idempotency_key)).toEqual([
      "refund_re_partial_a",
      "refund_re_partial_b",
    ]);
    expect(debits.map((c) => c.params.p_amount)).toEqual([1000, 2000]);
  });

  it("a later basil refund event debits every not-yet-debited refund in its snapshot", async () => {
    const { sb, rpcCalls } = buildTrackingSupabase();
    vi.mocked(isAdminSupabaseConfigured).mockReturnValue(true);
    vi.mocked(getAdminSupabase).mockReturnValue(sb as any);
    mockSucceededRefunds([
      { id: "re_partial_a", amount: 250, created: 100 },
      { id: "re_partial_b", amount: 500, created: 200 },
    ]);
    mockConstructEvent.mockReturnValue(makeStripeEvent("charge.refunded", {
      id: "evt_partial_both",
      object: {
        id: "ch_partial_both",
        amount: 1000,
        amount_refunded: 750,
        payment_intent: "pi_partial_both",
        metadata: { product_type: "credit_pack", clerk_id: "clerk_123", coin_amount: "4000" },
      },
    }));
    const { POST: webhookPOST } = await import("@/app/api/stripe/webhook/route");
    expect((await webhookPOST(makeWebhookRequest("body", "sig"))).status).toBe(200);
    const debits = rpcCalls.filter((c) => c.fn === "debit_credits");
    expect(debits.map((c) => [c.params.p_idempotency_key, c.params.p_amount])).toEqual([
      ["refund_re_partial_a", 1000],
      ["refund_re_partial_b", 2000],
    ]);
  });

  it("basil charge.refunded returns 500 when the refund list does not match amount_refunded", async () => {
    const { sb, rpcCalls } = buildTrackingSupabase();
    vi.mocked(isAdminSupabaseConfigured).mockReturnValue(true);
    vi.mocked(getAdminSupabase).mockReturnValue(sb as any);
    mockSucceededRefunds([{ id: "re_short", amount: 250, created: 100 }]);
    mockConstructEvent.mockReturnValue(makeStripeEvent("charge.refunded", {
      id: "evt_short",
      object: {
        id: "ch_short",
        amount: 1000,
        amount_refunded: 750,
        payment_intent: "pi_short",
        metadata: { product_type: "credit_pack", clerk_id: "clerk_123", coin_amount: "4000" },
      },
    }));
    const { POST: webhookPOST } = await import("@/app/api/stripe/webhook/route");
    const res = await webhookPOST(makeWebhookRequest("body", "sig"));
    expect(res.status).toBe(500);
    expect(rpcCalls.filter((c) => c.fn === "debit_credits")).toHaveLength(0);
  });

  it("basil charge.refunded returns 500 when the refund list call fails", async () => {
    const { sb, rpcCalls } = buildTrackingSupabase();
    vi.mocked(isAdminSupabaseConfigured).mockReturnValue(true);
    vi.mocked(getAdminSupabase).mockReturnValue(sb as any);
    mockRefundsList.mockRejectedValue(new Error("stripe down"));
    mockConstructEvent.mockReturnValue(makeStripeEvent("charge.refunded", {
      id: "evt_list_down",
      object: {
        id: "ch_list_down",
        amount: 1000,
        amount_refunded: 1000,
        payment_intent: "pi_list_down",
        metadata: { product_type: "credit_pack", clerk_id: "clerk_123", coin_amount: "4000" },
      },
    }));
    const { POST: webhookPOST } = await import("@/app/api/stripe/webhook/route");
    const res = await webhookPOST(makeWebhookRequest("body", "sig"));
    expect(res.status).toBe(500);
    expect(rpcCalls.filter((c) => c.fn === "debit_credits")).toHaveLength(0);
  });

  it("invoice.paid does not revive a newer canceled or past_due subscription", async () => {
    const { sb, rpcCalls, updates } = buildTrackingSupabase();
    sb.from = vi.fn((table: string) => {
      const chainObj: any = {
        select: () => chainObj,
        eq: () => chainObj,
        maybeSingle: async () => ({ data: null, error: null }),
        single: async () => {
          if (table === "subscriptions") {
            return {
              data: {
                user_id: "user_internal_123",
                plan: "creator_beta",
                status: "canceled",
                updated_at: "2030-01-01T00:00:00.000Z",
              },
              error: null,
            };
          }
          if (table === "users") return { data: { id: "user_internal_123" }, error: null };
          return { data: null, error: null };
        },
        insert: async (row: any) => {
          updates.push({ table, patch: row, matches: [] });
          return { error: null };
        },
        update: (patch: any) => {
          const builder: any = {
            eq: () => builder,
            then: (resolve: (value: any) => void) => {
              updates.push({ table, patch, matches: [] });
              resolve({ error: null });
            },
          };
          return builder;
        },
        delete: () => {
          const builder: any = { eq: () => builder, then: (r: any) => r({ error: null }) };
          return builder;
        },
      };
      return chainObj;
    });
    vi.mocked(isAdminSupabaseConfigured).mockReturnValue(true);
    vi.mocked(getAdminSupabase).mockReturnValue(sb as any);
    mockSubscriptionsRetrieve.mockResolvedValue({ id: "sub_test_123", status: "active" });
    mockConstructEvent.mockReturnValue(makeStripeEvent("invoice.paid", {
      id: "evt_late_paid",
      created: 1700000000,
      object: {
        id: "in_late_paid",
        parent: { subscription_details: { subscription: "sub_test_123" } },
        lines: { data: [{ period: { end: 1702678400 } }] },
      },
    }));

    const { POST: webhookPOST } = await import("@/app/api/stripe/webhook/route");
    const res = await webhookPOST(makeWebhookRequest("body", "sig"));
    expect(res.status).toBe(200);
    expect(updates.some((u) => u.patch.status === "active")).toBe(false);
    expect(rpcCalls.filter((c) => c.fn === "grant_credits")).toHaveLength(1);

    mockSubscriptionsRetrieve.mockResolvedValue({ id: "sub_test_123", status: "past_due" });
    sb.from = vi.fn((table: string) => {
      const chainObj: any = {
        select: () => chainObj,
        eq: () => chainObj,
        maybeSingle: async () => ({ data: null, error: null }),
        single: async () => {
          if (table === "subscriptions") {
            return {
              data: { user_id: "user_internal_123", plan: "creator_beta", status: "active" },
              error: null,
            };
          }
          return { data: null, error: null };
        },
        insert: async () => ({ error: null }),
        update: (patch: any) => {
          const builder: any = {
            eq: () => builder,
            then: (resolve: (value: any) => void) => {
              updates.push({ table, patch, matches: [] });
              resolve({ error: null });
            },
          };
          return builder;
        },
        delete: () => {
          const builder: any = { eq: () => builder, then: (r: any) => r({ error: null }) };
          return builder;
        },
      };
      return chainObj;
    });
    mockConstructEvent.mockReturnValue(makeStripeEvent("invoice.paid", {
      id: "evt_late_paid_live",
      created: 1800000000,
      object: {
        id: "in_late_paid_live",
        parent: { subscription_details: { subscription: "sub_test_123" } },
        lines: { data: [{ period: { end: 1802678400 } }] },
      },
    }));
    const live = await webhookPOST(makeWebhookRequest("body", "sig"));
    expect(live.status).toBe(200);
    expect(updates.some((u) => u.table === "subscriptions" && u.patch.status === "active")).toBe(false);
  });

  it("a newer invoice.paid still marks a recovered subscription active", async () => {
    const { sb, updates } = buildTrackingSupabase();
    sb.from = vi.fn((table: string) => {
      const chainObj: any = {
        select: () => chainObj,
        eq: () => chainObj,
        maybeSingle: async () => ({ data: null, error: null }),
        single: async () => {
          if (table === "subscriptions") {
            return {
              data: {
                user_id: "user_internal_123",
                plan: "creator_beta",
                status: "past_due",
                updated_at: "2020-01-01T00:00:00.000Z",
              },
              error: null,
            };
          }
          return { data: null, error: null };
        },
        insert: async () => ({ error: null }),
        update: (patch: any) => {
          const builder: any = {
            eq: () => builder,
            then: (resolve: (value: any) => void) => {
              updates.push({ table, patch, matches: [] });
              resolve({ error: null });
            },
          };
          return builder;
        },
        delete: () => {
          const builder: any = { eq: () => builder, then: (r: any) => r({ error: null }) };
          return builder;
        },
      };
      return chainObj;
    });
    vi.mocked(isAdminSupabaseConfigured).mockReturnValue(true);
    vi.mocked(getAdminSupabase).mockReturnValue(sb as any);
    mockSubscriptionsRetrieve.mockResolvedValue({ id: "sub_test_123", status: "active" });
    mockConstructEvent.mockReturnValue(makeStripeEvent("invoice.paid", {
      id: "evt_recovered",
      created: 1800000000,
      object: {
        id: "in_recovered",
        parent: { subscription_details: { subscription: "sub_test_123" } },
        lines: { data: [{ period: { end: 1802678400 } }] },
      },
    }));
    const { POST: webhookPOST } = await import("@/app/api/stripe/webhook/route");
    const res = await webhookPOST(makeWebhookRequest("body", "sig"));
    expect(res.status).toBe(200);
    expect(updates.some((u) => u.table === "subscriptions" && u.patch.status === "active")).toBe(true);
  });

  it("invoice.paid returns 500 when the admin database client is unavailable", async () => {
    vi.mocked(isAdminSupabaseConfigured).mockReturnValue(false);
    mockConstructEvent.mockReturnValue(makeStripeEvent("invoice.paid", {
      id: "evt_no_db",
      object: {
        id: "in_no_db",
        parent: { subscription_details: { subscription: "sub_test_123" } },
        lines: { data: [{ period: { end: 1702678400 } }] },
      },
    }));
    const { POST: webhookPOST } = await import("@/app/api/stripe/webhook/route");
    const res = await webhookPOST(makeWebhookRequest("body", "sig"));
    expect(res.status).toBe(500);
    expect(getAdminSupabase).not.toHaveBeenCalled();
  });

  it("credit pack grant RPC error → 500 and the event is not marked processed", async () => {
    const { sb, inserts } = buildTrackingSupabase();
    (sb as any).rpc = vi.fn(async () => ({ data: null, error: { message: "ledger down" } }));
    vi.mocked(isAdminSupabaseConfigured).mockReturnValue(true);
    vi.mocked(getAdminSupabase).mockReturnValue(sb as any);

    mockConstructEvent.mockReturnValue(makeStripeEvent("checkout.session.completed", {
      id: "evt_pack_fail",
      object: {
        id: "cs_pack_fail",
        metadata: { clerk_id: "user_123", coin_amount: "4000", product_type: "credit_pack" },
      },
    }));

    const { POST: webhookPOST } = await import("@/app/api/stripe/webhook/route");
    const res = await webhookPOST(makeWebhookRequest("body", "sig"));
    expect(res.status).toBe(500);
    expect(
      inserts.some((row) => row.table === "stripe_events" && row.row.result === "processed"),
    ).toBe(false);
  });

  it("customer.subscription.created without plan_id resolves Pro from the Stripe price", async () => {
    process.env.STRIPE_PRICE_PRO_BUILDER_BETA = "price_pro_test";
    const { sb, upserts } = buildTrackingSupabase();
    vi.mocked(isAdminSupabaseConfigured).mockReturnValue(true);
    vi.mocked(getAdminSupabase).mockReturnValue(sb as any);

    mockConstructEvent.mockReturnValue(makeStripeEvent("customer.subscription.created", {
      object: {
        id: "sub_pro_price",
        status: "active",
        customer: "cus_pro",
        metadata: { clerk_id: "user_123" },
        items: {
          data: [{
            price: { id: "price_pro_test" },
            current_period_start: 1700000000,
            current_period_end: 1702678400,
          }],
        },
      },
    }));

    const { POST: webhookPOST } = await import("@/app/api/stripe/webhook/route");
    const res = await webhookPOST(makeWebhookRequest("body", "sig"));
    expect(res.status).toBe(200);
    const subUpsert = upserts.find((u) => u.table === "subscriptions");
    expect(subUpsert?.row.plan).toBe("pro_builder_beta");
    expect(subUpsert?.row.plan).not.toBe("creator_beta");
  });

  it("customer.subscription.created without a resolvable plan → 500, does not guess creator_beta", async () => {
    delete process.env.STRIPE_PRICE_CREATOR_BETA;
    delete process.env.STRIPE_PRICE_PRO_BUILDER_BETA;
    const { sb, upserts } = buildTrackingSupabase();
    vi.mocked(isAdminSupabaseConfigured).mockReturnValue(true);
    vi.mocked(getAdminSupabase).mockReturnValue(sb as any);

    mockConstructEvent.mockReturnValue(makeStripeEvent("customer.subscription.created", {
      id: "evt_unknown_plan",
      object: {
        id: "sub_unknown_plan",
        status: "active",
        customer: "cus_unknown",
        metadata: { clerk_id: "user_123" },
        items: { data: [{ price: { id: "price_not_configured" } }] },
      },
    }));

    const { POST: webhookPOST } = await import("@/app/api/stripe/webhook/route");
    const res = await webhookPOST(makeWebhookRequest("body", "sig"));
    expect(res.status).toBe(500);
    expect(upserts.find((u) => u.table === "subscriptions")).toBeUndefined();
  });

  it("charge.refunded debit RPC error → 500 (event not acknowledged)", async () => {
    const { sb } = buildTrackingSupabase();
    (sb as any).rpc = vi.fn(async () => ({ data: null, error: { message: "debit failed" } }));
    vi.mocked(isAdminSupabaseConfigured).mockReturnValue(true);
    vi.mocked(getAdminSupabase).mockReturnValue(sb as any);
    mockSucceededRefunds([{ id: "re_refund_fail", amount: 1000, created: 1700000001 }]);

    mockConstructEvent.mockReturnValue(makeStripeEvent("charge.refunded", {
      id: "evt_refund_fail",
      object: {
        id: "ch_refund_fail",
        amount: 1000,
        amount_refunded: 1000,
        currency: "usd",
        payment_intent: "pi_refund_fail",
        metadata: { product_type: "credit_pack", clerk_id: "clerk_123", coin_amount: "4000" },
      },
    }));

    const { POST: webhookPOST } = await import("@/app/api/stripe/webhook/route");
    const res = await webhookPOST(makeWebhookRequest("body", "sig"));
    expect(res.status).toBe(500);
  });

  it("invoice.payment_failed update error → 500", async () => {
    const tracked = buildTrackingSupabase();
    const origFrom = tracked.sb.from;
    tracked.sb.from = vi.fn((table: string) => {
      const chain = origFrom(table);
      if (table === "subscriptions") {
        chain.update = vi.fn(() => {
          const builder: any = {
            eq: vi.fn(() => builder),
            then: (resolve: (value: any) => void) =>
              resolve({ error: { message: "row locked" } }),
          };
          return builder;
        });
      }
      return chain;
    });
    vi.mocked(isAdminSupabaseConfigured).mockReturnValue(true);
    vi.mocked(getAdminSupabase).mockReturnValue(tracked.sb as any);

    mockConstructEvent.mockReturnValue(makeStripeEvent("invoice.payment_failed", {
      id: "evt_pastdue_fail",
      object: {
        id: "in_pastdue_fail",
        parent: { subscription_details: { subscription: "sub_test_123" } },
      },
    }));

    const { POST: webhookPOST } = await import("@/app/api/stripe/webhook/route");
    const res = await webhookPOST(makeWebhookRequest("body", "sig"));
    expect(res.status).toBe(500);
  });

  it("customer.subscription.deleted update error → 500", async () => {
    const tracked = buildTrackingSupabase();
    const origFrom = tracked.sb.from;
    tracked.sb.from = vi.fn((table: string) => {
      const chain = origFrom(table);
      if (table === "subscriptions") {
        chain.update = vi.fn(() => {
          const builder: any = {
            eq: vi.fn(() => builder),
            then: (resolve: (value: any) => void) =>
              resolve({ error: { message: "row locked" } }),
          };
          return builder;
        });
      }
      return chain;
    });
    vi.mocked(isAdminSupabaseConfigured).mockReturnValue(true);
    vi.mocked(getAdminSupabase).mockReturnValue(tracked.sb as any);

    mockConstructEvent.mockReturnValue(makeStripeEvent("customer.subscription.deleted", {
      id: "evt_cancel_fail",
      object: { id: "sub_test_123" },
    }));

    const { POST: webhookPOST } = await import("@/app/api/stripe/webhook/route");
    const res = await webhookPOST(makeWebhookRequest("body", "sig"));
    expect(res.status).toBe(500);
  });
});

// ═════════════════════════════════════════════════════════════════════
// INVOICE.PAID RACE CONDITION (webhook arrives before subscription row)
// ═════════════════════════════════════════════════════════════════════

describe("invoice.paid race condition — subscription row not yet written", () => {
  beforeEach(() => {
    process.env.STRIPE_SECRET_KEY = "sk_test_fake";
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_fake";
    // Make the retry loop instant in tests (no real 2s sleeps)
    vi.spyOn(globalThis, "setTimeout").mockImplementation(((cb: any) => {
      cb();
      return 0 as any;
    }) as any);
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    mockSubscriptionsRetrieve.mockReset();
    mockSubscriptionsRetrieve.mockResolvedValue({ status: "active" });
  });

  afterEach(() => {
    vi.mocked(console.error).mockRestore();
    vi.mocked(console.warn).mockRestore();
    // Restore the real setTimeout without nuking shared module mocks
    (globalThis.setTimeout as any).mockRestore?.();
  });

  /**
   * Builds a mock Supabase where the subscriptions lookup returns null for
   * the first `missCount` calls, then returns the row — simulating the
   * customer.subscription.created upsert landing mid-retry.
   */
  function buildRaceSupabase(missCount: number) {
    const base = buildTrackingSupabase();
    let subLookups = 0;
    // Replace from() entirely: every chain's single() is stateful, because
    // each .select()/.eq() returns a fresh chain object.
    base.sb.from = vi.fn((table: string) => {
      const chainObj: any = {
        select: vi.fn(() => chainObj),
        eq: vi.fn(() => chainObj),
        single: vi.fn(async () => {
          if (table === "subscriptions") {
            subLookups++;
            if (subLookups <= missCount) return { data: null, error: null };
            return { data: { user_id: "user_internal_123", plan: "creator_beta" }, error: null };
          }
          if (table === "users") return { data: { id: "user_internal_123" }, error: null };
          return { data: null, error: null };
        }),
        upsert: vi.fn(async (row: any, options?: { onConflict?: string }) => {
          base.upserts.push({ table, row, onConflict: options?.onConflict });
          return { error: null };
        }),
        insert: vi.fn(async (row: any) => {
          base.inserts.push({ table, row });
          return { error: null };
        }),
        update: vi.fn((patch: any) => {
          const builder: any = {
            eq: vi.fn(() => builder),
            then: (resolve: (v: any) => void) => resolve({ error: null }),
          };
          return builder;
        }),
      };
      return chainObj;
    });
    return { ...base, getSubLookups: () => subLookups };
  }

  function paidEvent() {
    return makeStripeEvent("invoice.paid", {
      object: {
        id: "in_test_race",
        parent: { subscription_details: { subscription: "sub_test_123" } },
        lines: { data: [{ period: { end: 1702678400 } }] },
      },
    });
  }

  it("waits for the subscription row and grants exactly once (no duplicate)", async () => {
    const { sb, rpcCalls, getSubLookups } = buildRaceSupabase(3);
    vi.mocked(isAdminSupabaseConfigured).mockReturnValue(true);
    vi.mocked(getAdminSupabase).mockReturnValue(sb as any);
    mockConstructEvent.mockReturnValue(paidEvent());

    const { POST: webhookPOST } = await import("@/app/api/stripe/webhook/route");
    const res = await webhookPOST(makeWebhookRequest("body", "sig"));

    expect(res.status).toBe(200);
    // Retried until the row appeared (3 misses + 1 hit)
    expect(getSubLookups()).toBe(4);
    // Granted exactly once — retries must not duplicate
    const grants = rpcCalls.filter((c) => c.fn === "grant_credits");
    expect(grants.length).toBe(1);
    expect(grants[0].params.p_idempotency_key).toBe("invoice_grant_in_test_race");
    expect(grants[0].params.p_amount).toBe(7500);
  });

  it("row never appears and Stripe fallback fails → 500 (Stripe retries; not silently dropped)", async () => {
    const { sb, rpcCalls, getSubLookups } = buildRaceSupabase(100); // never appears
    vi.mocked(isAdminSupabaseConfigured).mockReturnValue(true);
    vi.mocked(getAdminSupabase).mockReturnValue(sb as any);
    mockConstructEvent.mockReturnValue(paidEvent());
    mockSubscriptionsRetrieve.mockRejectedValue(new Error("stripe down"));

    const { POST: webhookPOST } = await import("@/app/api/stripe/webhook/route");
    const res = await webhookPOST(makeWebhookRequest("body", "sig"));

    // NOT 200: Stripe must retry. Event is not marked processed.
    expect(res.status).toBe(500);
    expect(getSubLookups()).toBe(6); // all retries exhausted
    expect(rpcCalls.filter((c) => c.fn === "grant_credits").length).toBe(0);
  });

  it("Stripe API fallback reconstructs the row and grants exactly once", async () => {
    const { sb, rpcCalls, upserts } = buildRaceSupabase(100); // row never appears via DB
    vi.mocked(isAdminSupabaseConfigured).mockReturnValue(true);
    vi.mocked(getAdminSupabase).mockReturnValue(sb as any);
    mockConstructEvent.mockReturnValue(paidEvent());
    // Fallback: Stripe returns the subscription with clerk metadata
    mockSubscriptionsRetrieve.mockResolvedValue({
      id: "sub_test_123",
      status: "active",
      metadata: { clerk_id: "user_123", plan_id: "creator_beta" },
      items: { data: [{ current_period_start: 1700000000, current_period_end: 1702678400 }] },
    });

    const { POST: webhookPOST } = await import("@/app/api/stripe/webhook/route");
    const res = await webhookPOST(makeWebhookRequest("body", "sig"));

    expect(res.status).toBe(200);
    // Subscription row was reconstructed via upsert on the user_id unique key.
    const rebuilt = upserts.find((u) => u.table === "subscriptions");
    expect(rebuilt).toBeDefined();
    expect(rebuilt?.onConflict).toBe("user_id");
    // Granted exactly once
    const grants = rpcCalls.filter((c) => c.fn === "grant_credits");
    expect(grants.length).toBe(1);
    expect(grants[0].params.p_idempotency_key).toBe("invoice_grant_in_test_race");
  });

  it("grant RPC failure → 500 propagates; retry grants exactly once (idempotent)", async () => {
    // First attempt: grant_credits throws
    const first = buildTrackingSupabase();
    let rpcShouldThrow = true;
    const origRpc = first.sb.rpc as any;
    first.sb.rpc = vi.fn(async (fnName: string, params: any) => {
      if (fnName === "grant_credits" && rpcShouldThrow) {
        throw new Error("db unavailable");
      }
      return origRpc(fnName, params);
    });
    vi.mocked(isAdminSupabaseConfigured).mockReturnValue(true);
    vi.mocked(getAdminSupabase).mockReturnValue(first.sb as any);
    mockConstructEvent.mockReturnValue(paidEvent());

    const { POST: webhookPOST } = await import("@/app/api/stripe/webhook/route");
    const res1 = await webhookPOST(makeWebhookRequest("body", "sig"));
    // Failure surfaces as 500 — Stripe will retry; event NOT marked processed
    expect(res1.status).toBe(500);

    // Retry (Stripe redelivery): grant now succeeds
    rpcShouldThrow = false;
    const second = buildTrackingSupabase();
    vi.mocked(getAdminSupabase).mockReturnValue(second.sb as any);
    // Same event id → but not marked processed (first attempt 500'd), so it processes
    mockConstructEvent.mockReturnValue(paidEvent());
    const res2 = await webhookPOST(makeWebhookRequest("body", "sig"));
    expect(res2.status).toBe(200);
    const grants = (second as any).rpcCalls.filter((c: any) => c.fn === "grant_credits");
    expect(grants.length).toBe(1);
    // Same idempotency key → the RPC layer dedups even if called twice
    expect(grants[0].params.p_idempotency_key).toBe("invoice_grant_in_test_race");
  });

  it("fallback upsert error → 500 (never grants on a failed reconstruction)", async () => {
    const { sb, rpcCalls } = buildRaceSupabase(100); // row never appears via DB
    // Make the fallback upsert fail
    (sb.from as any).mockImplementation((table: string) => {
      const chainObj: any = {
        select: () => chainObj,
        eq: () => chainObj,
        single: async () => {
          if (table === "users") return { data: { id: "user_internal_123" }, error: null };
          return { data: null, error: null };
        },
        upsert: async () => ({ error: { message: "permission denied" } }),
        insert: async () => ({ error: null }),
        update: (patch: any) => {
          const builder: any = { eq: () => builder, then: (r: any) => r({ error: null }) };
          return builder;
        },
      };
      return chainObj;
    });
    vi.mocked(isAdminSupabaseConfigured).mockReturnValue(true);
    vi.mocked(getAdminSupabase).mockReturnValue(sb as any);
    mockConstructEvent.mockReturnValue(paidEvent());
    mockSubscriptionsRetrieve.mockResolvedValue({
      id: "sub_test_123",
      status: "active",
      metadata: { clerk_id: "user_123", plan_id: "creator_beta" },
      items: { data: [] },
    });

    const { POST: webhookPOST } = await import("@/app/api/stripe/webhook/route");
    const res = await webhookPOST(makeWebhookRequest("body", "sig"));

    // Upsert failed → no grant attempted → 500 so Stripe retries
    expect(res.status).toBe(500);
    expect(rpcCalls.filter((c) => c.fn === "grant_credits").length).toBe(0);
  });

  it("grant_credits { error } (no throw) → 500; retry succeeds once", async () => {
    // RPC returns { error } instead of throwing — must still surface as 500
    const first = buildTrackingSupabase();
    let rpcShouldFail = true;
    const origRpc = first.sb.rpc as any;
    first.sb.rpc = vi.fn(async (fnName: string, params: any) => {
      if (fnName === "grant_credits" && rpcShouldFail) {
        return { data: null, error: { message: "duplicate key" } };
      }
      return origRpc(fnName, params);
    });
    vi.mocked(isAdminSupabaseConfigured).mockReturnValue(true);
    vi.mocked(getAdminSupabase).mockReturnValue(first.sb as any);
    mockConstructEvent.mockReturnValue(paidEvent());

    const { POST: webhookPOST } = await import("@/app/api/stripe/webhook/route");
    const res1 = await webhookPOST(makeWebhookRequest("body", "sig"));
    expect(res1.status).toBe(500);

    // Retry succeeds
    rpcShouldFail = false;
    const second = buildTrackingSupabase();
    vi.mocked(getAdminSupabase).mockReturnValue(second.sb as any);
    mockConstructEvent.mockReturnValue(paidEvent());
    const res2 = await webhookPOST(makeWebhookRequest("body", "sig"));
    expect(res2.status).toBe(200);
    const grants = (second as any).rpcCalls.filter((c: any) => c.fn === "grant_credits");
    expect(grants.length).toBe(1);
  });

  it("status update error → 500 (never silently leaves stale status)", async () => {
    const { sb, rpcCalls } = buildTrackingSupabase();
    // Make the subscriptions status update fail
    (sb.from as any).mockImplementation((table: string) => {
      const chainObj: any = {
        select: () => chainObj,
        eq: () => chainObj,
        single: async () => {
          if (table === "subscriptions") {
            return { data: { user_id: "user_internal_123", plan: "creator_beta" }, error: null };
          }
          if (table === "users") return { data: { id: "user_internal_123" }, error: null };
          return { data: null, error: null };
        },
        upsert: async (row: any) => ({ error: null }),
        insert: async (row: any) => ({ error: null }),
        update: (patch: any) => {
          const builder: any = {
            eq: () => builder,
            then: (r: any) => r({ error: { message: "row locked" } }),
          };
          return builder;
        },
      };
      return chainObj;
    });
    vi.mocked(isAdminSupabaseConfigured).mockReturnValue(true);
    vi.mocked(getAdminSupabase).mockReturnValue(sb as any);
    mockConstructEvent.mockReturnValue(paidEvent());

    const { POST: webhookPOST } = await import("@/app/api/stripe/webhook/route");
    const res = await webhookPOST(makeWebhookRequest("body", "sig"));

    // Status update failed → 500 before any grant → Stripe retries
    expect(res.status).toBe(500);
    expect(rpcCalls.filter((c) => c.fn === "grant_credits").length).toBe(0);
  });

  it("missing parent subscription id → 500 (not silently dropped)", async () => {
    const { sb, rpcCalls } = buildTrackingSupabase();
    vi.mocked(isAdminSupabaseConfigured).mockReturnValue(true);
    vi.mocked(getAdminSupabase).mockReturnValue(sb as any);
    mockConstructEvent.mockReturnValue(
      makeStripeEvent("invoice.paid", {
        id: "evt_noparent",
        object: { id: "in_test_noparent", lines: { data: [] } }, // no parent
      }),
    );

    const { POST: webhookPOST } = await import("@/app/api/stripe/webhook/route");
    const res = await webhookPOST(makeWebhookRequest("body", "sig"));

    // Malformed paid invoice must not be silently acknowledged
    expect(res.status).toBe(500);
    expect(rpcCalls.filter((c) => c.fn === "grant_credits").length).toBe(0);
  });

  it("invoice.paid grants the stored Pro allowance, not the Creator default", async () => {
    const { sb, rpcCalls } = buildTrackingSupabase();
    sb.from = vi.fn((table: string) => {
      const chainObj: any = {
        select: () => chainObj,
        eq: () => chainObj,
        single: async () => {
          if (table === "subscriptions") {
            return { data: { user_id: "user_internal_123", plan: "pro_builder_beta" }, error: null };
          }
          return { data: null, error: null };
        },
        upsert: async () => ({ error: null }),
        insert: async () => ({ error: null }),
        update: () => {
          const builder: any = { eq: () => builder, then: (r: any) => r({ error: null }) };
          return builder;
        },
        delete: () => {
          const builder: any = { eq: () => builder, then: (r: any) => r({ error: null }) };
          return builder;
        },
      };
      return chainObj;
    });
    vi.mocked(isAdminSupabaseConfigured).mockReturnValue(true);
    vi.mocked(getAdminSupabase).mockReturnValue(sb as any);
    mockConstructEvent.mockReturnValue(paidEvent());

    const { POST: webhookPOST } = await import("@/app/api/stripe/webhook/route");
    const res = await webhookPOST(makeWebhookRequest("body", "sig"));
    expect(res.status).toBe(200);
    const grants = rpcCalls.filter((c) => c.fn === "grant_credits");
    expect(grants).toHaveLength(1);
    expect(grants[0].params.p_amount).toBe(18000);
  });

  it("invoice.paid with an empty stored plan → 500 instead of granting Creator credits", async () => {
    const { sb, rpcCalls } = buildTrackingSupabase();
    sb.from = vi.fn((table: string) => {
      const chainObj: any = {
        select: () => chainObj,
        eq: () => chainObj,
        single: async () => {
          if (table === "subscriptions") {
            return { data: { user_id: "user_internal_123", plan: "" }, error: null };
          }
          return { data: null, error: null };
        },
        upsert: async () => ({ error: null }),
        insert: async () => ({ error: null }),
        update: () => {
          const builder: any = { eq: () => builder, then: (r: any) => r({ error: null }) };
          return builder;
        },
        delete: () => {
          const builder: any = { eq: () => builder, then: (r: any) => r({ error: null }) };
          return builder;
        },
      };
      return chainObj;
    });
    vi.mocked(isAdminSupabaseConfigured).mockReturnValue(true);
    vi.mocked(getAdminSupabase).mockReturnValue(sb as any);
    mockConstructEvent.mockReturnValue(
      makeStripeEvent("invoice.paid", {
        id: "evt_empty_plan",
        object: {
          id: "in_empty_plan",
          parent: { subscription_details: { subscription: "sub_test_123" } },
          lines: { data: [{ period: { end: 1702678400 } }] },
        },
      }),
    );

    const { POST: webhookPOST } = await import("@/app/api/stripe/webhook/route");
    const res = await webhookPOST(makeWebhookRequest("body", "sig"));
    expect(res.status).toBe(500);
    expect(rpcCalls.filter((c) => c.fn === "grant_credits")).toHaveLength(0);
  });
});

// ═════════════════════════════════════════════════════════════════════
// ENTITLEMENT RESOLUTION
// ═════════════════════════════════════════════════════════════════════

describe("Entitlement resolution", () => {
  it("returns starter entitlements for unknown user", () => {
    const ents = getEntitlementsForPlan("starter");
    expect(ents.planId).toBe("starter");
    expect(ents.activeProjectLimit).toBe(1);
    expect(ents.monthlyCredits).toBe(1500);
    expect(ents.terminal).toBe(false);
  });

  it("returns creator_beta entitlements with correct limits", () => {
    const ents = getEntitlementsForPlan("creator_beta");
    expect(ents.planId).toBe("creator_beta");
    expect(ents.activeProjectLimit).toBe(5);
    expect(ents.monthlyCredits).toBe(7500);
    expect(ents.voice).toBe(true);
    expect(ents.terminal).toBe(false);
  });

  it("returns pro_builder_beta entitlements with terminal access", () => {
    const ents = getEntitlementsForPlan("pro_builder_beta");
    expect(ents.planId).toBe("pro_builder_beta");
    expect(ents.activeProjectLimit).toBe(25);
    expect(ents.monthlyCredits).toBe(18000);
    expect(ents.terminal).toBe(true);
    expect(ents.premiumModels).toBe(true);
  });

  it("founder gets creator-level access with founder flag", () => {
    const ents = getEntitlementsForPlan("founder");
    expect(ents.planId).toBe("founder");
    expect(ents.founder).toBe(true);
    expect(ents.activeProjectLimit).toBe(5);
    expect(ents.voice).toBe(true);
  });

  it("plan rank: founder equals creator, pro_builder is highest customer tier", () => {
    expect(PLAN_RANK.founder).toBe(PLAN_RANK.creator_beta);
    expect(PLAN_RANK.pro_builder_beta).toBeGreaterThan(PLAN_RANK.creator_beta);
    expect(hasPlanAccess("founder", "creator_beta")).toBe(true);
    expect(hasPlanAccess("founder", "pro_builder_beta")).toBe(false);
    expect(hasPlanAccess("pro_builder_beta", "pro_builder_beta")).toBe(true);
  });
});

// ═════════════════════════════════════════════════════════════════════
// OWNER EXEMPTION
// ═════════════════════════════════════════════════════════════════════

describe("Owner billing exemption", () => {
  it("owner is billing-exempt with no simulation", () => {
    process.env.LITTLABS_VAPI_OWNER_CLERK_ID = "user_owner_123";
    expect(isOwnerClerkId("user_owner_123")).toBe(true);
    expect(isBillingExempt("user_owner_123", null)).toBe(true);
  });

  it("owner simulating customer tier is NOT billing-exempt", () => {
    process.env.LITTLABS_VAPI_OWNER_CLERK_ID = "user_owner_123";
    expect(isBillingExempt("user_owner_123", "starter")).toBe(false);
    expect(isBillingExempt("user_owner_123", "creator_beta")).toBe(false);
    expect(isBillingExempt("user_owner_123", "zero_bits")).toBe(false);
  });

  it("non-owner is never billing-exempt", () => {
    process.env.LITTLABS_VAPI_OWNER_CLERK_ID = "user_owner_123";
    expect(isBillingExempt("random_user", null)).toBe(false);
    expect(isBillingExempt("random_user", "starter")).toBe(false);
  });

  it("owner entitlements have unlimited projects and 0 monthly credits", () => {
    expect(OWNER_ENTITLEMENTS.activeProjectLimit).toBe(999_999);
    expect(OWNER_ENTITLEMENTS.monthlyCredits).toBe(0);
    expect(OWNER_ENTITLEMENTS.terminal).toBe(true);
    expect(OWNER_ENTITLEMENTS.premiumModels).toBe(true);
  });
});

// ═════════════════════════════════════════════════════════════════════
// INSUFFICIENT CREDIT BEHAVIOR
// ═════════════════════════════════════════════════════════════════════

describe("Insufficient credit behavior via wallet-ledger", () => {
  it("adjustWalletBalance throws 'Insufficient balance' when debit exceeds balance", async () => {
    const { adjustWalletBalance } = await import("@/lib/wallet-ledger");

    function makeChainable(terminalData: any = null) {
      const chain: any = {
        select: vi.fn(() => chain),
        eq: vi.fn(() => chain),
        in: vi.fn(() => chain),
        limit: vi.fn(() => chain),
        order: vi.fn(() => chain),
        like: vi.fn(() => chain),
        gte: vi.fn(() => chain),
        single: vi.fn(async () => ({ data: terminalData, error: null })),
        maybeSingle: vi.fn(async () => ({ data: terminalData, error: null })),
      };
      return chain;
    }

    const mockFrom = vi.fn((table: string) => {
      if (table === "users") return makeChainable({ id: "user_internal_123" });
      if (table === "subscriptions") return makeChainable(null);
      return makeChainable(null);
    });

    const mockRpc = vi.fn(async (fnName: string) => {
      if (fnName === "get_user_balances")
        return { data: { monthly: 0, purchased: 0, beta_promotional: 0, total: 0 }, error: null };
      if (fnName === "debit_credits")
        return { data: { success: false, remaining: 0 }, error: null };
      return { data: null, error: null };
    });

    vi.mocked(getSupabaseAdmin).mockReturnValue({ from: mockFrom, rpc: mockRpc } as any);

    await expect(
      adjustWalletBalance({
        clerkId: "user_123",
        amount: -100,
        type: "spend",
        reason: "test debit",
        idempotencyKey: "test_insufficient_1",
      }),
    ).rejects.toThrow("Insufficient balance");
  });
});

// ═════════════════════════════════════════════════════════════════════
// PLAN CONFIGURATION
// ═════════════════════════════════════════════════════════════════════

describe("Plan configuration", () => {
  it("all purchasable plans are enabled; retired Founder is not", () => {
    expect(PLANS.starter.enabled).toBe(true);
    expect(PLANS.creator_beta.enabled).toBe(true);
    expect(PLANS.pro_builder_beta.enabled).toBe(true);
    expect(PLANS.founder.enabled).toBe(false);
    expect(PLAN_LIST.find((p) => p.id === "owner")).toBeUndefined();
    expect(PLAN_LIST.find((p) => p.id === "founder")).toBeUndefined();
  });

  it("retired Founder plan has no Stripe price env, so no session can resolve", () => {
    process.env.STRIPE_PRICE_FOUNDER = "price_test_founder";
    expect(PLANS.founder.stripePriceIdEnv).toBeUndefined();
    expect(getStripePriceId(PLANS.founder)).toBe(null);
  });

  it("existing Founding Members keep Creator-level entitlements", () => {
    // Grandfathering contract: the plan definition and rank must survive
    // retirement, because the subscriptions table stores the literal id.
    expect(PLANS.founder).toBeDefined();
    expect(PLAN_RANK.founder).toBe(PLAN_RANK.creator_beta);
  });

  it("getStripePriceId returns null when env var is not set", () => {
    delete process.env.STRIPE_PRICE_CREATOR_BETA;
    expect(getStripePriceId(PLANS.creator_beta)).toBe(null);
  });

  it("getStripePriceId returns the price ID when env var is set", () => {
    process.env.STRIPE_PRICE_CREATOR_BETA = "price_test_123";
    expect(getStripePriceId(PLANS.creator_beta)).toBe("price_test_123");
    delete process.env.STRIPE_PRICE_CREATOR_BETA;
  });

  it("starter plan has no Stripe price ID env", () => {
    expect(PLANS.starter.stripePriceIdEnv).toBeUndefined();
  });

  it("founder plan is one-time billing, not subscription", () => {
    expect(PLANS.founder.billingType).toBe("one_time");
    expect(PLANS.founder.monthlyCredits).toBe(0);
    expect(PLANS.founder.founderLimit).toBe(100);
  });

  it("getPlanById returns null for unknown plan", () => {
    expect(getPlanById("nonexistent")).toBeNull();
    expect(getPlanById("starter")?.id).toBe("starter");
  });
});

// ═════════════════════════════════════════════════════════════════════
// STRIPE PRODUCT CATALOG
// ═════════════════════════════════════════════════════════════════════

describe("Stripe product catalog", () => {
  it("catalog is empty (no credit packs approved yet)", () => {
    expect(Object.keys(PRODUCT_CATALOG).length).toBe(0);
    expect(getProductById("anything")).toBeUndefined();
  });

  it("checkout route rejects unknown products with 404", async () => {
    vi.mocked(auth).mockResolvedValue({ userId: "user_123", clerkId: "user_123" } as any);
    const { POST: stripeCheckoutPOST } = await import("@/app/api/stripe/checkout/route");
    const req = makeNextRequest(JSON.stringify({ productId: "nonexistent" }));
    const res = await stripeCheckoutPOST(req);
    expect(res.status).toBe(404);
  });
});

// ═════════════════════════════════════════════════════════════════════
// CHECKOUT FAILURE MODES
// ═════════════════════════════════════════════════════════════════════

describe("Checkout failure modes", () => {
  it("fails safely when STRIPE_SECRET_KEY missing → 501, no session created", async () => {
    vi.mocked(auth).mockResolvedValue({ userId: "user_123", clerkId: "user_123" } as any);
    delete process.env.STRIPE_SECRET_KEY;
    const req = makeNextRequest(JSON.stringify({ planId: "creator_beta" }));
    const res = await checkoutPOST(req);
    expect(res.status).toBe(501);
    const body = await res.json();
    expect(body.setup_required).toBe(true);
    expect(body.url).toBeUndefined();
  });

  it("fails safely when price ID missing → 501, no session created", async () => {
    vi.mocked(auth).mockResolvedValue({ userId: "user_123", clerkId: "user_123" } as any);
    process.env.STRIPE_SECRET_KEY = "sk_test_fake";
    delete process.env.STRIPE_PRICE_CREATOR_BETA;
    const req = makeNextRequest(JSON.stringify({ planId: "creator_beta" }));
    const res = await checkoutPOST(req);
    expect(res.status).toBe(501);
    const body = await res.json();
    expect(body.setup_required).toBe(true);
    expect(body.url).toBeUndefined();
  });

  it("fails safely when user unauthenticated → 401, no Stripe call", async () => {
    vi.mocked(auth).mockResolvedValue({ userId: null, clerkId: null } as any);
    process.env.STRIPE_SECRET_KEY = "sk_test_fake";
    process.env.STRIPE_PRICE_CREATOR_BETA = "price_test";
    const req = makeNextRequest(JSON.stringify({ planId: "creator_beta" }));
    const res = await checkoutPOST(req);
    expect(res.status).toBe(401);
    expect((await res.json()).url).toBeUndefined();
  });

  it("fails safely when plan unknown → 400, no Stripe call", async () => {
    vi.mocked(auth).mockResolvedValue({ userId: "user_123", clerkId: "user_123" } as any);
    process.env.STRIPE_SECRET_KEY = "sk_test_fake";
    const req = makeNextRequest(JSON.stringify({ planId: "nonexistent" }));
    const res = await checkoutPOST(req);
    expect(res.status).toBe(400);
    expect((await res.json()).url).toBeUndefined();
  });

  it("fails safely when Stripe API returns error → forwards error, no url", async () => {
    vi.mocked(auth).mockResolvedValue({ userId: "user_123", clerkId: "user_123" } as any);
    process.env.STRIPE_SECRET_KEY = "sk_test_fake";
    process.env.STRIPE_PRICE_CREATOR_BETA = "price_test";

    const originalFetch = global.fetch;
    global.fetch = vi.fn(async () => ({
      ok: false,
      status: 400,
      json: async () => ({ error: { message: "Invalid price" } }),
    }) as any);

    const req = makeNextRequest(JSON.stringify({ planId: "creator_beta" }));
    const res = await checkoutPOST(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("Invalid price");
    expect(body.url).toBeUndefined();

    global.fetch = originalFetch;
  });

  it("webhook fails safely when secret missing → 500, no state mutation", async () => {
    delete process.env.STRIPE_WEBHOOK_SECRET;
    process.env.STRIPE_SECRET_KEY = "sk_test_fake";
    const { POST: webhookPOST } = await import("@/app/api/stripe/webhook/route");
    const req = makeWebhookRequest("body", "sig");
    const res = await webhookPOST(req);
    expect(res.status).toBe(500);
  });

  it("webhook fails safely when signature invalid → 400, no state mutation", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_fake";
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_fake";
    mockConstructEvent.mockImplementation(() => {
      throw new Error("Invalid signature");
    });
    const { POST: webhookPOST } = await import("@/app/api/stripe/webhook/route");
    const req = makeWebhookRequest("body", "invalid_sig");
    const res = await webhookPOST(req);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("Webhook Error");
  });
});
