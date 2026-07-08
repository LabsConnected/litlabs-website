import { NextRequest, NextResponse } from "next/server";
import { withRateLimit } from "@/lib/rate-limiter";
import { streamText, generateText } from "@/lib/llm";
import { AGENTS, Agent } from "@/lib/agents";
import { auth } from "@clerk/nextjs/server";
import { loadLitMemory, persistLitTurn } from "@/lib/ai/lit-brain";

export const runtime = "nodejs";
export const maxDuration = 60;

type HistoryEntry = { role: "user" | "assistant"; content: string };

const DEFAULT_AGENT_SLUG = "director";
const HISTORY_LIMIT = 12;

function buildPrompt(
  agent: Agent,
  message: string,
  history: HistoryEntry[],
  memoryContext: string,
): string {
  const recentHistory = history.slice(-HISTORY_LIMIT);

  const transcript = recentHistory
    .map((entry) =>
      entry.role === "user"
        ? `User: ${entry.content}`
        : `${agent.name}: ${entry.content}`,
    )
    .join("\n");

  return [
    agent.systemPrompt,
    memoryContext,
    "",
    "CONVERSATION RULES:",
    "- Do not reintroduce yourself if the conversation already contains an introduction.",
    "- Do not repeat the same capability list, route list, or generic assistant pitch.",
    "- Answer the user's latest message directly and build on recent history.",
    "- If the user is frustrated, acknowledge the actual problem and state the next concrete fix.",
    "- Use saved memory, project context, and current route naturally; do not dump them.",
    "- Keep replies short unless the user asks for a full plan.",
    "",
    transcript ? `--- Conversation so far ---\n${transcript}\n--- End of history ---\n` : "",
    `User: ${message}`,
    "",
    `${agent.name}:`,
  ]
    .filter((line) => line !== undefined)
    .join("\n");
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

    // Identity + long-term memory + history summary + personality state.
    const olderHistory = history.slice(0, -HISTORY_LIMIT);
    const memory = await loadLitMemory(userId ?? null, message, olderHistory);
    const prompt = buildPrompt(agent, message, history, memory.block);

    if (!stream) {
      const r = await generateText(
        prompt,
        { task: "chat", provider, maxTokens: 2048 },
        undefined,
      );
      void persistLitTurn({
        clerkId: userId ?? null,
        resolvedUserId: memory.resolvedUserId,
        message,
        answer: r.text,
        agentId: agent.id,
      });
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
            await persistLitTurn({
              clerkId: userId ?? null,
              resolvedUserId: memory.resolvedUserId,
              message,
              answer: assistantText,
              agentId: agent.id,
            });
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


