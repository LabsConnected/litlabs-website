import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { withRateLimit } from "@/lib/rate-limiter";
import { GoogleGenAI } from "@google/genai";

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

async function handler(req: NextRequest) {
  const { userId } = await auth();
  if (!userId)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!GEMINI_API_KEY)
    return NextResponse.json(
      { error: "Gemini API key not configured" },
      { status: 500 },
    );

  try {
    const { videoBytes, mimeType = "video/mp4", prompt } = await req.json();
    if (!videoBytes)
      return NextResponse.json(
        { error: "Missing videoBytes" },
        { status: 400 },
      );

    const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

    const response = await ai.models.generateContent({
      model: "gemini-3.1-pro-preview",
      contents: [
        { inlineData: { data: videoBytes, mimeType } },
        {
          text:
            prompt ||
            "Analyze this video in detail and provide a clean structured summary of the core visible events, actions, dynamic timings, and background audio contexts.",
        },
      ],
    });

    return NextResponse.json({
      text: response.text || "No analysis detected.",
    });
  } catch (err: unknown) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Video analysis failed" },
      { status: 500 },
    );
  }
}

export const POST = withRateLimit(handler, 60, 60);
