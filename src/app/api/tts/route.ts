/**
 * /api/tts — server-side text-to-speech
 *
 * Two providers, picked at runtime:
 *   1. ElevenLabs — if ELEVENLABS_API_KEY is set and the voice's engineId
 *      is a real ElevenLabs voice id (e.g. "21m00Tcm4TlvDq8ikWAM").
 *   2. Gemini TTS — otherwise, if GEMINI_API_KEY is set. Uses the
 *      `gemini-2.5-flash-preview-tts` model. Supports the full Gemini TTS
 *      voice set (Kore, Puck, Charon, Fenrir, Orus, Aoede, etc.).
 *
 * POST { text, voice, rate?, pitch? } → audio/wav (or audio/mpeg) stream.
 *   - `text`  : up to 5000 chars
 *   - `voice` : one of the ids in `src/lib/voices.ts` (e.g. "Kore",
 *               "eleven_rachel")
 *   - `rate`  : optional browser-TTS rate for fallback (not used server-side)
 *   - `pitch` : optional browser-TTS pitch for fallback (not used server-side)
 *
 * Returns the audio bytes directly (Content-Type: audio/wav). Errors come
 * back as JSON with status 4xx/5xx.
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { withRateLimit } from "@/lib/rate-limiter";
import { sanitizeProviderError } from "@/lib/provider-error";
import { PREMIUM_VOICES, getVoiceById, type VoiceDescriptor } from "@/lib/voices";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

interface TtsRequest {
  text?: string;
  voice?: string;
}

async function handler(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: TtsRequest;
  try {
    body = (await req.json()) as TtsRequest;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const text = (body.text ?? "").trim();
  if (!text) {
    return NextResponse.json({ error: "Missing 'text'" }, { status: 400 });
  }
  if (text.length > 5000) {
    return NextResponse.json(
      { error: "Text too long (max 5000 chars)" },
      { status: 400 },
    );
  }

  // Resolve voice — fall back to the first premium voice
  const voice: VoiceDescriptor =
    (body.voice ? getVoiceById(body.voice) : undefined) ?? PREMIUM_VOICES[0];

  // Provider 1: ElevenLabs (only if voice is ElevenLabs and the key is set)
  if (voice.provider === "elevenlabs") {
    const key = process.env.ELEVENLABS_API_KEY;
    if (key) {
      try {
        const audio = await elevenLabsSynthesize(text, voice.engineId, key);
        return new NextResponse(new Uint8Array(audio), {
          status: 200,
          headers: {
            "Content-Type": "audio/mpeg",
            "Cache-Control": "public, max-age=86400, immutable",
            "X-LiTT-Tts-Provider": "elevenlabs",
            "X-LiTT-Tts-Voice": voice.id,
          },
        });
      } catch (err) {
        // Fall through to Gemini on ElevenLabs error
        console.warn("[tts] ElevenLabs failed, falling back to Gemini:", err);
      }
    }
  }

  // Provider 2: Gemini TTS
  const geminiKey =
    process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || "";
  if (geminiKey) {
    try {
      const audio = await geminiTtsSynthesize(text, voice.engineId, geminiKey);
      return new NextResponse(new Uint8Array(audio), {
        status: 200,
        headers: {
          "Content-Type": "audio/wav",
          "Cache-Control": "public, max-age=86400, immutable",
          "X-LiTT-Tts-Provider": "gemini",
          "X-LiTT-Tts-Voice": voice.id,
        },
      });
    } catch (err) {
      console.error("[api/tts] Gemini TTS error:", err);
      const { status, error: message, retryAfter } = sanitizeProviderError(err);
      return NextResponse.json(
        { error: message, retryAfter },
        { status },
      );
    }
  }

  return NextResponse.json(
    { error: "Service unavailable" },
    { status: 503 },
  );
}

export const POST = withRateLimit(handler, 60, 60);

/* ------------------------------------------------------------------ */
/*  ElevenLabs                                                         */
/* ------------------------------------------------------------------ */

async function elevenLabsSynthesize(
  text: string,
  voiceId: string,
  apiKey: string,
): Promise<Buffer> {
  const res = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
    {
      method: "POST",
      headers: {
        "xi-api-key": apiKey,
        "Content-Type": "application/json",
        Accept: "audio/mpeg",
      },
      body: JSON.stringify({
        text,
        model_id: "eleven_turbo_v2_5",
        voice_settings: {
          stability: 0.5,
          similarity_boost: 0.75,
          style: 0.0,
          use_speaker_boost: true,
        },
      }),
    },
  );
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`ElevenLabs ${res.status}: ${txt.slice(0, 200)}`);
  }
  const arr = await res.arrayBuffer();
  return Buffer.from(arr);
}

/* ------------------------------------------------------------------ */
/*  Gemini TTS                                                         */
/* ------------------------------------------------------------------ */

async function geminiTtsSynthesize(
  text: string,
  voiceName: string,
  apiKey: string,
): Promise<Buffer> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-tts:generateContent?key=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [
        {
          parts: [
            {
              text,
            },
          ],
        },
      ],
      generationConfig: {
        responseModalities: ["AUDIO"],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: {
              voiceName,
            },
          },
        },
      },
    }),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`Gemini TTS ${res.status}: ${txt.slice(0, 300)}`);
  }
  const data = (await res.json()) as {
    candidates?: Array<{
      content?: {
        parts?: Array<{
          inlineData?: { data?: string; mimeType?: string };
        }>;
      };
    }>;
  };
  const inline = data?.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
  if (!inline) {
    throw new Error("Gemini TTS returned no audio data");
  }
  // Gemini returns base64 PCM; wrap in a minimal WAV header so the client
  // can play it as a normal audio/wav response.
  return wrapPcmInWav(Buffer.from(inline, "base64"), 24000, 1, 16);
}

/* ------------------------------------------------------------------ */
/*  Minimal WAV header for raw PCM                                    */
/* ------------------------------------------------------------------ */
function wrapPcmInWav(
  pcm: Buffer,
  sampleRate: number,
  channels: number,
  bitsPerSample: number,
): Buffer {
  const byteRate = (sampleRate * channels * bitsPerSample) / 8;
  const blockAlign = (channels * bitsPerSample) / 8;
  const dataSize = pcm.length;
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + dataSize, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16); // PCM chunk size
  header.writeUInt16LE(1, 20); // format = PCM
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write("data", 36);
  header.writeUInt32LE(dataSize, 40);
  return Buffer.concat([header, pcm]);
}

/* ------------------------------------------------------------------ */
/*  GET — list available voices (for the picker)                      */
/* ------------------------------------------------------------------ */
export async function GET() {
  return NextResponse.json({
    voices: PREMIUM_VOICES.map((v) => ({
      id: v.id,
      label: v.label,
      desc: v.desc,
      provider: v.provider,
      gender: v.gender,
      accent: v.accent,
      style: v.style,
      premium: v.premium,
      persona: v.persona,
    })),
    providers: {
      gemini: Boolean(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY),
      elevenlabs: Boolean(process.env.ELEVENLABS_API_KEY),
    },
  });
}
