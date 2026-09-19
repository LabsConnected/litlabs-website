import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { withRateLimit } from "@/lib/rate-limiter";
import { getLiveSessionStatus } from "@/lib/litt-intelligence/browser-session-manager";

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
    return NextResponse.json(status);
  } catch (err) {
    return NextResponse.json(
      { error: "Internal server error", detail: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}

export const GET = withRateLimit(handler, 60, 60);
