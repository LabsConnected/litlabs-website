// @vitest-environment node
/**
 * Unit tests for the Stripe webhook route.
 *
 * Verifies that the webhook endpoint returns appropriate status codes:
 * - 400 for missing stripe-signature header
 * - 400 for invalid signature
 * - 503 for missing STRIPE_SECRET_KEY or STRIPE_WEBHOOK_SECRET
 * - Never 500 for expected client/configuration errors
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

// Mock supabase-admin before importing the route
vi.mock("@/lib/supabase-admin", () => ({
  getAdminSupabase: vi.fn(),
  isAdminSupabaseConfigured: vi.fn(() => false),
}));

vi.mock("@/config/plans", () => ({
  PLANS: {},
}));

import { POST } from "@/app/api/stripe/webhook/route";

function makeRequest(body: string, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest("http://localhost/api/stripe/webhook", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body,
  });
}

describe("Stripe webhook route — error handling", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    delete process.env.STRIPE_SECRET_KEY;
    delete process.env.STRIPE_WEBHOOK_SECRET;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("returns 503 when STRIPE_SECRET_KEY is missing", async () => {
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_test";
    const req = makeRequest("{}", { "stripe-signature": "t=1,v1=abc" });
    const res = await POST(req);
    expect(res.status).toBe(503);
    const data = await res.json();
    expect(data.error).toContain("not configured");
  });

  it("returns 503 when STRIPE_WEBHOOK_SECRET is missing", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_123";
    const req = makeRequest("{}", { "stripe-signature": "t=1,v1=abc" });
    const res = await POST(req);
    expect(res.status).toBe(503);
    const data = await res.json();
    expect(data.error).toContain("not configured");
  });

  it("returns 400 when stripe-signature header is missing", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_123";
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_test";
    const req = makeRequest("{}");
    const res = await POST(req);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("Missing stripe-signature");
  });

  it("returns 400 for invalid signature (not 500)", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_123";
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_test";
    const req = makeRequest("{}", { "stripe-signature": "t=1,v1=invalid" });
    const res = await POST(req);
    expect(res.status).toBe(400);
    expect(res.status).toBeLessThan(500);
    const data = await res.json();
    expect(data.error).toContain("Webhook Error");
  });

  it("never returns 500 for any expected error path", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_123";
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_test";

    const cases: { body: string; headers: Record<string, string> }[] = [
      { body: "{}", headers: {} },
      { body: "{}", headers: { "stripe-signature": "invalid" } },
      { body: "", headers: { "stripe-signature": "t=1,v1=bad" } },
      { body: "not json", headers: { "stripe-signature": "t=1,v1=bad" } },
    ];

    for (const { body, headers } of cases) {
      const req = makeRequest(body, headers);
      const res = await POST(req);
      expect(res.status, `body="${body}" headers=${JSON.stringify(headers)}`).toBeLessThan(500);
    }
  });
});
