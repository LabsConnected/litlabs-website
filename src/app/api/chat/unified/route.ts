import { NextRequest, NextResponse } from "next/server";
import { withRateLimit } from "@/lib/rate-limiter";
import { sanitizeProviderError } from "@/lib/provider-error";
import {
  generateText,
  streamAgentTurn,
  type LLMFunctionCall,
  type LLMProvider,
  type LLMTool,
} from "@/lib/llm";
import { AGENTS, Agent, orchestrator } from "@/lib/agents";
import { auth } from "@/lib/auth";
import { PROJECT_CONTEXT } from "@/lib/project-context-server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { recallPersonaMemory, savePersonaMemory } from "@/lib/agent-memory";
import { AGENT_TOOL_SCHEMAS, executeAgentTool } from "@/lib/agent-tools";
import { withLittIdentity } from "@/lib/litt-identity";
import type { PersonaId } from "@/lib/persona";


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

interface StudioChatContext {
  projectId: string | null;
  studioMode: "code" | "media" | "command";
  activeWindowId: string | null;
  activeFilePath: string | null;
  selectedAssetPath: string | null;
  currentRoute: string;
}

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
  context?: StudioChatContext;
}

function buildPrompt(
  agent: Agent,
  message: string,
  history: HistoryEntry[],
  memories: string[] = [],
  projectContext = PROJECT_CONTEXT,
): string {
  const recentHistory = history.slice(-HISTORY_LIMIT);
  const transcript = recentHistory
    .map((entry) =>
      entry.role === "user"
        ? `User: ${entry.content}`
        : `${agent.name}: ${entry.content}`,
    )
    .join("\n");

  const memoryBlock =
    memories.length > 0
      ? `--- Long-term memory (relevant past context) ---\n${memories.join("\n")}\n--- End memory ---\n`
      : "";

  return [
    "=== PROJECT CONTEXT (repo files, docs, schema) ===",
    projectContext,
    "",
    agent.systemPrompt,
    "",
    memoryBlock,
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

function buildStudioContextBlock(context?: StudioChatContext): string {
  if (!context) return "";
  return [
    "=== ACTIVE STUDIO CONTEXT ===",
    `Selected project: ${context.projectId ?? "none"}`,
    `Studio mode: ${context.studioMode}`,
    `Active window: ${context.activeWindowId ?? "none"}`,
    `Active file: ${context.activeFilePath ?? "none"}`,
    `Selected asset: ${context.selectedAssetPath ?? "none"}`,
    `Current route: ${context.currentRoute}`,
    "=== END ACTIVE STUDIO CONTEXT ===",
  ].join("\n");
}

const BUILDER_ACTION_POLICY = `
You are operating inside LiTT Builder.

ACTION-FIRST RULES:

1. Treat normal language as Builder instructions.
   Examples: "make the logo move", "fix this mobile menu", "make the terminal bigger"

2. Do not respond with a raw list of candidate files.

3. Resolve targets using this order:
   a. selected asset or active file
   b. active Builder window
   c. current route
   d. imported components rendered by the current route
   e. code-search relevance and usage frequency
   f. public asset names only as the final signal

4. When one target is clearly most likely:
   - state the assumption briefly
   - inspect the relevant code
   - propose the exact change

5. Ask one short clarification only when two or more targets
   are similarly likely. Offer no more than two choices.

6. Read-only inspection tools may run automatically.

7. File edits, commands, builds, tests, and deployments require
   an approval proposal before execution.

8. Never claim a file was changed, command was run, or build passed
   unless a verified tool result confirms it.

9. Keep progress inside chat:
   Inspecting → Planning → Ready for approval → Applying → Verified.

10. After completing work, report:
   - what changed
   - files affected
   - validation results
   - Undo action when available
`.trim();

async function handleLLMChat(body: UnifiedChatRequest, userId: string | null) {
  const {
    agentSlug = DEFAULT_AGENT_SLUG,
    message,
    history = [],
    provider,
    stream = false,
    context,
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

  let memories: string[] = [];
  if (userId) {
    try {
      const recalled = await recallPersonaMemory(userId, agentSlug as PersonaId, 5);
      memories = recalled.map((m) => m.content).filter(Boolean);
    } catch {
      // Ignore memory recall failures; chat should still work.
    }
  }

  const prompt = buildPrompt(agent, message, history, memories);

  const saveMemory = async (responseText: string) => {
    if (!userId) return;
    try {
      const content = `User: ${message.slice(0, 500)}\n${agent.name}: ${responseText.slice(0, 1000)}`;
      await savePersonaMemory(userId, agentSlug as PersonaId, content, "terminal-chat");
    } catch {
      // Ignore memory save failures.
    }
  };

  if (!stream) {
    // Cap maxTokens for chat to keep replies tight (5-8 sentences). The agent
    // system prompt enforces brevity; this is the belt-and-suspenders ceiling.
    const llmOptions: {
      task: "chat";
      provider?: LLMProvider;
      maxTokens: number;
      temperature: number;
    } = {
      task: "chat",
      maxTokens: 500,
      temperature: 0.4,
    };
    if (provider && llmProvider) llmOptions.provider = llmProvider;
    const r = await generateText(prompt, llmOptions, undefined);
    await logConversation(agent, userId, message, r.text);
    await saveMemory(r.text);
    return NextResponse.json({
      response: r.text,
      provider: r.provider,
      model: r.model,
      latencyMs: r.latencyMs,
    });
  }

  // Build the canonical OpenAI-style messages array. We carry this across
  // the function-calling loop so tool results can be appended naturally.
  type Msg =
    | { role: "system"; content: string }
    | { role: "user"; content: string }
    | { role: "assistant"; content: string }
    | { role: "assistant"; content: string; tool_calls?: LLMFunctionCall[] }
    | { role: "tool"; name: string; content: string };
  const messages: Msg[] = [];
  // System prompt = static project identity + agent's own prompt + memory.
  // We re-use withLittIdentity so the identity block lands in front, same as
  // every other LLM call.
  const studioContextBlock = buildStudioContextBlock(context);
  const systemPrompt = withLittIdentity(
    [PROJECT_CONTEXT, studioContextBlock, BUILDER_ACTION_POLICY, agent.systemPrompt, memories.length > 0
      ? `--- Long-term memory (relevant past context) ---\n${memories.join("\n")}\n--- End memory ---`
      : ""].filter(Boolean).join("\n\n"),
  );
  messages.push({ role: "system", content: systemPrompt });
  for (const h of history.slice(-HISTORY_LIMIT)) {
    messages.push({
      role: h.role,
      content: h.content,
    });
  }
  messages.push({ role: "user", content: message });

  // Only the read-only tools are exposed to the chat path. Destructive tools
  // (run_build, run_lint, shell_command, npm_run) require an explicit
  // confirmation flow that the chat path does not implement yet; the
  // dedicated /api/agent-tool route is the entry point for those.
  const CHAT_TOOLS: LLMTool[] = AGENT_TOOL_SCHEMAS.filter(
    (s) => s.readonly,
  ).map((s) => ({
    name: s.name,
    description: s.description,
    parameters: s.parameters as LLMTool["parameters"],
  }));

  const encoder = new TextEncoder();
  const sse = new ReadableStream({
    async start(controller) {
      let assistantText = "";
      let lastProvider: LLMProvider = "gemini";
      let lastModel = "";
      const tStart = Date.now();
      const MAX_TURNS = 5;

      const streamOptions = (): {
        task: "chat";
        provider?: LLMProvider;
        maxTokens: number;
        temperature: number;
        tools?: LLMTool[];
      } => ({
        task: "chat",
        maxTokens: 500,
        temperature: 0.4,
        ...(provider && llmProvider ? { provider: llmProvider } : {}),
        ...(CHAT_TOOLS.length > 0 ? { tools: CHAT_TOOLS } : {}),
      });

      const send = (event: Record<string, unknown>) => {
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify(event)}\n\n`),
        );
      };

      try {
        // Turn loop: each turn may emit text, function calls, or both.
        // We keep going until the model produces a plain-text turn with
        // no function calls, or we hit MAX_TURNS.
        for (let turn = 0; turn < MAX_TURNS; turn++) {
          // Re-render the full message history into a single prompt the
          // LLM layer expects. OpenAI/Gemini both accept messages[] but
          // streamAgentTurn currently takes a single prompt string, so we
          // serialize the array into a transcript block.
          const transcript = messages
            .map((m) => {
              if (m.role === "system") return ""; // already system-prompt
              if (m.role === "tool") {
                return `[Tool ${m.name} returned]:\n${m.content}\n`;
              }
              if (m.role === "user") return `User: ${m.content}`;
              if (m.role === "assistant") {
                const calls =
                  "tool_calls" in m && m.tool_calls && m.tool_calls.length > 0
                    ? `\n[Called tools: ${m.tool_calls.map((c) => c.name).join(", ")}]`
                    : "";
                return `${agent.name}: ${m.content}${calls}`;
              }
              return "";
            })
            .filter(Boolean)
            .join("\n\n");

          const pending = { text: "", calls: [] as LLMFunctionCall[] };
          const r = await streamAgentTurn(
            transcript,
            (chunk) => {
              pending.text += chunk;
              assistantText += chunk;
              send({ text: chunk });
            },
            (call) => {
              pending.calls.push(call);
            },
            streamOptions(),
            systemPrompt,
          );
          const pendingText = pending.text;
          const pendingCalls = pending.calls;
          lastProvider = r.provider;
          lastModel = r.model;

          // Emit a status event so the client can show "Scanning..." in
          // the UI while tools run, without having to know the internals.
          if (pendingCalls.length > 0) {
            const humanLabels: Record<string, string> = {
              git_status: "Checking git status",
              git_log: "Reading recent commits",
              read_file: "Reading a file",
              list_directory: "Scanning a folder",
              search_code: "Searching the codebase",
            };
            for (const c of pendingCalls) {
              send({
                tool: c.name,
                status: "running",
                message: humanLabels[c.name] ?? `Running ${c.name}`,
              });
            }
            messages.push({
              role: "assistant",
              content: pendingText,
              tool_calls: pendingCalls,
            });
            for (const call of pendingCalls) {
              const result = await executeAgentTool(
                call.name,
                { ...call.args, _confirmed: false } as Record<string, unknown>,
                userId ?? "anonymous",
              );
              messages.push({
                role: "tool",
                name: call.name,
                content:
                  typeof result.result === "string"
                    ? result.result
                    : JSON.stringify(result.result ?? result.message ?? ""),
              });
              send({
                tool: call.name,
                status: "complete",
                message: result.message,
              });
            }
            // Continue the loop — model gets the tool results and may
            // emit more text or another tool call.
            continue;
          }

          // No tool call this turn — we have the final answer.
          messages.push({ role: "assistant", content: pendingText });
          break;
        }

        send({
          done: true,
          provider: lastProvider,
          model: lastModel,
          latencyMs: Date.now() - tStart,
        });
        // [DONE] is an SSE control message, not a JSON event. The client
        // already keys off `done: true` to close the stream.
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      } catch (err) {
        const { error: msg } = sanitizeProviderError(err);
        send({ error: msg });
      } finally {
        controller.close();
        if (assistantText) {
          await logConversation(agent, userId, message, assistantText);
          await saveMemory(assistantText);
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
    { task: "chat", provider: "gemini", maxTokens: 500, temperature: 0.4 },
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
    const { status, error: message, retryAfter } = sanitizeProviderError(err);
    return NextResponse.json(
      { error: message, retryAfter },
      { status },
    );
  }
}

export const POST = withRateLimit(handler, 60, 60);
