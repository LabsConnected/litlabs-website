// API Route: LLM provider health + chain config — useful for the admin UI
// and for agents that want to know which provider to prefer.
import { NextResponse } from "next/server";
import { llmHealth, DEFAULT_MODELS } from "@/lib/llm";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({
    ...llmHealth(),
    models: DEFAULT_MODELS,
  });
}
