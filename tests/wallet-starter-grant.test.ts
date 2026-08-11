/**
 * Starter credit grant regression tests.
 *
 * Canonical policy: Starter receives 500 LiTTBits ONCE at account creation,
 * not monthly. The idempotency key must be user-scoped (no period) so
 * repeated calls to getCreditBalances() do not grant additional credits.
 *
 * Run: pnpm exec vitest run tests/wallet-starter-grant.test.ts
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock server-only
vi.mock("server-only", () => ({}));

// Mock state
let mockLedgerRows: Record<string, unknown>[] = [];
const mockRpc = vi.fn();

vi.mock("@/lib/supabase", () => ({
  getSupabaseAdmin: vi.fn(() => ({
    rpc: mockRpc,
    from: vi.fn((table: string) => {
      // users table — getUserId lookup
      if (table === "users") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              single: vi.fn(async () => ({ data: { id: "user-uuid-123" }, error: null })),
              maybeSingle: vi.fn(async () => ({ data: { id: "user-uuid-123" }, error: null })),
            })),
          })),
        };
      }
      // subscriptions table
      if (table === "subscriptions") {
        const subData = mockSubData;
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              in: vi.fn(() => ({
                maybeSingle: vi.fn(async () => ({ data: subData, error: null })),
              })),
            })),
          })),
        };
      }
      // credit_ledger table — supports two query shapes:
      // 1. Starter pre-check: .eq("user_id").eq("idempotency_key").limit(1).maybeSingle()
      // 2. Daily claim: .eq("user_id").eq("category").like("idempotency_key").order().limit(1).maybeSingle()
      if (table === "credit_ledger") {
        const maybeSingleFn = vi.fn(async () => ({
          data: mockLedgerRows.length > 0 ? mockLedgerRows[0] : null,
          error: null,
        }));
        const limitFn = vi.fn(() => ({ maybeSingle: maybeSingleFn }));
        const orderFn = vi.fn(() => ({ limit: limitFn }));
        const likeFn = vi.fn(() => ({ order: orderFn }));
        const secondEqFn = vi.fn(() => ({
          limit: limitFn,
          like: likeFn,
        }));
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              eq: secondEqFn,
            })),
          })),
        };
      }
      // fallback
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            maybeSingle: vi.fn(async () => ({ data: null, error: null })),
          })),
        })),
      };
    }),
  })),
}));

// Import after mocks
const { getCreditBalances } = await import("@/lib/wallet-ledger");

// Controls whether the user has an active subscription
let mockSubData: { status: string } | null = null;

function setupBalances(monthly: number, purchased: number, beta: number) {
  mockRpc.mockImplementation(async (fn: string) => {
    if (fn === "get_user_balances") {
      return {
        data: [{ monthly, purchased, beta_promotional: beta, total: monthly + purchased + beta }],
        error: null,
      };
    }
    if (fn === "grant_credits") {
      return { data: { success: true, granted: true, total_after: 500 }, error: null };
    }
    return { data: null, error: null };
  });
}

describe("Starter credit grant — one-time only", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLedgerRows = [];
    mockSubData = null;
  });

  it("new Starter receives 500 once", async () => {
    setupBalances(500, 0, 0);

    await getCreditBalances("clerk_new_user");

    // grant_credits should have been called with user-scoped key (no period)
    expect(mockRpc).toHaveBeenCalledWith("grant_credits", expect.objectContaining({
      p_amount: 500,
      p_idempotency_key: "starter:user-uuid-123",
    }));
  });

  it("refreshing wallet does not grant more (ledger pre-check)", async () => {
    setupBalances(500, 0, 0);
    // Simulate that the grant already exists in the ledger
    mockLedgerRows = [{ id: "ledger-1" }];

    await getCreditBalances("clerk_existing_user");

    // grant_credits should NOT have been called — pre-check found existing grant
    const grantCalls = mockRpc.mock.calls.filter((c: unknown[]) => c[0] === "grant_credits");
    expect(grantCalls).toHaveLength(0);
  });

  it("idempotency key has no month period component", async () => {
    setupBalances(0, 0, 0);

    await getCreditBalances("clerk_test_user");

    const grantCall = mockRpc.mock.calls.find(
      (c: unknown[]) => c[0] === "grant_credits",
    );
    expect(grantCall).toBeDefined();
    const key = (grantCall![1] as Record<string, unknown>).p_idempotency_key as string;
    // Must NOT contain a YYYY-MM suffix
    expect(key).toBe("starter:user-uuid-123");
    expect(key).not.toMatch(/\d{4}-\d{2}$/);
  });

  it("paid subscriptions do not trigger starter grant", async () => {
    mockSubData = { status: "active" };
    setupBalances(6000, 0, 0);

    await getCreditBalances("clerk_paid_user");

    // grant_credits should NOT have been called at all
    const grantCalls = mockRpc.mock.calls.filter((c: unknown[]) => c[0] === "grant_credits");
    expect(grantCalls).toHaveLength(0);
  });
});
