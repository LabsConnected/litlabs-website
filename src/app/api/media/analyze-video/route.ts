import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { withRateLimit } from "@/lib/rate-limiter";
import { GoogleGenAI } from "@google/genai";
import { emitLlmMetering } from "@/lib/metering";

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const VIDEO_MODEL = "gemini-3.1-pro-preview";

async function handler(req: NextRequest) {
  const { userId, clerkId } = await auth(req);
  if (!userId)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!GEMINI_API_KEY)
    return NextResponse.json(
      { error: "Gemini API key not configured" },
      { status: 500 },
    );

  // Canonical metering: one usage_event per analyze attempt.
  const requestId = crypto.randomUUID();
  const startedAt = new Date();
  const meteringBase = {
    clerkId: clerkId ?? undefined,
    feature: "media-analyze" as const,
    provider: "gemini",
    model: VIDEO_MODEL,
    // P0 invariant: this single attempt is THE billable usage_event for
    // the action (emitter defaults billable=true on success).
    // Currently uncharged: chargedBits stays 0.
    chargedBits: 0,
  };

  try {
    const { videoBytes, mimeType = "video/mp4", prompt } = await req.json();
    if (!videoBytes)
      return NextResponse.json(
        { error: "Missing videoBytes" },
        { status: 400 },
      );

    const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

    const response = await ai.models.generateContent({
      model: VIDEO_MODEL,
      contents: [
        { inlineData: { data: videoBytes, mimeType } },
        {
          text:
            prompt ||
            "Analyze this video in detail and provide a clean structured summary of the core visible events, actions, dynamic timings, and background audio contexts.",
        },
      ],
    });

    const usage = response.usageMetadata;
    void emitLlmMetering({
      ...meteringBase,
      inputTokens: usage?.promptTokenCount ?? 0,
      outputTokens: usage?.candidatesTokenCount ?? 0,
      status: "success",
      idempotencyKey: `metering:llm:${requestId}:0`,
      startedAt,
      finishedAt: new Date(),
    });

    return NextResponse.json({
      text: response.text || "No analysis detected.",
    });
  } catch (err: unknown) {
    void emitLlmMetering({
      ...meteringBase,
      status: "failed",
      billable: false,
      error: err instanceof Error ? err.message.slice(0, 500) : "Video analysis failed",
      idempotencyKey: `metering:llm:${requestId}:0`,
      startedAt,
      finishedAt: new Date(),
    });
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Video analysis failed" },
      { status: 500 },
    );
  }
}

export const POST = withRateLimit(handler, 60, 60);
