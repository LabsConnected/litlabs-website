import { NextRequest, NextResponse } from "next/server";
import { GoogleGenAI } from "@google/genai";
import { withRateLimit } from "@/lib/rate-limiter";
import { auth } from "@/lib/auth";

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

async function handler(request: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!GEMINI_API_KEY) return NextResponse.json({ error: "Gemini API key not configured" }, { status: 500 });

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
    return NextResponse.json({ error: error instanceof Error ? error.message : "Vision analysis failed" }, { status: 500 });
  }
}

export const POST = withRateLimit(handler, 20, 60);
