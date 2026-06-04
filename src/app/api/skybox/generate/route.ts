import { NextRequest, NextResponse } from "next/server";

const SKYBOX_API_KEY = process.env.SKYBOX_API_KEY;
const SKYBOX_API_URL = "https://backend.blockadelabs.com/api/v1/skybox";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { prompt, negativePrompt = "", seed = 0 } = body;

    if (!SKYBOX_API_KEY) {
      return NextResponse.json(
        { error: "SKYBOX_API_KEY not configured" },
        { status: 500 }
      );
    }

    if (!prompt || prompt.trim().length < 3) {
      return NextResponse.json(
        { error: "Prompt too short" },
        { status: 400 }
      );
    }

    const payload: Record<string, unknown> = {
      prompt: prompt.trim(),
      negative_text: negativePrompt.trim(),
      seed,
      webhook_url: "",
    };

    const res = await fetch(SKYBOX_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": SKYBOX_API_KEY,
      },
      body: JSON.stringify(payload),
    });

    const data = await res.json();

    if (!res.ok || data.error) {
      return NextResponse.json(
        { error: data.message || data.error || "Skybox API error" },
        { status: 502 }
      );
    }

    return NextResponse.json({
      success: true,
      id: data.id,
      status: data.status,
      title: data.title,
      fileUrl: data.file_url,
      thumbUrl: data.thumb_url,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal error" },
      { status: 500 }
    );
  }
}
