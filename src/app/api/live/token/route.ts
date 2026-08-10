import { NextResponse } from "next/server";

export const runtime = "nodejs";

/**
 * POST /api/live/token — DEPRECATED
 *
 * This endpoint previously returned the permanent Gemini API key to the
 * browser. It has been replaced by /api/live/session-token which returns
 * a short-lived ephemeral token instead.
 *
 * @see /api/live/session-token/route.ts
 */
export function POST() {
  return NextResponse.json(
    {
      error:
        "This endpoint is deprecated. Use /api/live/session-token to get an ephemeral Live token.",
      deprecated: true,
      replacement: "/api/live/session-token",
    },
    { status: 410 },
  );
}
