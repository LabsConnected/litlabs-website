import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { withRateLimit } from "@/lib/rate-limiter";
import { GoogleGenAI } from "@google/genai";
import { emitUsageEvent } from "@/lib/metering";
import { calculateLlmCost } from "@/lib/llm-cost-engine";

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const TRANSCRIBE_MODEL = "gemini-3.5-flash";

async function handler(req: NextRequest) {
  const { userId, clerkId } = await auth(req);
  if (!userId)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!GEMINI_API_KEY)
    return NextResponse.json(
      { error: "Gemini API key not configured" },
      { status: 500 },
    );

  // Canonical metering: one usage_event per transcription attempt with
  // capability "transcription". Provider cost comes from the canonical
  // cost engine (the $1/1K-bit conversion behind retail bits is a
  // PRICING MODEL, not validated fact). P0 invariant: this single
  // attempt is THE billable usage_event (emitter defaults billable=true
  // on success); failures are billable=false with cost still recorded.
  const requestId = crypto.randomUUID();
  const startedAt = new Date();
  const meteringBase = {
    clerkId: clerkId ?? undefined,
    feature: "transcription" as const,
    capability: "transcription" as const,
    provider: "gemini",
    model: TRANSCRIBE_MODEL,
    chargedBits: 0,
  };
  const costFor = (promptTokens: number, completionTokens: number) =>
    calculateLlmCost({
      provider: "gemini",
      model: TRANSCRIBE_MODEL,
      promptTokens,
      completionTokens,
      isByok: false,
    }).providerCostMicros;

  try {
    const { audioBytes, mimeType = "audio/webm" } = await req.json();
    if (!audioBytes)
      return NextResponse.json(
        { error: "Missing audioBytes" },
        { status: 400 },
      );

    const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

    const response = await ai.models.generateContent({
      model: TRANSCRIBE_MODEL,
      contents: [
        { inlineData: { data: audioBytes, mimeType } },
        {
          text: "Provide a complete, highly accurate, and clean transcription of the spoken words in this audio. Do not include introductory notes, timestamps, speaker tags, or external commentary. Output only the transcript text.",
        },
      ],
    });

    const usage = response.usageMetadata;
    const promptTokens = usage?.promptTokenCount ?? 0;
    const completionTokens = usage?.candidatesTokenCount ?? 0;
    void emitUsageEvent({
      ...meteringBase,
      inputTokens: promptTokens,
      outputTokens: completionTokens,
      providerCostMicros: costFor(promptTokens, completionTokens),
      status: "success",
      idempotencyKey: `metering:transcription:${requestId}:0`,
      startedAt,
      finishedAt: new Date(),
    });

    return NextResponse.json({
      text: response.text || "No transcription detected.",
    });
  } catch (err: unknown) {
    void emitUsageEvent({
      ...meteringBase,
      providerCostMicros: 0,
      status: "failed",
      billable: false,
      error: err instanceof Error ? err.message.slice(0, 500) : "Transcription failed",
      idempotencyKey: `metering:transcription:${requestId}:0`,
      startedAt,
      finishedAt: new Date(),
    });
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Transcription failed" },
      { status: 500 },
    );
  }
}

export const POST = withRateLimit(handler, 60, 60);
