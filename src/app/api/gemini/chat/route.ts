import { NextRequest, NextResponse } from "next/server";
import { withRateLimit } from "@/lib/rate-limiter";
import { streamText, generateText } from "@/lib/llm";
import { AGENTS, Agent } from "@/lib/agents";
import { auth } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";
export const maxDuration = 60;

type HistoryEntry = { role: "user" | "assistant"; content: string };

const DEFAULT_AGENT_SLUG = "director";
// Keep last 12 turns (6 exchanges) to give the model solid context without bloating the prompt
const HISTORY_LIMIT = 12;

function buildPrompt(
  agent: Agent,
  message: string,
  history: HistoryEntry[],
): string {
  const recentHistory = history.slice(-HISTORY_LIMIT);

  // Build a turn-by-turn conversation transcript so the model can track the full thread
  const transcript = recentHistory
    .map((entry) =>
      entry.role === "user"
        ? `User: ${entry.content}`
        : `${agent.name}: ${entry.content}`,
    )
    .join("\n");

  return [
    agent.systemPrompt,
    "",
    transcript ? `--- Conversation so far ---\n${transcript}\n--- End of history ---\n` : "",
    `User: ${message}`,
    "",
    `${agent.name}:`,
  ]
    .filter((line) => line !== undefined)
    .join("\n");
}

async function logConversation(
  agent: Agent,
  userId: string | null,
  userMessage: string,
  responseText: string,
) {
  try {
    const admin = getSupabaseAdmin();
    if (!admin) return; // Build-safe: null when env keys unavailable
    await admin.from("agent_logs").insert({
      agent_id: agent.id,
      level: "info",
      message: "Agent chat",
      metadata: {
        userId,
        userMessage,
        responseText,
        timestamp: new Date().toISOString(),
      },
    });
  } catch {
    // Failed to log agent chat:
  }
}

/**
 * POST /api/gemini/chat
 * Body: { agentSlug, message, history?, provider?, stream?: boolean }
 */
async function handler(req: NextRequest) {
  if (req.method !== "POST") {
    return NextResponse.json({ error: "Method not allowed" }, { status: 405 });
  }

  try {
    const { userId } = await auth();
    const body = await req.json();
    const {
      agentSlug = DEFAULT_AGENT_SLUG,
      message,
      history = [],
      provider = "gemini",
      stream = false,
    } = body;

    if (!message || typeof message !== "string") {
      return NextResponse.json({ error: "Missing message" }, { status: 400 });
    }

    const agent =
      AGENTS[agentSlug as keyof typeof AGENTS] ??
      AGENTS[DEFAULT_AGENT_SLUG as keyof typeof AGENTS];
    const prompt = buildPrompt(agent, message, history);

    if (!stream) {
      const r = await generateText(
        prompt,
        { task: "chat", provider, maxTokens: 2048 },
        undefined,
      );
      await logConversation(agent, userId, message, r.text);
      return NextResponse.json({
        response: r.text,
        provider: r.provider,
        model: r.model,
        latencyMs: r.latencyMs,
      });
    }

    const encoder = new TextEncoder();
    const sse = new ReadableStream({
      async start(controller) {
        let assistantText = "";
        try {
          const r = await streamText(
            prompt,
            (chunk) => {
              assistantText += chunk;
              controller.enqueue(
                encoder.encode(`data: ${JSON.stringify({ text: chunk })}\n\n`),
              );
            },
            { task: "chat", provider, maxTokens: 2048 },
          );
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ done: true, provider: r.provider, model: r.model, latencyMs: r.latencyMs })}\n\n`,
            ),
          );
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        } catch (err) {
          const msg = err instanceof Error ? err.message : "stream error";
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ error: msg })}\n\n`),
          );
        } finally {
          controller.close();
          if (assistantText) {
            await logConversation(agent, userId, message, assistantText);
          }
        }
      },
    });

    return new Response(sse, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      },
    });
  } catch (err) {
    // LLM chat route error:
    console.error("[api/gemini/chat] error:", err);
    return NextResponse.json(
      { error: "Internal server error", detail: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}

export const POST = withRateLimit(handler, 60, 60);
