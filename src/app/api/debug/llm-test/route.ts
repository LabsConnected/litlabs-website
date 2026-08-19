import { NextRequest, NextResponse } from "next/server";
import { streamText, generateText, llmHealth } from "@/lib/llm";
import { auth } from "@/lib/auth";
import { isOwnerClerkId } from "@/lib/mission-control";
import { getRole } from "@/lib/roles";

export const runtime = "nodejs";

/**
 * GET /api/debug/llm-test
 *
 * Owner-only diagnostic endpoint that tests LLM connectivity and reports
 * the status of each provider in the failover chain. Shows:
 *   - Which provider keys are set (without revealing the keys)
 *   - Which provider actually responded
 *   - The specific error if a provider failed
 *   - The failover chain that was attempted
 */
export async function GET(req: NextRequest) {
  const { userId } = await auth(req);
  if (!userId) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  // Owner-only — this exposes provider status and error details
  let isOwner = isOwnerClerkId(userId);
  if (!isOwner) {
    try {
      const role = await getRole();
      isOwner = role === "owner";
    } catch {
      // getRole may not work in API context
    }
  }
  if (!isOwner) {
    return NextResponse.json({ error: "Owner access required" }, { status: 403 });
  }

  const health = llmHealth();

  // Provider key status (boolean only — never expose the actual key)
  const providerKeys = {
    gemini: {
      keySet: !!process.env.GEMINI_API_KEY || !!process.env.GOOGLE_API_KEY,
      model: health.gemini.model,
    },
    groq: {
      keySet: !!process.env.GROQ_API_KEY,
      model: health.groq.model,
    },
    openrouter: {
      keySet: !!process.env.OPENROUTER_API_KEY,
      model: health.openrouter.model,
    },
  };

  const results: {
    provider: string;
    ok: boolean;
    error?: string;
    errorCategory?: string;
    text?: string;
    latencyMs?: number;
    failover?: string[];
  }[] = [];

  // Test 1: Non-streaming generateText
  try {
    const r = await generateText("Say hello in 3 words", { task: "chat", category: "auto" });
    results.push({
      provider: `${r.provider} (generate)`,
      ok: true,
      text: r.text.substring(0, 100),
      latencyMs: r.latencyMs,
      failover: r.failover,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const category = msg.includes("auth") || msg.includes("403") || msg.includes("leaked")
      ? "auth_failure"
      : msg.includes("not set")
        ? "key_missing"
        : "unknown";
    results.push({ provider: "generate", ok: false, error: msg, errorCategory: category });
  }

  // Test 2: Streaming streamText
  try {
    let streamed = "";
    const r = await streamText(
      "Say hello in 3 words",
      (chunk) => { streamed += chunk; },
      { task: "chat", category: "auto" },
      undefined,
    );
    results.push({
      provider: `${r.provider} (stream)`,
      ok: true,
      text: streamed.substring(0, 100),
      latencyMs: r.latencyMs,
      failover: r.failover,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const category = msg.includes("auth") || msg.includes("403") || msg.includes("leaked")
      ? "auth_failure"
      : msg.includes("not set")
        ? "key_missing"
        : "unknown";
    results.push({ provider: "stream", ok: false, error: msg, errorCategory: category });
  }

  return NextResponse.json({
    timestamp: new Date().toISOString(),
    providerKeys,
    failoverChain: ["gemini", "groq", "openrouter-free"],
    results,
  });
}
