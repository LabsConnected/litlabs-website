import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";

const MINIMAX_API_KEY = process.env.MINIMAX_API_KEY;
const MINIMAX_API_URL = "https://api.minimax.io/v1/music_generation";

export async function POST(req: NextRequest) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const {
      model = "music-2.6-free",
      prompt,
      lyrics,
      isInstrumental = false,
      lyricsOptimizer = false,
      outputFormat = "url",
      audioSetting,
    } = body;

    if (!MINIMAX_API_KEY) {
      return NextResponse.json(
        { error: "MINIMAX_API_KEY not configured" },
        { status: 500 }
      );
    }

    if (!prompt && !lyrics) {
      return NextResponse.json(
        { error: "Missing 'prompt' or 'lyrics'" },
        { status: 400 }
      );
    }

    const payload: Record<string, unknown> = {
      model,
      prompt,
      is_instrumental: isInstrumental,
      lyrics_optimizer: lyricsOptimizer,
      output_format: outputFormat,
      stream: false,
    };

    if (lyrics) payload.lyrics = lyrics;
    if (audioSetting) payload.audio_setting = audioSetting;

    const res = await fetch(MINIMAX_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${MINIMAX_API_KEY}`,
      },
      body: JSON.stringify(payload),
    });

    const data = await res.json();

    if (!res.ok || data.base_resp?.status_code !== 0) {
      return NextResponse.json(
        {
          error: data.base_resp?.status_msg || "MiniMax API error",
          code: data.base_resp?.status_code || res.status,
        },
        { status: 502 }
      );
    }

    // Poll for completion if status is in progress
    const status = data.data?.status;
    const audio = data.data?.audio;
    const extraInfo = data.extra_info;

    return NextResponse.json({
      success: true,
      status,
      audio,
      extraInfo,
      traceId: data.trace_id,
      model,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal error" },
      { status: 500 }
    );
  }
}
