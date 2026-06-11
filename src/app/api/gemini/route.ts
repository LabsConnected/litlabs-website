import { NextRequest, NextResponse } from "next/server";
import { withRateLimit } from "@/lib/rate-limiter";
import { generateText } from "@/lib/llm";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * POST /api/gemini
 * Body: { message: string, systemPrompt?: string, task?: "creative"|"precise"|"code"|"chat" }
 *
 * Returns: { response: string, provider, model, latencyMs, failover }
 *
 * Now backed by the unified LLM client (Gemini → OpenRouter free → specific models).
 */
async function handler(req: NextRequest) {
  try {
    const { message, systemPrompt, task, preferFree } = await req.json();
    if (!message) {
      return NextResponse.json({ error: "Missing message" }, { status: 400 });
    }
    const r = await generateText(
      message,
      {
        task: task || "creative",
        preferFree: !!preferFree,
        maxTokens: 1024,
      },
      systemPrompt,
    );
    return NextResponse.json({
      response: r.text,
      provider: r.provider,
      model: r.model,
      latencyMs: r.latencyMs,
      failover: r.failover,
    });
  } catch (err) {
    // LLM route error:
    const msg = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export const POST = withRateLimit(handler, 60, 60);
