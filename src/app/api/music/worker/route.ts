import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { processPendingGenerations } from "@/lib/music/generation-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Timing-safe string comparison. Returns false if lengths differ.
 */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a), Buffer.from(b));
  } catch {
    return false;
  }
}

/**
 * Verify the request is authorized to invoke the worker.
 *
 * Accepts EITHER:
 *   1. Vercel Cron:  Authorization: Bearer <CRON_SECRET>
 *      (Vercel's documented mechanism — see vercel.com/docs/cron-jobs)
 *   2. Internal worker: x-worker-secret: <MUSIC_WORKER_SECRET>
 *
 * FAIL-CLOSED: if neither secret is configured, ALL requests are denied.
 * An unconfigured worker must never process jobs — a missing env var must
 * not silently expose billable MiniMax processing to the internet.
 */
function isAuthorized(req: NextRequest): boolean {
  const workerSecret = process.env.MUSIC_WORKER_SECRET;
  const cronSecret = process.env.CRON_SECRET;

  // Fail closed: no secrets configured → deny everything.
  // (Previously this returned true — a missing env var silently opened
  // the endpoint. See security fix 2026-10-08.)
  if (!workerSecret && !cronSecret) return false;

  // Check internal worker secret (x-worker-secret header).
  const providedWorker = req.headers.get("x-worker-secret");
  if (workerSecret && providedWorker && safeEqual(providedWorker, workerSecret)) {
    return true;
  }

  // Check Vercel cron secret (Authorization: Bearer <CRON_SECRET>).
  // This is Vercel's documented auth mechanism for cron jobs.
  if (cronSecret) {
    const authHeader = req.headers.get("authorization") || "";
    let presented = "";
    if (authHeader.toLowerCase().startsWith("bearer ")) {
      presented = authHeader.slice(7).trim();
    }
    if (presented && safeEqual(presented, cronSecret)) {
      return true;
    }
    // Backward compat: some older Vercel projects sent x-vercel-cron-auth-token.
    // Keep this as a fallback so a transition doesn't break production.
    const legacyCron = req.headers.get("x-vercel-cron-auth-token");
    if (legacyCron && safeEqual(legacyCron, cronSecret)) {
      return true;
    }
  }

  return false;
}

/**
 * POST /api/music/worker
 *
 * Durable worker endpoint that processes pending and stale music generations.
 *
 * Triggered by:
 *   - Vercel Cron (vercel.json schedule) — Authorization: Bearer CRON_SECRET
 *   - Internal server kick (after generation creation) — x-worker-secret
 *   - Manual admin call
 *
 * Security: protected by CRON_SECRET (Bearer) or MUSIC_WORKER_SECRET (x-worker-secret).
 * FAIL-CLOSED: requests are denied unless a valid secret is presented, even
 * when no secrets are configured (missing env vars never authorize).
 * POST-only: GET was removed — no legitimate caller uses GET (verified 2026-10-08).
 */
async function handler(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await processPendingGenerations();
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Worker failed";
    console.error(`[music:worker] error: ${message}`);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export const POST = handler;
// GET removed (security fix 2026-10-08): no legitimate caller uses GET —
// the kick endpoint calls processPendingGenerations() server-side, and there
// is no vercel.json cron. Allowing GET made the worker trivially triggerable
// from a browser URL bar.
