import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getUserByClerkId } from "@/lib/user-db";
import { getProfileStats } from "@/lib/profile-stats";
import { withRateLimit } from "@/lib/rate-limiter";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/profile/stats
 * Real counters for the signed-in user's profile header:
 * followers, following, posts, projects.
 * Returns { stats: null } when the counts can't be computed — the UI
 * shows an "unknown" dash rather than a fabricated number.
 */
async function getHandler(req: NextRequest) {
  try {
    const { userId: clerkId } = await auth(req);
    if (!clerkId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const user = await getUserByClerkId(clerkId);
    if (!user) {
      return NextResponse.json({ stats: null });
    }

    const stats = await getProfileStats(user.id, clerkId);
    return NextResponse.json({ stats });
  } catch {
    return NextResponse.json({ stats: null });
  }
}

export const GET = withRateLimit(getHandler, 60, 60);
