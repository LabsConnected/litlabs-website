import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { withRateLimit } from "@/lib/rate-limiter";
import { getLiveSessionStatus } from "@/lib/litt-intelligence/browser-session-manager";
import { getBurnSnapshot } from "@/lib/litt-intelligence/browser-billing";
import { mapBrowserFailure } from "@/lib/action-runtime/safe-errors";

export const runtime = "nodejs";

/**
 * GET /api/litt/browser/status
 *
 * Lightweight, honest liveness probe backing the Studio browser status
 * chip (Phase 2). Returns the user's current browser state for an
 * optional conversationId:
 *
 *   { state: "live" | "idle" | "disconnected", sessionId, controller,
 *     sessionStatus, lastActivityAt }
 *
 * Honesty contract (#397 precedent): "live" is reported only when a
 * Stagehand instance is genuinely present in this process's registry
 * with fresh activity inside the idle TTL. The chip must never show
 * "live" on any other basis.
 *
 * Phase 4: when a session is present, attaches `burn` — the real
 * accumulator reading ({ billableMinutes, modelCalls, bits, live }).
 * The chip renders it (e.g. "Browser · Live · 3 min · 135 BITS"). When
 * nothing is known, burn is null and the chip shows no burn rather
 * than a fake number.
 */
async function handler(req: NextRequest) {
  const { userId } = await auth(req);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const conversationId = url.searchParams.get("conversationId") ?? undefined;

  try {
    const status = await getLiveSessionStatus(userId, conversationId);
    let burn: Awaited<ReturnType<typeof getBurnSnapshot>> = null;
    if (status.sessionId) {
      burn = await getBurnSnapshot(status.sessionId, userId);
    }
    return NextResponse.json({ ...status, burn });
  } catch (err) {
    const failure = mapBrowserFailure(err, "BROWSER_STATUS_FAILED");
    console.error("[browser-status] probe failed", {
      code: failure.code,
      userId,
    });
    return NextResponse.json(
      { code: failure.code, message: "LiTT couldn't check the browser status right now." },
      { status: 503 },
    );
  }
}

export const GET = withRateLimit(handler, 60, 60);
