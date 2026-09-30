import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { withRateLimit } from "@/lib/rate-limiter";
import { emitUsageEvent } from "@/lib/metering";

const MINIMAX_API_KEY = process.env.MINIMAX_API_KEY;
const MINIMAX_API_URL = "https://api.minimax.io/v1/music_generation";

async function handler(req: NextRequest) {
  try {
    const { userId, clerkId } = await auth(req);
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

    // Canonical metering: one usage_event per MiniMax generation attempt.
    // P0 invariant: this single attempt is THE billable usage_event
    // (emitter defaults billable=true on success); failures are
    // billable=false with the error recorded.
    //
    // Provider cost: the MiniMax music_generation response does not
    // expose a per-call cost and the code carries no price mapping, so
    // providerCostMicros is recorded as 0 — NOT a claim that MiniMax is
    // free. Music generation is currently uncharged (chargedBits: 0).
    const requestId = crypto.randomUUID();
    const startedAt = new Date();
    const meteringBase = {
      clerkId: clerkId ?? undefined,
      feature: "music-gen" as const,
      capability: "music" as const,
      provider: "minimax",
      model: String(model),
      providerCostMicros: 0,
      chargedBits: 0,
    };
    const emitFailure = (error: string) =>
      void emitUsageEvent({
        ...meteringBase,
        status: "failed",
        billable: false,
        error,
        idempotencyKey: `metering:music:${requestId}:0`,
        startedAt,
        finishedAt: new Date(),
      });

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
    }).catch((fetchErr: unknown) => {
      emitFailure(String(fetchErr instanceof Error ? fetchErr.message : fetchErr).slice(0, 500));
      throw fetchErr;
    });

    const data = await res.json();

    if (!res.ok || data.base_resp?.status_code !== 0) {
      emitFailure(
        `minimax:${data.base_resp?.status_code ?? res.status} ${String(data.base_resp?.status_msg ?? "").slice(0, 200)}`,
      );
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

    void emitUsageEvent({
      ...meteringBase,
      status: "success",
      idempotencyKey: `metering:music:${requestId}:0`,
      startedAt,
      finishedAt: new Date(),
    });

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

export const POST = withRateLimit(handler, 10, 60);
