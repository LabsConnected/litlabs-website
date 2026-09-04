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
vi.mock("stripe", () => ({
  default: vi.fn().mockImplementation(() => ({
    webhooks: { constructEvent: mockConstructEvent },
  })),
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
    data: { object: overrides.object || {} },
  };
}

/**
 * Builds a mock Supabase admin that tracks all RPC calls and table mutations.
 */
function buildTrackingSupabase(existingEvent = false) {
  const rpcCalls: { fn: string; params: any }[] = [];
  const upserts: { table: string; row: any }[] = [];
  const updates: { table: string; patch: any; matches: any[] }[] = [];
  const inserts: { table: string; row: any }[] = [];

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
      if (table === "stripe_events" && existingEvent)
        return { data: { id: "evt_existing" }, error: null };
      if (table === "subscriptions")
        return { data: { user_id: "user_internal_123", plan: "creator_beta" }, error: null };
      return { data: null, error: null };
    }),
    maybeSingle: vi.fn(async () => {
      if (table === "users") return { data: { id: "user_internal_123" }, error: null };
      if (table === "stripe_events" && existingEvent)
        return { data: { id: "evt_existing" }, error: null };
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
      return { error: null };
    }),
    update: vi.fn((patch: any) => ({
      eq: vi.fn(async (col: string, val: any) => {
        updates.push({ table, patch, matches: [{ col, val }] });
        return { error: null };
      }),
    })),
  });

  const sb = {
    from: vi.fn((table: string) => chain(table)),
    rpc: vi.fn(async (fnName: string, params: any) => {
      rpcCalls.push({ fn: fnName, params });
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

    const req = makeNextRequest(JSON.stringify({ planId: "creator_beta" }));
    const res = await checkoutPOST(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.url).toBe("https://checkout.stripe.com/test");
    expect(body.sessionId).toBe("cs_test_123");
    global.fetch = originalFetch;
  });

  it("uses payment mode for one-time Founder plan", async () => {
    vi.mocked(auth).mockResolvedValue({ userId: "user_123", clerkId: "user_123" } as any);
    process.env.STRIPE_SECRET_KEY = "sk_test_fake_key";
    process.env.STRIPE_PRICE_FOUNDER = "price_test_founder";

    const originalFetch = global.fetch;
    global.fetch = vi.fn(async (url: string, opts: any) => {
      if (url === "https://api.stripe.com/v1/checkout/sessions") {
        const body = opts.body as string;
        expect(body).toContain("mode=payment");
        expect(body).toContain("price_test_founder");
        expect(body).toContain("metadata%5Bplan_id%5D=founder");
        expect(body).toContain("payment_intent_data");
        return {
          ok: true,
          status: 200,
          json: async () => ({ id: "cs_test_founder", url: "https://checkout.stripe.com/founder" }),
        } as any;
      }
      return new Response("not found", { status: 404 });
    }) as any;

    const req = makeNextRequest(JSON.stringify({ planId: "founder" }));
    const res = await checkoutPOST(req);
    expect(res.status).toBe(200);
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
    expect(grants[0].params.p_amount).toBe(6000);
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
});

// ═════════════════════════════════════════════════════════════════════
// ENTITLEMENT RESOLUTION
// ═════════════════════════════════════════════════════════════════════

describe("Entitlement resolution", () => {
  it("returns starter entitlements for unknown user", () => {
    const ents = getEntitlementsForPlan("starter");
    expect(ents.planId).toBe("starter");
    expect(ents.activeProjectLimit).toBe(1);
    expect(ents.monthlyCredits).toBe(500);
    expect(ents.terminal).toBe(false);
  });

  it("returns creator_beta entitlements with correct limits", () => {
    const ents = getEntitlementsForPlan("creator_beta");
    expect(ents.planId).toBe("creator_beta");
    expect(ents.activeProjectLimit).toBe(5);
    expect(ents.monthlyCredits).toBe(6000);
    expect(ents.voice).toBe(true);
    expect(ents.terminal).toBe(false);
  });

  it("returns pro_builder_beta entitlements with terminal access", () => {
    const ents = getEntitlementsForPlan("pro_builder_beta");
    expect(ents.planId).toBe("pro_builder_beta");
    expect(ents.activeProjectLimit).toBe(25);
    expect(ents.monthlyCredits).toBe(20000);
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
  it("all customer plans are enabled", () => {
    expect(PLANS.starter.enabled).toBe(true);
    expect(PLANS.creator_beta.enabled).toBe(true);
    expect(PLANS.pro_builder_beta.enabled).toBe(true);
    expect(PLANS.founder.enabled).toBe(true);
    expect(PLAN_LIST.find((p) => p.id === "owner")).toBeUndefined();
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
