import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
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

export async function GET() {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const apiKey = process.env.INWORLD_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      {
        error: "Voice service is not configured. Set INWORLD_API_KEY, INWORLD_LITT_VOICE, and INWORLD_SPARK_VOICE.",
        configured: false,
        details: {
          apiKey: false,
          littVoice: false,
          sparkVoice: false,
          wsUrl: !!process.env.NEXT_PUBLIC_VOICE_WS_URL,
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

    if (!littVoice) {
      return NextResponse.json(
        {
          error: "INWORLD_LITT_VOICE is not configured. Set it to a valid Inworld voice ID for LiTT.",
          configured: false,
          details: {
            apiKey: true,
            littVoice: false,
            sparkVoice: !!sparkVoice,
            wsUrl: !!process.env.NEXT_PUBLIC_VOICE_WS_URL,
          },
        },
        { status: 503, headers: { "Cache-Control": "no-store" } },
      );
    }

    return NextResponse.json(
      {
        token: `${encoded}.${sig}`,
        expiresAt: payload.exp * 1000,
        endpoint: process.env.NEXT_PUBLIC_VOICE_WS_URL || "ws://localhost:4002/voice",
        littVoice,
        sparkVoice: sparkVoice || littVoice,
        configured: true,
        details: {
          apiKey: true,
          littVoice: true,
          sparkVoice: !!sparkVoice,
          wsUrl: !!process.env.NEXT_PUBLIC_VOICE_WS_URL,
        },
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("[voice/token] Error:", error);
    return NextResponse.json(
      { error: "Voice authentication is unavailable" },
      { status: 503 },
    );
  }
}
