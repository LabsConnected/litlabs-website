// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { GET } from "@/app/api/wallet/route";

/**
 * /api/wallet must agree with /api/billing/subscription under the owner's
 * Zero-LiTTBits test-mode simulation: the balance is treated as 0
 * ("balance treated as 0" is the tier's entire definition). Before this
 * fix the wallet returned the real ledger balance under every simulation,
 * so the three surfaces (wallet / subscription / Studio chat) gave three
 * different answers for the same simulation.
 *
 * Display-side only: the ledger itself is never modified, and the state
 * can only occur behind the owner-only litt_test_mode cookie.
 */

const ownerState = { isOwner: true, simulation: null as string | null };

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(async () => ({ userId: "clerk-owner-1" })),
}));

vi.mock("@/lib/supabase", () => ({
  getSupabaseAdmin: () => ({}),
}));

vi.mock("@/lib/authz", () => ({
  canMutateBalances: vi.fn(async () => false),
}));

vi.mock("@/lib/wallet-ledger", () => ({
  getCreditBalances: vi.fn(async () => ({
    monthly: 2000,
    purchased: 0,
    betaPromotional: 80,
    total: 2080,
    lastDailyClaim: null,
  })),
  adjustWalletBalance: vi.fn(),
}));

vi.mock("@/lib/owner", () => ({
  isOwnerClerkId: vi.fn(() => ownerState.isOwner),
  getActiveSimulation: vi.fn(async () => ownerState.simulation),
  // Mirrors the real rule in src/lib/owner.ts: exempt only with no
  // simulation (or the "owner" simulation); any customer tier or
  // zero_bits simulation means real billing applies.
  isBillingExempt: vi.fn(
    (_clerkId: string | null | undefined, simulation?: string | null) =>
      ownerState.isOwner && (!simulation || simulation === "owner"),
  ),
  OWNER_SPEND_CEILING_USD: 25,
}));

vi.mock("@/lib/rate-limiter", () => ({
  withRateLimit: (handler: unknown) => handler,
}));

function getWallet() {
  return GET(
    new Request("https://x.test/api/wallet") as unknown as import("next/server").NextRequest,
  );
}

describe("GET /api/wallet — Zero-LiTTBits simulation alignment", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    ownerState.isOwner = true;
    ownerState.simulation = null;
  });

  it("reports balance 0 under the Zero-LiTTBits simulation", async () => {
    ownerState.simulation = "zero_bits";
    const res = await getWallet();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.balance).toBe(0);
    expect(body.balances).toEqual({ monthly: 0, purchased: 0, beta_promotional: 0 });
    expect(body.simulatedZeroBalance).toBe(true);
    // Billing is NOT exempt under zero_bits — the run must be chargable.
    expect(body.billingExempt).toBe(false);
    expect(body.displayBalance).toBeUndefined();
  });

  it("reports the real balance for the owner with no simulation (unchanged)", async () => {
    const res = await getWallet();
    const body = await res.json();
    expect(body.balance).toBe(2080);
    expect(body.balances.monthly).toBe(2000);
    expect(body.balances.beta_promotional).toBe(80);
    expect(body.simulatedZeroBalance).toBe(false);
    expect(body.billingExempt).toBe(true);
    expect(body.displayBalance).toBe("DEV ∞");
  });

  it("reports the real balance under a customer-tier simulation (only zero_bits zeroes)", async () => {
    ownerState.simulation = "creator_beta";
    const res = await getWallet();
    const body = await res.json();
    expect(body.balance).toBe(2080);
    expect(body.simulatedZeroBalance).toBe(false);
    expect(body.billingExempt).toBe(false);
  });
});
