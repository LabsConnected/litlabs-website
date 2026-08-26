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
import { getBillingClient, type AuthorizationDenialCode } from "./billing.js";

// ─── ModelProvider adapter ────────────────────────────────────────

/**
 * Cumulative usage observed across every `stream()` call made during ONE
 * operator turn (an agent run may call the model multiple times across
 * tool-calling rounds). Used for billing — see `runLiTTOperator()`.
 */
export interface OperatorUsageSummary {
  provider: string | null;
  model: string | null;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

/**
 * Wraps the existing `streamLiTTCode` (Ollama → OpenRouter fallback) as
 * a `ModelProvider` that the canonical agent loop can call.
 *
 * This is a transport adapter only — it does NOT make decisions, does
 * NOT call tools, and does NOT touch the RuntimeStore. The agent loop
 * owns the brain; this owns the wire to the LLM API.
 */
class LiTTModelProvider implements ModelProvider {
  // Per-instance accumulators. IMPORTANT: this class is instantiated FRESH
  // per operator turn (see `runLiTTOperator()`) — never shared across
  // concurrent requests — so these fields cannot leak usage between users.
  private _lastProvider: string | null = null;
  private _lastModel: string | null = null;
  private _promptTokens = 0;
  private _completionTokens = 0;
  private _totalTokens = 0;

  getUsageSummary(): OperatorUsageSummary {
    return {
      provider: this._lastProvider,
      model: this._lastModel,
      promptTokens: this._promptTokens,
      completionTokens: this._completionTokens,
      totalTokens: this._totalTokens,
    };
  }

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
          this._lastProvider = e.provider;
          this._lastModel = e.model;
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
          this._lastModel = e.model;
          this._promptTokens += e.usage.prompt_tokens ?? 0;
          this._completionTokens += e.usage.completion_tokens ?? 0;
          this._totalTokens += e.usage.total_tokens ?? 0;
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
  /**
   * True when the operator refused to execute — no model provider was
   * ever invoked. `termination` is "error" in this case for backward
   * compatibility with existing `result.termination !== "error"` checks;
   * `denied`/`denialCode` let callers distinguish "auth/entitlement
   * denial" from "the model call itself failed".
   */
  denied?: boolean;
  denialCode?: AuthorizationDenialCode;
}

// ─── System prompt builder ────────────────────────────────────────

/**
 * Read the current git branch synchronously-ish (capped at 2s).
 * This is a read-only diagnostic probe — the same class as /doctor's
 * git probes. It populates the operator's project context when the
 * RuntimeStore's `state.project` has not been set yet (i.e. /status
 * has not been called).
 */
function readGitBranch(cwd: string): string {
  try {
    const { execFileSync } = require("child_process");
    const branch = execFileSync("git", ["branch", "--show-current"], {
      cwd,
      timeout: 2000,
      stdio: ["ignore", "pipe", "ignore"],
      encoding: "utf8",
    }).trim();
    return branch || "detached";
  } catch {
    return "unknown";
  }
}

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

  // Extract runtime context. If the RuntimeStore's project field hasn't
  // been populated yet (e.g. /status was never called), read the git
  // branch directly so the operator always has concrete project context.
  const branch = state.project?.branch ?? readGitBranch(cwd);
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

/**
 * Run the canonical LiTT operator.
 *
 * This is the ONE brain path. Desktop, CLI remote, Termux, and any
 * other surface that needs natural-language LiTT execution must call
 * this function — not `askLiTTCode` directly.
 *
 * The operator:
 *   1. Generates a canonical runId
 *   2. Authorizes the request (authenticated identity + plan entitlement
 *      + credit balance) — FAILS CLOSED, and the model provider is never
 *      constructed or invoked when authorization is denied
 *   3. Obtains canonical runtime resources (store, gateway, tools, shell)
 *   4. Calls runAgentLoop with those resources
 *   5. Emits lifecycle events through the canonical RuntimeStore
 *   6. On success, debits the caller's LiTTBits balance and records a
 *      usage row (idempotent per runId — a retried completion for the
 *      same runId cannot double-charge)
 *   7. Returns the result with the runId for cross-surface correlation
 *
 * Every surface that calls this function (CLI `--remote`, Studio Web's
 * Socket.IO NL path, Desktop, Termux) is subject to the SAME gate — there
 * is no separate, looser entry point into model execution.
 */
export async function runLiTTOperator(ctx: OperatorContext): Promise<OperatorResult> {
  const t0 = Date.now();
  const runId = `run_op_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const mode = ctx.mode ?? "act";
  // No placeholder identity: a missing/unresolvable userId is treated as
  // unauthenticated and denied below — it is NEVER substituted with a
  // synthetic "terminal-server" identity that could bypass billing.
  const userId = ctx.userId ?? null;

  // ─── Authorization gate — runs BEFORE any runtime/model resource is
  // constructed. Denial here means the OpenRouter/Ollama provider is
  // never instantiated and never called. ─────────────────────────────
  const authz = await getBillingClient().authorize(userId);
  if (!authz.ok) {
    runtimeSetPhase("failed");
    return {
      content: authz.message ?? "Not authorized.",
      runId,
      toolCalls: [],
      rounds: 0,
      durationMs: Date.now() - t0,
      termination: "error",
      usage: { total_tokens: 0 },
      denied: true,
      denialCode: authz.code,
    };
  }
  const identity = authz.identity!;

  const store = getRuntimeStore();
  const gateway = getExecutionGateway(ctx.cwd, mode);
  const tools = getCanonicalToolRegistry(ctx.cwd);
  const shell = getCanonicalShell(ctx.cwd);
  // Fresh per-run instance — accumulates usage for THIS turn only, never
  // shared across concurrent requests (see LiTTModelProvider above).
  const model = new LiTTModelProvider();

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

    // ─── Usage recording + debit — success only. A provider failure
    // (thrown below, in the catch block) never reaches this line, so
    // failed calls are never billed. ──────────────────────────────────
    if (success) {
      const usageSummary = model.getUsageSummary();
      // Ollama is terminal-server's own self-hosted fallback — zero
      // marginal provider cost, so it is never charged. Only OpenRouter
      // calls (the only provider that carries a real provider cost) are
      // billed.
      if (usageSummary.provider === "openrouter") {
        await getBillingClient().recordUsage({
          identity,
          runId,
          provider: usageSummary.provider,
          model: usageSummary.model ?? "unknown",
          promptTokens: usageSummary.promptTokens,
          completionTokens: usageSummary.completionTokens,
          totalTokens: usageSummary.totalTokens || result.usage.total_tokens,
        });
      }
    }

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
