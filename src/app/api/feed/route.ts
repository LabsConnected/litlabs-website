// Legacy feed endpoint — superseded by /api/posts.
// Kept only to return a clear 410 so any stray client calls fail loudly
// instead of silently hitting stale behavior. The legacy POST (which created
// posts with mock fallbacks) has been removed entirely.
import { NextRequest, NextResponse } from "next/server";
import { withRateLimit } from "@/lib/rate-limiter";

async function getHandler(_req: NextRequest) {
  return NextResponse.json({ error: "Gone: use /api/posts" }, { status: 410 });
}

export const GET = withRateLimit(getHandler, 100, 60);
