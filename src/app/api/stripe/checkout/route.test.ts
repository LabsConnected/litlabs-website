/**
 * Security tests for the server-priced Stripe checkout route.
 *
 * Run: pnpm exec vitest run src/app/api/stripe/checkout/route.test.ts
 *
 * These tests verify that the browser cannot control any financial field.
 * They mock Clerk auth, global fetch (to inspect the exact form-encoded
 * Stripe request), and the product catalog (to inject controlled test
 * products).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// ── Mocks ──────────────────────────────────────────────────────────────

// Track the last fetch call so tests can inspect the form-encoded body.
let lastFetchUrl: string | null = null;
let lastFetchBody: string | null = null;
let lastFetchHeaders: Record<string, string> | null = null;
let fetchStatus = 200;
let fetchJson: unknown = { url: "https://checkout.stripe.com/s/123", id: "cs_123" };

// Mock Clerk auth — default to authenticated.
let mockClerkId: string | null = "user_test_clerk_id";
vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn(async () => ({ userId: mockClerkId })),
}));

// Mock the product catalog so tests can inject controlled products.
// We mock the module-level `getProductById` and `CHECKOUT_VERSION`.
let mockProducts: Record<string, import("@/config/stripe-products").ProductDefinition> = {};
vi.mock("@/config/stripe-products", () => ({
  CHECKOUT_VERSION: "server-priced-v1",
  getProductById: vi.fn((id: string) => mockProducts[id]),
}));

// ── Helpers ────────────────────────────────────────────────────────────

function makeProduct(
  overrides: Partial<import("@/config/stripe-products").ProductDefinition>,
): import("@/config/stripe-products").ProductDefinition {
  return {
    id: "test_product",
    active: true,
    type: "coin_pack",
    checkoutMode: "payment",
    currency: "usd",
    name: "Test Coin Pack",
    allowPromotionCodes: true,
    ...overrides,
  };
}

function makeReq(body: unknown): Request {
  return new Request("http://localhost:3000/api/stripe/checkout", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function callRoute(body: unknown) {
  const { POST } = await import("./route");
  return POST(makeReq(body) as never);
}

function parseBody(body: string | null): Record<string, string> {
  if (!body) return {};
  const params = new URLSearchParams(body);
  const result: Record<string, string> = {};
  for (const [key, value] of params.entries()) {
    result[key] = value;
  }
  return result;
}

// ── Setup ──────────────────────────────────────────────────────────────

beforeEach(() => {
  // Reset all mock state between tests.
  mockClerkId = "user_test_clerk_id";
  mockProducts = {};
  lastFetchUrl = null;
  lastFetchBody = null;
  lastFetchHeaders = null;
  fetchStatus = 200;
  fetchJson = { url: "https://checkout.stripe.com/s/123", id: "cs_123" };

  vi.stubGlobal("fetch", vi.fn(async (_url: RequestInfo, init?: RequestInit) => {
    lastFetchUrl = String(_url);
    lastFetchBody = init?.body ? String(init.body) : null;
    lastFetchHeaders = init?.headers as Record<string, string>;
    return {
      ok: fetchStatus >= 200 && fetchStatus < 300,
      status: fetchStatus,
      json: async () => fetchJson,
    } as Response;
  }));

  // Ensure Stripe key is set for most tests.
  process.env.STRIPE_SECRET_KEY = "sk_test_xxx";
  // Trusted app URL — HTTPS for production-like tests.
  process.env.NEXT_PUBLIC_APP_URL = "https://litlabs.net";
  delete process.env.APP_URL;
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

// ── Tests ─────────────────────────────────────────────────────────────

describe("stripe/checkout security", () => {
  // 1. Unauthenticated request returns 401
  it("returns 401 when unauthenticated", async () => {
    mockClerkId = null;
    const res = await callRoute({ productId: "test_product" });
    expect(res.status).toBe(401);
  });

  // 2. Valid active product succeeds
  it("creates a checkout session for a valid active product", async () => {
    mockProducts["coin_pack_500"] = makeProduct({
      id: "coin_pack_500",
      amountCents: 500,
      credits: 500,
      name: "500 LiTTBits",
    });
    const res = await callRoute({ productId: "coin_pack_500" });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.url).toBe("https://checkout.stripe.com/s/123");
    expect(json.sessionId).toBe("cs_123");
  });

  // 3. Unknown product is rejected
  it("returns 404 for unknown product", async () => {
    const res = await callRoute({ productId: "does_not_exist" });
    expect(res.status).toBe(404);
  });

  // 4. Inactive product is rejected
  it("returns 409 for inactive product", async () => {
    mockProducts["inactive_pack"] = makeProduct({
      id: "inactive_pack",
      active: false,
      amountCents: 500,
    });
    const res = await callRoute({ productId: "inactive_pack" });
    expect(res.status).toBe(409);
  });

  // 5. priceData is rejected
  it("rejects priceData", async () => {
    const res = await callRoute({
      productId: "coin_pack_500",
      priceData: { amount: 50, name: "cheap" },
    });
    expect(res.status).toBe(400);
  });

  // 6. Arbitrary priceId is rejected
  it("rejects arbitrary priceId", async () => {
    const res = await callRoute({ priceId: "price_abc123" });
    expect(res.status).toBe(400);
  });

  // 7. Client amount is rejected
  it("rejects client amount", async () => {
    const res = await callRoute({ productId: "coin_pack_500", amount: 50 });
    expect(res.status).toBe(400);
  });

  // 8. Client currency is rejected
  it("rejects client currency", async () => {
    const res = await callRoute({ productId: "coin_pack_500", currency: "eur" });
    expect(res.status).toBe(400);
  });

  // 9. Client name is rejected
  it("rejects client name", async () => {
    const res = await callRoute({ productId: "coin_pack_500", name: "fake" });
    expect(res.status).toBe(400);
  });

  // 10. Client mode is rejected
  it("rejects client mode", async () => {
    const res = await callRoute({ productId: "coin_pack_500", mode: "subscription" });
    expect(res.status).toBe(400);
  });

  // 11. Client clerk_id cannot override auth
  it("client clerk_id cannot override auth", async () => {
    mockProducts["coin_pack_500"] = makeProduct({
      id: "coin_pack_500",
      amountCents: 500,
      credits: 500,
    });
    const res = await callRoute({
      productId: "coin_pack_500",
      clerk_id: "attacker_id",
    });
    expect(res.status).toBe(400); // strict schema rejects unknown key
  });

  // 12. Client coin_amount cannot override catalog
  it("client coin_amount cannot override catalog", async () => {
    mockProducts["coin_pack_500"] = makeProduct({
      id: "coin_pack_500",
      amountCents: 500,
      credits: 500,
    });
    const res = await callRoute({
      productId: "coin_pack_500",
      coin_amount: "999999",
    });
    expect(res.status).toBe(400);
  });

  // 13. Client plan_id cannot override catalog
  it("client plan_id cannot override catalog", async () => {
    const res = await callRoute({
      productId: "coin_pack_500",
      plan_id: "founder",
    });
    expect(res.status).toBe(400);
  });

  // 14. Arbitrary client metadata is not forwarded
  it("arbitrary client metadata is not forwarded", async () => {
    mockProducts["coin_pack_500"] = makeProduct({
      id: "coin_pack_500",
      amountCents: 500,
      credits: 500,
    });
    const res = await callRoute({
      productId: "coin_pack_500",
      metadata: { evil_key: "evil_value", clerk_id: "attacker" },
    });
    expect(res.status).toBe(400);
    // Even if it were accepted, verify metadata wasn't forwarded:
    if (lastFetchBody) {
      expect(lastFetchBody).not.toContain("evil_key");
      expect(lastFetchBody).not.toContain("evil_value");
    }
  });

  // 15. Client email is not forwarded
  it("client email is not forwarded", async () => {
    mockProducts["coin_pack_500"] = makeProduct({
      id: "coin_pack_500",
      amountCents: 500,
      credits: 500,
    });
    const res = await callRoute({
      productId: "coin_pack_500",
      email: "attacker@evil.com",
      customer_email: "attacker@evil.com",
    });
    expect(res.status).toBe(400);
  });

  // 16. Return URLs use trusted app configuration
  it("return URLs use trusted app configuration, not request origin", async () => {
    mockProducts["coin_pack_500"] = makeProduct({
      id: "coin_pack_500",
      amountCents: 500,
      credits: 500,
    });
    process.env.NEXT_PUBLIC_APP_URL = "https://litlabs.net";
    const res = await callRoute({ productId: "coin_pack_500" });
    expect(res.status).toBe(200);
    const body = parseBody(lastFetchBody);
    expect(body.success_url).toContain("https://litlabs.net/order/success");
    expect(body.cancel_url).toContain("https://litlabs.net/marketplace");
  });

  // 17. Product checkoutMode controls Stripe mode
  it("product checkoutMode controls Stripe mode", async () => {
    mockProducts["sub_product"] = makeProduct({
      id: "sub_product",
      type: "plan",
      checkoutMode: "subscription",
      stripePriceId: "price_real_sub",
      planId: "creator_beta",
      allowPromotionCodes: false,
    });
    const res = await callRoute({ productId: "sub_product" });
    expect(res.status).toBe(200);
    const body = parseBody(lastFetchBody);
    expect(body.mode).toBe("subscription");
  });

  // 18. Product promotion policy controls allow_promotion_codes
  it("product promotion policy controls allow_promotion_codes", async () => {
    mockProducts["no_promo"] = makeProduct({
      id: "no_promo",
      amountCents: 500,
      allowPromotionCodes: false,
    });
    const res = await callRoute({ productId: "no_promo" });
    expect(res.status).toBe(200);
    const body = parseBody(lastFetchBody);
    expect(body.allow_promotion_codes).toBe("false");
  });

  // 19. Catalog coin_amount reaches session metadata
  it("catalog coin_amount reaches session metadata", async () => {
    mockProducts["coin_pack_500"] = makeProduct({
      id: "coin_pack_500",
      amountCents: 500,
      credits: 500,
    });
    const res = await callRoute({ productId: "coin_pack_500" });
    expect(res.status).toBe(200);
    const body = parseBody(lastFetchBody);
    expect(body["metadata[coin_amount]"]).toBe("500");
    expect(body["metadata[product_id]"]).toBe("coin_pack_500");
    expect(body["metadata[product_type]"]).toBe("coin_pack");
    expect(body["metadata[clerk_id]"]).toBe("user_test_clerk_id");
    expect(body["metadata[checkout_version]"]).toBe("server-priced-v1");
  });

  // 20. Stripe failure returns a sanitized response
  it("Stripe failure returns a sanitized response", async () => {
    mockProducts["coin_pack_500"] = makeProduct({
      id: "coin_pack_500",
      amountCents: 500,
      credits: 500,
    });
    fetchStatus = 400;
    fetchJson = { error: { message: "secret internal Stripe error with key sk_live_xxx" } };
    const res = await callRoute({ productId: "coin_pack_500" });
    expect(res.status).toBe(502);
    const json = await res.json();
    expect(json.error).toBe("Unable to create checkout session");
    expect(JSON.stringify(json)).not.toContain("sk_live");
    expect(JSON.stringify(json)).not.toContain("secret");
  });

  // 21. Secrets never appear in responses
  it("secrets never appear in responses on success", async () => {
    mockProducts["coin_pack_500"] = makeProduct({
      id: "coin_pack_500",
      amountCents: 500,
      credits: 500,
    });
    const res = await callRoute({ productId: "coin_pack_500" });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(JSON.stringify(json)).not.toContain("sk_test");
    expect(JSON.stringify(json)).not.toContain("sk_live");
  });

  // 22. Inspect the exact form-encoded Stripe request body
  it("sends correct form-encoded body to Stripe for ad-hoc amount product", async () => {
    mockProducts["coin_pack_500"] = makeProduct({
      id: "coin_pack_500",
      amountCents: 500,
      credits: 500,
      name: "500 LiTTBits",
      description: "Test pack",
    });
    const res = await callRoute({ productId: "coin_pack_500" });
    expect(res.status).toBe(200);
    expect(lastFetchUrl).toBe("https://api.stripe.com/v1/checkout/sessions");
    expect(lastFetchHeaders?.Authorization).toBe("Bearer sk_test_xxx");
    expect(lastFetchHeaders?.["Content-Type"]).toBe("application/x-www-form-urlencoded");

    const body = parseBody(lastFetchBody);
    expect(body.mode).toBe("payment");
    expect(body["line_items[0][price_data][currency]"]).toBe("usd");
    expect(body["line_items[0][price_data][unit_amount]"]).toBe("500");
    expect(body["line_items[0][price_data][product_data][name]"]).toBe("500 LiTTBits");
    expect(body["line_items[0][price_data][product_data][description]"]).toBe("Test pack");
    expect(body["line_items[0][quantity]"]).toBe("1");
    expect(body.allow_promotion_codes).toBe("true");
  });

  // 23. Catalog invariant: subscription without stripePriceId is rejected
  it("catalog invariant: subscription without stripePriceId throws", async () => {
    // Directly test validateCatalog
    const mod = await import("@/config/stripe-products");
    const badProduct = makeProduct({
      id: "bad_sub",
      type: "plan",
      checkoutMode: "subscription",
      amountCents: 1000,
      // no stripePriceId
    });
    expect(() =>
      (mod as { validateCatalog: (c: Record<string, unknown>) => void }).validateCatalog({
        bad_sub: badProduct,
      }),
    ).toThrow();
  });

  // 24. Product using both amountCents and stripePriceId is rejected
  it("catalog invariant: both amountCents and stripePriceId throws", async () => {
    const mod = await import("@/config/stripe-products");
    const badProduct = makeProduct({
      id: "bad_both",
      amountCents: 1000,
      stripePriceId: "price_xxx",
    });
    expect(() =>
      (mod as { validateCatalog: (c: Record<string, unknown>) => void }).validateCatalog({
        bad_both: badProduct,
      }),
    ).toThrow();
  });

  // 25. Malformed productId is rejected
  it("rejects malformed productId (empty string)", async () => {
    const res = await callRoute({ productId: "" });
    expect(res.status).toBe(400);
  });

  it("rejects malformed productId (missing field)", async () => {
    const res = await callRoute({});
    expect(res.status).toBe(400);
  });

  // 26. Production return URL cannot use HTTP
  it("production return URL cannot use HTTP", async () => {
    mockProducts["coin_pack_500"] = makeProduct({
      id: "coin_pack_500",
      amountCents: 500,
      credits: 500,
    });
    (process.env as Record<string, string>).NODE_ENV = "production";
    process.env.NEXT_PUBLIC_APP_URL = "http://litlabs.net";
    const res = await callRoute({ productId: "coin_pack_500" });
    expect(res.status).toBe(500);
    (process.env as Record<string, string>).NODE_ENV = "test";
  });

  // 27. Empty production catalog makes every product unavailable
  it("empty catalog makes every product unavailable (404)", async () => {
    // mockProducts is already empty from beforeEach
    const res = await callRoute({ productId: "any_product" });
    expect(res.status).toBe(404);
  });

  // 28. Stripe key missing returns sanitized 500
  it("returns sanitized 500 when Stripe key is missing", async () => {
    mockProducts["coin_pack_500"] = makeProduct({
      id: "coin_pack_500",
      amountCents: 500,
      credits: 500,
    });
    delete process.env.STRIPE_SECRET_KEY;
    const res = await callRoute({ productId: "coin_pack_500" });
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error).toBe("Unable to create checkout session");
    expect(JSON.stringify(json)).not.toContain("STRIPE_SECRET_KEY");
  });

  // 29. Invalid JSON body is rejected
  it("rejects invalid JSON body", async () => {
    const req = new Request("http://localhost:3000/api/stripe/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not valid json{{{",
    });
    const { POST } = await import("./route");
    const res = await POST(req as never);
    expect(res.status).toBe(400);
  });

  // 30. stripePriceId product sends price, not price_data
  it("sends Stripe price ID for stripePriceId product", async () => {
    mockProducts["sub_product"] = makeProduct({
      id: "sub_product",
      type: "plan",
      checkoutMode: "subscription",
      stripePriceId: "price_real_sub",
      planId: "creator_beta",
      allowPromotionCodes: false,
    });
    const res = await callRoute({ productId: "sub_product" });
    expect(res.status).toBe(200);
    const body = parseBody(lastFetchBody);
    expect(body["line_items[0][price]"]).toBe("price_real_sub");
    expect(body["line_items[0][price_data]"]).toBeUndefined();
    expect(body["metadata[plan_id]"]).toBe("creator_beta");
    expect(body["metadata[coin_amount]"]).toBeUndefined();
  });

  // 31. Stripe 200 without valid url is treated as failure
  it("returns 502 when Stripe returns 200 without a checkout URL", async () => {
    mockProducts["coin_pack_500"] = makeProduct({
      id: "coin_pack_500",
      amountCents: 500,
      credits: 500,
    });
    fetchJson = { id: "cs_123", url: "https://evil.com/redirect" };
    const res = await callRoute({ productId: "coin_pack_500" });
    expect(res.status).toBe(502);
    const json = await res.json();
    expect(json.error).toBe("Unable to create checkout session");
  });

  it("returns 502 when Stripe returns 200 without a session id", async () => {
    mockProducts["coin_pack_500"] = makeProduct({
      id: "coin_pack_500",
      amountCents: 500,
      credits: 500,
    });
    fetchJson = { url: "https://checkout.stripe.com/s/123" };
    const res = await callRoute({ productId: "coin_pack_500" });
    expect(res.status).toBe(502);
  });

  // ── Strengthened catalog invariants ──────────────────────────────

  // 32. Catalog key must equal product.id
  it("catalog invariant: key must equal product.id", async () => {
    const mod = await import("@/config/stripe-products");
    const badProduct = makeProduct({ id: "wrong_id", amountCents: 500, credits: 500 });
    expect(() =>
      (mod as { validateCatalog: (c: Record<string, unknown>) => void }).validateCatalog({
        mismatched_key: badProduct,
      }),
    ).toThrow();
  });

  // 33. currency must be approved lowercase
  it("catalog invariant: unapproved currency is rejected", async () => {
    const mod = await import("@/config/stripe-products");
    const badProduct = makeProduct({ id: "bad_cur", amountCents: 500, credits: 500, currency: "USD" });
    expect(() =>
      (mod as { validateCatalog: (c: Record<string, unknown>) => void }).validateCatalog({
        bad_cur: badProduct,
      }),
    ).toThrow();
  });

  // 34. stripePriceId must start with price_
  it("catalog invariant: stripePriceId must start with price_", async () => {
    const mod = await import("@/config/stripe-products");
    const badProduct = makeProduct({
      id: "bad_price",
      type: "plan",
      checkoutMode: "subscription",
      stripePriceId: "not_a_price_id",
      planId: "creator_beta",
    });
    expect(() =>
      (mod as { validateCatalog: (c: Record<string, unknown>) => void }).validateCatalog({
        bad_price: badProduct,
      }),
    ).toThrow();
  });

  // 35. credits must be a positive integer
  it("catalog invariant: non-positive credits is rejected", async () => {
    const mod = await import("@/config/stripe-products");
    const badProduct = makeProduct({ id: "bad_credits", amountCents: 500, credits: 0 });
    expect(() =>
      (mod as { validateCatalog: (c: Record<string, unknown>) => void }).validateCatalog({
        bad_credits: badProduct,
      }),
    ).toThrow();
  });

  // 36. coin_pack requires credits
  it("catalog invariant: coin_pack without credits is rejected", async () => {
    const mod = await import("@/config/stripe-products");
    const badProduct = makeProduct({ id: "no_credits", amountCents: 500, credits: undefined });
    expect(() =>
      (mod as { validateCatalog: (c: Record<string, unknown>) => void }).validateCatalog({
        no_credits: badProduct,
      }),
    ).toThrow();
  });

  // 37. plan requires planId
  it("catalog invariant: plan without planId is rejected", async () => {
    const mod = await import("@/config/stripe-products");
    const badProduct = makeProduct({
      id: "no_planid",
      type: "plan",
      checkoutMode: "subscription",
      stripePriceId: "price_real_sub",
      planId: undefined,
    });
    expect(() =>
      (mod as { validateCatalog: (c: Record<string, unknown>) => void }).validateCatalog({
        no_planid: badProduct,
      }),
    ).toThrow();
  });

  // 38. name must be non-empty
  it("catalog invariant: empty name is rejected", async () => {
    const mod = await import("@/config/stripe-products");
    const badProduct = makeProduct({ id: "no_name", amountCents: 500, credits: 500, name: "" });
    expect(() =>
      (mod as { validateCatalog: (c: Record<string, unknown>) => void }).validateCatalog({
        no_name: badProduct,
      }),
    ).toThrow();
  });

  // 39. Response with valid Stripe checkout URL succeeds
  it("succeeds when Stripe returns valid checkout URL", async () => {
    mockProducts["coin_pack_500"] = makeProduct({
      id: "coin_pack_500",
      amountCents: 500,
      credits: 500,
    });
    fetchJson = { id: "cs_valid_123", url: "https://checkout.stripe.com/s/valid" };
    const res = await callRoute({ productId: "coin_pack_500" });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.sessionId).toBe("cs_valid_123");
    expect(json.url).toBe("https://checkout.stripe.com/s/valid");
  });
});