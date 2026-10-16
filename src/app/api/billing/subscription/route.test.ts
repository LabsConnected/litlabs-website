// @vitest-environment node
/**
 * Billing status includes cancel_at_period_end from the subscriptions row.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { authMock, fromMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
  fromMock: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ auth: authMock }));
vi.mock("@/lib/rate-limiter", () => ({ withRateLimit: (handler: unknown) => handler }));
vi.mock("@/lib/supabase", () => ({ getSupabaseAdmin: () => ({ from: fromMock }) }));
vi.mock("@/lib/wallet-ledger", () => ({
  getCreditBalances: vi.fn(async () => ({
    monthly: 10,
    purchased: 0,
    betaPromotional: 0,
    total: 10,
  })),
}));
vi.mock("@/lib/owner", () => ({
  isOwnerClerkId: () => false,
  getActiveSimulation: vi.fn(async () => null),
}));

import { GET } from "./route";

beforeEach(() => {
  vi.clearAllMocks();
  authMock.mockResolvedValue({ userId: "clerk_status" });
});

describe("GET /api/billing/subscription", () => {
  it("selects and returns cancel_at_period_end", async () => {
    const selects: string[] = [];
    fromMock.mockImplementation((table: string) => {
      const builder = {
        select: (columns: string) => {
          selects.push(columns);
          return builder;
        },
        eq: () => builder,
        single: async () => {
          if (table === "users") return { data: { id: "db-user" }, error: null };
          return {
            data: {
              plan: "creator_beta",
              status: "active",
              stripe_customer_id: "cus_1",
              stripe_subscription_id: "sub_1",
              current_period_start: "2026-10-01T00:00:00.000Z",
              current_period_end: "2026-11-01T00:00:00.000Z",
              cancel_at_period_end: true,
            },
            error: null,
          };
        },
      };
      return builder;
    });

    const res = await GET({ headers: { get: () => null } } as any);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(selects.some((columns) => columns.includes("cancel_at_period_end"))).toBe(true);
    expect(body.subscription.cancel_at_period_end).toBe(true);
    expect(body.subscription.current_period_end).toBe("2026-11-01T00:00:00.000Z");
  });
});
