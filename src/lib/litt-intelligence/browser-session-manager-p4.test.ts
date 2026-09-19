/**
 * Agent Browser Phase 4 — cap + quota enforcement at the manager level.
 *
 * Uses the real browser-session-manager (test seams) wired to the real
 * browser-billing module:
 * - The 101st executed action is refused WITHOUT executing (the
 *   provider function is never called).
 * - A quota-crossed action pauses the session and returns the
 *   plain-English message.
 * - The burn snapshot reflects real accumulation (1 min + 1 model call
 *   → 55 BITS).
 * - closeSession settles through the wallet ledger exactly once with
 *   the session-scoped idempotency key.
 *
 * The vendor (Browserbase/Stagehand) is a fake; the wallet ledger is
 * mocked; the quota DB read is stubbed via getSupabaseAdmin.
 */
// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase", () => ({
  supabaseAdmin: null,
  getSupabaseAdmin: vi.fn(),
}));

vi.mock("@/lib/wallet-ledger", () => ({
  getCreditBalances: vi.fn(),
  adjustWalletBalance: vi.fn(),
}));

import { getSupabaseAdmin } from "@/lib/supabase";
import { adjustWalletBalance } from "@/lib/wallet-ledger";
import {
  executeBrowserAction,
  closeSession,
  getSession,
  __registerActiveSessionForTest,
  __resetActiveSessionsForTest,
  type BrowserSession,
} from "./browser-session-manager";
import {
  recordBrowserAction,
  getBurnSnapshot,
  QUOTA_PAUSED_MESSAGE,
  ACTION_CAP_MESSAGE,
  __resetBrowserBillingForTest,
} from "./browser-billing";

const mockGetSupabaseAdmin = vi.mocked(getSupabaseAdmin);
const mockAdjust = vi.mocked(adjustWalletBalance);

const USER = "user_non_owner_1";

function fakeSession(overrides: Partial<BrowserSession> = {}): BrowserSession {
  const now = new Date().toISOString();
  return {
    id: `session-${Math.random().toString(36).slice(2)}`,
    userId: USER,
    projectId: null,
    conversationId: "conv-abc",
    browserbaseSessionId: "bb-1",
    status: "active",
    controller: "agent",
    task: null,
    liveViewUrl: null,
    error: null,
    metadata: {},
    createdAt: now,
    updatedAt: now,
    closedAt: null,
    ...overrides,
  };
}

function fakeStagehand() {
  return { close: vi.fn().mockResolvedValue(undefined) } as never;
}

/** Stub getDailyBrowserMinutesUsed to report a fixed number of minutes today. */
function stubDailyMinutes(minutes: number) {
  mockGetSupabaseAdmin.mockReturnValue({
    from: () => ({
      select: () => ({
        eq: () => ({
          gte: () =>
            Promise.resolve({
              data: [
                {
                  created_at: new Date(Date.now() - minutes * 60_000).toISOString(),
                  closed_at: new Date().toISOString(),
                },
              ],
              error: null,
            }),
        }),
      }),
    }),
  } as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  __resetActiveSessionsForTest();
  __resetBrowserBillingForTest();
  mockGetSupabaseAdmin.mockReturnValue(null);
});

describe("executeBrowserAction — Phase 4 gates", () => {
  it("refuses the 101st action without executing it", async () => {
    const session = fakeSession();
    __registerActiveSessionForTest({
      stagehand: fakeStagehand(),
      session,
      lastActivity: Date.now(),
    });
    // 100 attempts already recorded → the next one is the 101st.
    for (let i = 0; i < 100; i++) {
      recordBrowserAction(session.id, { success: true });
    }

    const fn = vi.fn().mockResolvedValue({ success: true, durationMs: 1 });
    const result = await executeBrowserAction(
      session.id,
      USER,
      "browser.snapshot",
      {},
      fn,
    );

    expect(result.success).toBe(false);
    expect(result.error).toBe(ACTION_CAP_MESSAGE);
    expect(fn).not.toHaveBeenCalled();
  });

  it("pauses the session with a plain-English message when quota is crossed", async () => {
    const session = fakeSession();
    __registerActiveSessionForTest({
      stagehand: fakeStagehand(),
      session,
      lastActivity: Date.now(),
    });
    // 119 minutes already burned today + this session's started minute
    // (created just now → 1 wall minute) ≥ the 120-minute quota.
    stubDailyMinutes(119);

    const fn = vi.fn().mockResolvedValue({ success: true, durationMs: 1 });
    const result = await executeBrowserAction(
      session.id,
      USER,
      "browser.snapshot",
      {},
      fn,
    );

    expect(result.success).toBe(false);
    expect(result.error).toBe(QUOTA_PAUSED_MESSAGE);
    expect(fn).not.toHaveBeenCalled();

    const after = await getSession(session.id, USER);
    expect(after?.status).toBe("paused");
  });

  it("executes normally under the caps and accrues a real burn", async () => {
    const session = fakeSession();
    __registerActiveSessionForTest({
      stagehand: fakeStagehand(),
      session,
      lastActivity: Date.now(),
    });

    const result = await executeBrowserAction(
      session.id,
      USER,
      "browser.extract",
      {},
      async () => ({ success: true, modelCalls: 1, durationMs: 5 }),
    );

    expect(result.success).toBe(true);

    const burn = await getBurnSnapshot(session.id, USER);
    // 1 started minute × 45 + 1 model call × 10 = 55 BITS.
    expect(burn).toMatchObject({
      billableMinutes: 1,
      modelCalls: 1,
      bits: 55,
      live: true,
    });
  });
});

describe("closeSession — Phase 4 settle", () => {
  it("settles the accrued burn once with the session-scoped idempotency key", async () => {
    const session = fakeSession();
    __registerActiveSessionForTest({
      stagehand: fakeStagehand(),
      session,
      lastActivity: Date.now(),
    });

    await executeBrowserAction(
      session.id,
      USER,
      "browser.extract",
      {},
      async () => ({ success: true, modelCalls: 1, durationMs: 5 }),
    );

    mockAdjust.mockResolvedValue({
      balance: 9_945,
      previousBalance: 10_000,
      replayed: false,
    });

    await closeSession(session.id, USER);

    expect(mockAdjust).toHaveBeenCalledTimes(1);
    expect(mockAdjust).toHaveBeenCalledWith(
      expect.objectContaining({
        clerkId: USER,
        amount: -55,
        type: "spend",
        idempotencyKey: `browser:settle:${session.id}`,
      }),
    );

    // A retried close (same session) settles 0 — the accumulator is
    // gone, so no second charge is even attempted.
    await closeSession(session.id, USER);
    expect(mockAdjust).toHaveBeenCalledTimes(1);
  });

  it("does not touch the ledger when the session never produced a successful action", async () => {
    const session = fakeSession();
    __registerActiveSessionForTest({
      stagehand: fakeStagehand(),
      session,
      lastActivity: Date.now(),
    });

    await executeBrowserAction(
      session.id,
      USER,
      "browser.navigate",
      {},
      async () => ({ success: false, error: "provider exploded", durationMs: 5 }),
    );

    await closeSession(session.id, USER);

    expect(mockAdjust).not.toHaveBeenCalled();
  });
});
