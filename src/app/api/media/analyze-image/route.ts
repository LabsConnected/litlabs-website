import { NextRequest, NextResponse } from "next/server";
import { GoogleGenAI } from "@google/genai";
import { withRateLimit } from "@/lib/rate-limiter";
import { sanitizeProviderError } from "@/lib/provider-error";
import { auth } from "@/lib/auth";

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

async function handler(request: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!GEMINI_API_KEY) return NextResponse.json({ error: "Service unavailable" }, { status: 503 });

  try {
    const { imageBytes, mimeType = "image/jpeg", prompt } = await request.json();
    if (!imageBytes || typeof imageBytes !== "string") {
      return NextResponse.json({ error: "Missing imageBytes" }, { status: 400 });
    }
    const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
    const response = await ai.models.generateContent({
      model: "gemini-3.5-flash",
      contents: [
        { inlineData: { data: imageBytes, mimeType } },
        {
          text:
            prompt ||
            "You are LiTT-Code looking at an explicitly shared workspace frame. Briefly describe the visible UI or problem, identify one useful detail, and suggest one next action. Never infer sensitive traits about a person. Use at most three short sentences.",
        },
      ],
    });
    return NextResponse.json({ text: response.text || "I can see the frame, but there is not enough detail to act on yet." });
  } catch (error) {
    console.error("[api/media/analyze-image] error:", error);
    const { status, error: message, retryAfter } = sanitizeProviderError(error);
    return NextResponse.json({ error: message, retryAfter }, { status });
  }
}

export const POST = withRateLimit(handler, 20, 60);
