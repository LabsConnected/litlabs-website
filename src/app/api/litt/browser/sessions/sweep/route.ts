import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { isOwnerClerkId } from "@/lib/owner";
import { sweepIdleBrowserSessions } from "@/lib/litt-intelligence/browser-session-manager";
import { mapBrowserFailure } from "@/lib/action-runtime/safe-errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/litt/browser/sessions/sweep
 *
 * Phase 5 — scheduled idle-session sweeper for the agent browser.
 * Closes every idle-expired browser session and settles its BITS:
 *  - in-memory idle sessions on this instance;
 *  - DB rows in an active-like status past the idle TTL that no local
 *    process owns (the owning instance died, or is a different Railway
 *    replica): conditional close + best-effort provider cleanup +
 *    row-snapshot settle.
 *
 * Idempotent and safe to run often — conditional closes elect a single
 * winner and settle carries the session-scoped idempotency key.
 *
 * Triggered by an external scheduler (Railway cron, Vercel Cron, or
 * GitHub Actions) — this repo's established cron pattern (cf.
 * /api/account/purge-expired, /api/music/worker): present
 * `x-cron-secret: <CRON_SECRET>` or `Authorization: Bearer <CRON_SECRET>`.
 * The platform owner may also trigger it manually (Clerk session).
 *
 * With no CRON_SECRET configured the route refuses (unlike the music
 * worker's dev-open default — an idle sweeper must never run
 * unauthenticated in production).
 */
function isAuthorized(req: NextRequest): boolean {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const headerSecret = req.headers.get("x-cron-secret");
    if (headerSecret && headerSecret === cronSecret) return true;
    const authHeader = req.headers.get("authorization") ?? "";
    if (
      authHeader.toLowerCase().startsWith("bearer ") &&
      authHeader.slice(7).trim() === cronSecret
    ) {
      return true;
    }
  }
  return false;
}

async function handler(req: NextRequest) {
  if (req.method !== "POST") {
    return NextResponse.json({ error: "Method not allowed" }, { status: 405 });
  }

  if (!isAuthorized(req)) {
    // Manual trigger: owner only.
    const { userId } = await auth(req);
    if (!userId || !isOwnerClerkId(userId)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  try {
    const result = await sweepIdleBrowserSessions();
    return NextResponse.json({
      success: true,
      ...result,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    const failure = mapBrowserFailure(err, "BROWSER_SESSION_SWEEP_FAILED");
    console.error("[browser-session-sweep] failed", {
      code: failure.code,
    });
    return NextResponse.json(
      { code: failure.code, message: "LiTT couldn't clean up browser sessions right now." },
      { status: 503 },
    );
  }
}

export const POST = handler;
