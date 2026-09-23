import { NextRequest, NextResponse } from "next/server";
import { randomUUID, timingSafeEqual } from "crypto";
import { auth } from "@/lib/auth";
import { isOwnerClerkId } from "@/lib/owner";
import { sweepIdleBrowserSessions } from "@/lib/litt-intelligence/browser-session-manager";
import { mapBrowserFailure } from "@/lib/action-runtime/safe-errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET|POST /api/litt/browser/sessions/sweep
 *
 * Phase 5 — scheduled idle-session sweeper for the agent browser.
 * Closes every idle-expired browser session, settles its BITS, and
 * reconciles the Action Runtime for each session it actually closes:
 *  - in-memory idle sessions on this instance;
 *  - DB rows in an active-like status past the idle TTL that no local
 *    process owns (the owning instance died, or is a different Railway
 *    replica): conditional close + best-effort provider cleanup +
 *    row-snapshot settle.
 *
 * Idempotent and safe to run often — conditional closes elect a single
 * winner and settle carries the session-scoped idempotency key, so
 * concurrent sweepers cannot double-close, double-charge, or emit
 * duplicate runtime lifecycle events.
 *
 * Triggered by an external scheduler (Railway cron, Vercel Cron, or
 * GitHub Actions) — this repo's established cron pattern (cf.
 * /api/account/purge-expired, /api/music/worker): present
 * `x-cron-secret: <CRON_SECRET>` or `Authorization: Bearer <CRON_SECRET>`.
 * Vercel Cron calls configured paths with GET and sends the Bearer
 * credential automatically when CRON_SECRET is set; POST is kept for
 * manual/other schedulers. The platform owner may also trigger it
 * manually (Clerk session).
 *
 * With no CRON_SECRET configured the route refuses (unlike the music
 * worker's dev-open default — an idle sweeper must never run
 * unauthenticated in production).
 */
function secretsEqual(candidate: string, expected: string): boolean {
  const a = Buffer.from(candidate);
  const b = Buffer.from(expected);
  // Different lengths can never match; still run a constant-time compare
  // against itself so the early-exit doesn't leak length as a side channel.
  if (a.length !== b.length) {
    timingSafeEqual(a, a);
    return false;
  }
  return timingSafeEqual(a, b);
}

function isAuthorized(req: NextRequest): boolean {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return false;
  const headerSecret = req.headers.get("x-cron-secret");
  if (headerSecret && secretsEqual(headerSecret, cronSecret)) return true;
  const authHeader = req.headers.get("authorization") ?? "";
  if (authHeader.toLowerCase().startsWith("bearer ")) {
    return secretsEqual(authHeader.slice(7).trim(), cronSecret);
  }
  return false;
}

async function handler(req: NextRequest) {
  if (req.method !== "GET" && req.method !== "POST") {
    return NextResponse.json({ error: "Method not allowed" }, { status: 405 });
  }

  if (!isAuthorized(req)) {
    // Manual trigger: owner only.
    const { userId } = await auth(req);
    if (!userId || !isOwnerClerkId(userId)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const sweepId = `sweep-${randomUUID()}`;
  try {
    const result = await sweepIdleBrowserSessions();
    console.log("[browser-session-sweep] completed", {
      sweepId,
      inspected: result.inspected,
      expired: result.expired,
      closed: result.closed,
      billingSettled: result.billingSettled,
      providerCleanupFailed: result.providerCleanupFailed,
      runtimeReconciled: result.runtimeReconciled,
      runtimeReconcileFailed: result.runtimeReconcileFailed,
    });
    return NextResponse.json({
      success: true,
      sweepId,
      ...result,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    const failure = mapBrowserFailure(err, "BROWSER_SESSION_SWEEP_FAILED");
    console.error("[browser-session-sweep] failed", {
      sweepId,
      code: failure.code,
      errorType: err instanceof Error ? err.name : typeof err,
    });
    return NextResponse.json(
      { code: failure.code, message: "LiTT couldn't clean up browser sessions right now.", sweepId },
      { status: 503 },
    );
  }
}

export const GET = handler;
export const POST = handler;
