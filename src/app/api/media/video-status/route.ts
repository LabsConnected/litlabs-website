import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { GoogleGenAI, GenerateVideosOperation } from "@google/genai";

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!GEMINI_API_KEY)
    return NextResponse.json(
      { error: "Gemini API key not configured" },
      { status: 500 },
    );

  try {
    const { operationName } = await req.json();
    if (!operationName)
      return NextResponse.json(
        { error: "Missing operationName" },
        { status: 400 },
      );

    const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
    const op = new GenerateVideosOperation();
    op.name = operationName;

    const updated = await ai.operations.getVideosOperation({ operation: op });

    // If done, get the video URI
    let videoUri: string | null = null;
    if (updated.done && updated.response?.generatedVideos?.[0]?.video?.uri) {
      videoUri = updated.response.generatedVideos[0].video.uri;
    }

    return NextResponse.json({ done: updated.done, videoUri });
  } catch (err: unknown) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Polling failed" },
      { status: 500 },
    );
  }
}
