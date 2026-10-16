// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The 409 already-subscribed path, without a Clerk session.
 * Auth is mocked. The route's own users → subscriptions lookup runs
 * against an in-memory table that honors eq(), so a row for a different
 * clerk cannot block this caller.
 */

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/rate-limiter", () => ({
  withRateLimit: (handler: (req: Request) => Promise<Response>) => handler,
}));
vi.mock("@/lib/supabase", () => ({ getSupabaseAdmin: vi.fn() }));

import { auth } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase";
import { POST } from "./route";

type Row = Record<string, unknown>;

function lookup(tables: Record<string, Row[]>) {
  const from = vi.fn((table: string) => {
    const filters: { col: string; val: unknown }[] = [];
    const query = {
      select: () => query,
      eq: (col: string, val: unknown) => {
        filters.push({ col, val });
        return query;
      },
      maybeSingle: async () => {
        const rows = (tables[table] ?? []).filter((row) =>
          filters.every((filter) => row[filter.col] === filter.val),
        );
        return { data: rows[0] ?? null, error: null };
      },
    };
    return query;
  });
  vi.mocked(getSupabaseAdmin).mockReturnValue({
    from,
    rpc: async (fn: string) => {
      if (fn === "begin_checkout_reservation") {
        return { data: { action: "create", token: "00000000-0000-4000-8000-000000000001" }, error: null };
      }
      if (fn === "commit_checkout_reservation") return { data: true, error: null };
      if (fn === "abort_checkout_reservation") return { data: true, error: null };
      return { data: null, error: { message: `unexpected rpc ${fn}` } };
    },
  } as never);
  return from;
}

function request(planId = "creator_beta") {
  return new Request("https://www.litlabs.net/api/billing/checkout", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ planId }),
  });
}

beforeEach(() => {
  process.env.STRIPE_SECRET_KEY = "sk_test_fake_key";
  process.env.STRIPE_PRICE_CREATOR_BETA = "price_test_creator";
  vi.mocked(auth).mockResolvedValue({ userId: "user_123" } as never);
});

describe("POST /api/billing/checkout already subscribed", () => {
  it("returns 409 from the subscription lookup and does not call Stripe", async () => {
    const originalFetch = global.fetch;
    const stripeCalls: string[] = [];
    global.fetch = vi.fn(async (url: string | URL | Request) => {
      stripeCalls.push(String(url));
      return new Response("stripe", { status: 500 });
    }) as typeof fetch;

    try {
      for (const status of ["active", "trialing", "past_due"]) {
        lookup({
          users: [{ id: "db-user", clerk_id: "user_123" }],
          subscriptions: [
            { user_id: "someone-else", status: "active", stripe_customer_id: "cus_other" },
            { user_id: "db-user", status, stripe_customer_id: "cus_existing" },
          ],
        });
        const res = await POST(request() as never);
        expect(res.status).toBe(409);
        const body = await res.json();
        expect(body.code).toBe("already_subscribed");
        expect(body.portalPath).toBe("/api/billing/portal");
      }
      expect(stripeCalls.filter((url) => url.includes("api.stripe.com"))).toHaveLength(0);
    } finally {
      global.fetch = originalFetch;
    }
  });

  it("parallel checkout attempts by an already-subscribed user all return 409", async () => {
    lookup({
      users: [{ id: "db-user", clerk_id: "user_123" }],
      subscriptions: [
        { user_id: "db-user", status: "active", stripe_customer_id: "cus_existing" },
      ],
    });
    const originalFetch = global.fetch;
    const stripeCalls: string[] = [];
    global.fetch = vi.fn(async (url: string | URL | Request) => {
      stripeCalls.push(String(url));
      return new Response("stripe", { status: 500 });
    }) as typeof fetch;
    try {
      const responses = await Promise.all([
        POST(request() as never),
        POST(request() as never),
        POST(request() as never),
      ]);
      for (const res of responses) {
        expect(res.status).toBe(409);
        const body = await res.json();
        expect(body.code).toBe("already_subscribed");
        expect(body.portalPath).toBe("/api/billing/portal");
      }
      expect(stripeCalls.filter((url) => url.includes("api.stripe.com"))).toHaveLength(0);
    } finally {
      global.fetch = originalFetch;
    }
  });

  it("does not treat another clerk's active subscription as this user's", async () => {
    lookup({
      users: [{ id: "db-other", clerk_id: "user_other" }],
      subscriptions: [
        { user_id: "db-other", status: "active", stripe_customer_id: "cus_other" },
      ],
    });
    const originalFetch = global.fetch;
    global.fetch = vi.fn(async () =>
      Response.json({ id: "cs_test_new", url: "https://checkout.stripe.com/new" }),
    ) as typeof fetch;
    try {
      const res = await POST(request() as never);
      expect(res.status).toBe(200);
      expect(global.fetch).toHaveBeenCalled();
    } finally {
      global.fetch = originalFetch;
    }
  });
});
