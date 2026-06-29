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
    const { audioBytes, mimeType = "audio/webm" } = await req.json();
    if (!audioBytes)
      return NextResponse.json(
        { error: "Missing audioBytes" },
        { status: 400 },
      );

    const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

    const response = await ai.models.generateContent({
      model: "gemini-3.5-flash",
      contents: [
        { inlineData: { data: audioBytes, mimeType } },
        {
          text: "Provide a complete, highly accurate, and clean transcription of the spoken words in this audio. Do not include introductory notes, timestamps, speaker tags, or external commentary. Output only the transcript text.",
        },
      ],
    });

    return NextResponse.json({
      text: response.text || "No transcription detected.",
    });
  } catch (err: unknown) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Transcription failed" },
      { status: 500 },
    );
  }
}

export const POST = withRateLimit(handler, 60, 60);
