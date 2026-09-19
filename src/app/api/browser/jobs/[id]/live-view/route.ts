import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { withRateLimit } from "@/lib/rate-limiter";
import { authorizeVapiRequest, ownerClerkId } from "@/lib/vapi-tools";
import { getJobLiveView } from "@/lib/browser-job-live-view";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/browser/jobs/[id]/live-view
 *
 * Owner-checked live-view resolution for a browser job (Phase 6).
 * The Studio panel polls this to decide between the live iframe and
 * the snapshot fallback. Never shows "live" on an assumed basis: the
 * availability rule (src/lib/browser-live-view.ts) requires an
 * embeddable live URL, an active job, an active-like session row, and
 * a fresh row.
 *
 * Response:
 *   {
 *     available: boolean,           // may the panel frame embedUrl now?
 *     reason: "live" | <unavailable reason>,
 *     embedUrl: string | null,     // iframe URL — present ONLY when available
 *     openUrl: string | null,      // dashboard page for "open in new tab"
 *     sessionStatus: string | null,
 *     checkedAt: string,
 *   }
 *
 * Auth (dual mode, same as the job routes):
 *   1. Bearer <redacted>: Authorization: Bearer <LITTLABS_VAPI_TOOL_TOKEN>
 *      → Vapi mode, scoped to LITTLABS_VAPI_OWNER_CLERK_ID
 *   2. Clerk session cookie or Bearer <redacted>
 *      → Studio mode, scoped to the authenticated user
 *
 * A non-owner gets 404 — the liveViewUrl capability URL is never
 * served to anyone but the session owner.
 */
async function handler(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id: jobId } = await ctx.params;
  if (!jobId) {
    return NextResponse.json({ error: "Missing job ID" }, { status: 400 });
  }

  const authHeader = req.headers.get("authorization") || req.headers.get("Authorization") || "";

  let userId: string | null = null;

  if (authorizeVapiRequest(authHeader)) {
    userId = ownerClerkId();
  } else {
    const authResult = await auth(req);
    userId = authResult.userId;
  }

  if (!userId || userId === "anonymous-dev") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const info = await getJobLiveView(jobId, userId);
    if (!info) {
      // Unknown job, or not the owner's — identical response either way.
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }
    return NextResponse.json({
      available: info.available,
      reason: info.reason,
      embedUrl: info.embedUrl,
      openUrl: info.openUrl,
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
