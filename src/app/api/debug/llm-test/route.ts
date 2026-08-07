import { NextResponse } from "next/server";
import { streamText, generateText } from "@/lib/llm";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * GET /api/debug/llm-test
 * Diagnostic endpoint to test LLM connectivity. No auth required.
 * Remove this route after debugging.
 */
export async function GET() {
  const results: { provider: string; ok: boolean; error?: string; text?: string }[] = [];

  // Test 1: Non-streaming generateText
  try {
    const r = await generateText("Say hello in 3 words", { task: "chat", category: "auto" });
    results.push({ provider: `${r.provider} (generate)`, ok: true, text: r.text.substring(0, 50) });
  } catch (err) {
    results.push({ provider: "generate", ok: false, error: err instanceof Error ? err.message : String(err) });
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
    results.push({ provider: `${r.provider} (stream)`, ok: true, text: streamed.substring(0, 50) });
  } catch (err) {
    results.push({ provider: "stream", ok: false, error: err instanceof Error ? err.message : String(err) });
  }

  // Test 3: Check env vars
  results.push({
    provider: "env",
    ok: !!process.env.GEMINI_API_KEY,
    text: `GEMINI=${!!process.env.GEMINI_API_KEY} OPENROUTER=${!!process.env.OPENROUTER_API_KEY} GROQ=${!!process.env.GROQ_API_KEY}`,
  });

  return NextResponse.json({ results });
}
