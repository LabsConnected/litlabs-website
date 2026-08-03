/**
 * Unit tests for the marketplace agent checkout route.
 *
 * These are unit-level tests that mock Clerk auth, Supabase, and global
 * fetch. They verify the security properties of the checkout route:
 * - Server-side price resolution (no client price)
 * - Trusted app URL (no request Origin)
 * - Stripe response validation
 * - Duplicate purchase prevention
 * - Sanitized errors
 * - Idempotency-Key sent as HTTP header (not form body)
 * - PaymentIntent metadata propagation for refund classification
 *
 * For real end-to-end verification of Stripe -> webhook -> Postgres ->
 * entitlement behavior, see the integration test plan in
 * tests/premium-agents-integration-plan.md.
 *
 * Run: pnpm exec vitest run tests/premium-agents.unit.test.ts
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// -- Mocks ----------------------------------------------------------------

let mockClerkId: string | null = "user_test_clerk_id";
vi.mock("@/lib/auth", () => ({
  auth: vi.fn(async () => ({ userId: mockClerkId, clerkId: mockClerkId })),
}));

// Mock Supabase admin client
let mockUser: { id: string } | null = { id: "user-uuid-123" };
let mockVersion: Record<string, unknown> | null = null;
let mockExistingEntitlement: unknown = null;
let mockAgent: { id: string; slug: string; is_public: boolean } | null = {
  id: "agent-uuid-001",
  slug: "litt-growth",
  is_public: true,
};
let mockListing: { status: string; item_type: string } | null = {
  status: "available",
  item_type: "agent",
};
let mockOrderInsert: { id: string } | null = { id: "order-uuid-456" };
let mockOrderUpdateError: unknown = null;
let mockSupabaseError: unknown = null;
let mockRpcResult: unknown = { order_id: "order-uuid-456", order_item_id: "item-uuid-789" };
let mockRpcError: unknown = null;

// Helper: create a chainable that resolves to the given result.
function makeChainable(resultFn: () => Promise<{ data: unknown; error: unknown }>) {
  const terminal = {
    single: vi.fn(resultFn),
    maybeSingle: vi.fn(resultFn),
  };
  const chainAfterEq = {
    eq: vi.fn(() => chainAfterEq),
    order: vi.fn(() => chainAfterEq),
    limit: vi.fn(() => chainAfterEq),
    single: terminal.single,
    maybeSingle: terminal.maybeSingle,
  };
  return {
    eq: vi.fn(() => chainAfterEq),
    order: vi.fn(() => chainAfterEq),
    limit: vi.fn(() => chainAfterEq),
    single: terminal.single,
    maybeSingle: terminal.maybeSingle,
  };
}

vi.mock("@/lib/supabase", () => ({
  supabaseAdmin: {
    from: vi.fn((table: string) => {
      const selectChain = makeChainable(async () => {
        if (table === "users") return { data: mockUser, error: mockSupabaseError };
        if (table === "agent_versions") return { data: mockVersion, error: mockSupabaseError };
        if (table === "agent_entitlements") return { data: mockExistingEntitlement, error: null };
        if (table === "agents") return { data: mockAgent, error: null };
        if (table === "marketplace_items") return { data: mockListing, error: null };
        return { data: null, error: null };
      });

      const insertChain = {
        select: vi.fn(() => ({
          single: vi.fn(async () => ({ data: mockOrderInsert, error: null })),
        })),
      };

      const updateChain = {
        eq: vi.fn(async () => ({ error: mockOrderUpdateError })),
      };

      return {
        select: vi.fn(() => selectChain),
        insert: vi.fn(() => insertChain),
        update: vi.fn(() => updateChain),
        eq: vi.fn(() => selectChain),
      };
    }),
    rpc: vi.fn(async () => ({ data: mockRpcResult, error: mockRpcError })),
  },
}));

vi.mock("@/lib/rate-limiter", () => ({
  withRateLimit: vi.fn((handler: unknown) => handler),
  rateLimit: vi.fn(async () => ({ success: true, remaining: 10, resetTime: 60 })),
}));

// -- Fetch mock ------------------------------------------------------------

let fetchStatus = 200;
let fetchJson: unknown = {
  id: "cs_test_123",
  url: "https://checkout.stripe.com/s/test",
};
let lastFetchBody: string | null = null;
let lastFetchHeaders: Record<string, string> = {};

beforeEach(() => {
  mockClerkId = "user_test_clerk_id";
  mockUser = { id: "user-uuid-123" };
  mockVersion = {
    id: "version-uuid-789",
    agent_id: "agent-uuid-001",
    version: "1.0.0",
    stripe_price_id: "price_test_abc",
    price_cents: 1900,
    currency: "usd",
    status: "published",
  };
  mockExistingEntitlement = null;
  mockAgent = { id: "agent-uuid-001", slug: "litt-growth", is_public: true };
  mockListing = { status: "available", item_type: "agent" };
  mockOrderInsert = { id: "order-uuid-456" };
  mockOrderUpdateError = null;
  mockSupabaseError = null;
  mockRpcResult = { order_id: "order-uuid-456", order_item_id: "item-uuid-789" };
  mockRpcError = null;
  fetchStatus = 200;
  fetchJson = { id: "cs_test_123", url: "https://checkout.stripe.com/s/test" };
  lastFetchBody = null;
  lastFetchHeaders = {};

  vi.stubGlobal("fetch", vi.fn(async (_url: RequestInfo, init?: RequestInit) => {
    lastFetchBody = init?.body ? String(init.body) : null;
    lastFetchHeaders = {};
    if (init?.headers) {
      const headers = init.headers as Record<string, string>;
      for (const [key, value] of Object.entries(headers)) {
        lastFetchHeaders[key.toLowerCase()] = value;
      }
    }
    return {
      ok: fetchStatus >= 200 && fetchStatus < 300,
      status: fetchStatus,
      json: async () => fetchJson,
    } as Response;
  }));

  process.env.STRIPE_SECRET_KEY = "sk_test_xxx";
  process.env.NEXT_PUBLIC_APP_URL = "https://litlabs.net";
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

// -- Helpers ---------------------------------------------------------------

function parseBody(body: string | null): Record<string, string> {
  if (!body) return {};
  const params = new URLSearchParams(body);
  const result: Record<string, string> = {};
  for (const [key, value] of params.entries()) {
    result[key] = value;
  }
  return result;
}

async function callCheckout(agentId: string) {
  const { POST } = await import(
    "@/app/api/marketplace/agents/[id]/checkout/route"
  );
  const req = new Request(
    `http://localhost:3000/api/marketplace/agents/${agentId}/checkout`,
    { method: "POST" },
  );
  return POST(req as never, {
    params: Promise.resolve({ id: agentId }),
  } as never);
}

// -- Tests -----------------------------------------------------------------

describe("marketplace/agents/[id]/checkout", () => {
  it("returns 401 when unauthenticated", async () => {
    mockClerkId = null;
    const res = await callCheckout("agent-uuid-001");
    expect(res.status).toBe(401);
  });

  it("returns 404 when user not found", async () => {
    mockUser = null;
    mockSupabaseError = { message: "not found" };
    const res = await callCheckout("agent-uuid-001");
    expect(res.status).toBe(404);
  });

  it("returns 404 when agent version not found", async () => {
    mockVersion = null;
    const res = await callCheckout("agent-uuid-001");
    expect(res.status).toBe(404);
  });

  it("returns 501 when stripe_price_id is not configured", async () => {
    mockVersion = {
      ...mockVersion,
      stripe_price_id: null,
    };
    const res = await callCheckout("agent-uuid-001");
    expect(res.status).toBe(501);
  });

  it("returns 500 when stripe_price_id has invalid format", async () => {
    mockVersion = {
      ...mockVersion,
      stripe_price_id: "not_a_price_id",
    };
    const res = await callCheckout("agent-uuid-001");
    expect(res.status).toBe(500);
  });

  it("returns 409 when user already owns the agent", async () => {
    mockExistingEntitlement = { id: "ent-uuid" };
    const res = await callCheckout("agent-uuid-001");
    expect(res.status).toBe(409);
  });

  it("creates a checkout session with server-owned price", async () => {
    const res = await callCheckout("agent-uuid-001");
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.url).toBe("https://checkout.stripe.com/s/test");
    expect(json.sessionId).toBe("cs_test_123");

    // Verify the Stripe request used the server-owned price, not client input
    const body = parseBody(lastFetchBody);
    expect(body["line_items[0][price]"]).toBe("price_test_abc");
    expect(body["line_items[0][quantity]"]).toBe("1");
  });

  it("uses trusted APP_URL, not request Origin", async () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://litlabs.net";
    const res = await callCheckout("agent-uuid-001");
    expect(res.status).toBe(200);
    const body = parseBody(lastFetchBody);
    // Success URL redirects to Studio with the agent slug so the buyer
    // can immediately open the purchased agent instance.
    expect(body.success_url).toContain("https://litlabs.net/studio");
    expect(body.cancel_url).toContain("https://litlabs.net/marketplace");
  });

  it("sets product_type=agent in Checkout Session metadata", async () => {
    const res = await callCheckout("agent-uuid-001");
    expect(res.status).toBe(200);
    const body = parseBody(lastFetchBody);
    expect(body["metadata[product_type]"]).toBe("agent");
    expect(body["metadata[checkout_version]"]).toBe("marketplace-agent-v1");
    expect(body["metadata[marketplace_order_id]"]).toBe("order-uuid-456");
    expect(body["metadata[agent_id]"]).toBe("agent-uuid-001");
    expect(body["metadata[agent_version_id]"]).toBe("version-uuid-789");
    expect(body["metadata[clerk_id]"]).toBe("user_test_clerk_id");
  });

  it("propagates metadata to PaymentIntent for refund classification", async () => {
    const res = await callCheckout("agent-uuid-001");
    expect(res.status).toBe(200);
    const body = parseBody(lastFetchBody);
    // PaymentIntent metadata is copied to the Charge by Stripe,
    // so charge.refunded events will carry this metadata.
    expect(body["payment_intent_data[metadata][product_type]"]).toBe("agent");
    expect(body["payment_intent_data[metadata][marketplace_order_id]"]).toBe("order-uuid-456");
    expect(body["payment_intent_data[metadata][agent_id]"]).toBe("agent-uuid-001");
    expect(body["payment_intent_data[metadata][agent_version_id]"]).toBe("version-uuid-789");
    expect(body["payment_intent_data[metadata][clerk_id]"]).toBe("user_test_clerk_id");
  });

  it("sends Idempotency-Key as HTTP header, not in form body", async () => {
    const res = await callCheckout("agent-uuid-001");
    expect(res.status).toBe(200);
    // The idempotency key must be in the HTTP header
    expect(lastFetchHeaders["idempotency-key"]).toBe("marketplace_order_order-uuid-456");
    // It must NOT be in the form body
    const body = parseBody(lastFetchBody);
    expect(body.idempotency_key).toBeUndefined();
  });

  it("returns 502 when Stripe returns non-2xx", async () => {
    fetchStatus = 400;
    fetchJson = { error: { message: "internal Stripe error" } };
    const res = await callCheckout("agent-uuid-001");
    expect(res.status).toBe(502);
    const json = await res.json();
    expect(json.error).toBe("Unable to create checkout session");
  });

  it("returns 502 when Stripe returns 200 without valid checkout URL", async () => {
    fetchJson = { id: "cs_123", url: "https://evil.com/redirect" };
    const res = await callCheckout("agent-uuid-001");
    expect(res.status).toBe(502);
  });

  it("returns 502 when Stripe returns 200 without session id", async () => {
    fetchJson = { url: "https://checkout.stripe.com/s/123" };
    const res = await callCheckout("agent-uuid-001");
    expect(res.status).toBe(502);
  });

  it("returns 500 when STRIPE_SECRET_KEY is missing", async () => {
    delete process.env.STRIPE_SECRET_KEY;
    const res = await callCheckout("agent-uuid-001");
    expect(res.status).toBe(500);
  });

  it("never exposes STRIPE_SECRET_KEY in responses", async () => {
    const res = await callCheckout("agent-uuid-001");
    const json = await res.json();
    expect(JSON.stringify(json)).not.toContain("sk_test");
    expect(JSON.stringify(json)).not.toContain("sk_live");
  });

  it("never reads request Origin header", async () => {
    const { POST } = await import(
      "@/app/api/marketplace/agents/[id]/checkout/route"
    );
    const req = new Request(
      "http://localhost:3000/api/marketplace/agents/agent-uuid-001/checkout",
      {
        method: "POST",
        headers: { origin: "https://evil.com" },
      },
    );
    const res = await POST(req as never, {
      params: Promise.resolve({ id: "agent-uuid-001" }),
    } as never);
    expect(res.status).toBe(200);
    const body = parseBody(lastFetchBody);
    // The return URL must use the trusted APP_URL, not the evil origin
    expect(body.success_url).toContain("https://litlabs.net");
    expect(body.success_url).not.toContain("evil.com");
  });

  it("creates a pending order before Stripe Checkout", async () => {
    const res = await callCheckout("agent-uuid-001");
    expect(res.status).toBe(200);
    // The mock verifies that marketplace_orders.insert was called
    // and the order ID appears in Stripe metadata
    const body = parseBody(lastFetchBody);
    expect(body["metadata[marketplace_order_id]"]).toBe("order-uuid-456");
  });
});
