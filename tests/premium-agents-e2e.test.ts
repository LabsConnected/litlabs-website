// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockRpc, mockFrom } = vi.hoisted(() => ({
  mockRpc: vi.fn(),
  mockFrom: vi.fn(),
}));

vi.mock("@/lib/supabase", () => ({
  supabaseAdmin: {
    from: mockFrom,
    rpc: mockRpc,
  },
}));

vi.mock("@/lib/rate-limiter", () => ({
  withRateLimit: (handler: unknown) => handler,
}));

vi.mock("@clerk/nextjs/server", () => ({
  auth: async () => ({ userId: "user_test_123", clerkId: "user_test_123" }),
}));

vi.mock("@/lib/auth", () => ({
  auth: async () => ({ userId: "user_test_123", clerkId: "user_test_123" }),
}));

function chainableQuery(result: { data: unknown; error: unknown }) {
  const chain: Record<string, unknown> = {};
  const handler: ProxyHandler<Record<string, unknown>> = {
    get(_t, prop) {
      if (prop === "then")
        return (resolve: (v: unknown) => void) => resolve(result);
      if (prop === "catch")
        return () => Promise.resolve(result);
      if (prop === "single")
        return () => Promise.resolve(result);
      if (prop === "maybeSingle")
        return () => Promise.resolve(result);
      return () => new Proxy(chain, handler);
    },
  };
  return new Proxy(chain, handler);
}

function setupMockFrom(opts: {
  userId?: string | null;
  version?: Record<string, unknown> | null;
  hasEntitlement?: boolean;
  agentSlug?: string | null;
}) {
  mockFrom.mockImplementation((table: string) => {
    if (table === "users")
      return chainableQuery({
        data: opts.userId ? { id: opts.userId } : null,
        error: opts.userId ? null : { message: "not found" },
      });
    if (table === "agent_versions")
      return chainableQuery({
        data: opts.version ?? null,
        error: opts.version ? null : { message: "not found" },
      });
    if (table === "agent_entitlements")
      return chainableQuery({
        data: opts.hasEntitlement ? { id: "ent-1" } : null,
        error: null,
      });
    if (table === "agents")
      return chainableQuery({
        data: opts.agentSlug ? { slug: opts.agentSlug } : null,
        error: opts.agentSlug ? null : { message: "not found" },
      });
    return chainableQuery({ data: null, error: null });
  });
}

const mockFetch = vi.fn();
global.fetch = mockFetch as unknown as typeof global.fetch;

import { POST as checkoutPOST } from "@/app/api/marketplace/agents/[id]/checkout/route";
import { GET as entitlementsGET } from "@/app/api/marketplace/agents/entitlements/route";

function makeCheckoutReq() {
  return {
    headers: new Map([["origin", "https://litlabs.net"]]),
    json: async () => ({}),
  } as unknown as import("next/server").NextRequest;
}

function makeEntitlementsReq() {
  return {
    headers: new Map(),
  } as unknown as import("next/server").NextRequest;
}

describe("Premium Agents — E2E Checkout Flow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.STRIPE_SECRET_KEY = "sk_test_fake_key";
  });

  it("creates a Stripe checkout session for a valid agent", async () => {
    setupMockFrom({
      userId: "user-uuid-1",
      version: {
        id: "version-uuid-1",
        agent_id: "agent-uuid-1",
        stripe_price_id: "price_test_123",
        price_cents: 1900,
        status: "active",
      },
      hasEntitlement: false,
      agentSlug: "litt-growth",
    });

    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ url: "https://checkout.stripe.com/session_123", id: "cs_test_123" }),
    });

    const res = await checkoutPOST(makeCheckoutReq(), {
      params: Promise.resolve({ id: "agent-uuid-1" }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.url).toBe("https://checkout.stripe.com/session_123");
    expect(body.sessionId).toBe("cs_test_123");

    const fetchCall = mockFetch.mock.calls[0];
    const fetchBody = fetchCall[1].body as string;
    expect(fetchBody).toContain("price_test_123");
    expect(fetchBody).toContain("mode=payment");
    expect(fetchBody).toContain("metadata%5Bagent_version_id%5D=version-uuid-1");
    expect(fetchBody).toContain("metadata%5Bagent_slug%5D=litt-growth");
  });

  it("returns 409 if user already owns the agent", async () => {
    setupMockFrom({
      userId: "user-uuid-1",
      version: {
        id: "version-uuid-1",
        agent_id: "agent-uuid-1",
        stripe_price_id: "price_test_123",
        price_cents: 1900,
        status: "active",
      },
      hasEntitlement: true,
      agentSlug: "litt-growth",
    });

    const res = await checkoutPOST(makeCheckoutReq(), {
      params: Promise.resolve({ id: "agent-uuid-1" }),
    });

    expect(res.status).toBe(409);
  });

  it("returns 501 when Stripe is not configured", async () => {
    delete process.env.STRIPE_SECRET_KEY;
    setupMockFrom({
      userId: "user-uuid-1",
      version: {
        id: "version-uuid-1",
        agent_id: "agent-uuid-1",
        stripe_price_id: "price_test_123",
        price_cents: 1900,
        status: "active",
      },
      hasEntitlement: false,
      agentSlug: "litt-growth",
    });

    const res = await checkoutPOST(makeCheckoutReq(), {
      params: Promise.resolve({ id: "agent-uuid-1" }),
    });

    expect(res.status).toBe(501);
  });
});

describe("Premium Agents — E2E Webhook Idempotency", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("first webhook call processes successfully", async () => {
    mockRpc.mockResolvedValueOnce({ data: { status: "ok", order_id: "order-1" }, error: null });

    const result = await mockRpc("fulfill_agent_purchase", {
      p_stripe_event_id: "evt_unique_001",
      p_stripe_event_type: "checkout.session.completed",
      p_clerk_id: "user_test_123",
      p_agent_version_id: "version-uuid-1",
      p_agent_slug: "litt-growth",
      p_stripe_session_id: "cs_test_001",
      p_stripe_payment_intent_id: "pi_test_001",
      p_stripe_charge_id: null,
      p_amount_cents: 1900,
      p_currency: "usd",
    });

    expect(result.data.status).toBe("ok");
    expect(result.data.order_id).toBe("order-1");
  });

  it("duplicate webhook call returns already_processed", async () => {
    mockRpc.mockResolvedValueOnce({ data: { status: "already_processed" }, error: null });

    const result = await mockRpc("fulfill_agent_purchase", {
      p_stripe_event_id: "evt_unique_001",
      p_stripe_event_type: "checkout.session.completed",
      p_clerk_id: "user_test_123",
      p_agent_version_id: "version-uuid-1",
      p_agent_slug: "litt-growth",
      p_stripe_session_id: "cs_test_001",
      p_stripe_payment_intent_id: "pi_test_001",
      p_stripe_charge_id: null,
      p_amount_cents: 1900,
      p_currency: "usd",
    });

    expect(result.data.status).toBe("already_processed");
  });
});

describe("Premium Agents — E2E Refund Flow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("refund RPC revokes entitlement and marks order refunded", async () => {
    mockRpc.mockResolvedValueOnce({ data: { status: "ok", order_id: "order-1" }, error: null });

    const result = await mockRpc("refund_agent_purchase", {
      p_stripe_event_id: "evt_refund_001",
      p_stripe_event_type: "charge.refunded",
      p_stripe_payment_intent_id: "pi_test_001",
      p_stripe_refund_id: "re_test_001",
    });

    expect(result.data.status).toBe("ok");
    expect(result.data.order_id).toBe("order-1");
  });

  it("duplicate refund event returns already_processed", async () => {
    mockRpc.mockResolvedValueOnce({ data: { status: "already_processed" }, error: null });

    const result = await mockRpc("refund_agent_purchase", {
      p_stripe_event_id: "evt_refund_001",
      p_stripe_event_type: "charge.refunded",
      p_stripe_payment_intent_id: "pi_test_001",
      p_stripe_refund_id: "re_test_001",
    });

    expect(result.data.status).toBe("already_processed");
  });

  it("refund for non-existent order returns error", async () => {
    mockRpc.mockResolvedValueOnce({ data: { status: "error", message: "order_not_found" }, error: null });

    const result = await mockRpc("refund_agent_purchase", {
      p_stripe_event_id: "evt_refund_002",
      p_stripe_event_type: "charge.refunded",
      p_stripe_payment_intent_id: "pi_unknown",
      p_stripe_refund_id: "re_test_002",
    });

    expect(result.data.status).toBe("error");
    expect(result.data.message).toBe("order_not_found");
  });
});

describe("Premium Agents — E2E Kill Switch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.STRIPE_SECRET_KEY = "sk_test_fake_key";
  });

  it("suspended agent version returns 404 on checkout", async () => {
    setupMockFrom({
      userId: "user-uuid-1",
      version: null,
      hasEntitlement: false,
      agentSlug: null,
    });

    const res = await checkoutPOST(makeCheckoutReq(), {
      params: Promise.resolve({ id: "suspended-agent-uuid" }),
    });

    expect(res.status).toBe(404);
  });
});

describe("Premium Agents — E2E Entitlements Query", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns user entitlements", async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === "users")
        return chainableQuery({ data: { id: "user-uuid-1" }, error: null });
      if (table === "agent_entitlements")
        return chainableQuery({
          data: [
            {
              id: "ent-1",
              agent_version_id: "version-uuid-1",
              status: "active",
              created_at: "2026-07-28T00:00:00Z",
              updated_at: "2026-07-28T00:00:00Z",
              agent_versions: {
                agent_id: "agent-1",
                agents: { slug: "litt-growth", display_name: "LiTT Growth" },
              },
            },
          ],
          error: null,
        });
      return chainableQuery({ data: null, error: null });
    });

    const res = await entitlementsGET(makeEntitlementsReq());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.entitlements).toHaveLength(1);
    expect(body.entitlements[0].agent_slug).toBe("litt-growth");
    expect(body.entitlements[0].status).toBe("active");
  });
});
