/**
 * Agent Browser Phase 4 — BITS metering + caps tests.
 *
 * Covers:
 * - Price math: bitsForSession (minutes × 45 + model calls × 10),
 *   ceiling-per-started-minute, billable grace (no successful action
 *   → 0 minutes → 0 BITS).
 * - preflightBrowserStart (fail closed): no-BITS → no session,
 *   3rd concurrent session refused, daily quota exhausted refused,
 *   spend ceiling refused, exempt owners skip the balance check.
 * - checkActionGate: 101st action refused; quota crossed → pause.
 * - recordBrowserAction: attempts count toward the cap; only
 *   successful actions accrue model-call surcharges.
 * - settleBrowserSession: one ledger write with a session-scoped
 *   idempotency key (retried settle → single charge); 0 BITS → no
 *   ledger write; provider failure → 0 BITS; exempt → metered, not
 *   debited.
 *
 * The vendor (Browserbase/Stagehand) and the wallet ledger are mocked —
 * these tests verify LiTT's metering, not the vendors'.
 */
// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/llm-billing", () => ({
  preflightBillingAuth: vi.fn(),
}));

vi.mock("@/lib/wallet-ledger", () => ({
  getCreditBalances: vi.fn(),
  adjustWalletBalance: vi.fn(),
}));

vi.mock("@/lib/supabase", () => ({
  getSupabaseAdmin: vi.fn(),
}));

import { preflightBillingAuth } from "@/lib/llm-billing";
import { getCreditBalances, adjustWalletBalance } from "@/lib/wallet-ledger";
import { getSupabaseAdmin } from "@/lib/supabase";
import {
  BROWSER_MINUTE_BITS,
  BROWSER_MODEL_CALL_BITS,
  MAX_CONCURRENT_BROWSER_SESSIONS,
  MAX_ACTIONS_PER_BROWSER_SESSION,
  DAILY_BROWSER_MINUTES_QUOTA,
  QUOTA_PAUSED_MESSAGE,
  ACTION_CAP_MESSAGE,
  CONCURRENT_SESSION_CAP_MESSAGE,
  bitsForSession,
  billableMinutes,
  ceilMinutesBetween,
  recordBrowserAction,
  getAccumulatorState,
  preflightBrowserStart,
  checkActionGate,
  settleBrowserSession,
  getDailyBrowserMinutesUsed,
  __resetBrowserBillingForTest,
} from "./browser-billing";

const mockPreflight = vi.mocked(preflightBillingAuth);
const mockBalances = vi.mocked(getCreditBalances);
const mockAdjust = vi.mocked(adjustWalletBalance);
const mockSupabase = vi.mocked(getSupabaseAdmin);

// A non-owner user (isBillingExempt is real and env-independent for
// non-owners — no owner env var is set in this test file).
const USER = "user_non_owner_1";

function fakeSession(overrides: Record<string, unknown> = {}) {
  return {
    id: "session-settle-1",
    userId: USER,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  __resetBrowserBillingForTest();
  // Default: billing allowed, not exempt; healthy balance; no DB.
  mockPreflight.mockResolvedValue({ allowed: true, billingExempt: false });
  mockBalances.mockResolvedValue({
    monthly: 0,
    purchased: 10_000,
    betaPromotional: 0,
    total: 10_000,
    lastDailyClaim: null,
  });
  mockSupabase.mockReturnValue(null);
});

describe("price constants", () => {
  it("exposes the provisional per-minute price in one spot", () => {
    expect(BROWSER_MINUTE_BITS).toBe(45);
  });

  it("exposes the provisional per-model-call surcharge in one spot", () => {
    expect(BROWSER_MODEL_CALL_BITS).toBe(10);
  });

  it("keeps the caps the spec mandates", () => {
    expect(MAX_CONCURRENT_BROWSER_SESSIONS).toBe(2);
    expect(MAX_ACTIONS_PER_BROWSER_SESSION).toBe(100);
    expect(DAILY_BROWSER_MINUTES_QUOTA).toBeGreaterThan(0);
  });
});

describe("bitsForSession", () => {
  it("charges minutes × 45 plus model calls × 10", () => {
    expect(bitsForSession(3, 0)).toBe(135);
    expect(bitsForSession(3, 2)).toBe(135 + 20);
    expect(bitsForSession(0, 0)).toBe(0);
  });

  it("ceils to a full started minute (any started minute counts)", () => {
    expect(ceilMinutesBetween(0, 0)).toBe(1);
    expect(ceilMinutesBetween(0, 1)).toBe(1);
    expect(ceilMinutesBetween(0, 60_000)).toBe(1);
    expect(ceilMinutesBetween(0, 60_001)).toBe(2);
  });

  it("gives 0 billable minutes before any successful action (P1-3 grace)", () => {
    expect(billableMinutes(null, Date.now())).toBe(0);
  });

  it("counts minutes from the first successful action, not session start", () => {
    const from = Date.now() - 90_000; // 90s ago
    expect(billableMinutes(from, Date.now())).toBe(2);
  });
});

describe("recordBrowserAction", () => {
  it("counts attempts (success or failure) toward the action cap", () => {
    recordBrowserAction("s1", { success: false });
    recordBrowserAction("s1", { success: true, modelCalls: 1 });
    expect(getAccumulatorState("s1").actionCount).toBe(2);
  });

  it("accrues model-call surcharges only for successful actions", () => {
    recordBrowserAction("s2", { success: false, modelCalls: 1 });
    recordBrowserAction("s2", { success: true, modelCalls: 2 });
    expect(getAccumulatorState("s2").modelCalls).toBe(2);
  });

  it("defaults unknown sessions to zero", () => {
    expect(getAccumulatorState("never-seen")).toEqual({
      actionCount: 0,
      modelCalls: 0,
    });
  });
});

describe("preflightBrowserStart", () => {
  it("allows a funded user under all caps", async () => {
    const result = await preflightBrowserStart(USER, 0);
    expect(result).toEqual({ ok: true });
  });

  it("refuses when the user has no BITS (no balance → no session)", async () => {
    mockBalances.mockResolvedValue({
      monthly: 0,
      purchased: 0,
      betaPromotional: 0,
      total: 0,
      lastDailyClaim: null,
    });
    const result = await preflightBrowserStart(USER, 0);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("insufficient_bits");
      expect(result.message).toContain(`${BROWSER_MINUTE_BITS}`);
    }
  });

  it("refuses a 3rd concurrent session", async () => {
    const result = await preflightBrowserStart(USER, 2);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("session_cap");
      expect(result.message).toBe(CONCURRENT_SESSION_CAP_MESSAGE);
    }
  });

  it("refuses when the daily minute quota is exhausted", async () => {
    mockSupabase.mockReturnValue({
      from: () => ({
        select: () => ({
          eq: () => ({
            gte: () =>
              Promise.resolve({
                data: [
                  {
                    created_at: new Date(Date.now() - 200 * 60_000).toISOString(),
                    closed_at: new Date().toISOString(),
                  },
                ],
                error: null,
              }),
          }),
        }),
      }),
    } as never);
    const result = await preflightBrowserStart(USER, 0);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("quota_exhausted");
      expect(result.message).toBe(QUOTA_PAUSED_MESSAGE);
    }
  });

  it("refuses when the owner spend ceiling is exceeded (fail closed)", async () => {
    mockPreflight.mockResolvedValue({
      allowed: false,
      reason: "spend_ceiling_exceeded",
      spendMicros: 1,
    });
    const result = await preflightBrowserStart(USER, 0);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("spend_ceiling_exceeded");
  });

  it("skips the balance check for billing-exempt owners (video precedent)", async () => {
    mockPreflight.mockResolvedValue({ allowed: true, billingExempt: true });
    mockBalances.mockRejectedValue(new Error("should not be called"));
    const result = await preflightBrowserStart("owner-x", 0);
    expect(result).toEqual({ ok: true });
    expect(mockBalances).not.toHaveBeenCalled();
  });

  it("fails closed in production when the balance cannot be verified", async () => {
    vi.stubEnv("NODE_ENV", "production");
    try {
      mockBalances.mockRejectedValue(new Error("wallet down"));
      const result = await preflightBrowserStart(USER, 0);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toBe("billing_unavailable");
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe("checkActionGate", () => {
  it("allows a fresh session's action", async () => {
    const gate = await checkActionGate("s3", USER, new Date().toISOString());
    expect(gate).toEqual({ allowed: true });
  });

  it("refuses the 101st action", async () => {
    for (let i = 0; i < 100; i++) {
      recordBrowserAction("s4", { success: true });
    }
    const gate = await checkActionGate("s4", USER, new Date().toISOString());
    expect(gate.allowed).toBe(false);
    if (!gate.allowed) {
      expect(gate.error).toBe("action_cap");
      expect(gate.pause).toBe(false);
      expect(gate.message).toBe(ACTION_CAP_MESSAGE);
    }
  });

  it("pauses with the plain-English message when quota is crossed", async () => {
    mockSupabase.mockReturnValue({
      from: () => ({
        select: () => ({
          eq: () => ({
            gte: () =>
              Promise.resolve({
                data: [
                  {
                    created_at: new Date(Date.now() - 119 * 60_000).toISOString(),
                    closed_at: null,
                  },
                ],
                error: null,
              }),
          }),
        }),
      }),
    } as never);
    // 119 minutes today + this session's started minute (1) ≥ 120.
    const gate = await checkActionGate(
      "s5",
      USER,
      new Date(Date.now() - 30_000).toISOString(),
    );
    expect(gate.allowed).toBe(false);
    if (!gate.allowed) {
      expect(gate.error).toBe("quota_exhausted");
      expect(gate.pause).toBe(true);
      expect(gate.message).toBe(QUOTA_PAUSED_MESSAGE);
    }
  });
});

describe("settleBrowserSession", () => {
  it("debts the accrued burn once with a session-scoped idempotency key", async () => {
    // One successful action (2 model calls), then settle immediately:
    // 1 started minute × 45 + 2 × 10 = 65 BITS.
    recordBrowserAction("s6", { success: true, modelCalls: 2 });
    mockAdjust.mockResolvedValue({
      balance: 9_935,
      previousBalance: 10_000,
      replayed: false,
    });

    const result = await settleBrowserSession(fakeSession({ id: "s6" }));

    expect(result.bits).toBe(65);
    expect(result.debited).toBe(true);
    expect(result.replayed).toBe(false);
    expect(mockAdjust).toHaveBeenCalledTimes(1);
    expect(mockAdjust).toHaveBeenCalledWith(
      expect.objectContaining({
        clerkId: USER,
        amount: -65,
        idempotencyKey: "browser:settle:s6",
      }),
    );
  });

  it("makes a retried settle idempotent (same key → single charge)", async () => {
    recordBrowserAction("s7", { success: true });
    mockAdjust
      .mockResolvedValueOnce({
        balance: 9_955,
        previousBalance: 10_000,
        replayed: false,
      })
      .mockResolvedValueOnce({
        balance: 9_955,
        previousBalance: 10_000,
        replayed: true,
      });

    const first = await settleBrowserSession(fakeSession({ id: "s7" }));
    // Re-record the same usage (simulating the close being retried with
    // identical state) and settle again.
    recordBrowserAction("s7", { success: true });
    const second = await settleBrowserSession(fakeSession({ id: "s7" }));

    expect(first.debited).toBe(true);
    expect(second.replayed).toBe(true);
    expect(second.debited).toBe(false);
    expect(mockAdjust).toHaveBeenCalledTimes(2);
    // Both settles carried the same session-scoped idempotency key —
    // the ledger RPC enforces the single charge.
    expect(mockAdjust.mock.calls[0][0].idempotencyKey).toBe(
      "browser:settle:s7",
    );
    expect(mockAdjust.mock.calls[1][0].idempotencyKey).toBe(
      "browser:settle:s7",
    );
  });

  it("writes no ledger row when nothing was ever successful (provider failure = 0 BITS)", async () => {
    recordBrowserAction("s8", { success: false });
    recordBrowserAction("s8", { success: false });

    const result = await settleBrowserSession(fakeSession({ id: "s8" }));

    expect(result.bits).toBe(0);
    expect(result.debited).toBe(false);
    expect(mockAdjust).not.toHaveBeenCalled();
  });

  it("meters but never debits billing-exempt owners (video precedent)", async () => {
    const OLD_ENV = process.env.LITTLABS_VAPI_OWNER_CLERK_ID;
    process.env.LITTLABS_VAPI_OWNER_CLERK_ID = "owner_clerk_123";
    try {
      recordBrowserAction("s9", { success: true, modelCalls: 1 });
      const result = await settleBrowserSession(
        fakeSession({ id: "s9", userId: "owner_clerk_123" }),
      );
      expect(result.bits).toBe(45 + 10);
      expect(result.exempt).toBe(true);
      expect(result.debited).toBe(false);
      expect(mockAdjust).not.toHaveBeenCalled();
    } finally {
      if (OLD_ENV === undefined) delete process.env.LITTLABS_VAPI_OWNER_CLERK_ID;
      else process.env.LITTLABS_VAPI_OWNER_CLERK_ID = OLD_ENV;
    }
  });

  it("returns the error (never throws) when the ledger debit fails", async () => {
    recordBrowserAction("s10", { success: true });
    mockAdjust.mockRejectedValue(new Error("Insufficient balance"));

    const result = await settleBrowserSession(fakeSession({ id: "s10" }));

    expect(result.bits).toBe(45);
    expect(result.debited).toBe(false);
    expect(result.error).toBe("Insufficient balance");
  });
});

describe("getDailyBrowserMinutesUsed", () => {
  it("returns 0 when the wallet DB is unavailable (fail open)", async () => {
    await expect(getDailyBrowserMinutesUsed(USER)).resolves.toBe(0);
  });
});
