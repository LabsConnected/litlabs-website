import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { withRateLimit } from "@/lib/rate-limiter";
import { emitLlmMetering } from "@/lib/metering";
import {
  buildSpokenSummarySystemPrompt,
  buildSpokenSummaryUserContent,
  SPOKEN_SUMMARY_MAX_WORDS,
  truncateToSpokenFallback,
  type SpokenAgentId,
} from "@/features/voice/lib/spokenSummary";

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

/**
 * Spoken-summary endpoint for agent voice.
 *
 * Turns a full chat reply into 1–2 conversational sentences for TTS, so LiTT
 * speaks like a person instead of reading the on-screen transcript aloud.
 * Uses gpt-4o-mini — a typical reply costs a fraction of a cent.
 * No wallet charge (voice is a core feature, not a premium asset).
 *
 * On any OpenAI failure the endpoint still returns 200 with a deterministic
 * client-side-style truncation ({ fallback: true }) so voice never breaks.
 *
 * POST /api/voice/speak-summary
 * Body: { text: string, agentId?: "litt" | "spark" }
 * Returns: { spoken: string, fallback?: boolean }
 */
async function handler(req: NextRequest) {
  try {
    const { userId, clerkId } = await auth(req);
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!OPENAI_API_KEY) {
      return NextResponse.json(
        { error: "OpenAI API key not configured" },
        { status: 500 },
      );
    }

    const { text, agentId } = await req.json();
    if (!text?.trim()) {
      return NextResponse.json({ error: "Text required" }, { status: 400 });
    }
    const agent: SpokenAgentId = agentId === "spark" ? "spark" : "litt";

    // Canonical metering: one usage_event per summary attempt. Spoken
    // summaries are an uncharged voice feature (no wallet debit).
    const requestId = crypto.randomUUID();
    const startedAt = new Date();
    const meteringBase = {
      clerkId: clerkId ?? undefined,
      feature: "tts" as const,
      provider: "openai",
      model: "gpt-4o-mini",
      // P0 invariant: this single attempt is THE billable usage_event for
      // the action (emitter defaults billable=true on success). Spoken
      // summaries are currently uncharged, so chargedBits stays 0.
      chargedBits: 0,
    };

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        max_tokens: 120,
        temperature: 0.4,
        messages: [
          { role: "system", content: buildSpokenSummarySystemPrompt(agent) },
          { role: "user", content: buildSpokenSummaryUserContent(text) },
        ],
      }),
    }).catch((fetchErr: unknown) => {
      void emitLlmMetering({
        ...meteringBase,
        status: "failed",
        billable: false,
        error: String(fetchErr instanceof Error ? fetchErr.message : fetchErr).slice(0, 500),
        idempotencyKey: `metering:llm:${requestId}:0`,
        startedAt,
        finishedAt: new Date(),
      });
      throw fetchErr;
    });

    if (!response.ok) {
      // Provider attempt failed — the endpoint still returns 200 with a
      // deterministic fallback so voice never breaks, but the attempt
      // is metered as failed (provider bills $0 for failed calls).
      void emitLlmMetering({
        ...meteringBase,
        status: "failed",
        billable: false,
        error: `openai-chat-completions:${response.status}`,
        idempotencyKey: `metering:llm:${requestId}:0`,
        startedAt,
        finishedAt: new Date(),
      });
      return NextResponse.json({
        spoken: truncateToSpokenFallback(text),
        fallback: true,
      });
    }

    const data = await response.json();
    const spoken = (data?.choices?.[0]?.message?.content ?? "").trim();
    const usage = data?.usage as
      | { prompt_tokens?: number; completion_tokens?: number }
      | undefined;
    if (!spoken) {
      void emitLlmMetering({
        ...meteringBase,
        inputTokens: usage?.prompt_tokens ?? 0,
        outputTokens: usage?.completion_tokens ?? 0,
        status: "failed",
        billable: false,
        error: "empty-summary-content",
        idempotencyKey: `metering:llm:${requestId}:0`,
        startedAt,
        finishedAt: new Date(),
      });
      return NextResponse.json({
        spoken: truncateToSpokenFallback(text),
        fallback: true,
      });
    }

    void emitLlmMetering({
      ...meteringBase,
      inputTokens: usage?.prompt_tokens ?? 0,
      outputTokens: usage?.completion_tokens ?? 0,
      status: "success",
      idempotencyKey: `metering:llm:${requestId}:0`,
      startedAt,
      finishedAt: new Date(),
    });

    // Hard cap: never speak more than ~40 words even if the model rambles.
    const words = spoken.split(/\s+/);
    const capped =
      words.length > SPOKEN_SUMMARY_MAX_WORDS
        ? words.slice(0, SPOKEN_SUMMARY_MAX_WORDS).join(" ")
        : spoken;
    return NextResponse.json({ spoken: capped });
  } catch (err: unknown) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Summary failed" },
      { status: 500 },
    );
  }
}

export const POST = withRateLimit(handler, 10, 60);
