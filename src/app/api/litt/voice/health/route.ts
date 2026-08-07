import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/litt/voice/health
 *
 * Reports the health of the LiTT voice path. Voice providers can poll
 * this to verify the LiTT voice endpoint is reachable before routing
 * calls through it.
 */
export async function GET() {
  return NextResponse.json({
    status: "ok",
    endpoint: "/api/litt/voice/v1/chat/completions",
    protocol: "openai-chat-completions",
    streaming: true,
    runtime: "litt",
  });
}
