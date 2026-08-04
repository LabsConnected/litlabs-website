import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { withRateLimit } from "@/lib/rate-limiter";

export const runtime = "nodejs";
export const maxDuration = 10;

/**
 * POST /api/live/token
 *
 * Returns a Gemini API key for browser-based Gemini Live API connections.
 *
 * The key is NOT a NEXT_PUBLIC variable — it is only delivered to
 * authenticated Clerk users at runtime. For production hardening,
 * create a restricted API key in Google AI Studio that only allows
 * the Live API and set it as GEMINI_LIVE_API_KEY.
 *
 * Body: { model?: string }
 * Returns: { apiKey: string, model: string }
 *
 * @see https://ai.google.dev/gemini-api/docs/live-api
 */
async function postHandler(req: NextRequest) {
  try {
    const session = await auth(req);
    if (!session?.userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Prefer a restricted Live-only key if provided, fall back to the
    // general Gemini key.  Neither is ever in NEXT_PUBLIC_*.
    const apiKey =
      process.env.GEMINI_LIVE_API_KEY ||
      process.env.GEMINI_API_KEY ||
      process.env.GOOGLE_API_KEY;

    if (!apiKey) {
      return NextResponse.json(
        { error: "Gemini API key not configured" },
        { status: 503 },
      );
    }

    const body = await req.json().catch(() => ({}));
    const requestedModel = (body as { model?: string }).model;

    // Use the currently supported Gemini Live Flash preview model.
    // This is the real-time conversational model — NOT the REST vision model.
    const model = requestedModel || "gemini-live-2.5-flash-preview";

    return NextResponse.json({ apiKey, model });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal error" },
      { status: 500 },
    );
  }
}

export const POST = withRateLimit(postHandler, 20, 60);
