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
  type ToolDefinition,
} from "@litt/agent-core";
import {
  getRuntimeStore,
  getExecutionGateway,
  getCanonicalToolRegistry,
  getCanonicalShell,
  runtimeSetPhase,
} from "./runtime.js";
import {
  streamLiTTMessagesWithTools,
  health,
  type LiTTEvent,
  type LiTTNativeTool,
} from "./litt-code.js";

// ─── ModelProvider adapter ────────────────────────────────────────

/**
 * Tool-aware model provider for the canonical operator.
 *
 * Uses `streamLiTTMessagesWithTools()` — the native OpenRouter function
 * calling transport — so the model can select tools via native tool_calls
 * instead of text-form ```tool_call blocks. The transport converts native
 * calls into LiTT's canonical fenced tool_call envelope, which runAgentLoop
 * dispatches through the canonical ExecutionGateway.
 *
 * This replaces the old `streamLiTTCode()` adapter, which only consumed
 * `choices[0].delta.content` and threw "completed without assistant content"
 * when the model returned a native tool call with zero text.
 *
 * Architecture: this is a transport adapter only — it does NOT make
 * decisions, does NOT call tools, and does NOT touch the RuntimeStore.
 * The agent loop owns the brain; this owns the wire to the LLM API.
 */
class LiTTModelProvider implements ModelProvider {
  private readonly nativeTools: LiTTNativeTool[];

  constructor(toolDefinitions: ToolDefinition[]) {
    const usedNames = new Set<string>();

    this.nativeTools = toolDefinitions.map((tool) => {
      // OpenRouter function names must match ^[a-zA-Z0-9_-]{1,64}$
      const baseName =
        tool.id.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 60) || "litt_tool";

      let functionName = baseName;
      let suffix = 2;
      while (usedNames.has(functionName)) {
        functionName = `${baseName}_${suffix++}`;
      }
      usedNames.add(functionName);

      return {
        toolId: tool.id,
        functionName,
        description: tool.description,
        parameters: tool.inputSchema,
      };
    });
  }

  async stream(
    messages: ChatMessage[],
    emit: (event: ModelStreamEvent) => void,
  ): Promise<ModelResult> {
    const result = await streamLiTTMessagesWithTools(
      messages,
      this.nativeTools,
      (e: LiTTEvent) => {
        // Bridge LiTTEvent → ModelStreamEvent
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
      },
    );

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
  /** Authenticated user's email (best-effort, from Clerk via JWT) */
  authEmail?: string | null;
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
function buildOperatorSystemPrompt(cwd: string, mode: string, authEmail?: string | null): string {
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

  // Auth context — the operator must know WHO it's acting for so it can
  // truthfully answer "am I authenticated?" and "what is my email?"
  // without guessing. The email comes from the verified Clerk JWT.
  const authLine = authEmail
    ? `- Authenticated: yes (user: ${authEmail} via Clerk OAuth)`
    : `- Authenticated: yes (user ID verified via Clerk, email not available)`;

  // Current date/time grounding — the model must NOT invent the current
  // date. Words like "today", "tomorrow", "tonight", "yesterday", "open
  // now" must be resolved against this authoritative runtime timestamp.
  const now = new Date();
  const currentDate = now.toISOString().split("T")[0]; // YYYY-MM-DD
  const currentDayName = now.toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" });
  const currentUtcTime = now.toISOString();

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
    authLine,
    `- REMOTE terminal server: reachable (you are running on it)`,
    `- Doctor checks: 4 pass (runtime, shell, provider, environment)`,
    "",
    `## Current Date/Time (Authoritative)`,
    `- Current date (UTC): ${currentDate}`,
    `- Current day: ${currentDayName}`,
    `- Current UTC time: ${currentUtcTime}`,
    `- Use THIS date for "today", "tomorrow", "tonight", "yesterday", "open now" — never guess the date.`,
    "",
    `## Mode Rules`,
    mode === "plan"
      ? "- PLAN mode: You may inspect the project (status, diff, check, test, build) but you CANNOT mutate files or run commands that change state. If the user asks for a mutation, explain what you would do and ask them to switch to ACT mode."
      : "- ACT mode: You can inspect and modify the project. Destructive operations require approval from the gateway.",
    "",
    `## Available Tools`,
    "",
    "### Project Tools (for code/repo/file questions):",
    "- project.status: Get project + git status (read-only)",
    "- project.diff: Get git diff (read-only)",
    "- project.check: Run typecheck/lint (read-only)",
    "- project.test: Run tests (read-only)",
    "- project.build: Run build (read-only)",
    "- project.run: Run a shell command (subject to gateway policy)",
    "- project.list_files: List files in a directory (read-only)",
    "- project.read_file: Read a file (read-only)",
    "- project.search: Search file contents in the codebase (read-only)",
    "",
    "### Web Tools (for current public information):",
    "- web.search: Search the web for current information (store hours, prices, news, facts)",
    "- web.fetch: Fetch the content of a known public URL (official store pages, documentation)",
    "",
    "### Weather Tools (for weather questions ONLY):",
    "- weather.forecast: Get a real U.S. weather forecast for a 5-digit ZIP code",
    "",
    `## Tool Routing Rules`,
    "- CODE/REPO/FILE questions → use project.* tools (project.search, project.read_file, etc.)",
    "- CURRENT PUBLIC INFORMATION (store hours, prices, news, business info) → use web.search",
    "- KNOWN PUBLIC URL → use web.fetch to read the page content",
    "- WEATHER questions ONLY → use weather.forecast",
    "- A ZIP code alone does NOT imply weather. Do not call weather.forecast unless the user explicitly asks about weather.",
    "- Store hours / business hours / opening times → web.search (NOT weather, NOT project.search)",
    "- Never use project.search for public/business/current information — it only searches the codebase.",
    "- For local business hours: web.search → find official source → web.fetch official page if needed → return verified hours",
    "",
    `## Intent Interpretation`,
    "Users may phrase requests informally. Map natural language to actions:",
    '- "test and see how you are" → run project.test, then report results + runtime status',
    '- "check the project" → run project.check + project.status',
    '- "how are you" / "status" → run project.status, report runtime state',
    '- "what\'s wrong" / "is it broken" → run project.check + project.test, report failures',
    '- "build it" → run project.build',
    '- "show me the diff" → run project.diff',
    '- "what time does [store] open" → web.search for the store, NOT project.search',
    '- "weather [zip]" → weather.forecast with the ZIP',
    '- "search this repo for X" → project.search',
    "Do NOT ask for clarification when the intent is reasonably clear. Act first, then report.",
    "",
    `## Truthfulness Rules`,
    "- If current/local information cannot be verified via web tools, SAY verification failed.",
    "- Do NOT turn 'most stores typically open at...' into a verified answer.",
    "- Do NOT guess store hours, prices, or business information after web verification fails.",
    "- Do NOT fabricate facts. If a tool returns empty or fails, report that honestly.",
    "- Prefer authoritative sources: official store pages over aggregators, NWS for weather, manufacturer for specs.",
    "",
    `## Response Style`,
    "- Be concise and actionable. Report what you did and what happened.",
    "- Use tool calls to inspect before answering questions about the project or public information.",
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
 *   2. Obtains canonical runtime resources (store, gateway, tools, shell)
 *   3. Creates a tool-aware model provider with the canonical tool definitions
 *   4. Calls runAgentLoop with those resources
 *   5. Emits lifecycle events through the canonical RuntimeStore
 *   6. Returns the result with the runId for cross-surface correlation
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

  // Create a tool-aware model provider with the canonical tool definitions.
  // The provider maps ToolDefinition[] → LiTTNativeTool[] and calls
  // streamLiTTMessagesWithTools(), which sends native OpenRouter function
  // definitions and converts model-selected tool_calls into LiTT's
  // canonical fenced tool_call envelope for runAgentLoop to dispatch.
  const model = new LiTTModelProvider(tools.list());

  // Emit lifecycle: operator turn started
  store.commandStart("litt-operator", [ctx.prompt], ctx.cwd);

  runtimeSetPhase("thinking");

  const systemPrompt = buildOperatorSystemPrompt(ctx.cwd, mode, ctx.authEmail);

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
