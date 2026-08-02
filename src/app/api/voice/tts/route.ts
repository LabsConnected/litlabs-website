import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

/**
 * OpenAI TTS endpoint for agent voice.
 * Uses tts-1 model — high quality, low latency, ~$0.015/min.
 * No wallet charge (voice is a core feature, not a premium asset).
 *
 * POST /api/voice/tts
 * Body: { text: string, voice?: "alloy"|"echo"|"fable"|"onyx"|"nova"|"shimmer" }
 * Returns: { audioUrl: string } (data URL, base64 MP3)
 */
export async function POST(req: NextRequest) {
  try {
    const { userId } = await auth(req);
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!OPENAI_API_KEY) {
      return NextResponse.json(
        { error: "OpenAI API key not configured" },
        { status: 500 },
      );
    }

    const { text, voice = "onyx" } = await req.json();
    if (!text?.trim()) {
      return NextResponse.json({ error: "Text required" }, { status: 400 });
    }

    // Truncate to 4096 chars (OpenAI TTS limit)
    const truncated = text.slice(0, 4096);

    const response = await fetch("https://api.openai.com/v1/audio/speech", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "tts-1",
        input: truncated,
        voice: voice,
        response_format: "mp3",
        speed: 1.0,
      }),
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => "Unknown error");
      console.error("[TTS] OpenAI API error:", response.status, errText);
      return NextResponse.json(
        { error: `TTS failed: ${response.status}` },
        { status: response.status },
      );
    }

    const audioBuffer = await response.arrayBuffer();
    const base64 = Buffer.from(audioBuffer).toString("base64");
    const audioUrl = `data:audio/mp3;base64,${base64}`;

    return NextResponse.json({ audioUrl });
  } catch (err: unknown) {
    console.error("[TTS] Error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "TTS failed" },
      { status: 500 },
    );
  }
}
