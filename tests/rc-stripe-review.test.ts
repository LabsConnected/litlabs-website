// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const probe = vi.hoisted(() => ({
  grants: vi.fn(),
  processed: vi.fn(),
  lookup: vi.fn(),
  // Emulated token-fenced stripe_events claim rows: eventId -> {token,result}
  claims: new Map<string, { token: string; result: string }>(),
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
    rpc: (fn: string, args: Record<string, unknown>) => {
      // Emulate the token-fenced claim RPCs (migration
      // 20261015240000_stripe_event_claim_token).
      if (fn === "claim_stripe_event") {
        const id = args.p_stripe_event_id as string;
        const row = probe.claims.get(id);
        if (!row) {
          probe.claims.set(id, { token: args.p_claim_token as string, result: "processing" });
          return Promise.resolve({ data: "owned", error: null });
        }
        if (row.result !== "processing") return Promise.resolve({ data: "duplicate", error: null });
        return Promise.resolve({ data: "in_progress", error: null });
      }
      if (fn === "finalize_stripe_event") {
        const row = probe.claims.get(args.p_stripe_event_id as string);
        if (row && row.result === "processing" && row.token === args.p_claim_token) {
          row.result = args.p_result as string;
        }
        if (args.p_result === "processed") probe.processed(args);
        return Promise.resolve({ data: true, error: null });
      }
      if (fn === "release_stripe_event") {
        const id = args.p_stripe_event_id as string;
        const row = probe.claims.get(id);
        if (row && row.result === "processing" && row.token === args.p_claim_token) {
          probe.claims.delete(id);
        }
        return Promise.resolve({ data: "released", error: null });
      }
      return probe.grants(fn, args);
    },
    from: (table: string) => {
      const builder = {
        select: () => builder,
        eq: () => builder,
        single: async () => ({ data: null, error: null }),
        maybeSingle: async () => table === "users"
          ? probe.lookup()
          : { data: null, error: null },
        insert: async () => ({ error: null }),
        update: () => ({ eq: async () => ({ error: null }) }),
      };
      return builder;
    },
  }),
}));
import { POST } from "@/app/api/stripe/webhook/route";
beforeEach(() => {
  vi.clearAllMocks();
  probe.claims.clear();
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
