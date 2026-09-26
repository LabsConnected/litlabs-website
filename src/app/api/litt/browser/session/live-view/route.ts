import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { withRateLimit } from "@/lib/rate-limiter";
import {
  getConversationLiveView,
  getSessionLiveView,
} from "@/lib/browser-session-live-view";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/litt/browser/session/live-view?conversationId=... | ?sessionId=...
 *
 * Owner-checked live-view resolution for a chat-initiated browser
 * session (chat browser as first-class capability). The Studio chat
 * panel polls this to decide between the embedded live iframe and the
 * honest not-live fallback. Never shows "live" on an assumed basis:
 * the availability rule (src/lib/browser-live-view.ts) requires an
 * embeddable live URL, an active-like session row, and a fresh row.
 *
 * Exactly one of conversationId / sessionId is required. When both
 * are given, sessionId wins.
 *
 * Response:
 *   {
 *     available: boolean,           // may the panel frame embedUrl now?
 *     reason: "live" | <unavailable reason>,
 *     embedUrl: string | null,     // iframe URL — present ONLY when available
 *     openUrl: string | null,      // dashboard page for "open in new tab"
 *     sessionId: string | null,
 *     sessionStatus: string | null,
 *     checkedAt: string,
 *   }
 *
 * Auth: Clerk session cookie or Bearer <redacted> (Studio mode),
 * scoped to the authenticated user. A non-owner gets 404 — the
 * liveViewUrl capability URL is never served to anyone but the
 * session owner.
 */
async function handler(req: NextRequest) {
  const { userId } = await auth(req);
  if (!userId || userId === "anonymous-dev") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = req.nextUrl;
  const sessionId = url.searchParams.get("sessionId");
  const conversationId = url.searchParams.get("conversationId");

  if (!sessionId && !conversationId) {
    return NextResponse.json(
      { error: "Missing sessionId or conversationId" },
      { status: 400 },
    );
  }

  try {
    const info = sessionId
      ? await getSessionLiveView(sessionId, userId)
      : await getConversationLiveView(conversationId as string, userId);
    if (!info) {
      // Unknown session, or not the owner's — identical response either way.
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }
    return NextResponse.json({
      available: info.available,
      reason: info.reason,
      embedUrl: info.embedUrl,
      openUrl: info.openUrl,
      sessionId: info.sessionId,
      sessionStatus: info.sessionStatus,
      checkedAt: info.checkedAt,
    });
  } catch (err) {
    return NextResponse.json(
      { error: "Internal server error", detail: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}

export const GET = withRateLimit(handler, 60, 60); // polling-friendly
