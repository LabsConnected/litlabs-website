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
      model: "gemini-2.5-flash",
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
    const raw = err instanceof Error ? err.message : String(err);
    const clean = formatProviderError(raw);
    return NextResponse.json(
      { error: clean.message, retryAfter: clean.retryAfter },
      { status: clean.status },
    );
  }
}

function formatProviderError(raw: string): {
  message: string;
  retryAfter?: number;
  status: number;
} {
  const lower = raw.toLowerCase();
  if (lower.includes("429") || lower.includes("quota") || lower.includes("resource_exhausted")) {
    const seconds = extractRetrySeconds(raw);
    return {
      message: seconds
        ? `Voice service rate limit reached. Retry in ${seconds}s.`
        : "Voice service rate limit reached. Please try again shortly.",
      retryAfter: seconds,
      status: 429,
    };
  }
  if (lower.includes("api key not valid") || lower.includes("unauthorized")) {
    return {
      message: "Voice service API key is invalid or missing.",
      status: 500,
    };
  }
  return { message: "Transcription failed. Please try again.", status: 500 };
}

function extractRetrySeconds(raw: string): number | undefined {
  const match = raw.match(/(?:retry\s*in|retry\s*delay|retryafter)[\s:]*([\d.]+)\s*s/i);
  if (match) return Math.round(parseFloat(match[1]));
  const seconds = raw.match(/(\d+(?:\.\d+)?)\s*seconds/i);
  if (seconds) return Math.round(parseFloat(seconds[1]));
  return undefined;
}

export const POST = withRateLimit(handler, 60, 60);
