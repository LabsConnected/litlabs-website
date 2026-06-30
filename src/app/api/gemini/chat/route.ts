import { NextRequest, NextResponse } from "next/server";
import { withRateLimit } from "@/lib/rate-limiter";
import { streamText, generateText } from "@/lib/llm";
import { AGENTS, Agent } from "@/lib/agents";
import { auth } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase";
import { buildToolPrompt, parseToolCalls, executeTool } from "@/lib/agent-tools";

export const runtime = "nodejs";
export const maxDuration = 60;

type HistoryEntry = { role: "user" | "assistant"; content: string };

const DEFAULT_AGENT_SLUG = "director";
const HISTORY_LIMIT = 8;

interface SiteContext {
  platform?: string;
  totalUsers?: number;
  currentTime?: string;
  recentEvents?: { type: string; title: string; when: string }[];
  capabilities?: string[];
}

function buildPrompt(
  agent: Agent,
  message: string,
  history: HistoryEntry[],
  context?: SiteContext,
): string {
  const condensed = history
    .slice(-HISTORY_LIMIT)
    .map(
      (entry) =>
        `${entry.role === "user" ? "User" : agent.name}: ${entry.content}`,
    )
    .join("\n");

  const contextBlock = context
    ? `\nSite awareness:\n- Platform: ${context.platform || "LiTTree Lab Studios"}\n- Users: ${context.totalUsers || "unknown"}\n- Time: ${context.currentTime || new Date().toISOString()}\n${context.recentEvents?.length ? `- Recent: ${context.recentEvents.map((e) => e.title).join(", ")}` : ""}\n`
    : "";

  const toolPrompt = buildToolPrompt();

  return `${agent.systemPrompt}

Personality: ${agent.personality}
Role: ${agent.role}
${contextBlock}${toolPrompt}
${condensed ? `\nConversation history:\n${condensed}\n\n` : ""}User: ${message}

Respond as ${agent.name} in character, staying concise and actionable. If you need to use a tool, include it in format [TOOL:name {"param":"value"}].`;
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
 * Body: { agentSlug, message, history?, context?, provider?, stream?: boolean }
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
      context,
      provider = "gemini",
      stream = false,
    } = body;

    if (!message || typeof message !== "string") {
      return NextResponse.json({ error: "Missing message" }, { status: 400 });
    }

    const agent =
      AGENTS[agentSlug as keyof typeof AGENTS] ??
      AGENTS[DEFAULT_AGENT_SLUG as keyof typeof AGENTS];
    const prompt = buildPrompt(agent, message, history, context);

    if (!stream) {
      const r = await generateText(
        prompt,
        { task: "chat", provider, maxTokens: 2048 },
        undefined,
      );

      // Process any tool calls in the response
      const toolCalls = parseToolCalls(r.text);
      let toolResults: { tool: string; result: string }[] = [];
      if (toolCalls.length > 0) {
        toolResults = await Promise.all(
          toolCalls.map(async (tc) => {
            const result = await executeTool(tc.tool, tc.params);
            return { tool: tc.tool, result: result.output };
          }),
        );
      }

      await logConversation(agent, userId, message, r.text);
      return NextResponse.json({
        response: r.text,
        provider: r.provider,
        model: r.model,
        latencyMs: r.latencyMs,
        toolResults: toolResults.length > 0 ? toolResults : undefined,
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

          // Process tool calls after streaming completes
          const toolCalls = parseToolCalls(assistantText);
          if (toolCalls.length > 0) {
            const toolResults = await Promise.all(
              toolCalls.map(async (tc) => {
                const result = await executeTool(tc.tool, tc.params);
                return { tool: tc.tool, result: result.output };
              }),
            );
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({ toolResults })}\n\n`,
              ),
            );
          }

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
    console.error("[api/gemini/chat] error:", err);
    return NextResponse.json(
      { error: "Internal server error", detail: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}

export const POST = withRateLimit(handler, 60, 60);
