import { NextRequest, NextResponse } from "next/server";
import { GoogleGenAI } from "@google/genai";
import { withRateLimit } from "@/lib/rate-limiter";
import { auth } from "@/lib/auth";
import { emitLlmMetering } from "@/lib/metering";
import { assertSpendAuthorized } from "@/lib/metered-llm-call";

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const VISION_MODEL = "gemini-3.5-flash";

async function handler(request: NextRequest) {
  const { userId, clerkId } = await auth(request);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!GEMINI_API_KEY) return NextResponse.json({ error: "Gemini API key not configured" }, { status: 500 });
  const spendId = clerkId ?? userId;
  const authz = await assertSpendAuthorized(spendId);
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error, code: authz.code }, { status: authz.status });
  }

  // Canonical metering: one usage_event per analyze attempt. Provider cost
  // comes from the canonical cost engine (the $1/1K-bit conversion behind
  // retailBits is a PRICING MODEL, not validated fact).
  const requestId = crypto.randomUUID();
  const startedAt = new Date();
  const meteringBase = {
    clerkId: clerkId ?? undefined,
    feature: "media-analyze" as const,
    provider: "gemini",
    model: VISION_MODEL,
    // P0 invariant: this single attempt is THE billable usage_event for
    // the action (emitter defaults billable=true on success).
    // Currently uncharged: chargedBits stays 0.
    chargedBits: 0,
  };

  try {
    const { imageBytes, mimeType = "image/jpeg", prompt } = await request.json();
    if (!imageBytes || typeof imageBytes !== "string") {
      return NextResponse.json({ error: "Missing imageBytes" }, { status: 400 });
    }
    const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
    const response = await ai.models.generateContent({
      model: VISION_MODEL,
      contents: [
        { inlineData: { data: imageBytes, mimeType } },
        {
          text:
            prompt ||
            "You are LiTT looking at an explicitly shared workspace frame. Briefly describe the visible UI or problem, identify one useful detail, and suggest one next action. Never infer sensitive traits about a person. Use at most three short sentences.",
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
    return NextResponse.json({ text: response.text || "I can see the frame, but there is not enough detail to act on yet." });
  } catch (error) {
    void emitLlmMetering({
      ...meteringBase,
      status: "failed",
      billable: false,
      error: error instanceof Error ? error.message.slice(0, 500) : "Vision analysis failed",
      idempotencyKey: `metering:llm:${requestId}:0`,
      startedAt,
      finishedAt: new Date(),
    });
    return NextResponse.json({ error: error instanceof Error ? error.message : "Vision analysis failed" }, { status: 500 });
  }
}

export const POST = withRateLimit(handler, 20, 60);
