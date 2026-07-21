import { NextResponse } from "next/server";
import { GoogleGenAI } from "@google/genai";
import { auth } from "@/lib/auth";

export const runtime = "nodejs";
export const maxDuration = 10;

export async function POST() {
  const { userId } = await auth();

  if (!userId) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401 },
    );
  }

  if (
    process.env.NEXT_PUBLIC_STUDIO_LIVE_VOICE_ENABLED !== "true"
  ) {
    return NextResponse.json(
      { error: "Live voice is disabled" },
      { status: 503 },
    );
  }

  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    return NextResponse.json(
      { error: "Live voice is not configured" },
      { status: 503 },
    );
  }

  const model =
    process.env.GEMINI_LIVE_MODEL ??
    "gemini-3.1-flash-live-preview";

  try {
    const client = new GoogleGenAI({ apiKey });

    const token = await (client as unknown as {
      authTokens: {
        create: (config: unknown) => Promise<{ name: string }>;
      };
    }).authTokens.create({
      config: {
        uses: 1,
        expireTime: new Date(
          Date.now() + 30 * 60 * 1000,
        ).toISOString(),
        newSessionExpireTime: new Date(
          Date.now() + 60 * 1000,
        ).toISOString(),
        liveConnectConstraints: {
          model,
          config: {
            sessionResumption: {},
            temperature: 0.6,
            responseModalities: ["AUDIO"],
          },
        },
        httpOptions: {
          apiVersion: "v1alpha",
        },
      },
    });

    return NextResponse.json({
      token: token.name,
      model,
    }, {
      headers: {
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    console.error("[api/voice/live-token] error:", err);
    return NextResponse.json(
      { error: "Failed to issue live voice token" },
      { status: 500 },
    );
  }
}
