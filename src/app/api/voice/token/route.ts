import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { createHmac, createCipheriv } from "crypto";

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

function encryptApiKey(apiKey: string, secret: string): string {
  const key = Buffer.from(secret, "utf-8").subarray(0, 32);
  const data = Buffer.from(apiKey, "utf-8");
  const iv = Buffer.alloc(16, 0);
  const cipher = createCipheriv("aes-256-cbc", key, iv);
  const encrypted = Buffer.concat([cipher.update(data), cipher.final()]);
  return encrypted.toString("base64");
}

export async function GET() {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const apiKey = process.env.INWORLD_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "Voice service is not configured" },
      { status: 503 },
    );
  }

  try {
    const secret = getSecret();
    const now = Math.floor(Date.now() / 1000);

    const payload = {
      sub: userId,
      iat: now,
      exp: now + TOKEN_TTL_SECONDS,
      key: encryptApiKey(apiKey, secret),
    };

    const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
    const sig = createHmac("sha256", secret).update(encoded).digest("base64url");

    const littVoice = process.env.INWORLD_LITT_VOICE || "rustic-banana-5826__design-voice-e5899468";
    const sparkVoice = process.env.INWORLD_SPARK_VOICE || littVoice;

    return NextResponse.json(
      {
        token: `${encoded}.${sig}`,
        expiresAt: payload.exp * 1000,
        endpoint: "wss://api.inworld.ai/api/v1/realtime/session",
        littVoice,
        sparkVoice,
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
