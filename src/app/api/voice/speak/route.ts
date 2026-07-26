import { NextRequest } from "next/server";
import { sanitizeSpeech } from "@/features/voice/lib/sanitizeSpeech";
import type { VoiceAgentId } from "@/features/voice/types";
import { streamTextToSpeech, getDefaultVoiceSettings } from "@/server/voice/elevenlabs";
import { getProviderVoices, type TtsResponseMetadata } from "@/features/voice/lib/voiceConfig";

export const runtime = "nodejs";

export async function POST(request: NextRequest): Promise<Response> {
  let agentId: VoiceAgentId = "litt";
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

    agentId = body.agentId === "spark" ? "spark" : "litt";
    const text = sanitizeSpeech(body.text ?? "");

    if (!text) {
      return Response.json(
        { error: "No speakable text provided." },
        { status: 400 },
      );
    }

    const apiKey = process.env.ELEVENLABS_API_KEY;
    const providerVoices = getProviderVoices(agentId);
    const requestedVoiceId = providerVoices.elevenlabs ?? null;

    if (!apiKey || !requestedVoiceId) {
      const reason = !apiKey
        ? "ElevenLabs API key not configured"
        : `ElevenLabs voice ID not configured for ${agentId}`;

      const metadata: TtsResponseMetadata = {
        provider: "browser",
        requestedAgent: agentId,
        requestedVoiceId,
        actualVoiceId: "browser-fallback",
        fallbackUsed: true,
        fallbackReason: reason,
      };

      return Response.json(
        {
          error: "Voice provider not configured. Using browser fallback.",
          metadata,
          fallback: true,
        },
        { status: 200 },
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

    const metadata: TtsResponseMetadata = {
      provider: "elevenlabs",
      requestedAgent: agentId,
      requestedVoiceId,
      actualVoiceId: requestedVoiceId,
      fallbackUsed: false,
    };

    return new Response(response.body, {
      headers: {
        "Content-Type": "audio/mpeg",
        "Cache-Control": "no-store",
        "X-TTS-Provider": metadata.provider,
        "X-TTS-Agent": metadata.requestedAgent,
        "X-TTS-Voice-Id": metadata.actualVoiceId,
        "X-TTS-Fallback": String(metadata.fallbackUsed),
        "X-TTS-Fallback-Reason": metadata.fallbackReason ?? "",
      },
    });
  } catch (error) {
    console.error("Voice route error:", error);
    const message = error instanceof Error ? error.message : "Unable to generate voice.";

    const metadata: TtsResponseMetadata = {
      provider: "browser",
      requestedAgent: agentId,
      requestedVoiceId: null,
      actualVoiceId: "browser-fallback",
      fallbackUsed: true,
      fallbackReason: message,
    };

    return Response.json(
      { error: message, metadata, fallback: true },
      { status: 200 },
    );
  }
}
