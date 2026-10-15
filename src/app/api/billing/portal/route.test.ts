// @vitest-environment node
/**
 * The billing portal return URL comes from the server app URL, not Origin.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { authMock, fromMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
  fromMock: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ auth: authMock }));
vi.mock("@/lib/rate-limiter", () => ({ withRateLimit: (handler: unknown) => handler }));
vi.mock("@/lib/supabase", () => ({ getSupabaseAdmin: () => ({ from: fromMock }) }));

import { POST } from "./route";

function request() {
  return {
    headers: { get: (name: string) => (name === "origin" ? "https://evil.example" : null) },
    json: async () => ({}),
  } as any;
}

beforeEach(() => {
  vi.clearAllMocks();
  authMock.mockResolvedValue({ userId: "clerk_portal" });
  process.env.STRIPE_SECRET_KEY = "sk_test_fake_key";
  process.env.NEXT_PUBLIC_APP_URL = "https://app.example";
  delete process.env.STRIPE_PORTAL_CONFIG_ID;
  fromMock.mockImplementation((table: string) => {
    const builder = {
      select: () => builder,
      eq: () => builder,
      single: async () => {
        if (table === "users") return { data: { id: "db-user" }, error: null };
        return { data: { stripe_customer_id: "cus_portal" }, error: null };
      },
    };
    return builder;
  });
});

describe("POST /api/billing/portal", () => {
  it("ignores Origin and uses the server app URL", async () => {
    const original = global.fetch;
    global.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({ url: "https://billing.stripe.com/session" }),
    })) as any;
    const res = await POST(request());
    expect(res.status).toBe(200);
    const params = new URLSearchParams((global.fetch as any).mock.calls[0][1].body as string);
    expect(params.get("return_url")).toBe("https://app.example/settings?section=billing");
    expect(params.get("return_url")).not.toContain("evil.example");
    expect(params.get("customer")).toBe("cus_portal");
    expect(params.get("configuration")).toBeNull();
    global.fetch = original;
  });

  it("passes STRIPE_PORTAL_CONFIG_ID when it is set", async () => {
    process.env.STRIPE_PORTAL_CONFIG_ID = "bpc_test_123";
    const original = global.fetch;
    global.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({ url: "https://billing.stripe.com/session" }),
    })) as any;
    const res = await POST(request());
    expect(res.status).toBe(200);
    const params = new URLSearchParams((global.fetch as any).mock.calls[0][1].body as string);
    expect(params.get("configuration")).toBe("bpc_test_123");
    global.fetch = original;
  });
});
