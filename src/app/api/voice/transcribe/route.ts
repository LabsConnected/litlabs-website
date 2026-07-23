import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { isDeepgramConfigured } from "@/server/voice/deepgram";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!isDeepgramConfigured()) {
    return NextResponse.json(
      { error: "Deepgram is not configured. Set DEEPGRAM_API_KEY." },
      { status: 503 },
    );
  }

  try {
    const formData = await request.formData();
    const audioFile = formData.get("audio") as File | null;

    if (!audioFile) {
      return NextResponse.json({ error: "No audio file provided" }, { status: 400 });
    }

    const arrayBuffer = await audioFile.arrayBuffer();
    const audioBuffer = Buffer.from(arrayBuffer);

    // Use Deepgram's REST API for pre-recorded audio
    const apiKey = process.env.DEEPGRAM_API_KEY!;
    const response = await fetch("https://api.deepgram.com/v1/listen", {
      method: "POST",
      headers: {
        Authorization: `Token ${apiKey}`,
        "Content-Type": audioFile.type || "audio/webm",
      },
      body: audioBuffer,
    });

    if (!response.ok) {
      const errorText = await response.text();
      return NextResponse.json(
        { error: `Deepgram error: ${errorText}` },
        { status: response.status },
      );
    }

    const data = await response.json();
    const transcript = data.results?.channels?.[0]?.alternatives?.[0]?.transcript || "";
    const confidence = data.results?.channels?.[0]?.alternatives?.[0]?.confidence || 0;

    return NextResponse.json({ transcript, confidence });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Transcription failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
