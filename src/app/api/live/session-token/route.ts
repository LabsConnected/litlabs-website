import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { withRateLimit } from "@/lib/rate-limiter";
import { GoogleGenAI, type AuthToken } from "@google/genai";
import { LIVE_MODEL_ID } from "@/lib/litt/live/types";

export const runtime = "nodejs";
export const maxDuration = 10;

/**
 * POST /api/live/session-token
 *
 * Returns a short-lived ephemeral Gemini Live token for browser-based
 * WebSocket connections. The permanent API key NEVER leaves the server.
 *
 * Flow:
 *   authenticated Clerk user
 *   → server owns permanent Gemini API key
 *   → server calls authTokens.create()
 *   → short-lived single-use ephemeral token
 *   → browser receives ephemeral token only
 *
 * Body: { model?: string }
 * Returns: { token: string, model: string, expiresAt: string }
 *
 * @see https://ai.google.dev/gemini-api/docs/live-api/ephemeral-tokens
 */
async function postHandler(req: NextRequest) {
  try {
    const session = await auth(req);
    if (!session?.userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

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
    const model = requestedModel || LIVE_MODEL_ID;

    // Create the server-side client with the permanent key (v1alpha required
    // for ephemeral tokens).
    const client = new GoogleGenAI({
      apiKey,
      apiVersion: "v1alpha",
    });

    if (!client.authTokens) {
      return NextResponse.json(
        { error: "Ephemeral tokens not supported by installed @google/genai version" },
        { status: 503 },
      );
    }

    // Create a short-lived ephemeral token — single use, 30 min expiry.
    const expireTime = new Date(Date.now() + 30 * 60 * 1000).toISOString();
    const newSessionExpireTime = new Date(Date.now() + 5 * 60 * 1000).toISOString();

    const authToken: AuthToken = await client.authTokens.create({
      config: {
        uses: 1,
        expireTime,
        newSessionExpireTime,
        httpOptions: { apiVersion: "v1alpha" },
      },
    });

    if (!authToken.name) {
      return NextResponse.json(
        { error: "Failed to generate ephemeral token" },
        { status: 500 },
      );
    }

    return NextResponse.json({
      token: authToken.name,
      model,
      expiresAt: expireTime,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal error";
    return NextResponse.json(
      { error: message },
      { status: 500 },
    );
  }
}

export const POST = withRateLimit(postHandler, 20, 60);
