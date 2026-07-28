import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * POST /api/voice/realtime-token
 *
 * Issues a short-lived OpenAI Realtime ephemeral token for browser WebRTC
 * connections. The permanent OPENAI_API_KEY never reaches the browser.
 *
 * Body: { agentId: string, instructions: string, voice?: string }
 * Returns: { token: string, model: string }
 *
 * @see https://platform.openai.com/docs/guides/realtime-webrtc
 */
export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "OpenAI API key not configured" },
        { status: 503 },
      );
    }

    const body = await req.json();
    const { instructions, voice } = body as {
      agentId?: string;
      instructions?: string;
      voice?: string;
    };

    if (!instructions || typeof instructions !== "string") {
      return NextResponse.json(
        { error: "Missing required field: instructions" },
        { status: 400 },
      );
    }

    // Create an ephemeral token via the OpenAI Realtime API.
    // The browser uses this token (not our API key) for the WebRTC SDP exchange.
    // Using the latest preview snapshot (2025-06-03) for best performance.
    const model = "gpt-4o-realtime-preview-2025-06-03";

    const tokenRes = await fetch(
      "https://api.openai.com/v1/realtime/sessions",
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          voice: voice || "alloy",
          instructions,
          input_audio_format: "pcm16",
          output_audio_format: "pcm16",
          turn_detection: {
            type: "server_vad",
            threshold: 0.5,
            prefix_padding_ms: 300,
            silence_duration_ms: 500,
          },
          input_audio_transcription: {
            model: "whisper-1",
          },
        }),
      },
    );

    if (!tokenRes.ok) {
      const errBody = await tokenRes.text();
      console.error("[realtime-token] OpenAI error:", tokenRes.status, errBody);
      return NextResponse.json(
        { error: `OpenAI Realtime token request failed: ${tokenRes.status}` },
        { status: 502 },
      );
    }

    const sessionData = await tokenRes.json();
    const token = sessionData.client_secret?.value;
    if (!token) {
      return NextResponse.json(
        { error: "OpenAI did not return a client secret" },
        { status: 502 },
      );
    }

    return NextResponse.json({ token, model });
  } catch (err) {
    console.error("[realtime-token] error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal error" },
      { status: 500 },
    );
  }
}
