import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { withRateLimit } from "@/lib/rate-limiter";
import { GoogleGenAI } from "@google/genai";
import { meteredProviderCall } from "@/lib/metered-provider-call";

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

  const requestId = crypto.randomUUID();

  try {
    const { videoBytes, mimeType = "video/mp4", prompt } = await req.json();
    if (!videoBytes)
      return NextResponse.json(
        { error: "Missing videoBytes" },
        { status: 400 },
      );

    const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

    const call = await meteredProviderCall({
      clerkId: clerkId ?? userId,
      feature: "media-analyze",
      provider: "gemini",
      model: VIDEO_MODEL,
      callId: requestId,
      execute: () => ai.models.generateContent({
        model: VIDEO_MODEL,
        contents: [
          { inlineData: { data: videoBytes, mimeType } },
          {
            text:
              prompt ||
              "Analyze this video in detail and provide a clean structured summary of the core visible events, actions, dynamic timings, and background audio contexts.",
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
