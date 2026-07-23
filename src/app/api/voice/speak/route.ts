import { NextRequest } from "next/server";
import { sanitizeSpeech } from "@/features/voice/lib/sanitizeSpeech";
import type { VoiceAgentId } from "@/features/voice/types";
import { streamTextToSpeech, getDefaultVoiceSettings } from "@/server/voice/elevenlabs";

export const runtime = "nodejs";

export async function POST(request: NextRequest): Promise<Response> {
  try {
    const body = (await request.json()) as {
      text?: string;
      agentId?: VoiceAgentId;
      voiceSettings?: {
        stability?: number;
        similarity?: number;
        style?: number;
        speakerBoost?: boolean;
      };
    };

    const text = sanitizeSpeech(body.text ?? "");
    const agentId: VoiceAgentId = body.agentId === "spark" ? "spark" : "litt";

    if (!text) {
      return Response.json(
        { error: "No speakable text provided." },
        { status: 400 },
      );
    }

    const apiKey = process.env.ELEVENLABS_API_KEY;
    if (!apiKey) {
      return Response.json(
        { error: "ElevenLabs is not configured. Set ELEVENLABS_API_KEY." },
        { status: 500 },
      );
    }

    const defaults = getDefaultVoiceSettings(agentId);
    const voiceSettings = {
      stability: body.voiceSettings?.stability ?? defaults.stability,
      similarity_boost: body.voiceSettings?.similarity ?? defaults.similarity_boost,
      style: body.voiceSettings?.style ?? defaults.style,
      use_speaker_boost: body.voiceSettings?.speakerBoost ?? defaults.use_speaker_boost,
    };

    const response = await streamTextToSpeech(text, agentId, voiceSettings, request.signal);

    return new Response(response.body, {
      headers: {
        "Content-Type": "audio/mpeg",
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    console.error("Voice route error:", error);
    const message = error instanceof Error ? error.message : "Unable to generate voice.";
    return Response.json({ error: message }, { status: 500 });
  }
}
