/**
 * Agent Browser Phase 4 — BITS metering + abuse caps.
 *
 * This module is the single source of truth for agent-browser billing:
 * prices, caps, the per-session burn accumulator, preflight budget checks
 * (fail closed), and settlement (one ledger write per session, idempotent).
 *
 * Design contract (§6 of the audit plan):
 * - Unit: browser-minutes (ceiling per started minute) + a per-action
 *   surcharge weight for Stagehand model calls. Simple, auditable,
 *   explainable in one line.
 * - Enforcement points: startSession → preflight budget check (fail
 *   closed); each action → accumulate; close/TTL → settle.
 * - P1-3 (video BITS) precedent: NO debit before successful provider
 *   output — a session that never produced a successful action settles
 *   to 0 BITS. Provider failure = 0 BITS debited. Idempotent retries
 *   (the settle idempotency key is session-scoped, so a retried close
 *   can never double-charge).
 * - Owner billing-exempt convention (video route precedent): the owner
 *   is metered (the accumulator and the live burn display are real) but
 *   the wallet is never debited and balance checks are skipped, unless
 *   the owner is simulating a customer tier. Metering is fully enforced
 *   for non-exempt accounts — this is what makes broader rollout
 *   *possible*, while the owner-only account gate stays in place.
 *
 * One ledger write path: settleBrowserSession → adjustWalletBalance once,
 * idempotency key `browser:settle:<sessionId>`.
 */

import "server-only";
import { getSupabaseAdmin } from "@/lib/supabase";
import { preflightBillingAuth } from "@/lib/llm-billing";
import { getCreditBalances, adjustWalletBalance } from "@/lib/wallet-ledger";
import { isBillingExempt } from "@/lib/owner";
import { buildChargeRating } from "@/lib/billing/canonical-pricing";
import type { BrowserSession } from "./browser-session-manager";

// ─── Prices (ONE spot) ────────────────────────────────────────────
// BROWSER_MINUTE_BITS is **PROVISIONAL** — Larry sets the final number.
// Change it here and every metered path (preflight, chip, settle) follows.
//
// Derivation (documented 2026-09-18):
//   Browserbase $0.10/browser-hour overage = $0.0017/min
//   Stagehand gemini-2.5-flash at $0.30/$2.50 per 1M tokens
//     ≈ $0.004 per act() call × ~4 calls/min ≈ $0.016/min
//   Total vendor cost ≈ $0.018/min = 18 BITS/min at the canonical
//   1000 BITS/USD rate; 2.5× cost-plus margin → 45 BITS/min.

/** PROVISIONAL per-started-minute price. Trivially changeable here. */
export const BROWSER_MINUTE_BITS = 45;

/**
 * PROVISIONAL per-action surcharge for Stagehand MODEL calls only
 * (stagehand.act() / stagehand.extract() — the text-fallback paths in
 * browser.click/type/select and browser.extract). Deterministic
 * Playwright-level actions (goto, click-by-selector, press, …) add no
 * surcharge. Derivation: ≈ $0.004/model call ≈ 4 BITS × 2.5× margin.
 */
export const BROWSER_MODEL_CALL_BITS = 10;

// ─── Abuse caps ───────────────────────────────────────────────────

/** Max concurrently active browser sessions per user (3rd start refused). */
export const MAX_CONCURRENT_BROWSER_SESSIONS = 2;

/** Max executed actions per session (the 101st action is refused). */
export const MAX_ACTIONS_PER_BROWSER_SESSION = 100;

/**
 * Daily browser-minute quota per user (wall-clock minutes across all of
 * the user's sessions started that day). Sane default: 120 minutes
 * (2h) — at the provisional price that's up to 5,400 BITS/day of
 * exposure, enough for real browsing work while capping runaway loops.
 * Crossing it pauses the session with a plain-English message.
 */
export const DAILY_BROWSER_MINUTES_QUOTA = 120;

/**
 * In-module session-start rate limit — this is what covers the agent
 * TOOL path (`browser.start_session`), which never passes through the
 * HTTP route's `withRateLimit`. (The routes keep their own
 * `withRateLimit` guards; this is defense-in-depth for the tool path.)
 * Multi-instance note: this map is per-process; full multi-instance
 * coverage arrives with Phase 5's session re-attach work.
 */
export const SESSION_START_RATE_LIMIT = { windowMs: 60 * 60 * 1000, max: 10 };

/** Plain-English quota message — shown when a session pauses on quota. */
export const QUOTA_PAUSED_MESSAGE =
  "Browser paused: you've hit your daily browser-minute limit. It resets tomorrow.";

export const ACTION_CAP_MESSAGE =
  "This browser session has reached its action limit (100 actions). Close it and start a new session to continue.";

export const CONCURRENT_SESSION_CAP_MESSAGE =
  "You already have 2 browser sessions running. Close one before starting another.";

// ─── Session accumulator (the real meter) ─────────────────────────
// In-memory per-session burn state. The ONLY place burn accumulates;
// the chip reads this (via getBurnSnapshot), settle reads this, so the
// live display and the final charge can never disagree.

interface SessionAccumulator {
  /** Executed actions this session (success + failure — attempts cost time). */
  actionCount: number;
  /** Stagehand model calls used by successful actions. */
  modelCalls: number;
  /**
   * Epoch ms of the first SUCCESSFUL action. Billing grace (P1-3
   * precedent): the minute meter starts here, not at session creation —
   * a session that never produced a successful action settles to 0.
   */
  billableFromMs: number | null;
}

const accumulators = new Map<string, SessionAccumulator>();

function getOrCreateAccumulator(sessionId: string): SessionAccumulator {
  let acc = accumulators.get(sessionId);
  if (!acc) {
    acc = { actionCount: 0, modelCalls: 0, billableFromMs: null };
    accumulators.set(sessionId, acc);
  }
  return acc;
}

/** Test seam — reset the in-memory accumulator map. */
export function __resetBrowserBillingForTest(): void {
  accumulators.clear();
  startTimestamps.clear();
}

// ─── Pure rating math (unit-testable) ─────────────────────────────

/**
 * Ceiling minutes between two epoch-ms timestamps (never negative).
 * Any non-negative span counts as at least 1 started minute — a
 * session that opens and closes in the same millisecond still started
 * a minute (§6: "ceiling per started minute").
 */
export function ceilMinutesBetween(fromMs: number, toMs: number): number {
  return Math.max(1, Math.ceil((toMs - fromMs) / 60_000));
}

/** Session wall-clock minutes from creation to now (quota accounting). */
export function wallMinutesForSession(createdAtIso: string, nowMs: number): number {
  const created = new Date(createdAtIso).getTime();
  if (Number.isNaN(created)) return 0;
  return ceilMinutesBetween(created, nowMs);
}

/**
 * Billable minutes for a session at settle time: ceiling minutes since
 * the FIRST SUCCESSFUL action (billableFromMs). Null billableFrom (no
 * successful action yet) → 0 minutes → 0 BITS. Never negative.
 */
export function billableMinutes(
  billableFromMs: number | null,
  nowMs: number,
): number {
  if (billableFromMs === null) return 0;
  return ceilMinutesBetween(billableFromMs, nowMs);
}

/** Total BITS for a session: minutes × 45 + model calls × 10. */
export function bitsForSession(billableMinutesCount: number, modelCallCount: number): number {
  return (
    billableMinutesCount * BROWSER_MINUTE_BITS +
    modelCallCount * BROWSER_MODEL_CALL_BITS
  );
}

/** Vendor cost estimate for the pricing evidence chain (micros USD). */
function providerCostMicrosFor(billableMinutesCount: number): number {
  return billableMinutesCount * 18_000; // ≈ $0.018/min vendor cost
}

// ─── Action accounting ────────────────────────────────────────────

/**
 * Record one executed action against the session's accumulator.
 * Only SUCCESSFUL results accrue model-call surcharges (failed provider
 * output = 0 BITS for that action — P1-3 precedent); attempts (success
 * or failure) count toward the per-session action cap.
 */
export function recordBrowserAction(
  sessionId: string,
  result: { success: boolean; modelCalls?: number },
): SessionAccumulator {
  const acc = getOrCreateAccumulator(sessionId);
  acc.actionCount += 1;
  if (result.success) {
    if (acc.billableFromMs === null) acc.billableFromMs = Date.now();
    const calls = Math.max(0, Math.floor(result.modelCalls ?? 0));
    acc.modelCalls += calls;
  }
  return acc;
}

/** Current accumulator state for a session (0s when never used). */
export function getAccumulatorState(sessionId: string): {
  actionCount: number;
  modelCalls: number;
} {
  const acc = accumulators.get(sessionId);
  return {
    actionCount: acc?.actionCount ?? 0,
    modelCalls: acc?.modelCalls ?? 0,
  };
}

// ─── Live burn snapshot (backs the chip — never a placeholder) ───

export interface BrowserBurnSnapshot {
  /** Billable minutes so far (ceiling, from first successful action). */
  billableMinutes: number;
  /** Stagehand model calls used so far. */
  modelCalls: number;
  /** Total BITS accrued so far (the number the chip shows). */
  bits: number;
  /** True when the snapshot came from the live in-memory accumulator. */
  live: boolean;
}

/**
 * The real, current burn for a session. Prefers the in-memory
 * accumulator (live sessions); falls back to the persisted DB row
 * (createdAt + metadata.billing) for sessions not drivable in this
 * process. Returns null when nothing is known — the chip then shows no
 * burn rather than a fake number.
 */
export async function getBurnSnapshot(
  sessionId: string,
  userId: string,
): Promise<BrowserBurnSnapshot | null> {
  const now = Date.now();
  const acc = accumulators.get(sessionId);
  if (acc) {
    const mins = billableMinutes(acc.billableFromMs, now);
    return {
      billableMinutes: mins,
      modelCalls: acc.modelCalls,
      bits: bitsForSession(mins, acc.modelCalls),
      live: true,
    };
  }

  // DB fallback: reconstruct from the persisted row.
  const admin = getSupabaseAdmin();
  if (!admin) return null;
  try {
    const { data, error } = await admin
      .from("browser_sessions")
      .select("created_at, metadata")
      .eq("id", sessionId)
      .eq("user_id", userId)
      .maybeSingle();
    if (error || !data) return null;
    const meta = (data as { metadata?: { billing?: { modelCalls?: number } } })
      .metadata;
    const calls = Math.max(0, meta?.billing?.modelCalls ?? 0);
    const created = String((data as { created_at: string }).created_at);
    const mins = wallMinutesForSession(created, now);
    return {
      billableMinutes: mins,
      modelCalls: calls,
      bits: bitsForSession(mins, calls),
      live: false,
    };
  } catch {
    return null;
  }
}

// ─── Daily quota accounting ───────────────────────────────────────

/**
 * Browser wall-clock minutes the user has burned today (UTC), across
 * all sessions started today. Used by the quota gate. Fail-open (0) on
 * DB errors — quota is an abuse cap, not a billing guarantee; the
 * ledger is the billing guarantee.
 */
export async function getDailyBrowserMinutesUsed(userId: string): Promise<number> {
  const admin = getSupabaseAdmin();
  if (!admin) return 0;
  try {
    const startOfDay = new Date();
    startOfDay.setUTCHours(0, 0, 0, 0);
    const { data, error } = await admin
      .from("browser_sessions")
      .select("created_at, closed_at")
      .eq("user_id", userId)
      .gte("created_at", startOfDay.toISOString());
    if (error || !data) return 0;
    const now = Date.now();
    let minutes = 0;
    for (const row of data as { created_at: string; closed_at: string | null }[]) {
      const created = new Date(row.created_at).getTime();
      if (Number.isNaN(created)) continue;
      const end = row.closed_at ? new Date(row.closed_at).getTime() : now;
      minutes += ceilMinutesBetween(created, Number.isNaN(end) ? now : end);
    }
    return minutes;
  } catch {
    return 0;
  }
}

// ─── Preflight budget check (fail closed) ─────────────────────────

export type BrowserStartRefusal =
  | "rate_limited"
  | "spend_ceiling_exceeded"
  | "session_cap"
  | "quota_exhausted"
  | "insufficient_bits"
  | "billing_unavailable";

export type PreflightBrowserStartResult =
  | { ok: true }
  | { ok: false; error: BrowserStartRefusal; message: string };

const startTimestamps = new Map<string, number[]>();

function startRateLimited(userId: string): boolean {
  const now = Date.now();
  const stamps = (startTimestamps.get(userId) ?? []).filter(
    (t) => now - t < SESSION_START_RATE_LIMIT.windowMs,
  );
  if (stamps.length >= SESSION_START_RATE_LIMIT.max) {
    startTimestamps.set(userId, stamps);
    return true;
  }
  stamps.push(now);
  startTimestamps.set(userId, stamps);
  return false;
}

function insufficientBitsMessage(): string {
  return (
    `You need at least ${BROWSER_MINUTE_BITS} LiTTBits to start a browser session ` +
    "(one browser-minute). Top up your balance and try again."
  );
}

/**
 * Fail-closed preflight for browser session starts. The caller supplies
 * the current active-session count (from dbGetActiveSessions) so this
 * module never imports the session manager (import cycle).
 *
 * Checks, in order: tool-path start rate limit → preflightBillingAuth
 * (owner spend ceiling) → concurrent session cap → daily minute quota →
 * BITS balance (skipped for billing-exempt owners, video-route
 * precedent). The first failure wins; the message is user-facing.
 */
export async function preflightBrowserStart(
  userId: string,
  activeSessionCount: number,
): Promise<PreflightBrowserStartResult> {
  // 1. Rate limit (covers the agent tool path; routes have withRateLimit).
  if (startRateLimited(userId)) {
    return {
      ok: false,
      error: "rate_limited",
      message:
        "You're starting browser sessions too quickly. Wait a bit and try again.",
    };
  }

  // 2. Owner spend ceiling (fail closed).
  let billingExempt = false;
  try {
    const preflight = await preflightBillingAuth(userId);
    if (!preflight.allowed) {
      return {
        ok: false,
        error: "spend_ceiling_exceeded",
        message:
          "The browser couldn't start: the monthly spend ceiling for this account has been reached.",
      };
    }
    billingExempt = preflight.billingExempt;
  } catch {
    return {
      ok: false,
      error: "billing_unavailable",
      message:
        "The browser couldn't start: billing verification failed. No session was created.",
    };
  }

  // 3. Concurrent session cap.
  if (activeSessionCount >= MAX_CONCURRENT_BROWSER_SESSIONS) {
    return {
      ok: false,
      error: "session_cap",
      message: CONCURRENT_SESSION_CAP_MESSAGE,
    };
  }

  // 4. Daily minute quota.
  const dailyMinutes = await getDailyBrowserMinutesUsed(userId);
  if (dailyMinutes >= DAILY_BROWSER_MINUTES_QUOTA) {
    return { ok: false, error: "quota_exhausted", message: QUOTA_PAUSED_MESSAGE };
  }

  // 5. Balance — no BITS, no session. Skipped for billing-exempt owners
  // (video-route precedent: exempt skips balance check and debit).
  if (!billingExempt) {
    try {
      const balances = await getCreditBalances(userId);
      if (balances.total < BROWSER_MINUTE_BITS) {
        return {
          ok: false,
          error: "insufficient_bits",
          message: insufficientBitsMessage(),
        };
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // No wallet DB in dev — don't block local development.
      if (process.env.NODE_ENV === "production") {
        return {
          ok: false,
          error: "billing_unavailable",
          message: `The browser couldn't start: couldn't verify your LiTTBits balance (${msg}). No session was created.`,
        };
      }
    }
  }

  return { ok: true };
}

// ─── Per-action gate (cap + quota) ────────────────────────────────

export type ActionGateResult =
  | { allowed: true }
  | { allowed: false; pause: false; error: "action_cap"; message: string }
  | { allowed: false; pause: true; error: "quota_exhausted"; message: string };

/**
 * Gate consulted before every executed browser action: per-session
 * action cap (refuse the 101st) and daily minute quota (pause the
 * session with the plain-English message — never a silent stall).
 */
export async function checkActionGate(
  sessionId: string,
  userId: string,
  createdAtIso: string,
): Promise<ActionGateResult> {
  const { actionCount } = getAccumulatorState(sessionId);
  if (actionCount >= MAX_ACTIONS_PER_BROWSER_SESSION) {
    return {
      allowed: false,
      pause: false,
      error: "action_cap",
      message: ACTION_CAP_MESSAGE,
    };
  }

  const dailyMinutes = await getDailyBrowserMinutesUsed(userId);
  const sessionMinutes = wallMinutesForSession(createdAtIso, Date.now());
  if (dailyMinutes + sessionMinutes >= DAILY_BROWSER_MINUTES_QUOTA) {
    return {
      allowed: false,
      pause: true,
      error: "quota_exhausted",
      message: QUOTA_PAUSED_MESSAGE,
    };
  }

  return { allowed: true };
}

// ─── Settle (one ledger write per session) ────────────────────────

export interface SettleBrowserSessionResult {
  /** BITS accrued (what was/would be charged). */
  bits: number;
  billableMinutes: number;
  modelCalls: number;
  /** True when the wallet was actually debited. */
  debited: boolean;
  /** True when this settle was an idempotent replay (no new charge). */
  replayed: boolean;
  /** True when the user was billing-exempt (metered, not debited). */
  exempt: boolean;
  error?: string;
}

/**
 * Settle a session's BITS on close/TTL. Single ledger write, idempotency
 * key `browser:settle:<sessionId>` — a retried close settles once.
 * 0 BITS → no ledger write at all. Failures are returned, never thrown,
 * so settle can never break session cleanup.
 */
export async function settleBrowserSession(
  session: Pick<BrowserSession, "id" | "userId">,
): Promise<SettleBrowserSessionResult> {
  const now = Date.now();
  const acc = accumulators.get(session.id);
  const billableMins = billableMinutes(acc?.billableFromMs ?? null, now);
  const modelCalls = acc?.modelCalls ?? 0;
  const bits = bitsForSession(billableMins, modelCalls);
  // The accumulator is done either way — settle is terminal.
  accumulators.delete(session.id);

  const base = {
    bits,
    billableMinutes: billableMins,
    modelCalls,
    debited: false,
    replayed: false,
    exempt: false,
  };

  // Provider failure / never used → 0 BITS, no ledger write.
  if (bits <= 0) return base;

  const exempt = isBillingExempt(session.userId);
  if (exempt) {
    // Metered, never debited (video-route precedent for the owner).
    return { ...base, exempt: true };
  }

  try {
    const idempotencyKey = `browser:settle:${session.id}`;
    const adjustment = await adjustWalletBalance({
      clerkId: session.userId,
      amount: -bits,
      type: "spend",
      reason:
        `Agent browser session — ${billableMins} min × ${BROWSER_MINUTE_BITS} BITS` +
        (modelCalls > 0
          ? ` + ${modelCalls} model calls × ${BROWSER_MODEL_CALL_BITS} BITS`
          : ""),
      idempotencyKey,
      rating: buildChargeRating({
        capability: "browser",
        provider: "browserbase",
        model: "stagehand/gemini-2.5-flash",
        providerCostMicros: providerCostMicrosFor(billableMins),
        bitsCharged: bits,
        billingClass: "standard",
        lane: "generation",
      }),
      usage: { computeMs: billableMins * 60_000 },
    });
    return {
      ...base,
      debited: !adjustment.replayed,
      replayed: adjustment.replayed,
    };
  } catch (err) {
    return {
      ...base,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// ─── Metadata persistence (forensic backup of the accumulator) ────

/**
 * Billing fields persisted into the session's metadata JSON on every
 * action (the DB fallback for getBurnSnapshot, and the audit trail for
 * what the in-memory meter saw). Shaped so getBurnSnapshot can read it.
 */
export function billingMetadata(sessionId: string): {
  modelCalls: number;
  actionCount: number;
} {
  const { actionCount, modelCalls } = getAccumulatorState(sessionId);
  return { modelCalls, actionCount };
}
