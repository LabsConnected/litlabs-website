import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import { createHmac } from "crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TOKEN_TTL_SECONDS = 3 * 60;

function getSecret(): string {
  const secret = process.env.VOICE_AUTH_SECRET ?? "";
  if (secret.length < 32) {
    throw new Error("VOICE_AUTH_SECRET must contain at least 32 characters");
  }
  return secret;
}

export async function GET(request: NextRequest) {
  const { userId } = await auth(request);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const apiKey = process.env.INWORLD_API_KEY;
  // Read VOICE_WS_URL at runtime (server-side). NEXT_PUBLIC_ vars are inlined
  // at build time by webpack, so process.env.NEXT_PUBLIC_VOICE_WS_URL returns
  // the build-time value, not the current Railway variable. Use a plain
  // server-side var with a fallback to the NEXT_PUBLIC_ one for local dev.
  const voiceWsUrl = process.env.VOICE_WS_URL || process.env.NEXT_PUBLIC_VOICE_WS_URL;
  if (!apiKey) {
    return NextResponse.json(
      {
        error: "Voice service is not configured. Set INWORLD_API_KEY, INWORLD_LITT_VOICE, and INWORLD_SPARK_VOICE.",
        configured: false,
        details: {
          apiKey: false,
          littVoice: false,
          sparkVoice: false,
          wsUrl: !!voiceWsUrl,
        },
      },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }

  try {
    const secret = getSecret();
    const now = Math.floor(Date.now() / 1000);

    const payload = {
      sub: userId,
      iat: now,
      exp: now + TOKEN_TTL_SECONDS,
      key: Buffer.from(apiKey, "utf-8").toString("base64"),
    };

    const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
    const sig = createHmac("sha256", secret).update(encoded).digest("base64url");

    const littVoice = process.env.INWORLD_LITT_VOICE || "";
    const sparkVoice = process.env.INWORLD_SPARK_VOICE || "";

    if (!littVoice || !voiceWsUrl) {
      const missing = [
        !littVoice && "INWORLD_LITT_VOICE",
        !voiceWsUrl && "VOICE_WS_URL",
      ].filter(Boolean);
      return NextResponse.json(
        {
          error: `Voice service is not configured. Set ${missing.join(" and ")}.`,
          configured: false,
          details: {
            apiKey: true,
            littVoice: !!littVoice,
            sparkVoice: !!sparkVoice,
            wsUrl: !!voiceWsUrl,
          },
        },
        { status: 503, headers: { "Cache-Control": "no-store" } },
      );
    }

    return NextResponse.json(
      {
        token: `${encoded}.${sig}`,
        expiresAt: payload.exp * 1000,
        endpoint: voiceWsUrl,
        littVoice,
        sparkVoice: sparkVoice || littVoice,
        configured: true,
        details: {
          apiKey: true,
          littVoice: true,
          sparkVoice: !!sparkVoice,
          wsUrl: !!voiceWsUrl,
        },
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (_error) {
    return NextResponse.json(
      { error: "Voice authentication is unavailable" },
      { status: 503 },
    );
  }
}
