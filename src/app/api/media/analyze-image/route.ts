import { NextRequest, NextResponse } from "next/server";
import { GoogleGenAI } from "@google/genai";
import { withRateLimit } from "@/lib/rate-limiter";
import { auth } from "@/lib/auth";
import { meteredProviderCall } from "@/lib/metered-provider-call";

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const VISION_MODEL = "gemini-3.5-flash";

async function handler(request: NextRequest) {
  const { userId, clerkId } = await auth(request);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!GEMINI_API_KEY) return NextResponse.json({ error: "Gemini API key not configured" }, { status: 500 });

  const requestId = crypto.randomUUID();

  try {
    const { imageBytes, mimeType = "image/jpeg", prompt } = await request.json();
    if (!imageBytes || typeof imageBytes !== "string") {
      return NextResponse.json({ error: "Missing imageBytes" }, { status: 400 });
    }
    const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
    const call = await meteredProviderCall({
      clerkId: clerkId ?? userId,
      feature: "media-analyze",
      provider: "gemini",
      model: VISION_MODEL,
      callId: requestId,
      execute: () => ai.models.generateContent({
        model: VISION_MODEL,
        contents: [
          { inlineData: { data: imageBytes, mimeType } },
          {
            text:
              prompt ||
              "You are LiTT looking at an explicitly shared workspace frame. Briefly describe the visible UI or problem, identify one useful detail, and suggest one next action. Never infer sensitive traits about a person. Use at most three short sentences.",
          },
        ],
      }),
      usage: (result) => ({
        promptTokens: result.usageMetadata?.promptTokenCount ?? 0,
        completionTokens: result.usageMetadata?.candidatesTokenCount ?? 0,
      }),
    });
    if (!call.ok) return NextResponse.json({ error: call.error }, { status: call.status });
    const response = call.result;
    return NextResponse.json({ text: response.text || "I can see the frame, but there is not enough detail to act on yet." });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Vision analysis failed" }, { status: 500 });
  }
}

export const POST = withRateLimit(handler, 20, 60);
