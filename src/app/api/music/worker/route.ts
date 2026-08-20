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
 * In development with NO secrets configured, the endpoint is open.
 */
function isAuthorized(req: NextRequest): boolean {
  const workerSecret = process.env.MUSIC_WORKER_SECRET;
  const cronSecret = process.env.CRON_SECRET;

  // No secrets configured → open (development only).
  if (!workerSecret && !cronSecret) return true;

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
 *   - GitHub Actions Cron (.github/workflows/cron-music-worker.yml) — Authorization: Bearer CRON_SECRET
 *   - Internal server kick (after generation creation) — x-worker-secret
 *   - Manual admin call
 *
 * Security: protected by CRON_SECRET (Bearer) or MUSIC_WORKER_SECRET (x-worker-secret).
 * In development with no secret configured, the endpoint is open.
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
export const GET = handler;
