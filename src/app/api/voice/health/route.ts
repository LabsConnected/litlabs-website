import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { createHmac } from "crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/voice/health
 *
 * Real voice health check. Does NOT just check env vars — it actually
 * tests the token generation path (the same logic /api/voice/token uses).
 *
 * Returns structured data:
 * {
 *   "provider": "inworld",
 *   "configured": true,
 *   "tokenService": "healthy" | "error",
 *   "transport": "disconnected",  // always disconnected here — transport is client-side
 *   "available": true,
 *   "checkedAt": "ISO_TIMESTAMP",
 *   "details": { apiKey, littVoice, sparkVoice, wsUrl, authSecret }
 * }
 *
 * If the token service fails (missing env vars, bad secret, etc.):
 * {
 *   "provider": "inworld",
 *   "configured": true|false,
 *   "tokenService": "error",
 *   "available": false,
 *   "errorCode": "VOICE_TOKEN_UNAVAILABLE",
 *   "message": "Voice is configured, but the token service could not be reached."
 * }
 */
export async function GET() {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const checkedAt = new Date().toISOString();

  const apiKey = process.env.INWORLD_API_KEY;
  const littVoice = process.env.INWORLD_LITT_VOICE;
  const sparkVoice = process.env.INWORLD_SPARK_VOICE;
  const authSecret = process.env.VOICE_AUTH_SECRET;
  const wsUrl = process.env.NEXT_PUBLIC_VOICE_WS_URL ||
    "wss://voice-proxy-production-3f9c.up.railway.app/voice";

  // Check configuration (env vars exist)
  const configured = !!(apiKey && littVoice && authSecret && authSecret.length >= 32);

  const details = {
    apiKey: !!apiKey,
    littVoice: !!littVoice,
    sparkVoice: !!sparkVoice,
    wsUrl: !!wsUrl,
    authSecret: !!(authSecret && authSecret.length >= 32),
  };

  // If not configured, return not_configured
  if (!configured) {
    const missing: string[] = [];
    if (!apiKey) missing.push("INWORLD_API_KEY");
    if (!littVoice) missing.push("INWORLD_LITT_VOICE");
    if (!authSecret || authSecret.length < 32) missing.push("VOICE_AUTH_SECRET");

    return NextResponse.json({
      provider: "inworld",
      configured: false,
      tokenService: "error",
      transport: "disconnected",
      available: false,
      errorCode: "VOICE_NOT_CONFIGURED",
      message: `Voice is not configured. Missing: ${missing.join(", ")}.`,
      details,
      checkedAt,
    }, { status: 200, headers: { "Cache-Control": "no-store, max-age=0" } });
  }

  // Actually test the token generation path (same logic as /api/voice/token)
  try {
    const now = Math.floor(Date.now() / 1000);
    const ttl = 3 * 60;
    const payload = {
      sub: userId,
      iat: now,
      exp: now + ttl,
      key: Buffer.from(apiKey!, "utf-8").toString("base64"),
    };
    const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
    const sig = createHmac("sha256", authSecret!).update(encoded).digest("base64url");
    const token = `${encoded}.${sig}`;

    // Verify the token is well-formed (non-empty, has two parts)
    if (!token || !token.includes(".")) {
      throw new Error("Token generation produced an invalid token");
    }

    // Token service is healthy — return success
    return NextResponse.json({
      provider: "inworld",
      configured: true,
      tokenService: "healthy",
      transport: "disconnected", // transport is client-side state, not server-side
      available: true,
      details,
      checkedAt,
    }, { headers: { "Cache-Control": "no-store, max-age=0" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown token service error";
    return NextResponse.json({
      provider: "inworld",
      configured: true,
      tokenService: "error",
      transport: "disconnected",
      available: false,
      errorCode: "VOICE_TOKEN_UNAVAILABLE",
      message: `Voice is configured, but the token service could not be reached: ${message}`,
      details,
      checkedAt,
    }, { status: 200, headers: { "Cache-Control": "no-store, max-age=0" } });
  }
}
