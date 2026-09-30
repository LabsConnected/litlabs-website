import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { auth } from "@/lib/auth";
import { withRateLimit } from "@/lib/rate-limiter";
import { meteredLlmCall } from "@/lib/metered-llm-call";

export const runtime = "nodejs";

/**
 * POST /api/gemini
 * Body: { message: string, systemPrompt?: string, task?: "creative"|"precise"|"code"|"chat" }
 *
 * Returns: { response: string, provider, model, latencyMs, failover }
 *
 * Backed by the unified LLM client (Gemini → OpenRouter free → specific models).
 *
 * Billing (P0): every call runs through the canonical metered-LLM gateway —
 * pre-flight balance/entitlement gate BEFORE provider execution, per-attempt
 * metering (usage_events + cost_events), and exactly one wallet debit per
 * logical action (retries reuse the billable usage_event).
 */
async function handler(req: NextRequest) {
  const { userId } = await auth(req);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const { message, systemPrompt, task, preferFree } = await req.json();
    if (!message) {
      return NextResponse.json({ error: "Missing message" }, { status: 400 });
    }
    const call = await meteredLlmCall({
      clerkId: userId,
      prompt: message,
      systemPrompt,
      llmOptions: {
        task: task || "creative",
        preferFree: !!preferFree,
        maxTokens: 1024,
      },
      feature: "gemini-api",
      callId: randomUUID(),
    });
    if (!call.ok) {
      return NextResponse.json(
        { error: call.error, code: call.code },
        { status: call.status },
      );
    }
    const r = call.result;
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
