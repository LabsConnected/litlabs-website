/**
 * Canonical LiTT operator — the ONE brain path for terminal-server.
 *
 *   UI transport (Socket.IO / HTTP / Termux)
 *      ↓
 *   runLiTTOperator()
 *      ↓
 *   runAgentLoop()  ←  @litt/agent-core (the canonical agent loop)
 *      ↓
 *   ExecutionGateway → CommandExecutor → ShellExecutor  ←  runtime.ts
 *      ↓
 *   canonical RuntimeStore  ←  runtime.ts
 *      ↓
 *   Socket.IO runtime events
 *
 * This replaces the old `handleLiTTCodeCommand` → `askLiTTCode` path,
 * which was a bare LLM call with NO tool execution, NO gateway, NO
 * runtime store, and NO runId. The old path is retained as a fallback
 * for when no model provider is configured (no OPENROUTER_API_KEY and
 * Ollama unreachable).
 *
 * Architecture rules enforced here:
 *   - ONE RuntimeStore (from getRuntimeStore())
 *   - ONE ExecutionGateway (from getExecutionGateway())
 *   - ONE ToolRegistry (from getCanonicalToolRegistry())
 *   - ONE ShellExecutor (from getCanonicalShell())
 *   - ONE runId per operator turn (generated here, passed through)
 *   - requestId ≠ runId (requestId is transport correlation)
 */

import {
  runAgentLoop,
  type AgentLoopResult,
  type AgentLoopOptions,
  type ChatMessage,
  type ModelProvider,
  type ModelResult,
  type ModelStreamEvent,
  type ModelProfile,
  type ToolResult,
} from "@litt/agent-core";
import {
  getRuntimeStore,
  getExecutionGateway,
  getCanonicalToolRegistry,
  getCanonicalShell,
  runtimeSetPhase,
} from "./runtime.js";
import { streamLiTTCode, health, type LiTTEvent } from "./litt-code.js";

// ─── ModelProvider adapter ────────────────────────────────────────

/**
 * Wraps the existing `streamLiTTCode` (Ollama → OpenRouter fallback) as
 * a `ModelProvider` that the canonical agent loop can call.
 *
 * This is a transport adapter only — it does NOT make decisions, does
 * NOT call tools, and does NOT touch the RuntimeStore. The agent loop
 * owns the brain; this owns the wire to the LLM API.
 */
class LiTTModelProvider implements ModelProvider {
  async stream(
    messages: ChatMessage[],
    emit: (event: ModelStreamEvent) => void,
  ): Promise<ModelResult> {
    // The agent loop sends [system, user, assistant, user, ...] — but
    // streamLiTTCode expects a single prompt. We reconstruct the prompt
    // from the conversation, keeping the system message separate.
    const systemMsg = messages.find((m) => m.role === "system");
    const conversation = messages
      .filter((m) => m.role !== "system")
      .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`)
      .join("\n\n");

    const prompt = systemMsg
      ? `${systemMsg.content}\n\n${conversation}`
      : conversation;

    // Bridge LiTTEvent → ModelStreamEvent
    const result = await streamLiTTCode(prompt, (e: LiTTEvent) => {
      switch (e.type) {
        case "meta":
          emit({
            type: "meta",
            provider: e.provider,
            model: e.model,
            profile: e.profile as ModelProfile,
          });
          break;
        case "delta":
          emit({ type: "delta", text: e.text });
          break;
        case "done":
          emit({
            type: "done",
            model: e.model,
            usage: e.usage,
            timing: e.timing,
          });
          break;
        case "error":
          emit({ type: "error", message: e.message });
          break;
      }
    });

    return {
      content: result.content,
      model: result.model,
      provider: result.provider,
      usage: result.usage,
      timing: result.timing,
      profile: result.profile as ModelProfile,
    };
  }

  async health(): Promise<number> {
    return health();
  }
}

// ─── Operator context ─────────────────────────────────────────────

export interface OperatorContext {
  /** The user's natural-language input */
  prompt: string;
  /** Working directory */
  cwd: string;
  /** User ID (from Socket.IO auth or HTTP auth) */
  userId?: string | null;
  /** Mission mode */
  mode?: "plan" | "act" | "auto";
  /** Transport correlation ID (distinct from runId) */
  requestId?: string;
  /** Optional stream callback for live model output */
  onModelStream?: (event: ModelStreamEvent) => void;
  /** Optional stream callback for live tool output */
  onToolStream?: (chunk: { stream: "stdout" | "stderr"; text: string; ts: number }) => void;
}

export interface OperatorResult {
  /** The final text response from the agent */
  content: string;
  /** The canonical runId for this operator turn */
  runId: string;
  /** Tool calls made during the loop */
  toolCalls: AgentLoopResult["toolCalls"];
  /** Number of rounds */
  rounds: number;
  /** Duration in ms */
  durationMs: number;
  /** Termination reason */
  termination: AgentLoopResult["termination"];
  /** Model usage */
  usage: { total_tokens: number };
}

// ─── System prompt builder ────────────────────────────────────────

/**
 * Build the canonical operator system prompt.
 *
 * This is the IDENTITY prompt — it tells the model WHO it is, WHERE it
 * is, and WHAT it can do. This prevents the "I am an AI assistant" /
 * "I am not a software project" embarrassment: the model receives
 * concrete project context (name, root, branch, mode, runtime status)
 * and a clear instruction to act as the LiTT operator, not a generic
 * chatbot.
 *
 * The prompt includes:
 *   - Identity: LiTT operator for LiTTree Lab Studios
 *   - Project: name, root, branch (from runtime state)
 *   - Mode: PLAN/ACT/AUTO and what it means
 *   - Runtime status: current phase, online state
 *   - Available tools: the canonical tool set
 *   - Intent guidance: how to interpret natural-language requests
 */
function buildOperatorSystemPrompt(cwd: string, mode: string): string {
  const projectName = cwd.split(/[\\/]/).pop() ?? "unknown";
  const store = getRuntimeStore();
  const state = store.getState();

  // Extract runtime context
  const branch = state.project?.branch ?? "unknown";
  const phase = state.phase ?? "idle";
  const online = state.online ? "online" : "offline";
  const model = state.model ?? "unconfigured";
  const profile = state.profile ?? "auto";

  return [
    `You are LiTT, the lead AI operator for LiTTree Lab Studios.`,
    `You are NOT a generic AI assistant. You are the project's operator — you inspect, diagnose, and act on the codebase.`,
    "",
    `## Project Context`,
    `- Project: ${projectName}`,
    `- Root: ${cwd}`,
    `- Branch: ${branch}`,
    `- Runtime mode: ${mode.toUpperCase()}`,
    `- Runtime phase: ${phase}`,
    `- Model: ${model} (${profile})`,
    `- Server: ${online}`,
    "",
    `## Mode Rules`,
    mode === "plan"
      ? "- PLAN mode: You may inspect the project (status, diff, check, test, build) but you CANNOT mutate files or run commands that change state. If the user asks for a mutation, explain what you would do and ask them to switch to ACT mode."
      : "- ACT mode: You can inspect and modify the project. Destructive operations require approval from the gateway.",
    "",
    `## Available Tools`,
    "When you need to inspect or modify the project, use tool calls:",
    "- project.status: Get project + git status (read-only)",
    "- project.diff: Get git diff (read-only)",
    "- project.check: Run typecheck/lint (read-only)",
    "- project.test: Run tests (read-only)",
    "- project.build: Run build (read-only)",
    "- project.run: Run a shell command (subject to gateway policy)",
    "- project.list_files: List files in a directory (read-only)",
    "- project.read_file: Read a file (read-only)",
    "- project.search: Search file contents (read-only)",
    "",
    `## Intent Interpretation`,
    "Users may phrase requests informally. Map natural language to actions:",
    '- "test and see how you are" → run project.test, then report results + runtime status',
    '- "check the project" → run project.check + project.status',
    '- "how are you" / "status" → run project.status, report runtime state',
    '- "what\'s wrong" / "is it broken" → run project.check + project.test, report failures',
    '- "build it" → run project.build',
    '- "show me the diff" → run project.diff',
    "Do NOT ask for clarification when the intent is reasonably clear. Act first, then report.",
    "",
    `## Response Style`,
    "- Be concise and actionable. Report what you did and what happened.",
    "- Use tool calls to inspect before answering questions about the project.",
    "- When you have the answer, respond without a tool_call block.",
    "- Never say 'I am an AI assistant' or 'I am not a software project'. You ARE the project's operator.",
  ].join("\n");
}

// ─── Canonical operator ───────────────────────────────────────────

let modelProvider: LiTTModelProvider | null = null;

function getModelProvider(): LiTTModelProvider {
  if (!modelProvider) {
    modelProvider = new LiTTModelProvider();
  }
  return modelProvider;
}

/**
 * Run the canonical LiTT operator.
 *
 * This is the ONE brain path. Desktop, CLI remote, Termux, and any
 * other surface that needs natural-language LiTT execution must call
 * this function — not `askLiTTCode` directly.
 *
 * The operator:
 *   1. Generates a canonical runId
 *   2. Obtains canonical runtime resources (store, gateway, tools, shell)
 *   3. Calls runAgentLoop with those resources
 *   4. Emits lifecycle events through the canonical RuntimeStore
 *   5. Returns the result with the runId for cross-surface correlation
 */
export async function runLiTTOperator(ctx: OperatorContext): Promise<OperatorResult> {
  const t0 = Date.now();
  const runId = `run_op_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const mode = ctx.mode ?? "act";
  const userId = ctx.userId ?? "terminal-server";

  const store = getRuntimeStore();
  const gateway = getExecutionGateway(ctx.cwd, mode);
  const tools = getCanonicalToolRegistry(ctx.cwd);
  const shell = getCanonicalShell(ctx.cwd);
  const model = getModelProvider();

  // Emit lifecycle: operator turn started
  store.commandStart("litt-operator", [ctx.prompt], ctx.cwd);

  runtimeSetPhase("thinking");

  const systemPrompt = buildOperatorSystemPrompt(ctx.cwd, mode);

  const options: AgentLoopOptions = {
    model,
    tools,
    shell,
    store,
    gateway,
    cwd: ctx.cwd,
    userId,
    mode,
    systemPrompt,
    maxRounds: 6,
    onModelStream: ctx.onModelStream,
    onToolStream: ctx.onToolStream,
  };

  try {
    const result = await runAgentLoop(ctx.prompt, options);

    const success = result.termination === "complete";
    runtimeSetPhase(success ? "complete" : "failed");
    store.commandEnd(
      "litt-operator",
      success,
      success ? 0 : 1,
      Date.now() - t0,
      result.content.slice(0, 200),
    );

    return {
      content: result.content,
      runId,
      toolCalls: result.toolCalls,
      rounds: result.rounds,
      durationMs: Date.now() - t0,
      termination: result.termination,
      usage: result.usage,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    runtimeSetPhase("failed");
    store.commandEnd("litt-operator", false, 1, Date.now() - t0, message);
    return {
      content: `Operator error: ${message}`,
      runId,
      toolCalls: [],
      rounds: 0,
      durationMs: Date.now() - t0,
      termination: "error",
      usage: { total_tokens: 0 },
    };
  }
}

/**
 * Check if the canonical operator is available (model provider reachable).
 * Falls back to the legacy `askLiTTCode` path if not.
 */
export async function operatorAvailable(): Promise<boolean> {
  const ping = await health();
  return ping >= 0;
}
