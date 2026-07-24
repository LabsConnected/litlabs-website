import { NextRequest, NextResponse } from "next/server";
import { withRateLimit } from "@/lib/rate-limiter";
import { streamText, generateText } from "@/lib/llm";
import { AGENTS, Agent } from "@/lib/agents";
import { auth } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase";
import type { Part } from "@google/generative-ai";

export const runtime = "nodejs";
export const maxDuration = 60;

type HistoryEntry = { role: "user" | "assistant"; content: string };

const DEFAULT_AGENT_SLUG = "litt";
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

function sanitizeOutput(text: string): string {
  return text.replace(/\{\{?userName\}?\}/gi, "there");
}

function dataUrlToInlineData(dataUrl: string) {
  const match = dataUrl.match(/^data:([a-zA-Z0-9+/\-._]+);base64,(.+)$/);
  if (!match) return null;
  const mimeType = match[1];
  const base64 = match[2];
  // Only accept common image MIME types
  if (!mimeType.startsWith("image/")) return null;
  return { inlineData: { mimeType, data: base64 } };
}

async function generateWithImages(
  systemPrompt: string,
  userText: string,
  history: HistoryEntry[],
  images: string[],
  modelName = "gemini-2.5-flash",
): Promise<{ text: string; provider: string; model: string; latencyMs: number }> {
  const { GoogleGenerativeAI } = await import("@google/generative-ai");
  const key = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || "";
  if (!key) throw new Error("Gemini API key not configured");
  const genAI = new GoogleGenerativeAI(key);
  const model = genAI.getGenerativeModel({
    model: modelName,
    systemInstruction: systemPrompt,
  });

  const contents: { role: "user" | "model"; parts: Part[] }[] = [];
  for (const entry of history.slice(-HISTORY_LIMIT)) {
    contents.push({
      role: entry.role === "user" ? "user" : "model",
      parts: [{ text: entry.content }],
    });
  }

  const parts: Part[] = [{ text: userText }];
  for (const image of images) {
    const inline = dataUrlToInlineData(image);
    if (inline) parts.push(inline as Part);
  }
  contents.push({ role: "user", parts });

  const t0 = Date.now();
  const result = await model.generateContent({ contents });
  const text = result.response.text();
  return { text, provider: "gemini", model: modelName, latencyMs: Date.now() - t0 };
}

function buildPrompt(
  agent: Agent,
  message: string,
  history: HistoryEntry[],
  memoryContext: string,
  userName?: string,
  capabilities?: Record<string, unknown>,
): string {
  const recentHistory = history.slice(-HISTORY_LIMIT);

  const transcript = recentHistory
    .map((entry) =>
      entry.role === "user"
        ? `User: ${entry.content}`
        : `${agent.name}: ${entry.content}`,
    )
    .join("\n");

  const resolvedName = userName?.trim() || "Member";
  const systemPrompt = agent.systemPrompt.replace(/\{\{?userName\}?\}/g, resolvedName);

  const connSummary = capabilities?.connectionSummary as string | undefined;
  const availableTools = capabilities?.availableTools as string[] | undefined;
  const toolList = Array.isArray(availableTools) && availableTools.length > 0
    ? availableTools.join(", ")
    : "none";

  return [
    systemPrompt,
    `Verified capability state: ${JSON.stringify(capabilities ?? { repository: "none", terminalExecution: "unavailable", writeAccess: false })}`,
    `Connection summary: ${connSummary || "No services connected."}`,
    `Available tools: ${toolList}`,
    `Truth rules: Never claim the repository was scanned, indexed, read, modified, or that a command executed unless the verified capability state and supplied tool result explicitly confirm it. Never claim a service is connected unless it appears in the connection summary. State uncertainty plainly. If no services are connected, say so and suggest visiting the Connection Bay.`,
    `Terminal truthfulness: The terminalExecution capability is "${capabilities?.terminalExecution ?? "unavailable"}". If it is "unavailable", you MUST NOT claim you can run commands, execute code, or access a terminal. Tell the user the terminal is not connected and they need to start the PTY server and connect. If it is "available", you may suggest commands but must clarify that execution requires user approval. Never fabricate terminal output or claim a command ran when you have no tool result confirming it.`,
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
      model: requestedModel,
      stream = false,
      userName,
      images = [],
      capabilities = {},
    } = body;

    if (!message || typeof message !== "string") {
      return NextResponse.json({ error: "Missing message" }, { status: 400 });
    }

    const agent =
      AGENTS[agentSlug as keyof typeof AGENTS] ??
      AGENTS[DEFAULT_AGENT_SLUG as keyof typeof AGENTS];

    const uid = userId || "anonymous-dev";
    const memoryContext = userId ? await fetchMemories(message, uid) : "";
    const systemPrompt = buildPrompt(agent, message, history, memoryContext, userName, capabilities)
      .split("User: ")[0]
      .trim();

    const geminiModel =
      typeof requestedModel === "string" && requestedModel.startsWith("gemini")
        ? requestedModel
        : "gemini-2.5-flash";

    // Multimodal path: send image snapshots directly to Gemini
    const imageArray = Array.isArray(images) ? images : [];
    if (imageArray.length > 0 && !stream) {
      const r = await generateWithImages(systemPrompt, message, history, imageArray, geminiModel);
      const cleanText = sanitizeOutput(r.text);
      if (userId) {
        await saveMemory(`User: ${message}\n${agent.name}: ${cleanText}`, uid, agent.id);
      }
      return NextResponse.json({
        response: cleanText,
        provider: r.provider,
        model: r.model,
        latencyMs: r.latencyMs,
      });
    }

    const prompt = buildPrompt(agent, message, history, memoryContext, userName, capabilities);

    if (!stream) {
      const r = await generateText(
        prompt,
        {
          task: "chat",
          provider,
          maxTokens: 2048,
          modelOverride: requestedModel ? { [provider]: requestedModel } : undefined,
        },
        undefined,
      );
      const cleanText = sanitizeOutput(r.text);
      await logConversation(agent, userId, message, cleanText);
      if (userId) {
        await saveMemory(`User: ${message}\n${agent.name}: ${cleanText}`, uid, agent.id);
      }
      return NextResponse.json({
        response: cleanText,
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
              const cleanChunk = sanitizeOutput(chunk);
              assistantText += cleanChunk;
              controller.enqueue(
                encoder.encode(`data: ${JSON.stringify({ text: cleanChunk })}\n\n`),
              );
            },
            {
              task: "chat",
              provider,
              maxTokens: 2048,
              modelOverride: requestedModel ? { [provider]: requestedModel } : undefined,
            },
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
