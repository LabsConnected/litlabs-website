import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { withRateLimit } from "@/lib/rate-limiter";
import { getBusinessProfile } from "@/lib/business-profile-server";

/**
 * GET /api/business-profile[?projectId=]
 * Per-user read of the Business Profile:
 * - ?projectId=<id> — that project's profile (ownership-checked).
 * - otherwise — the user's default profile: the most recently updated
 *   project that has one.
 * Returns { profile } or { profile: null } when none exists yet.
 */
async function getHandler(req: NextRequest) {
  try {
    const { userId } = await auth(req);
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const projectId = req.nextUrl.searchParams.get("projectId") ?? undefined;
    const profile = await getBusinessProfile({ userId, projectId });
    return NextResponse.json({ profile });
  } catch {
    return NextResponse.json(
      { error: "Failed to load business profile" },
      { status: 500 },
    );
  }
}

export const GET = withRateLimit(getHandler, 100, 60);
