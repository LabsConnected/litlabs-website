import "server-only";
import { getSupabaseAdmin } from "@/lib/supabase";

/**
 * Server-side GHL Affiliate Manager tracking — atomic claim edition.
 *
 * State machine: `untracked → processing → tracked | failed`
 *
 * The race condition in the previous check-then-call flow is fixed by
 * an atomic conditional UPDATE: only the request that successfully
 * flips `untracked → processing` proceeds to call GHL. All concurrent
 * requests see `processing` (or `tracked`) and return early.
 *
 * Flow:
 *   1. Client captures `am_id` from URL/cookie before Clerk redirect.
 *   2. Client calls POST /api/affiliate/track-lead with {amId?}.
 *   3. Server sanitizes am_id.
 *   4. Server attempts atomic claim: UPDATE state='processing'
 *      WHERE clerk_id=? AND state='untracked'. If 0 rows updated,
 *      another request already claimed it → return in-progress/replayed.
 *   5. Claimed request calls GHL.
 *      - Success → UPDATE state='tracked', set ghl_am_id + tracked_at.
 *      - Failure → UPDATE state='failed', leave retryable.
 *   6. Stale `processing` records (older than 5 min) are reset to
 *      `untracked` so a crashed request can be retried.
 */

const GHL_LOCATION_ID = "sT0yL2XFTU0l87Ooce3h";
const GHL_BACKEND_URL = "https://backend.leadconnectorhq.com";
const GHL_AM_SCRIPT_SRC = "https://link.msgsndr.com/js/am.js";

/** Stale processing timeout — a record stuck in `processing` longer than this is reset. */
const STALE_PROCESSING_MS = 5 * 60 * 1000; // 5 minutes

/** Max am_id length — GHL affiliate IDs are short UUID-like strings. */
const MAX_AM_ID_LENGTH = 128;

export type GhlTrackingState = "untracked" | "processing" | "tracked" | "failed";

export interface TrackLeadResult {
  tracked: boolean;
  replayed: boolean;
  reason?: string;
}

/**
 * Sanitize an am_id from untrusted client input.
 *
 * GHL am_id values are alphanumeric with dashes/underscores, typically
 * UUID-like or short identifiers. We reject anything with weird chars,
 * excessive length, or control characters to prevent injection.
 *
 * Returns null if the input is empty or invalid (no attribution).
 */
export function sanitizeAmId(input: string | null | undefined): string | null {
  if (!input) return null;
  const trimmed = input.trim();
  if (!trimmed) return null;
  if (trimmed.length > MAX_AM_ID_LENGTH) {
    console.warn(`[ghl] am_id rejected: too long (${trimmed.length} chars)`);
    return null;
  }
  // Allow alphanumeric, dashes, underscores only
  if (!/^[a-zA-Z0-9_-]+$/.test(trimmed)) {
    console.warn(`[ghl] am_id rejected: invalid charset`);
    return null;
  }
  return trimmed;
}

/**
 * Read the current tracking state for a user.
 */
export async function getTrackingState(clerkId: string): Promise<GhlTrackingState> {
  const admin = getSupabaseAdmin();
  if (!admin) return "untracked";

  const { data } = await admin
    .from("users")
    .select("ghl_tracking_state, ghl_tracking_started_at")
    .eq("clerk_id", clerkId)
    .maybeSingle();

  if (!data) return "untracked";

  const state = (data.ghl_tracking_state as GhlTrackingState) ?? "untracked";

  // Stale processing recovery: if processing for too long, treat as untracked
  if (state === "processing" && data.ghl_tracking_started_at) {
    const startedAt = new Date(data.ghl_tracking_started_at as string).getTime();
    if (Date.now() - startedAt > STALE_PROCESSING_MS) {
      console.info(`[ghl] stale processing detected for clerkId=${clerkId}, resetting to untracked`);
      await resetStaleProcessing(clerkId);
      return "untracked";
    }
  }

  return state;
}

/**
 * Reset a stale `processing` record back to `untracked` so it can retry.
 */
async function resetStaleProcessing(clerkId: string): Promise<void> {
  const admin = getSupabaseAdmin();
  if (!admin) return;

  await admin
    .from("users")
    .update({
      ghl_tracking_state: "untracked",
      ghl_tracking_started_at: null,
    })
    .eq("clerk_id", clerkId)
    .eq("ghl_tracking_state", "processing"); // only reset if still processing
}

/**
 * Atomic claim: attempt to transition `untracked → processing`.
 *
 * Uses a conditional UPDATE that only succeeds if the current state is
 * `untracked`. Returns true if this caller claimed the job (and should
 * proceed to call GHL), false if another request already claimed it.
 *
 * This is the key concurrency safeguard: the database's row-level
 * locking ensures exactly one UPDATE succeeds even under concurrent
 * load.
 */
export async function claimTracking(clerkId: string): Promise<boolean> {
  const admin = getSupabaseAdmin();
  if (!admin) return false;

  const now = new Date().toISOString();

  // Conditional update: only claim if currently untracked
  const { data, error } = await admin
    .from("users")
    .update({
      ghl_tracking_state: "processing",
      ghl_tracking_started_at: now,
    })
    .eq("clerk_id", clerkId)
    .eq("ghl_tracking_state", "untracked")
    .select("id");

  if (error) {
    console.warn(`[ghl] claimTracking error for clerkId=${clerkId}: ${error.message}`);
    return false;
  }

  // If we updated at least one row, we claimed it
  return Array.isArray(data) && data.length > 0;
}

/**
 * Mark tracking as complete (GHL acknowledged the lead).
 */
export async function markTracked(
  clerkId: string,
  amId: string | null,
): Promise<void> {
  const admin = getSupabaseAdmin();
  if (!admin) return;

  await admin
    .from("users")
    .update({
      ghl_tracking_state: "tracked",
      ghl_lead_tracked: true, // backward compat
      ghl_am_id: amId,
      ghl_lead_tracked_at: new Date().toISOString(),
      ghl_tracking_started_at: null,
    })
    .eq("clerk_id", clerkId);
}

/**
 * Mark tracking as failed (GHL rejected or errored).
 *
 * The record stays retryable — state goes back to `untracked` so the
 * next visit can try again. We log the failure but don't permanently
 * mark it as failed to allow retries.
 */
export async function markFailedRetryable(clerkId: string): Promise<void> {
  const admin = getSupabaseAdmin();
  if (!admin) return;

  await admin
    .from("users")
    .update({
      ghl_tracking_state: "untracked", // retryable
      ghl_tracking_started_at: null,
    })
    .eq("clerk_id", clerkId)
    .eq("ghl_tracking_state", "processing"); // only reset if we still own it
}

/**
 * Check if a user has already been tracked as a GHL lead.
 * (Backward-compat wrapper around getTrackingState.)
 */
export async function isUserGhlTracked(clerkId: string): Promise<boolean> {
  return (await getTrackingState(clerkId)) === "tracked";
}

/**
 * Get the stored am_id for a user (if any).
 */
export async function getUserGhlAmId(clerkId: string): Promise<string | null> {
  const admin = getSupabaseAdmin();
  if (!admin) return null;

  const { data } = await admin
    .from("users")
    .select("ghl_am_id")
    .eq("clerk_id", clerkId)
    .maybeSingle();

  return (data?.ghl_am_id as string) ?? null;
}

/**
 * Server-side GHL trackLead call.
 */
export async function submitGhlLead(params: {
  clerkId: string;
  email: string;
  firstName?: string;
  lastName?: string;
  amId?: string | null;
}): Promise<{ success: boolean; error?: string }> {
  const { clerkId, email, firstName, lastName, amId } = params;

  if (!email) {
    return { success: false, error: "Email is required for GHL lead tracking" };
  }

  try {
    const url = new URL("https://backend.leadconnectorhq.com/affiliates/track-lead");
    url.searchParams.set("locationId", GHL_LOCATION_ID);
    if (amId) {
      url.searchParams.set("am_id", amId);
    }

    const response = await fetch(url.toString(), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Origin": "https://litlabs.net",
      },
      body: JSON.stringify({
        email,
        firstName: firstName || "",
        lastName: lastName || "",
        locationId: GHL_LOCATION_ID,
        ...(amId ? { amId } : {}),
      }),
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => response.statusText);
      console.warn(
        `[ghl] trackLead FAILED clerkId=${clerkId} status=${response.status} amId=${amId ?? "none"} error=${errorText.slice(0, 200)}`,
      );
      return { success: false, error: `GHL returned ${response.status}` };
    }

    console.info(
      `[ghl] trackLead OK clerkId=${clerkId} amId=${amId ?? "none"}`,
    );
    return { success: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Network error";
    console.warn(
      `[ghl] trackLead ERROR clerkId=${clerkId} amId=${amId ?? "none"} error=${msg}`,
    );
    return { success: false, error: msg };
  }
}

/**
 * Idempotent lead tracking with atomic claim — the main entry point.
 *
 * Concurrency-safe: the atomic `claimTracking()` call ensures only one
 * concurrent request calls GHL. All others return in-progress/replayed.
 */
export async function trackLeadIdempotent(params: {
  clerkId: string;
  email: string;
  firstName?: string;
  lastName?: string;
  amId?: string | null;
}): Promise<TrackLeadResult> {
  const { clerkId, email, firstName, lastName } = params;
  const amId = sanitizeAmId(params.amId);

  // 1. Check current state (also handles stale processing recovery)
  const state = await getTrackingState(clerkId);

  if (state === "tracked") {
    console.info(`[ghl] trackLead REPLAY clerkId=${clerkId} — already tracked, skipping`);
    return { tracked: true, replayed: true, reason: "already_tracked" };
  }

  if (state === "processing") {
    console.info(`[ghl] trackLead IN_PROGRESS clerkId=${clerkId} — another request is tracking, skipping`);
    return { tracked: false, replayed: true, reason: "in_progress" };
  }

  // 2. Atomic claim: untracked → processing
  const claimed = await claimTracking(clerkId);
  if (!claimed) {
    // Someone else claimed it between our check and claim
    console.info(`[ghl] trackLead LOST_RACE clerkId=${clerkId} — another request claimed it`);
    return { tracked: false, replayed: true, reason: "lost_race" };
  }

  // 3. We own the claim — call GHL
  const result = await submitGhlLead({
    clerkId,
    email,
    firstName,
    lastName,
    amId,
  });

  if (!result.success) {
    // 4a. GHL failed — reset to untracked for retry
    await markFailedRetryable(clerkId);
    return { tracked: false, replayed: false, reason: result.error };
  }

  // 4b. GHL succeeded — mark as tracked
  await markTracked(clerkId, amId);

  return { tracked: true, replayed: false };
}

export {
  GHL_LOCATION_ID,
  GHL_BACKEND_URL,
  GHL_AM_SCRIPT_SRC,
  STALE_PROCESSING_MS,
};
