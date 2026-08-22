/**
 * Entitlement denial tests — proves the server-side entitlement gate
 * correctly denies inference when:
 *   - The user has no subscription
 *   - The subscription is inactive
 *   - The user has no wallet
 *   - The coin balance is zero
 *   - The backend (Supabase) is not configured
 *
 * Also tests that estimateCoinCost() correctly returns 0 for included
 * plans (pro/studio/enterprise) and >0 for free/starter.
 *
 * Uses a mocked Supabase client — no real DB calls.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  checkEntitlement,
  estimateCoinCost,
  recordUsage,
  type EntitlementResult,
} from "../entitlement.js";

// ─── Mock Supabase ─────────────────────────────────────────────────

interface MockTable {
  data: unknown | null;
  error: { message: string } | null;
}

function mockQuery(result: MockTable): unknown {
  const chain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue(result),
    insert: vi.fn().mockResolvedValue({ error: null }),
    update: vi.fn().mockReturnThis(),
    abortSignal: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue({ error: null }),
  };
  return chain;
}

let envBackup: Record<string, string | undefined>;

beforeEach(() => {
  envBackup = {
    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  };
  process.env.SUPABASE_URL = "https://test.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-key";
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
  for (const [k, v] of Object.entries(envBackup)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

// Helper: mock the @supabase/supabase-js createClient to return a
// client with controllable table responses.
function mockSupabase(tables: Record<string, MockTable>): void {
  vi.doMock("@supabase/supabase-js", () => ({
    createClient: vi.fn(() => {
      const from = (table: string) => {
        const result = tables[table] ?? { data: null, error: null };
        return mockQuery(result);
      };
      return { from };
    }),
  }));
}

// ─── estimateCoinCost tests ────────────────────────────────────────

describe("estimateCoinCost", () => {
  it("returns 0 for pro plan (included)", () => {
    expect(estimateCoinCost(5000, "pro")).toBe(0);
  });

  it("returns 0 for studio plan (included)", () => {
    expect(estimateCoinCost(5000, "studio")).toBe(0);
  });

  it("returns 0 for enterprise plan (included)", () => {
    expect(estimateCoinCost(5000, "enterprise")).toBe(0);
  });

  it("returns coins for free plan (1 coin per 1000 tokens, min 1)", () => {
    expect(estimateCoinCost(0, "free")).toBe(1);
    expect(estimateCoinCost(500, "free")).toBe(1);
    expect(estimateCoinCost(1000, "free")).toBe(1);
    expect(estimateCoinCost(2500, "free")).toBe(3);
    expect(estimateCoinCost(10000, "free")).toBe(10);
  });

  it("returns coins for null plan (treated as pay-per-use)", () => {
    expect(estimateCoinCost(2000, null)).toBe(2);
  });
});

// ─── checkEntitlement tests ────────────────────────────────────────

describe("checkEntitlement", () => {
  it("denies when backend is not configured (no SUPABASE_URL)", async () => {
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    vi.resetModules();
    const { checkEntitlement: check } = await import("../entitlement.js");

    const result = await check("user_123");
    expect(result.entitled).toBe(false);
    expect(result.code).toBe("backend_unavailable");
  });

  it("denies when user is not found", async () => {
    mockSupabase({
      users: { data: null, error: null },
    });
    const { checkEntitlement: check } = await import("../entitlement.js");

    const result = await check("unknown_clerk_id");
    expect(result.entitled).toBe(false);
    expect(result.code).toBe("user_not_found");
    expect(result.reason).toContain("User not found");
  });

  it("denies when no subscription exists", async () => {
    mockSupabase({
      users: { data: { id: "uuid-1" }, error: null },
      subscriptions: { data: null, error: null },
    });
    const { checkEntitlement: check } = await import("../entitlement.js");

    const result = await check("user_123");
    expect(result.entitled).toBe(false);
    expect(result.code).toBe("no_subscription");
    expect(result.reason).toContain("No subscription");
  });

  it("denies when subscription is inactive", async () => {
    mockSupabase({
      users: { data: { id: "uuid-1" }, error: null },
      subscriptions: { data: { plan: "free", status: "canceled" }, error: null },
    });
    const { checkEntitlement: check } = await import("../entitlement.js");

    const result = await check("user_123");
    expect(result.entitled).toBe(false);
    expect(result.code).toBe("subscription_inactive");
    expect(result.reason).toContain("canceled");
  });

  it("allows when subscription is active and plan is included (pro)", async () => {
    mockSupabase({
      users: { data: { id: "uuid-1" }, error: null },
      subscriptions: { data: { plan: "pro", status: "active" }, error: null },
    });
    const { checkEntitlement: check } = await import("../entitlement.js");

    const result = await check("user_123");
    expect(result.entitled).toBe(true);
    expect(result.plan).toBe("pro");
  });

  it("denies when free plan and no wallet exists", async () => {
    mockSupabase({
      users: { data: { id: "uuid-1" }, error: null },
      subscriptions: { data: { plan: "free", status: "active" }, error: null },
      wallets: { data: null, error: null },
    });
    const { checkEntitlement: check } = await import("../entitlement.js");

    const result = await check("user_123");
    expect(result.entitled).toBe(false);
    expect(result.code).toBe("no_wallet");
  });

  it("denies when free plan and coin balance is zero", async () => {
    mockSupabase({
      users: { data: { id: "uuid-1" }, error: null },
      subscriptions: { data: { plan: "free", status: "active" }, error: null },
      wallets: { data: { balance: 0 }, error: null },
    });
    const { checkEntitlement: check } = await import("../entitlement.js");

    const result = await check("user_123");
    expect(result.entitled).toBe(false);
    expect(result.code).toBe("insufficient_credits");
    expect(result.coinBalance).toBe(0);
    expect(result.reason).toContain("Out of LiTBit coins");
  });

  it("allows when free plan and coin balance is positive", async () => {
    mockSupabase({
      users: { data: { id: "uuid-1" }, error: null },
      subscriptions: { data: { plan: "free", status: "active" }, error: null },
      wallets: { data: { balance: 500 }, error: null },
    });
    const { checkEntitlement: check } = await import("../entitlement.js");

    const result = await check("user_123");
    expect(result.entitled).toBe(true);
    expect(result.coinBalance).toBe(500);
  });
});

// ─── recordUsage tests ─────────────────────────────────────────────

describe("recordUsage", () => {
  it("does not throw when backend is not configured", async () => {
    delete process.env.SUPABASE_URL;
    vi.resetModules();
    const { recordUsage: record } = await import("../entitlement.js");

    await expect(record({
      clerkId: "user_123",
      provider: "openrouter",
      model: "test",
      promptTokens: 10,
      completionTokens: 20,
      totalTokens: 30,
      costUsd: 0.001,
      coinsDebited: 1,
    })).resolves.toBeUndefined();
  });
});
