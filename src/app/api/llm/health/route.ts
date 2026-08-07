// API Route: LLM provider health + chain config — useful for the admin UI
// and for agents that want to know which provider to prefer.
//
// Security: Returns a minimal public payload ({ status: "ok" }) to
// unauthenticated callers. Full provider/model details are only exposed
// to authenticated users (via Clerk session or Bearer token).
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { llmHealth, DEFAULT_MODELS } from "@/lib/llm";
import { auth } from "@/lib/auth";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  try {
    // Check if caller is authenticated
    const { userId } = await auth(req);

    // Unauthenticated: return minimal public health payload only
    if (!userId) {
      const health = llmHealth();
      const anyAvailable =
        health.gemini?.available ||
        health.groq?.available ||
        health.openrouter?.available;
      return NextResponse.json({
        status: anyAvailable ? "ok" : "degraded",
      });
    }

    // Authenticated: return full details for admin UI and agents
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
  } catch (_error) {
    return NextResponse.json({ error: "Health check failed" }, { status: 500 });
  }
}
