// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const probe = vi.hoisted(() => ({
  grants: vi.fn(),
  processed: vi.fn(),
  lookup: vi.fn(),
  event: {
    id: "review-event", type: "checkout.session.completed",
    data: { object: { id: "review-session", metadata: { coin_amount: "100", clerk_id: "review-user" } } },
  },
}));
vi.mock("stripe", () => ({
  default: class { webhooks = { constructEvent: () => probe.event }; },
}));
vi.mock("@/lib/business-operations", () => ({ confirmBookingPayment: vi.fn(), recordAudit: vi.fn() }));
vi.mock("@/lib/supabase-admin", () => ({
  isAdminSupabaseConfigured: () => true,
  getAdminSupabase: () => ({
    rpc: probe.grants,
    from: (table: string) => {
      const builder = {
        select: () => builder,
        eq: () => builder,
        single: async () => ({ data: null, error: null }),
        maybeSingle: async () => table === "users"
          ? probe.lookup()
          : { data: null, error: null },
        insert: probe.processed,
      };
      return builder;
    },
  }),
}));
import { POST } from "@/app/api/stripe/webhook/route";
beforeEach(() => {
  vi.clearAllMocks();
  probe.lookup.mockResolvedValue({ data: null, error: { message: "temporary database connection failure" } });
  probe.grants.mockResolvedValue({ error: null });
  // SDK verification is mocked; these are placeholders, not credentials.
  vi.stubEnv("STRIPE_SECRET_KEY", "review-placeholder");
  vi.stubEnv("STRIPE_WEBHOOK_SECRET", "review-placeholder");
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Network disabled in review"); }));
});
it("retries a credit-pack event when user resolution fails transiently", async () => {
  const response = await POST(new NextRequest("http://localhost/api/stripe/webhook", {
    method: "POST", body: "{}", headers: { "stripe-signature": "mocked" },
  }));
  expect.soft(response.status).toBe(500);
  expect(probe.processed).not.toHaveBeenCalled();
  expect(probe.grants).not.toHaveBeenCalled();
});

function delivery() {
  return POST(new NextRequest("http://localhost/api/stripe/webhook", {
    method: "POST", body: "{}", headers: { "stripe-signature": "mocked" },
  }));
}

it("grants the recovered delivery with a stable idempotency key", async () => {
  expect((await delivery()).status).toBe(500);
  probe.lookup.mockResolvedValue({ data: { id: "db-user" }, error: null });
  expect((await delivery()).status).toBe(200);
  expect(probe.grants).toHaveBeenCalledTimes(1);
  expect(probe.grants).toHaveBeenCalledWith("grant_credits", expect.objectContaining({
    p_user_id: "db-user", p_idempotency_key: "creditpack_review-session",
  }));
  expect(probe.processed).toHaveBeenCalledTimes(1);
});

it("distinguishes a confirmed missing user from a failed lookup", async () => {
  probe.lookup.mockResolvedValue({ data: null, error: null });
  expect((await delivery()).status).toBe(200);
  expect(probe.grants).not.toHaveBeenCalled();
  expect(probe.processed).toHaveBeenCalledTimes(1);
});
