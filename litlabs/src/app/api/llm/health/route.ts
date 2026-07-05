// API Route: LLM provider health + chain config — useful for the admin UI
// and for agents that want to know which provider to prefer.
import { NextResponse } from "next/server";
import { llmHealth, DEFAULT_MODELS } from "@/lib/llm";

export const runtime = "nodejs";

export async function GET() {
  const health = llmHealth();
  // Build list of free models available (no key required = truly free)
  const freeModels = [
    { id: "openrouter-qwen", name: "Qwen 2.5 Coder", provider: "OpenRouter", task: "code" },
    { id: "openrouter-deepseek", name: "DeepSeek Chat", provider: "OpenRouter", task: "chat" },
    { id: "openrouter-mistral", name: "Mistral Small 3.2", provider: "OpenRouter", task: "general" },
    { id: "openrouter-llama", name: "Llama 3.3 70B", provider: "OpenRouter", task: "general" },
    { id: "openrouter-trinity", name: "Trinity Large", provider: "OpenRouter", task: "general" },
  ];
  return NextResponse.json({
    ...health,
    models: DEFAULT_MODELS,
    freeModels,
    hasGemini: health.gemini.available,
    hasOpenRouter: health.openrouter.available,
  });
}
