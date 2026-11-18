import { describe, it, expect, vi, beforeEach } from "vitest";
import { GET } from "@/app/api/billing/subscription/route";

/**
 * /api/billing/subscription must flag the billing-exempt owner so Settings
 * renders "DEV ∞" (the owner display doctrine in src/lib/owner.ts) instead
 * of the raw ledger balance — while a customer, or the owner simulating a
 * customer tier, still sees real numbers (ART-20261111-084).
 * Display signal only: balances themselves are returned unchanged.
 */

const ownerState = { isOwner: true, simulation: null as string | null, exempt: true };

function makeQuery(singleData: unknown) {
  const q: Record<string, unknown> = {};
  for (const m of ["select", "eq", "in"]) {
    q[m] = () => q;
  }
  q.single = async () => ({ data: singleData });
  q.maybeSingle = async () => ({ data: singleData });
  q.then = (resolve: (v: unknown) => void) => resolve({ data: singleData });
  return q;
}

const fakeAdmin = {
  from: vi.fn((table: string) =>
    makeQuery(table === "users" ? { id: "user-uuid-1" } : null),
  ),
};

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(async () => ({ userId: "clerk-user-1" })),
}));

vi.mock("@/lib/supabase", () => ({
  getSupabaseAdmin: () => fakeAdmin,
}));

vi.mock("@/lib/wallet-ledger", () => ({
  getCreditBalances: vi.fn(async () => ({
    monthly: 2000,
    purchased: 0,
    betaPromotional: 80,
    total: 2080,
    lastDailyClaim: null,
  })),
}));

vi.mock("@/lib/owner", () => ({
  isOwnerClerkId: vi.fn(() => ownerState.isOwner),
  getActiveSimulation: vi.fn(async () => ownerState.simulation),
  isBillingExempt: vi.fn(
    (_clerkId: string | null | undefined, simulation?: string | null) =>
      ownerState.isOwner && (!simulation || simulation === "owner") && ownerState.exempt,
  ),
}));

vi.mock("@/lib/rate-limiter", () => ({
  withRateLimit: (handler: unknown) => handler,
}));

function getSubscription() {
  return GET(
    new Request("https://x.test/api/billing/subscription") as unknown as import("next/server").NextRequest,
  );
}

describe("GET /api/billing/subscription — billingExempt display flag", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    ownerState.isOwner = true;
    ownerState.simulation = null;
    ownerState.exempt = true;
  });

  it("flags the non-simulating owner as billing-exempt, balances untouched", async () => {
    const res = await getSubscription();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.billingExempt).toBe(true);
    expect(body.balances.total).toBe(2080);
  });

  it("does NOT flag the owner while simulating a customer tier", async () => {
    ownerState.simulation = "creator_beta";
    const res = await getSubscription();
    const body = await res.json();
    expect(body.billingExempt).toBe(false);
    expect(body.balances.total).toBe(2080);
  });

  it("does NOT flag a regular customer", async () => {
    ownerState.isOwner = false;
    ownerState.exempt = false;
    const res = await getSubscription();
    const body = await res.json();
    expect(body.billingExempt).toBe(false);
  });
});
