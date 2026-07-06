import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { chatWithLiTT, ChatMessage, LittProviderName } from "@/lib/ai/litt-router";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * POST /api/litt/chat
 *
 * Body:
 *   {
 *     message: string;
 *     history?: { role: "user" | "assistant"; content: string }[];
 *     provider?: "openrouter" | "groq" | "ollama";
 *     model?: string;
 *     context?: string;
 *   }
 *
 * Response:
 *   {
 *     reply: string;
 *     mood: string;
 *     action?: string;
 *     provider: string;
 *     model?: string;
 *     latencyMs: number;
 *     failover: string[];
 *   }
 */
export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const { message, history = [], provider, model, context } = body;

    if (!message || typeof message !== "string") {
      return NextResponse.json({ error: "Missing message" }, { status: 400 });
    }

    const normalizedHistory: ChatMessage[] = history.map((m: { role: string; content: string }) => ({
      role: m.role === "system" ? "system" : m.role === "assistant" ? "assistant" : "user",
      content: m.content,
    }));

    const result = await chatWithLiTT(message, normalizedHistory, {
      provider: provider as LittProviderName | undefined,
      model,
      context,
    });

    return NextResponse.json({
      reply: result.reply,
      mood: result.mood,
      action: result.action,
      provider: result.provider,
      model: result.model,
      latencyMs: result.latencyMs,
      failover: result.failover,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
