// User-facing billing policy for the approved #684 LiTTBits fix.
//
// Canonical contract only — this file documents the rules and exports the
// pure helpers that application code uses to decide billability. It does NOT
// touch wallets, grants, entitlements or plan definitions.
//
// Approved rules:
//  1. Cancelled builds refund unused reserved LiTTBits.
//  2. Charge only for verifiably completed billable operations.
//  3. Approval waits hold the reservation with an explicit timeout and
//     automatic release on expiration.
//  4. Plain Studio chat is free, subject to abuse protection.
//  5. Minimum of 1 LiTTBit applies to successful billable operations only.
//  6. Existing plan allowances/entitlements are preserved.

import type { SimulatedPlan } from "@/lib/owner";

// ── Free-chat abuse protection ───────────────────────────────────────

/** Window (ms) for counting rapid free-chat messages from the same actor. */
export const FREE_CHAT_BURST_WINDOW_MS = 30_000;
/** Maximum plain Studio chat turns allowed in a burst window before soft-limit. */
export const FREE_CHAT_BURST_LIMIT = 20;
/** Label attached to a billable agent-run usage event. */
export const BILLABLE_RUN_CAPABILITY = "agent_run";
/** Feature label used on run usage events. */
export const RUN_FEATURE_LABEL = "studio-chat";

// ── Minimum billing ──────────────────────────────────────────────────

/** Minimum LiTTBits charged for a successful billable operation. */
export const MINIMUM_BILLABLE_BITS = 1;

/**
 * Returns the minimum charge for a completed billable operation.
 * Used ONLY after the operation verifiably completed; it is never
 * applied to failed, cancelled or free actions.
 */
export function minimumBillableCharge(): number {
  return MINIMUM_BILLABLE_BITS;
}

// ── Billability classification ───────────────────────────────────────

/**
 * Why a given run was treated as free or billable. Used on the reservation
 * and on the settlement record so the billing path is auditable.
 */
export type BillabilityCause =
  | "chat_free"        // ordinary Studio chat turn
  | "chat_abuse_limit" // chat beyond approved free burst
  | "billing_exempt"   // owner / simulated exempt actor
  | "build_billable"   // agent/build execution path
  | "unknown";

/**
 * Decides whether a run should be treated as free or billable at
 * reservation time. Returns the cause so callers can route to the correct
 * reservation mode.
 */
export function classifyRunBillability(input: {
  /** True for ordinary Studio chat turns. */
  isPlainChat: boolean;
  /** Owner reservation-time model/provider (for future abuse heuristics). */
  model?: string | null;
  /** Owner simulation override, when applicable. */
  simulation?: SimulatedPlan | null;
  /** Pre-resolved billing exemption for the actor. */
  billingExempt: boolean;
  /** Abuse-protected free-chat budget remaining for the window. */
  freeChatBudgetRemaining: number;
}): { billable: boolean; cause: BillabilityCause } {
  if (input.billingExempt) {
    return { billable: false, cause: "billing_exempt" };
  }
  if (input.isPlainChat) {
    if (input.freeChatBudgetRemaining > 0) {
      return { billable: false, cause: "chat_free" };
    }
    return { billable: true, cause: "chat_abuse_limit" };
  }
  return { billable: true, cause: "build_billable" };
}

// ── Approval hold timeout ────────────────────────────────────────────

/** Default maximum time a reservation may be held waiting for approval. */
export const APPROVAL_HOLD_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes
/** ISO-8601 duration literal suitable for a Postgres interval, 30 min. */
export const APPROVAL_HOLD_TIMEOUT_INTERVAL = "30 minutes";
