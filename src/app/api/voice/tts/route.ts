import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { withRateLimit } from "@/lib/rate-limiter";
import { emitUsageEvent } from "@/lib/metering";

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

/**
 * OpenAI TTS pricing (published): tts-1 = $15.00 per 1M characters.
 * $15 / 1M chars = $0.000015 / char = 15 micros / char.
 */
const TTS_USD_MICROS_PER_CHAR = 15;
/** Spoken-English density used only to record audioSeconds (~900 chars/min). */
const CHARS_PER_AUDIO_SECOND = 15;

/**
 * OpenAI TTS endpoint for agent voice.
 * Uses tts-1 model — high quality, low latency, ~$0.015/min.
 * No wallet charge (voice is a core feature, not a premium asset).
 *
 * POST /api/voice/tts
 * Body: { text: string, voice?: "alloy"|"echo"|"fable"|"onyx"|"nova"|"shimmer" }
 * Returns: { audioUrl: string } (data URL, base64 MP3)
 */
async function handler(req: NextRequest) {
  try {
    const { userId, clerkId } = await auth(req);
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

    // Canonical metering: one usage_event per TTS attempt (success AND
    // failure). Emission is best-effort — it must never break the TTS path.
    const requestId = crypto.randomUUID();
    const startedAt = new Date();
    // P0 invariant: per logical user action, exactly ONE billable
    // usage_event. This single attempt is it: on success the emitter
    // defaults billable=true; on failure we set billable=false explicitly.
    // TTS is currently uncharged (no wallet debit), so chargedBits stays 0
    // and LiTT absorbs the provider cost (liitt_absorbed=true).
    const meteringBase = {
      clerkId: clerkId ?? undefined,
      feature: "tts" as const,
      capability: "speech" as const,
      provider: "openai",
      model: "tts-1",
      chargedBits: 0,
    };

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
    }).catch((fetchErr: unknown) => {
      // The provider call itself threw — record the failed attempt before
      // surfacing the error.
      void emitUsageEvent({
        ...meteringBase,
        providerCostMicros: 0,
        status: "failed",
        billable: false,
        error: String(fetchErr instanceof Error ? fetchErr.message : fetchErr).slice(0, 500),
        idempotencyKey: `metering:tts:${requestId}:0`,
        startedAt,
        finishedAt: new Date(),
      });
      throw fetchErr;
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => "Unknown error");
      void emitUsageEvent({
        ...meteringBase,
        providerCostMicros: 0, // failed provider attempts are not billed
        status: "failed",
        billable: false,
        error: `openai-tts:${response.status} ${errText.slice(0, 200)}`,
        idempotencyKey: `metering:tts:${requestId}:0`,
        startedAt,
        finishedAt: new Date(),
      });
      return NextResponse.json(
        { error: `TTS failed: ${response.status}` },
        { status: response.status },
      );
    }

    const audioBuffer = await response.arrayBuffer();
    const base64 = Buffer.from(audioBuffer).toString("base64");
    const audioUrl = `data:audio/mp3;base64,${base64}`;

    // Provider cost from OpenAI's published tts-1 pricing ($15/1M chars);
    // audioSeconds is an estimate from character density.
    const charCount = truncated.length;
    void emitUsageEvent({
      ...meteringBase,
      audioSeconds: Math.max(1, Math.round(charCount / CHARS_PER_AUDIO_SECOND)),
      providerCostMicros: charCount * TTS_USD_MICROS_PER_CHAR,
      status: "success",
      idempotencyKey: `metering:tts:${requestId}:0`,
      startedAt,
      finishedAt: new Date(),
    });

    return NextResponse.json({ audioUrl });
  } catch (err: unknown) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "TTS failed" },
      { status: 500 },
    );
  }
}

export const POST = withRateLimit(handler, 10, 60);
