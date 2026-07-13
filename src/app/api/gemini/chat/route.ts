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
const HISTORY_LIMIT = 12;

async function fetchMemories(query: string, userId: string): Promise<string> {
  try {
    const smKey = process.env.SUPERMEMORY_API_KEY;
    if (!smKey) return "";
    const { Supermemory } = await import("supermemory");
    const sm = new Supermemory({ apiKey: smKey });
    const results = await sm.search.memories({ q: query, containerTag: userId, limit: 5 });
    const memories = (results.results || []).map((m: { memory?: string; chunk?: string }) => m.memory || m.chunk || "").filter(Boolean);
    if (!memories.length) return "";
    return `\n\nRELEVANT MEMORIES FROM PREVIOUS SESSIONS:\n${memories.join("\n")}\n---`;
  } catch {
    return "";
  }
}

async function saveMemory(content: string, userId: string, agentId: string): Promise<void> {
  try {
    const smKey = process.env.SUPERMEMORY_API_KEY;
    if (!smKey) return;
    const { Supermemory } = await import("supermemory");
    const sm = new Supermemory({ apiKey: smKey });
    await sm.add({ content, containerTag: userId, metadata: { type: "agent-chat", agent: agentId } });
  } catch {
    // non-fatal
  }
}

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

    const uid = userId || "anonymous-dev";
    const memoryContext = userId ? await fetchMemories(message, uid) : "";
    const prompt = buildPrompt(agent, message, history, memoryContext);

    if (!stream) {
      const r = await generateText(
        prompt,
        { task: "chat", provider, maxTokens: 2048 },
        undefined,
      );
      await logConversation(agent, userId, message, r.text);
      if (userId) {
        await saveMemory(`User: ${message}\n${agent.name}: ${r.text}`, uid, agent.id);
      }
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
            if (userId) {
              await saveMemory(`User: ${message}\n${agent.name}: ${assistantText}`, uid, agent.id);
            }
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
