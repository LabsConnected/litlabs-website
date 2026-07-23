/**
 * ElevenLabs streaming TTS server module.
 * Provides streaming text-to-speech for LiTT and Spark voices.
 */

import type { VoiceAgentId } from "@/features/voice/types";

const ELEVENLABS_BASE = "https://api.elevenlabs.io/v1";

export interface ElevenLabsVoiceSettings {
  stability: number;
  similarity_boost: number;
  style: number;
  use_speaker_boost: boolean;
}

export function getVoiceId(agentId: VoiceAgentId): string {
  const voiceId =
    agentId === "spark"
      ? process.env.ELEVENLABS_SPARK_VOICE_ID
      : process.env.ELEVENLABS_LITT_VOICE_ID;

  if (!voiceId) {
    throw new Error(
      `Missing ElevenLabs voice ID for ${agentId}. Set ELEVENLABS_${agentId === "spark" ? "SPARK" : "LITT"}_VOICE_ID.`,
    );
  }

  return voiceId;
}

export function getDefaultVoiceSettings(agentId: VoiceAgentId): ElevenLabsVoiceSettings {
  if (agentId === "spark") {
    return {
      stability: 0.40,
      similarity_boost: 0.78,
      style: 0.68,
      use_speaker_boost: true,
    };
  }
  return {
    stability: 0.72,
    similarity_boost: 0.82,
    style: 0.22,
    use_speaker_boost: true,
  };
}

export interface ElevenLabsStreamResult {
  audioStream: ReadableStream<Uint8Array>;
  headers: Headers;
}

export async function streamTextToSpeech(
  text: string,
  agentId: VoiceAgentId,
  voiceSettings?: Partial<ElevenLabsVoiceSettings>,
  signal?: AbortSignal,
): Promise<Response> {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    throw new Error("ELEVENLABS_API_KEY is not configured");
  }

  const voiceId = getVoiceId(agentId);
  const defaults = getDefaultVoiceSettings(agentId);
  const settings = { ...defaults, ...voiceSettings };

  const response = await fetch(
    `${ELEVENLABS_BASE}/text-to-speech/${voiceId}/stream`,
    {
      method: "POST",
      headers: {
        "xi-api-key": apiKey,
        "Content-Type": "application/json",
        Accept: "audio/mpeg",
      },
      body: JSON.stringify({
        text,
        voice_settings: settings,
      }),
      signal,
    },
  );

  if (!response.ok || !response.body) {
    const errorText = await response.text();
    throw new Error(`ElevenLabs error ${response.status}: ${errorText}`);
  }

  return response;
}

export function isElevenLabsConfigured(): boolean {
  return !!process.env.ELEVENLABS_API_KEY;
}

export function getVoiceConfigStatus() {
  return {
    apiKey: !!process.env.ELEVENLABS_API_KEY,
    littVoiceId: !!process.env.ELEVENLABS_LITT_VOICE_ID,
    sparkVoiceId: !!process.env.ELEVENLABS_SPARK_VOICE_ID,
  };
}
