import { NextRequest, NextResponse } from "next/server";
import { withRateLimit } from "@/lib/rate-limiter";
import { streamText, generateText, type LLMProvider } from "@/lib/llm";
import { AGENTS, Agent, orchestrator } from "@/lib/agents";
import { auth } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";
export const maxDuration = 60;

type HistoryEntry = { role: "user" | "assistant"; content: string };

const DEFAULT_AGENT_SLUG = "littcode";
const HISTORY_LIMIT = 12;

/**
 * Unified Chat API Contract
 * 
 * Supports multiple chat modes:
 * 1. Agent-to-agent: { mode: "agent", from, to, message }
 * 2. LLM chat: { mode: "llm", agentSlug, message, history, provider, stream }
 * 3. Gallery/simple: { mode: "simple", agent, message }
 * 4. Legacy: { from, to, message } (defaults to agent mode)
 */

interface UnifiedChatRequest {
  mode?: "agent" | "llm" | "simple";
  from?: string;
  to?: string;
  agent?: string;
  agentSlug?: string;
  message: string;
  type?: string;
  metadata?: Record<string, unknown>;
  history?: HistoryEntry[];
  provider?: string;
  stream?: boolean;
  simulateResponse?: boolean;
}

function buildPrompt(
  agent: Agent,
  message: string,
  history: HistoryEntry[],
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
    if (!admin) return;
    await admin.from("agent_logs").insert({
      agent_id: agent.id,
      level: "info",
      message: "Unified chat",
      metadata: {
        userId,
        userMessage,
        responseText,
        timestamp: new Date().toISOString(),
      },
    });
  } catch {
    // Failed to log: silently continue
  }
}

async function handleAgentChat(body: UnifiedChatRequest) {
  const { from, to, message, type = "chat", metadata, simulateResponse } = body;

  if (!from || !to || !message) {
    return NextResponse.json(
      { error: "Missing required fields for agent mode: from, to, message" },
      { status: 400 },
    );
  }

  const fromAgent = orchestrator.getAgent(from);
  const toAgent = orchestrator.getAgent(to);

  if (!fromAgent || !toAgent) {
    return NextResponse.json(
      { error: "Invalid agent ID(s)" },
      { status: 400 },
    );
  }

  const validTypes = ["chat", "command", "insight", "task"] as const;
  type MessageType = (typeof validTypes)[number];
  const messageType: MessageType = validTypes.includes(type as MessageType) ? (type as MessageType) : "chat";

  const agentMessage = orchestrator.sendMessage(from, to, message, messageType, metadata);

  if (simulateResponse) {
    const response = await orchestrator.simulateAgentResponse(to, message);
    const reply = orchestrator.sendMessage(to, from, response, "chat");

    return NextResponse.json({
      sent: agentMessage,
      received: reply,
      conversation: [agentMessage, reply],
    });
  }

  return NextResponse.json({
    sent: agentMessage,
    from: { id: fromAgent.id, name: fromAgent.name },
    to: { id: toAgent.id, name: toAgent.name },
  });
}

async function handleLLMChat(body: UnifiedChatRequest, userId: string | null) {
  const {
    agentSlug = DEFAULT_AGENT_SLUG,
    message,
    history = [],
    provider,
    stream = false,
  } = body;

  if (!message || typeof message !== "string") {
    return NextResponse.json({ error: "Missing message" }, { status: 400 });
  }

  const validProviders: LLMProvider[] = [
    "gemini",
    "openrouter-free",
    "openrouter-qwen",
    "openrouter-deepseek",
    "openrouter-mistral",
    "openrouter-llama",
    "openrouter-trinity",
  ];
  const llmProvider: LLMProvider = validProviders.includes(provider as LLMProvider)
    ? (provider as LLMProvider)
    : "gemini";

  const agent =
    AGENTS[agentSlug as keyof typeof AGENTS] ??
    AGENTS[DEFAULT_AGENT_SLUG as keyof typeof AGENTS];
  const prompt = buildPrompt(agent, message, history);

  if (!stream) {
    const llmOptions: { task: "chat"; provider?: LLMProvider; maxTokens: number } = {
      task: "chat",
      maxTokens: 2048,
    };
    if (provider && llmProvider) llmOptions.provider = llmProvider;
    const r = await generateText(prompt, llmOptions, undefined);
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
        const streamOptions: { task: "chat"; provider?: LLMProvider; maxTokens: number } = {
          task: "chat",
          maxTokens: 2048,
        };
        if (provider && llmProvider) streamOptions.provider = llmProvider;
        const r = await streamText(
          prompt,
          (chunk) => {
            assistantText += chunk;
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({ text: chunk })}\n\n`),
            );
          },
          streamOptions,
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
}

async function handleSimpleChat(body: UnifiedChatRequest, userId: string | null) {
  const { agent, message } = body;

  if (!agent || !message) {
    return NextResponse.json(
      { error: "Missing required fields for simple mode: agent, message" },
      { status: 400 },
    );
  }

  // Resolve agent from slug or ID
  const agentSlug = agent;
  const targetAgent =
    AGENTS[agentSlug as keyof typeof AGENTS] ??
    AGENTS[DEFAULT_AGENT_SLUG as keyof typeof AGENTS];

  const prompt = buildPrompt(targetAgent, message, []);
  const r = await generateText(
    prompt,
    { task: "chat", provider: "gemini", maxTokens: 2048 },
    undefined,
  );

  await logConversation(targetAgent, userId, message, r.text);

  return NextResponse.json({
    reply: r.text,
    agent: { id: targetAgent.id, name: targetAgent.name },
    message,
  });
}

async function handler(req: NextRequest) {
  if (req.method !== "POST") {
    return NextResponse.json({ error: "Method not allowed" }, { status: 405 });
  }

  try {
    const { userId } = await auth();
    const body = (await req.json()) as UnifiedChatRequest;
    const { mode = "llm" } = body;

    // Auto-detect mode if not specified
    let detectedMode = mode;
    if (!mode) {
      if (body.from && body.to) detectedMode = "agent";
      else if (body.agent) detectedMode = "simple";
      else detectedMode = "llm";
    }

    switch (detectedMode) {
      case "agent":
        return await handleAgentChat(body);
      case "simple":
        return await handleSimpleChat(body, userId);
      case "llm":
      default:
        return await handleLLMChat(body, userId);
    }
  } catch (err) {
    console.error("[api/chat/unified] error:", err);
    return NextResponse.json(
      { error: "Internal server error", detail: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}

export const POST = withRateLimit(handler, 60, 60);
