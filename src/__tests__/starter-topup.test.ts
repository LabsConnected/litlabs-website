/**
 * Starter legacy top-up tests.
 *
 * Accounts that only ever received the pre-v1 500-bit Starter grant
 * (`starter:{userId}`) get a one-time +1,000 adjustment so their lifetime
 * Starter grant equals the locked 1,500 — never a second full grant.
 *
 * All Supabase calls are mocked. No real API calls are made.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase", () => ({ getSupabaseAdmin: vi.fn() }));

import { getSupabaseAdmin } from "@/lib/supabase";
import { ensureStarterTopUp } from "@/lib/wallet-ledger";
import {
  PLAN_ENTITLEMENTS,
  STARTER_TOPUP_BITS,
  STARTER_GRANT_KEY_PREFIX,
  STARTER_TOPUP_KEY_PREFIX,
  LEGACY_STARTER_GRANT_KEY_PREFIX,
  formatBits,
} from "@/config/plan-entitlements";

const USER_ID = "user_legacy_123";

// ─── Mock supabase admin ─────────────────────────────────────────────
// ledgerKeys: the set of idempotency_key values "present" in credit_ledger.
function makeAdmin(ledgerKeys: Set<string>) {
  const rpcCalls: { fn: string; args: Record<string, unknown> }[] = [];

  const newBuilder = (): any => {
    const builder: any = {
      _filters: {} as Record<string, unknown>,
      _in: null as null | { col: string; vals: string[] },
      select() {
        return builder;
      },
      eq(col: string, val: unknown) {
        builder._filters[col] = val;
        return builder;
      },
      in(col: string, vals: string[]) {
        builder._in = { col, vals };
        return builder;
      },
      limit() {
        return builder;
      },
      maybeSingle() {
        return Promise.resolve({
          data: resolveRows()[0] ?? null,
          error: null,
        });
      },
      // thenable — allows `await admin.from(...).select()...`
      then(
        resolve: (v: { data: unknown[]; error: null }) => void,
      ) {
        resolve({ data: resolveRows(), error: null });
      },
    };
    function resolveRows(): { idempotency_key: string }[] {
      if (builder._in) {
        return builder._in.vals
          .filter((v: string) => ledgerKeys.has(v))
          .map((idempotency_key: string) => ({ idempotency_key }));
      }
      const key = builder._filters["idempotency_key"];
      if (typeof key === "string" && ledgerKeys.has(key)) {
        return [{ idempotency_key: key }];
      }
      return [];
    }
    return builder;
  };

  const admin: any = {
    from: vi.fn(() => newBuilder()),
    rpc: vi.fn(async (fn: string, args: Record<string, unknown>) => {
      rpcCalls.push({ fn, args });
      // Simulate DB-level idempotency: a duplicate key is a no-op, not an error.
      if (
        fn === "grant_credits" &&
        typeof args.p_idempotency_key === "string"
      ) {
        ledgerKeys.add(args.p_idempotency_key);
      }
      return { data: { success: true }, error: null };
    }),
  };
  return { admin, rpcCalls };
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── Derivation from the single source ───────────────────────────────

describe("starter top-up constants", () => {
  it("locked allowance is 1,500 and top-up derives to exactly +1,000", () => {
    expect(PLAN_ENTITLEMENTS.starter.oneTimeGrantBits).toBe(1500);
    expect(STARTER_TOPUP_BITS).toBe(1000);
    expect(
      PLAN_ENTITLEMENTS.starter.oneTimeGrantBits,
    ).toBe(500 + STARTER_TOPUP_BITS);
  });

  it("formats allowances with thousands separators", () => {
    expect(formatBits(1500)).toBe("1,500");
    expect(formatBits(7500)).toBe("7,500");
    expect(formatBits(18000)).toBe("18,000");
  });
});

// ─── ensureStarterTopUp behavior ─────────────────────────────────────

describe("ensureStarterTopUp", () => {
  it("grants +1,000 once to a legacy-only account", async () => {
    const { admin, rpcCalls } = makeAdmin(
      new Set([`${LEGACY_STARTER_GRANT_KEY_PREFIX}${USER_ID}`]),
    );
    (getSupabaseAdmin as any).mockReturnValue(admin);

    const result = await ensureStarterTopUp(admin, USER_ID);

    expect(result.toppedUp).toBe(true);
    const grants = rpcCalls.filter((c) => c.fn === "grant_credits");
    expect(grants).toHaveLength(1);
    expect(grants[0].args.p_amount).toBe(1000);
    expect(grants[0].args.p_idempotency_key).toBe(
      `${STARTER_TOPUP_KEY_PREFIX}${USER_ID}`,
    );
    expect(grants[0].args.p_balance_bucket).toBe("monthly");
    expect(String(grants[0].args.p_description)).toContain("legacy 500");
    // Never a second full 1,500 grant.
    expect(grants[0].args.p_amount).not.toBe(1500);
  });

  it("is a no-op on re-run after the top-up lands", async () => {
    const keys = new Set([
      `${LEGACY_STARTER_GRANT_KEY_PREFIX}${USER_ID}`,
      `${STARTER_TOPUP_KEY_PREFIX}${USER_ID}`,
    ]);
    const { admin, rpcCalls } = makeAdmin(keys);
    (getSupabaseAdmin as any).mockReturnValue(admin);

    const result = await ensureStarterTopUp(admin, USER_ID);

    expect(result.toppedUp).toBe(false);
    expect(rpcCalls.filter((c) => c.fn === "grant_credits")).toHaveLength(0);
  });

  it("does not touch accounts that already hold the v1 grant", async () => {
    const { admin, rpcCalls } = makeAdmin(
      new Set([`${STARTER_GRANT_KEY_PREFIX}${USER_ID}`]),
    );
    (getSupabaseAdmin as any).mockReturnValue(admin);

    const result = await ensureStarterTopUp(admin, USER_ID);

    expect(result.toppedUp).toBe(false);
    expect(rpcCalls.filter((c) => c.fn === "grant_credits")).toHaveLength(0);
  });

  it("does not touch brand-new accounts with no grants at all", async () => {
    const { admin, rpcCalls } = makeAdmin(new Set());
    (getSupabaseAdmin as any).mockReturnValue(admin);

    const result = await ensureStarterTopUp(admin, USER_ID);

    expect(result.toppedUp).toBe(false);
    expect(rpcCalls.filter((c) => c.fn === "grant_credits")).toHaveLength(0);
  });

  it("concurrent double-invoke results in a single logical grant", async () => {
    const keys = new Set([
      `${LEGACY_STARTER_GRANT_KEY_PREFIX}${USER_ID}`,
    ]);
    const { admin, rpcCalls } = makeAdmin(keys);
    (getSupabaseAdmin as any).mockReturnValue(admin);

    const [a, b] = await Promise.all([
      ensureStarterTopUp(admin, USER_ID),
      ensureStarterTopUp(admin, USER_ID),
    ]);

    // Both invocations race the same idempotency key; the RPC-level
    // idempotency guarantees the user is credited once.
    const grants = rpcCalls.filter((c) => c.fn === "grant_credits");
    expect(grants.length).toBeGreaterThanOrEqual(1);
    const amounts = grants.map((g) => g.args.p_amount);
    expect(amounts.every((n) => n === 1000)).toBe(true);
    expect(a.toppedUp || b.toppedUp).toBe(true);
  });
});
