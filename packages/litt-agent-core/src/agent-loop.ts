/**
 * Agent loop — the canonical LiTT agent execution path.
 *
 *   Agent Loop
 *      ↓
 *   ToolRegistry.execute()  ←  shared ShellExecutor
 *      ↓
 *   ToolHandler (project.check, project.build, etc.)
 *      ↓
 *   ShellExecutor  ←  same instance as CommandExecutor
 *      ↓
 *   RuntimeStore  ←  shared lifecycle events
 *
 * No second executor. No direct shell calls. No special "agent-only"
 * execution path. Every tool call routes through the same ToolRegistry
 * and ShellExecutor that the CLI cockpit, Studio, and voice surfaces use.
 *
 * For direct shell commands (the "project.run" tool), the tool handler
 * calls runCommand() which goes through the same security boundary as
 * the CommandExecutor.
 *
 * The agent loop:
 *   1. Builds a system prompt with available tool definitions
 *   2. Calls the ModelProvider with the conversation + tool definitions
 *   3. If the model returns a tool call:
 *      a. Dispatch it through ToolRegistry.execute()
 *      b. Emit lifecycle events (agent_tool_call, agent_tool_result)
 *      c. Append the tool result to the conversation
 *      d. Go back to step 2
 *   4. If the model returns a final answer, return it
 *   5. Respect maxRounds to prevent infinite loops
 */

import type {
  ChatMessage,
  ModelProvider,
  ModelResult,
  ModelStreamEvent,
  ToolDefinition,
  ToolResult,
  RuntimeEvent,
  RuntimeEventEmitter,
  ShellExecutor,
  ToolEntry,
  ProjectContext,
} from "./types.js";
import type { ToolRegistry } from "./tools.js";
import type { RuntimeStore } from "./state.js";
import type { CommandExecutor } from "./command-executor.js";
import type { ExecutionGateway } from "./execution-gateway.js";
import type { VerificationResult } from "./verification-gate.js";

// ─── Types ─────────────────────────────────────────────────────────

export interface AgentLoopOptions {
  /** The model provider to use for inference */
  model: ModelProvider;
  /** The tool registry — defines which tools the agent can call */
  tools: ToolRegistry;
  /** The shared ShellExecutor — same instance as CommandExecutor */
  shell: ShellExecutor;
  /** The shared RuntimeStore — same instance as CommandExecutor */
  store?: RuntimeStore | null;
  /**
   * The ExecutionGateway — the ONE canonical execution authority.
   * If provided, ALL tool calls route through the gateway, which enforces:
   *   - Identity verification
   *   - Grant verification
   *   - Policy decision (PLAN/ACT/AUTO mode + capability classification)
   *   - Approval enforcement
   *   - Credential lease
   *
   * Architecture when provided (CANONICAL):
   *   runAgentLoop → ExecutionGateway → CommandExecutor → runCommand() → ShellExecutor
   *   runAgentLoop → ExecutionGateway → ToolRegistry → ToolHandler → ShellExecutor
   *
   * Architecture when NOT provided (TEST ONLY — never production):
   *   runAgentLoop → ToolRegistry.execute() → ToolHandler → ShellExecutor
   *   (bypasses ALL security — only for unit tests with mock tools)
   */
  gateway?: ExecutionGateway | null;
  /** @deprecated Use gateway instead. Kept for backward compatibility. */
  executor?: CommandExecutor | null;
  /**
   * Prior conversation turns, replayed between the system prompt and
   * `prompt` so a follow-up is understood in context.
   *
   * Each runAgentLoop call is otherwise a fresh, context-free
   * conversation: the model sees only the system prompt and the current
   * `prompt`. That makes a follow-up like "49456" (answering an earlier
   * "what city or ZIP?") arrive in isolation, with the question that
   * prompted it gone.
   *
   * Contract:
   *   - Only "user" and "assistant" roles are replayed. A caller-supplied
   *     "system" message is dropped — the system prompt is built here and
   *     is the only system message in the conversation.
   *   - Empty/whitespace-only content is dropped (a still-streaming turn
   *     is not a settled one).
   *   - Order is preserved exactly as given — it IS the conversation.
   *   - A trailing "user" message identical to `prompt` is dropped, so a
   *     caller that appends the current turn to its own transcript before
   *     calling does not send that turn twice.
   * Nothing else is reordered, merged, or summarized.
   */
  priorMessages?: ChatMessage[];
  /** System prompt (prepended to the conversation) */
  systemPrompt?: string;
  /** Project context to embed in the default system prompt (prevents model hallucination) */
  projectContext?: ProjectContext | null;
  /** Working directory for tool execution */
  cwd: string;
  /** User ID for tool context */
  userId?: string | null;
  /** Maximum number of tool-call rounds (default: 10) */
  maxRounds?: number;
  /** Optional event emitter for streaming agent events to listeners */
  emitter?: RuntimeEventEmitter;
  /** Optional stream callback for live model output */
  onModelStream?: (event: ModelStreamEvent) => void;
  /** Optional stream callback for live tool output (when using CommandExecutor) */
  onToolStream?: (chunk: { stream: "stdout" | "stderr"; text: string; ts: number }) => void;
  /** Permission mode */
  mode?: "plan" | "act" | "auto";
  /**
   * Optional VerificationGate — the runtime truth boundary.
   *
   * Structural type (see VerificationGateLike): any object with
   * verify(). The concrete VerificationGate class satisfies it, as do
   * surface-level adapters (e.g. the CLI's read-only mission gate).
   *
   * When provided, the loop enforces the single most important rule:
   *   COMPLETE ≠ model says done
   *   COMPLETE = runtime proved it passed
   *
   * When the model returns a final answer (no tool call), the loop runs
   * the gate. If the gate proves the project passes, termination becomes
   * "complete". If the gate fails, the failure is fed back to the model
   * as a repair request — the model must fix the failures and try again.
   * The loop only terminates with "verification_failed" if it runs out
   * of rounds while the gate is still not proven.
   *
   * Without a gate, the loop keeps its original behavior (model "done"
   * = "complete"). This preserves backward compatibility for tests and
   * surfaces that don't yet wire the gate.
   */
  verificationGate?: VerificationGateLike | null;
  /**
   * Optional escalation hook — when provided with missionId + modelResolver,
   * repeated model failures (tool/reasoning) automatically escalate to a
   * stronger model and the loop continues. This is the Autopilot reliability
   * path: a weak model that keeps failing gets replaced mid-mission.
   */
  escalation?: EscalationHook | null;
  /** Mission id for escalation tracking. Required for escalation to activate. */
  missionId?: string;
  /** Model id of the initial `model` provider — used for escalation tracking. */
  modelId?: string;
  /**
   * Resolves a model id to a ModelProvider. Required for escalation to
   * construct the new (stronger) provider mid-loop.
   */
  modelResolver?: ModelResolver | null;
  /** Task kind for escalation model selection (default: "coding"). */
  taskKind?: string;
  /**
   * Optional AbortSignal — when aborted, the loop terminates as
   * "cancelled" at the next round boundary. This is the cancellation
   * path: the caller aborts the signal and the loop stops cleanly.
   */
  abortSignal?: AbortSignal | null;
  /**
   * Maximum total wall-clock duration in milliseconds. When exceeded,
   * the loop terminates as "error" (timeout) at the next round
   * boundary. Prevents a stuck model/tool from hanging the parent
   * process forever. Default: 0 (no total timeout — per-round
   * idle stall is handled by the provider adapter).
   */
  totalTimeoutMs?: number;
}

/**
 * Structural verification-gate contract — the loop only calls verify().
 * The concrete VerificationGate class satisfies this; surfaces may also
 * provide adapters (e.g. read-only evidence gates) without extending it.
 */
export interface VerificationGateLike {
  verify(): Promise<VerificationResult>;
}

export interface AgentLoopResult {
  /** The final text response from the model */
  content: string;
  /** All tool calls made during the loop */
  toolCalls: AgentToolCallRecord[];
  /** Number of rounds executed */
  rounds: number;
  /** Total duration in milliseconds */
  durationMs: number;
  /** Model usage info */
  usage: { total_tokens: number };
  /**
   * Why the loop terminated.
   *   complete:             model gave a final answer AND (no gate configured OR gate proven)
   *   verification_failed:  a gate is configured and it could not be proven before max_rounds
   *   max_rounds:           hit the round limit for reasons other than verification
   *   failed:               a required mutation failed and was not recovered, or a mutation
   *                         was requested but no mutation evidence exists
   *   error:                model call failed
   *   cancelled:            loop was cancelled
   */
  termination: "complete" | "verification_failed" | "max_rounds" | "failed" | "error" | "cancelled";
  /**
   * The canonical verification result, if a gate was configured.
   * `verification.proven === true` is the ONLY honest signal that the
   * mission is COMPLETE. Callers MUST check this, not `termination`,
   * when a gate is in use.
   */
  verification?: VerificationResult;
  /**
   * Escalation events that occurred during this loop run.
   * Each entry records a model swap from a weaker to a stronger model
   * after repeated failures. Present only when escalation was activated.
   */
  escalations?: EscalationRecord[];
}

export interface AgentToolCallRecord {
  toolCallId: string;
  toolId: string;
  toolName: string;
  inputs: Record<string, unknown>;
  result: ToolResult;
  durationMs: number;
}

// ─── Escalation ────────────────────────────────────────────────────

/**
 * Failure kind classification — mirrors @litt/models classifyFailure.
 * Kept local so agent-core stays platform-independent (no litt-models dep).
 */
export type AgentFailureKind = "tool" | "reasoning" | "network" | "rate-limit" | "auth" | "content" | "unknown";

/**
 * Classify a raw error into a failure kind. Used to decide whether to
 * escalate (tool/reasoning failures) vs fallback (network/rate-limit).
 */
export function classifyAgentFailure(error: unknown): AgentFailureKind {
  if (!(error instanceof Error)) return "unknown";
  const msg = error.message.toLowerCase();
  if (msg.includes("429") || msg.includes("rate limit")) return "rate-limit";
  if (msg.includes("401") || msg.includes("403") || msg.includes("unauthorized") || msg.includes("forbidden")) return "auth";
  if (msg.includes("500") || msg.includes("502") || msg.includes("503") || msg.includes("network") || msg.includes("econnreset") || msg.includes("timeout")) return "network";
  if (msg.includes("tool") || msg.includes("function call") || msg.includes("invalid arguments")) return "tool";
  if (msg.includes("invalid json") || msg.includes("parse") || msg.includes("malformed")) return "content";
  if (msg.includes("reason") || msg.includes("wrong") || msg.includes("incorrect")) return "reasoning";
  return "unknown";
}

/**
 * Escalation hook — the abstraction the agent loop uses to track
 * per-mission failures and decide when to swap to a stronger model.
 *
 * The real implementation is @litt/models EscalationTracker. The
 * controller adapts it to this interface. agent-core stays pure
 * (no litt-models dependency).
 */
export interface EscalationHook {
  startMission(missionId: string, modelId: string): void;
  recordFailure(missionId: string, kind: AgentFailureKind, message?: string): void;
  recordSuccess(missionId: string): void;
  shouldEscalate(missionId: string): boolean;
  pickEscalatedModel(missionId: string, taskKind: string): { modelId: string; reason: string } | null;
  commitEscalation(missionId: string, toModelId: string, reason: string, runId?: string): { fromModelId: string; toModelId: string; reason: string; at: string } | null;
  currentModel(missionId: string): string | null;
  endMission(missionId: string): void;
}

/**
 * Resolves a model id to a ModelProvider — needed for escalation to
 * construct the new (stronger) provider mid-loop.
 */
export type ModelResolver = (modelId: string) => ModelProvider | null;

/**
 * Record of an escalation that occurred during a loop run.
 */
export interface EscalationRecord {
  fromModelId: string;
  toModelId: string;
  reason: string;
  at: string;
}

// ─── Tool call parsing ─────────────────────────────────────────────

/**
 * Parse a model response for tool calls.
 *
 * Uses a structured-output format that works with any model provider:
 *
 *   ```tool_call
 *   { "tool": "project.status", "inputs": {} }
 *   ```
 *
 * The parser is deliberately tolerant of real-world model output:
 *   - CRLF line endings (`\r\n`)
 *   - whitespace after the ```tool_call opener (or none at all)
 *   - a missing newline before the closing fence (```tool_call{...}```)
 *   - a bare JSON tool object on its own line (no fences):
 *       tool_call
 *       { "tool": "project.status", "inputs": {} }
 *   - an inline `tool_call:` prefix before the JSON object
 */
export interface ParsedToolCall {
  toolId: string;
  inputs: Record<string, unknown>;
}

/** Fenced ```tool_call block — tolerant of spacing/CRLF and a missing
 *  newline before the closing fence. */
const TOOL_CALL_FENCE_RE = /```tool_call[ \t]*\r?\n?([\s\S]*?)```/i;
/** Fenced ```json block — models (especially local/Ollama) sometimes
 *  emit tool calls inside a ```json fence instead of ```tool_call.
 *  We only parse the CONTENT of such blocks, never blindly execute
 *  arbitrary JSON — the content must parse as a valid tool call. */
const JSON_FENCE_RE = /```json[ \t]*\r?\n?([\s\S]*?)```/i;
/** A line that looks like a bare JSON tool object (single line).
 *  Matches both the canonical LiTT format (`"tool":`) and the
 *  OpenAI/Anthropic native format (`"name":` with a dotted tool-like
 *  value, e.g. `"project.read_file"`). The `"name":` branch is gated
 *  by a dotted-value pattern so ordinary JSON with a `"name"` key
 *  (e.g. `{"name": "Alice"}`) is NOT mistaken for a tool call. */
const BARE_TOOL_JSON_RE = /^[ \t]*\{[^\n]*?("(tool"[ \t]*:|"name"[ \t]*:[ \t]*"[a-z][a-z0-9_-]*\.[a-z][a-z0-9_-]*"))/m;

/**
 * Check whether a string looks like a plausible LiTT tool ID.
 * LiTT canonical IDs are dotted (project.read_file, web.fetch, etc.).
 * The sanitized OpenAI form uses underscores (project_read_file).
 * Non-dotted, non-sanitized values are rejected so illustrative JSON
 * with a generic `"name"` key is not mistaken for a tool call.
 */
function isPlausibleToolId(id: string): boolean {
  if (typeof id !== "string" || id.length === 0) return false;
  // Canonical dotted form: project.read_file, web.fetch, weather.forecast
  if (/^[a-z][a-z0-9_-]*\.[a-z][a-z0-9_-]*$/i.test(id)) return true;
  // Sanitized form: project_read_file (dots replaced with underscores)
  if (/^[a-z][a-z0-9_]+_[a-z][a-z0-9_]+$/i.test(id)) return true;
  return false;
}

function parseToolJson(raw: string): ParsedToolCall | null {
  try {
    const parsed = JSON.parse(raw.trim());
    if (parsed && typeof parsed === "object") {
      // Canonical LiTT format: { "tool": "...", "inputs": {...} }
      const tool = (parsed as { tool?: unknown }).tool;
      if (typeof tool === "string") {
        const inputs = (parsed as { inputs?: unknown }).inputs;
        return {
          toolId: tool,
          inputs: typeof inputs === "object" && inputs !== null
            ? inputs as Record<string, unknown>
            : {},
        };
      }
      // OpenAI/Anthropic native format emitted as text:
      //   { "name": "project.read_file", "arguments": {...} }
      // Validate the name looks like a tool ID so illustrative JSON
      // with a generic "name" key is not mistaken for a tool call.
      const name = (parsed as { name?: unknown }).name;
      if (typeof name === "string" && isPlausibleToolId(name)) {
        const args = (parsed as { arguments?: unknown }).arguments;
        return {
          toolId: name,
          inputs: typeof args === "object" && args !== null
            ? args as Record<string, unknown>
            : {},
        };
      }
    }
  } catch {
    // Malformed JSON — not a valid tool call
  }
  return null;
}

/**
 * Extract a balanced brace span starting at the given `{` index.
 * Returns null when the braces never balance (malformed object).
 */
function balancedJsonSpan(content: string, openIdx: number): string | null {
  let depth = 0;
  for (let i = openIdx; i < content.length; i++) {
    const ch = content[i];
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return content.slice(openIdx, i + 1);
    }
  }
  return null;
}

/**
 * Check whether a balanced JSON span looks like a tool call — either the
 * canonical LiTT format (`"tool":`) or the OpenAI/Anthropic native format
 * (`"name":` with a dotted tool-like value). Used by the "anywhere" scan
 * so both formats are recognized mid-prose while ordinary JSON with a
 * `"name"` key is NOT mistaken for a tool call.
 */
function spanLooksLikeToolCall(span: string): boolean {
  // Canonical format: { "tool": "..." }
  if (/"tool"[ \t]*:/.test(span)) return true;
  // Native format: { "name": "project.read_file", ... } — the value must
  // look like a dotted tool ID so generic JSON is not matched.
  const nameMatch = span.match(/"name"[ \t]*:[ \t]*"([^"]+)"/);
  if (nameMatch && isPlausibleToolId(nameMatch[1])) return true;
  return false;
}

export function parseToolCall(content: string): ParsedToolCall | null {
  // 1. Fenced ```tool_call ... ``` block.
  const match = content.match(TOOL_CALL_FENCE_RE);
  if (match) {
    const parsed = parseToolJson(match[1]);
    if (parsed) return parsed;
  }

  // 1b. Fenced ```json ... ``` block containing a tool call.
  // Models (especially local/Ollama) sometimes emit tool calls inside
  // a ```json fence instead of ```tool_call. We only parse the content
  // if it actually looks like a tool call — never blindly execute
  // arbitrary JSON.
  const jsonMatch = content.match(JSON_FENCE_RE);
  if (jsonMatch) {
    const parsed = parseToolJson(jsonMatch[1]);
    if (parsed) return parsed;
  }

  // 2. Bare JSON tool object on its own line (the model sometimes skips
  //    the fences entirely, e.g. `tool_call` then a JSON line).
  const bareMatch = content.match(BARE_TOOL_JSON_RE);
  if (bareMatch && bareMatch.index !== undefined) {
    // Snip the JSON object out of the surrounding text and try to parse it.
    const lineStart = content.lastIndexOf("\n", bareMatch.index) + 1;
    const jsonText = content.slice(lineStart).split("\n")[0] ?? "";
    const parsed = parseToolJson(jsonText);
    if (parsed) return parsed;
  }

  // 3. Bare JSON tool object ANYWHERE (mid-prose, no newline before it).
  //    A missed tool call is worse than a missed answer: the model keeps
  //    re-claiming failure and the tool result never reaches the next
  //    turn (the observed "unable to access the tool" → tool succeeded
  //    contradiction). Scan every brace-balanced span that looks like a
  //    tool call (either format) and try to parse it.
  for (let idx = 0; idx < content.length; idx++) {
    if (content[idx] !== "{") continue;
    const span = balancedJsonSpan(content, idx);
    if (!span || !spanLooksLikeToolCall(span)) continue;
    const parsed = parseToolJson(span);
    if (parsed) return parsed;
  }

  return null;
}

/**
 * Parse ALL tool calls from a model response (multi-tool support).
 *
 * Extracts every fenced ```tool_call block AND every bare JSON tool
 * object from the content, returning them in document order. This
 * enables parallel execution of independent read-only tools in a
 * single model turn, reducing round-trips for compound queries like
 * "what framework and branch is this".
 *
 * Returns an empty array if no tool calls are found. The first element
 * is always the same call that `parseToolCall` would return (backward
 * compatibility), but callers using `parseToolCalls` get ALL calls.
 *
 * Deduplication: identical tool calls (same toolId + same inputs) are
 * deduplicated to prevent the model from accidentally double-executing
 * the same tool. The first occurrence wins.
 */
export function parseToolCalls(content: string): ParsedToolCall[] {
  const calls: ParsedToolCall[] = [];
  const seen = new Set<string>();

  const add = (parsed: ParsedToolCall | null) => {
    if (!parsed) return;
    const key = `${parsed.toolId}::${JSON.stringify(parsed.inputs)}`;
    if (seen.has(key)) return;
    seen.add(key);
    calls.push(parsed);
  };

  // 1. ALL fenced ```tool_call ... ``` blocks (global regex).
  const fenceRe = /```tool_call[ \t]*\r?\n?([\s\S]*?)```/gi;
  let m: RegExpExecArray | null;
  while ((m = fenceRe.exec(content)) !== null) {
    add(parseToolJson(m[1]));
  }

  // 1b. ALL fenced ```json ... ``` blocks containing tool calls.
  // Models (especially local/Ollama) sometimes emit tool calls inside
  // ```json fences. A ```json block may contain a single tool call
  // or multiple tool calls (one per line). We parse each JSON object
  // inside the block and only keep the ones that are valid tool calls.
  const jsonFenceRe = /```json[ \t]*\r?\n?([\s\S]*?)```/gi;
  let jm: RegExpExecArray | null;
  while ((jm = jsonFenceRe.exec(content)) !== null) {
    const blockContent = jm[1];
    // Try parsing the whole block as a single tool call first.
    const single = parseToolJson(blockContent);
    if (single) {
      add(single);
      continue;
    }
    // Try parsing each line as a separate tool call (multi-tool block).
    for (const line of blockContent.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("{")) continue;
      add(parseToolJson(trimmed));
    }
  }

  // 2. ALL bare JSON tool objects on their own lines.
  const bareRe = /^[ \t]*\{[^\n]*?("(tool"[ \t]*:|"name"[ \t]*:[ \t]*"[a-z][a-z0-9_-]*\.[a-z][a-z0-9_-]*"))/gm;
  let bm: RegExpExecArray | null;
  while ((bm = bareRe.exec(content)) !== null) {
    const lineStart = content.lastIndexOf("\n", bm.index) + 1;
    const jsonText = content.slice(lineStart).split("\n")[0] ?? "";
    add(parseToolJson(jsonText));
  }

  // 3. ALL bare JSON tool objects anywhere (mid-prose).
  for (let idx = 0; idx < content.length; idx++) {
    if (content[idx] !== "{") continue;
    const span = balancedJsonSpan(content, idx);
    if (!span || !spanLooksLikeToolCall(span)) continue;
    add(parseToolJson(span));
  }

  return calls;
}

/**
 * Extract the text content without the tool_call blocks.
 * Uses the same tolerant matching as parseToolCall so a block that was
 * parsed as a tool call is always stripped from the final response text
 * (never leaked into the user chat). Strips both fenced blocks AND bare
 * JSON tool objects anywhere in the text.
 */
export function stripToolCallBlocks(content: string): string {
  // Strip fenced tool_call blocks (with closing fence).
  let stripped = content.replace(/```tool_call[ \t]*\r?\n?[\s\S]*?```/gi, "");
  // Also strip UNCLOSED tool_call fences — smaller/free models sometimes
  // emit ` ```tool_call ` without a closing fence because they don't
  // properly support function calling. Without this, the raw fence
  // text leaks into the user-facing chat.
  stripped = stripped.replace(/```tool_call[ \t]*\r?\n?[\s\S]*$/gi, "");
  // Strip ```json fences that contain tool calls. Only strip if the
  // content inside the fence parses as a tool call — do NOT strip
  // ```json blocks that are illustrative examples.
  stripped = stripped.replace(/```json[ \t]*\r?\n?([\s\S]*?)```/gi, (match, inner) => {
    if (parseToolJson(inner.trim())) return "";
    // Check if any line inside is a tool call
    for (const line of inner.split("\n")) {
      if (parseToolJson(line.trim())) return "";
    }
    return match;
  });
  // Strip bare JSON tool objects (fenced handling above; this covers
  // unfenced `{ "tool": ... }` and `{ "name": "project.xxx", ... }`
  // objects that models emit without fences, even when split from the
  // surrounding prose by a newline or not).
  for (let guard = 0; guard < 8; guard++) {
    let removed = false;
    for (let idx = 0; idx < stripped.length; idx++) {
      if (stripped[idx] !== "{") continue;
      const span = balancedJsonSpan(stripped, idx);
      if (!span || !spanLooksLikeToolCall(span)) continue;
      stripped = stripped.slice(0, idx) + stripped.slice(idx + span.length);
      removed = true;
      break;
    }
    if (!removed) break;
  }
  return stripped.trim();
}

// ─── Tool argument validation ──────────────────────────────────────

/**
 * Placeholder patterns that indicate an argument value is an unresolved
 * template rather than a real value the model intended to use. These are
 * NEVER valid tool inputs — they mean the model copied a schema example
 * verbatim instead of filling it in.
 */
const PLACEHOLDER_RE = /^[A-Z_][A-Z0-9_]*(\.[A-Z_][A-Z0-9_]*)*$/;

/**
 * Validate a parsed tool call's arguments before dispatch. Returns an
 * error message string when the arguments are invalid (placeholders,
 * missing required fields, malformed values), or null when valid.
 *
 * This is a PRE-DISPATCH gate: invalid arguments are rejected BEFORE the
 * tool runs, so no placeholder invocation ever executes.
 */
export function validateToolCallArgs(
  toolId: string,
  inputs: Record<string, unknown>,
  toolDefs: ToolDefinition[],
): string | null {
  const def = toolDefs.find((t) => t.id === toolId);
  if (!def) return null; // unknown tool — handled separately

  const props = (def.inputSchema?.properties ?? {}) as Record<string, { type?: string }>;
  const required = (def.inputSchema?.required ?? []) as string[];

  // Check required fields are present and non-empty.
  for (const field of required) {
    const val = inputs[field];
    if (val === undefined || val === null) {
      return `Missing required argument: ${field}`;
    }
    if (typeof val === "string" && val.trim() === "") {
      return `Required argument "${field}" is empty`;
    }
  }

  // Check string arguments are not placeholders.
  for (const [key, val] of Object.entries(inputs)) {
    if (typeof val === "string") {
      const trimmed = val.trim();
      // Placeholder template like URL_OF_DOCUMENTATION, FILE_PATH, etc.
      if (PLACEHOLDER_RE.test(trimmed)) {
        return `Argument "${key}" is an unresolved placeholder: "${trimmed}". Provide a real value.`;
      }
      // Angle-bracket template like <path>, <command>
      if (/^<[a-z_]+>$/i.test(trimmed)) {
        return `Argument "${key}" is an unresolved template: "${trimmed}". Provide a real value.`;
      }
    }
  }

  return null;
}

// ─── Mission Planning ──────────────────────────────────────────────

// ─── Agent Loop ────────────────────────────────────────────────────

/**
 * Normalize caller-supplied prior turns into replayable conversation
 * messages. See AgentLoopOptions.priorMessages for the contract.
 *
 * Exported for tests — the ordering/filtering rules are the whole
 * behavior, so they are asserted directly rather than only through a
 * full loop run.
 */
export function sanitizePriorMessages(
  prior: ChatMessage[] | undefined | null,
  prompt?: string,
): ChatMessage[] {
  if (!prior || prior.length === 0) return [];
  const kept = prior.filter(
    (m) =>
      m
      && (m.role === "user" || m.role === "assistant")
      && typeof m.content === "string"
      && m.content.trim().length > 0,
  );
  // Drop a trailing user turn identical to the current prompt: callers
  // that render the user message into their own transcript before
  // calling would otherwise send this turn twice.
  const last = kept[kept.length - 1];
  if (prompt !== undefined && last && last.role === "user" && last.content === prompt) {
    return kept.slice(0, -1).map((m) => ({ role: m.role, content: m.content }));
  }
  return kept.map((m) => ({ role: m.role, content: m.content }));
}

/**
 * The canonical read-only repository-inspection capability.
 *
 * When a request requires repository evidence and the model has not
 * produced any, the runtime executes THIS tool itself rather than
 * spending rounds asking the model to choose it. It is the same tool id
 * the model would call, dispatched through the same gateway, emitting
 * the same lifecycle events — there is no second evidence path.
 */
export const PROJECT_EVIDENCE_TOOL_ID = "project.status";

/**
 * Run the agent loop.
 *
 * The loop calls the model, parses tool calls, dispatches them through
 * the shared ToolRegistry (which uses the same ShellExecutor as the
 * CommandExecutor), and returns the final response.
 */
export async function runAgentLoop(
  prompt: string,
  options: AgentLoopOptions,
): Promise<AgentLoopResult> {
  const startTime = Date.now();
  const maxRounds = options.maxRounds ?? 10;
  const toolCalls: AgentToolCallRecord[] = [];
  let rounds = 0;
  let totalTokens = 0;
  // Last verification result from the gate (if configured). Returned in
  // the result so callers can inspect why COMPLETE was not proven.
  let lastVerification: VerificationResult | undefined;

  // Build the system prompt with tool definitions
  const toolDefs = options.tools.list();
  const systemPrompt = options.systemPrompt ?? buildDefaultSystemPrompt(toolDefs, options.projectContext ?? null);

  // Build the conversation: system prompt, prior turns (context), then
  // the current prompt. See AgentLoopOptions.priorMessages.
  const messages: ChatMessage[] = [
    { role: "system", content: systemPrompt },
    ...sanitizePriorMessages(options.priorMessages, prompt),
    { role: "user", content: prompt },
  ];

  let termination: AgentLoopResult["termination"] = "complete";

  // ─── Escalation setup ──────────────────────────────────────────
  // When an escalation hook + missionId + modelResolver are provided,
  // repeated model failures (tool/reasoning) automatically swap to a
  // stronger model and the loop continues. This is the Autopilot
  // reliability path: a weak model that keeps failing gets replaced
  // mid-mission, preserving the same conversation/context.
  const missionId = options.missionId;
  const escalation = options.escalation;
  const taskKind = options.taskKind ?? "coding";
  let activeModel = options.model;
  let activeModelId = options.modelId ?? "unknown";
  const escalationEvents: EscalationRecord[] = [];

  if (missionId && escalation) {
    if (escalation.currentModel(missionId) === null) {
      escalation.startMission(missionId, activeModelId);
    } else {
      activeModelId = escalation.currentModel(missionId)!;
    }
  }

  /**
   * Check if the mission should escalate, and if so, swap to a stronger
   * model. Returns true if escalation happened (caller should continue
   * the loop with the new model), false otherwise.
   */
  function tryEscalate(): boolean {
    if (!missionId || !escalation) return false;
    if (!escalation.shouldEscalate(missionId)) return false;
    const pick = escalation.pickEscalatedModel(missionId, taskKind);
    if (!pick) return false;
    if (!options.modelResolver) return false;
    const newModel = options.modelResolver(pick.modelId);
    if (!newModel) return false;
    const fromId = activeModelId;
    const event = escalation.commitEscalation(missionId, pick.modelId, pick.reason);
    if (event) {
      escalationEvents.push({
        fromModelId: event.fromModelId,
        toModelId: event.toModelId,
        reason: event.reason,
        at: event.at,
      });
    } else {
      escalationEvents.push({
        fromModelId: fromId,
        toModelId: pick.modelId,
        reason: pick.reason,
        at: new Date().toISOString(),
      });
    }
    activeModel = newModel;
    activeModelId = pick.modelId;
    if (options.emitter) {
      options.emitter({
        type: "litt_event",
        subtype: "model_escalated",
        ts: Date.now(),
        data: { fromModelId: fromId, toModelId: pick.modelId, reason: pick.reason, missionId },
      });
    }
    return true;
  }

  // ─── The ONE tool dispatch path ─────────────────────────────────
  // Shared by model-selected tool calls and by the runtime's own
  // deterministic evidence acquisition. Both emit the same
  // agent_tool_call / agent_tool_result pair, both route through the
  // ExecutionGateway when one is configured, and both land in
  // `toolCalls`. Nothing downstream — the controller's
  // MissionEvidenceTracker, the mission's evidence types, the
  // VerificationGate — can tell the two apart, and nothing should:
  // provenance is identical because the execution is identical.

  /** Execute one tool call. Returns the raw outcome; recording is separate. */
  const dispatchToolCall = async (
    parsed: ParsedToolCall,
    entry: ToolEntry,
  ): Promise<{ toolCallId: string; result: ToolResult; durationMs: number }> => {
    const tcId = `tc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const t0 = Date.now();

    // Emit agent_tool_call event
    if (options.emitter) {
      options.emitter({
        type: "litt_event",
        subtype: "agent_tool_call",
        ts: Date.now(),
        toolCallId: tcId,
        data: {
          tool: entry.definition.name,
          toolId: entry.definition.id,
          inputs: parsed.inputs,
        },
      });
    }

    // Track command start in the runtime store
    if (options.store) {
      options.store.commandStart(
        entry.definition.name,
        [],
        options.cwd,
        `agent_${tcId}`,
      );
    }

    let res: ToolResult;
    // ─── Pre-dispatch argument validation ──────────────────────────
    // Reject placeholder/template arguments BEFORE the tool runs. No
    // placeholder invocation should ever execute — the model copied a
    // schema example instead of filling it in.
    const argError = validateToolCallArgs(parsed.toolId, parsed.inputs, toolDefs);
    if (argError) {
      res = {
        status: "failed",
        success: false,
        message: `Tool argument validation failed: ${argError}`,
        data: {},
      };
    } else {
    try {
      if (options.gateway) {
        // ─── CANONICAL path: ExecutionGateway ───
        const gwResult = await options.gateway.execute({
          toolId: parsed.toolId,
          inputs: parsed.inputs,
          cwd: options.cwd,
          mode: options.mode ?? "act",
          identity: {
            tenantId: "agent-tenant",
            userId: options.userId ?? "agent-user",
            actorId: options.userId ?? "agent-user",
            trusted: false, // model-originated execution is untrusted
            interaction: "interactive",
          },
          runId: `agent_${tcId}`,
          toolCallId: tcId,
          onStream: options.onToolStream as ((chunk: { stream: "stdout" | "stderr"; text: string; ts: number }) => void) | undefined,
        });
        res = gwResult.result;
      } else if (options.executor) {
        // ─── Deprecated: direct CommandExecutor (for backward compat) ───
        // For project.run, the actual command and args are in the inputs,
        // not the tool name. Pass them correctly so runCommand() executes
        // the real command (e.g. "git") instead of the tool name ("run").
        let execCommand = entry.definition.name;
        let execArgs = extractArgsFromToolCall(entry.definition.name, parsed.inputs);
        if (entry.definition.id === "project.run") {
          execCommand = typeof parsed.inputs.command === "string" ? parsed.inputs.command : "";
          execArgs = Array.isArray(parsed.inputs.args)
            ? parsed.inputs.args.filter((a): a is string => typeof a === "string")
            : [];
        }
        const cmdResult = await options.executor.execute(
          execCommand,
          execArgs,
          {
            cwd: options.cwd,
            mode: options.mode,
            runId: `agent_${tcId}`,
            toolCallId: tcId,
            commandLabel: execCommand,
            onStream: options.onToolStream,
          },
        );
        res = cmdResult.result;
      } else {
        // ─── TEST ONLY: direct ToolRegistry.execute() (no security) ───
        res = await options.tools.execute(parsed.toolId, {
          cwd: options.cwd,
          projectId: null,
          userId: options.userId ?? null,
          shell: options.shell,
        }, parsed.inputs);
      }
    } catch (err) {
      res = {
        status: "failed",
        success: false,
        message: `Tool execution error: ${err instanceof Error ? err.message : String(err)}`,
        data: {},
      };
    }
    }
    return { toolCallId: tcId, result: res, durationMs: Date.now() - t0 };
  };

  /**
   * Record a dispatched tool's outcome: runtime store, the loop's own
   * `toolCalls` ledger, the agent_tool_result event, and escalation
   * tracking. Separated from dispatch so parallel calls can execute
   * concurrently and still be recorded in deterministic document order.
   */
  const recordToolOutcome = (
    call: ParsedToolCall,
    entry: ToolEntry,
    exec: { toolCallId: string; result: ToolResult; durationMs: number },
  ): AgentToolCallRecord => {
    const { toolCallId, result, durationMs } = exec;

    // Track command end in the runtime store
    if (options.store) {
      options.store.commandEnd(
        entry.definition.name,
        result.success,
        result.data?.exitCode as number | null ?? null,
        durationMs,
        result.message,
        `agent_${toolCallId}`,
      );
    }

    const toolCallRecord: AgentToolCallRecord = {
      toolCallId,
      toolId: entry.definition.id,
      toolName: entry.definition.name,
      inputs: call.inputs,
      result,
      durationMs,
    };
    toolCalls.push(toolCallRecord);

    // Emit agent_tool_result event
    if (options.emitter) {
      options.emitter({
        type: "litt_event",
        subtype: "agent_tool_result",
        ts: Date.now(),
        toolCallId,
        data: {
          tool: entry.definition.name,
          toolId: entry.definition.id,
          status: result.status,
          success: result.success,
          message: result.message,
          durationMs,
        },
      });
    }

    // Escalation: track tool success/failure.
    if (missionId && escalation) {
      if (result.success) {
        escalation.recordSuccess(missionId);
      } else {
        escalation.recordFailure(missionId, "tool", result.message);
        tryEscalate();
      }
    }

    // ─── Mutation tracking ──────────────────────────────────────────
    // Track whether a potentially-mutating tool (project.run) succeeded
    // or failed. This drives the mutation completion requirement: if
    // the user asked for an edit and no mutation succeeded, the run
    // cannot report success.
    if (entry.definition.id === "project.run") {
      if (result.success) {
        mutationSucceeded = true;
      } else {
        mutationFailed = true;
      }
    }

    return toolCallRecord;
  };

  /** Render a tool outcome the way the model already sees tool results. */
  const renderToolResult = (entry: ToolEntry, result: ToolResult): string =>
    `Tool "${entry.definition.name}" returned:\n${JSON.stringify({
      status: result.status,
      message: result.message,
      data: result.data,
    }, null, 2)}`;

  // ─── Deterministic repository-evidence acquisition ──────────────
  // A repository-evidence request must not depend on the model
  // repeatedly CHOOSING to call project.status. When the model has
  // produced no successful evidence, the runtime runs the canonical
  // read-only inspection itself — once — through the dispatch path
  // above. The model then reasons over real evidence instead of being
  // re-prompted until the round limit.
  //
  // This never fabricates: it EXECUTES the tool and reports whatever it
  // truthfully returns. If the tool is not registered, the caller falls
  // back to the pre-existing re-prompt path (still fail-closed).
  let projectEvidenceAttempted = false;
  const acquireProjectEvidence = async (): Promise<AgentToolCallRecord | null> => {
    if (projectEvidenceAttempted) return null;
    projectEvidenceAttempted = true;
    // The model already ran it and it failed — reuse that real failure
    // rather than paying for an identical second run.
    const prior = toolCalls.find((tc) => tc.toolId === PROJECT_EVIDENCE_TOOL_ID);
    if (prior) return prior;
    const entry = options.tools.get(PROJECT_EVIDENCE_TOOL_ID);
    if (!entry) return null;
    const call: ParsedToolCall = { toolId: PROJECT_EVIDENCE_TOOL_ID, inputs: {} };
    const exec = await dispatchToolCall(call, entry);
    return recordToolOutcome(call, entry, exec);
  };

  // ─── Unknown tool bounded retry ──────────────────────────────────
  // Track consecutive unknown-tool errors. After MAX_UNKNOWN_TOOL_RETRIES,
  // the loop terminates as failed rather than looping forever asking the
  // model to retry with a tool it keeps getting wrong.
  const MAX_UNKNOWN_TOOL_RETRIES = 3;
  let unknownToolRetries = 0;

  // ─── Mutation completion tracking ────────────────────────────────
  // When the user explicitly requests an edit/mutation, the run cannot
  // report success unless observable mutation evidence exists. We track
  // whether a mutation was requested and whether any mutation tool
  // succeeded. A clean diff after a mutation request = NON-COMPLETION.
  //
  // The detection requires an explicit file-edit verb paired with a
  // file/code target, so prompts like "fix the typecheck error" (which
  // is a verification request, not a file edit request) do NOT trigger
  // the mutation requirement. Only prompts that clearly ask for a file
  // to be changed/created/edited match.
  const mutationRequested =
    // "edit/change/modify ... file/component/function/module/code/UI"
    /\b(?:edit|change|modify|update|create|write|add|delete|remove|refactor|patch|insert|replace|rename|move)\s+(?:a\s+|the\s+|this\s+|one\s+)?(?:file|component|function|module|code|line|class|interface|type|variable|constant|export|import|UI)\b/i.test(prompt)
    // "make/apply/perform a tiny/small/safe/visible edit/change"
    || /\b(?:make|apply|perform)\s+(?:a\s+|one\s+|the\s+)?(?:tiny\s+|small\s+|safe\s+|visible\s+)?(?:edit|change|modification|update|mutation)\b/i.test(prompt)
    // "edit/change/modify <filename>" — verb followed by a file path
    || /\b(?:edit|change|modify|update|create|write|patch|refactor)\s+\S+\.(?:ts|tsx|js|jsx|json|md|css|html|py|rs|go|java|rb|php|sh|yaml|yml|toml)\b/i.test(prompt)
    // "make a tiny safe visible UI change" — the acceptance test phrasing
    || /\bmake\s+one\s+tiny\s+safe\s+visible\s+UI\s+change\b/i.test(prompt);
  let mutationSucceeded = false;
  let mutationFailed = false;

  for (let round = 0; round < maxRounds; round++) {
    rounds++;

    // ─── Cancellation / timeout guard ──────────────────────────────
    // Check at every round boundary so a stuck model/tool cannot leave
    // the parent process in RUNNING forever. A dead worker/child
    // process transitions to failure rather than remaining RUNNING.
    if (options.abortSignal?.aborted) {
      return {
        content: "Agent cancelled by user.",
        toolCalls,
        rounds,
        durationMs: Date.now() - startTime,
        usage: { total_tokens: totalTokens },
        termination: "cancelled",
        escalations: escalationEvents.length ? escalationEvents : undefined,
      };
    }
    if (options.totalTimeoutMs && options.totalTimeoutMs > 0 && Date.now() - startTime > options.totalTimeoutMs) {
      return {
        content: `Agent timed out after ${options.totalTimeoutMs}ms total. ` +
          `The task was NOT completed. No success is being claimed.`,
        toolCalls,
        rounds,
        durationMs: Date.now() - startTime,
        usage: { total_tokens: totalTokens },
        termination: "error",
        escalations: escalationEvents.length ? escalationEvents : undefined,
      };
    }

    // Call the model
    let modelContent = "";
    const modelEvents: ModelStreamEvent[] = [];
    let modelResult: ModelResult | null = null;

    try {
      modelResult = await activeModel.stream(messages, (event) => {
        modelEvents.push(event);
        if (options.onModelStream) {
          try { options.onModelStream(event); } catch { /* listener errors don't crash the loop */ }
        }
        if (event.type === "delta") {
          modelContent += event.text;
        }
      });
    } catch (err) {
      // Escalation path: record the failure. If the threshold is
      // reached, swap to a stronger model and continue. If below
      // threshold, continue the loop to accumulate more failures
      // (the model will fail again on the next round). The maxRounds
      // limit prevents unbounded retries.
      if (missionId && escalation) {
        escalation.recordFailure(
          missionId,
          classifyAgentFailure(err),
          err instanceof Error ? err.message : String(err),
        );
        if (tryEscalate()) {
          // Escalated to a stronger model — continue with it.
          continue;
        }
        // Below threshold — continue to accumulate failures.
        // Push a retry prompt so the conversation has context.
        messages.push({
          role: "user",
          content:
            `The previous model call failed: ${err instanceof Error ? err.message : String(err)}. ` +
            `Retry now. You MUST either call an available tool or return a final answer.`,
        });
        continue;
      }
      termination = "error";
      return {
        content: `Model error: ${err instanceof Error ? err.message : String(err)}`,
        toolCalls,
        rounds,
        durationMs: Date.now() - startTime,
        usage: { total_tokens: totalTokens },
        termination,
        escalations: escalationEvents.length ? escalationEvents : undefined,
      };
    }

    // Accumulate usage
    const doneEvent = modelEvents.find((e) => e.type === "done");
    if (doneEvent?.type === "done") {
      totalTokens += doneEvent.usage.total_tokens;
    }

    // ─── Adopt the provider's canonical turn ────────────────────────
    // The streamed deltas are a LIVE PREVIEW of model prose; the
    // provider's returned ModelResult.content is the canonical turn.
    // Native `tool_calls` are translated into `tool_call` fence blocks
    // and appended to that returned content ONLY — never emitted as a
    // delta, because the fence is a LiTT-internal construct rather than
    // model prose.
    //
    // So the deltas are missing every native tool call. Adopting the
    // provider content only when the deltas were EMPTY silently
    // discarded the tool call of any model that narrates before calling
    // one ("Let me check the repository status." + tool_call) — the
    // turn then looked like a plain prose answer, and an
    // evidence-required request re-prompted until it hit the round
    // limit. That is the live REMOTE failure this branch prevents.
    //
    // Rule: take the provider content when the deltas carried nothing,
    // or whenever it carries MORE tool calls than the streamed text did.
    // Prose is never lost — the provider content is a superset of the
    // deltas — and a model that literally typed a fence is not
    // double-counted, because that fence is present in both.
    const providerContent = modelResult?.content ?? "";
    if (providerContent.trim()) {
      if (!modelContent.trim()) {
        modelContent = providerContent;
      } else if (
        parseToolCalls(providerContent).length > parseToolCalls(modelContent).length
      ) {
        modelContent = providerContent;
      }
    }

    if (!modelContent.trim()) {
      // Track empty responses as content failures (not counted toward
      // escalation by default, but recorded for audit).
      if (missionId && escalation) {
        escalation.recordFailure(missionId, "content", "empty model response");
      }
      if (round >= maxRounds - 1) {
        return {
          content:
            "LiTT received an empty model response after retrying. " +
            "The turn was not completed and no success is being claimed.",
          toolCalls,
          rounds,
          durationMs: Date.now() - startTime,
          usage: { total_tokens: totalTokens },
          termination: "error",
          escalations: escalationEvents.length ? escalationEvents : undefined,
        };
      }

      messages.push({
        role: "user",
        content:
          "Your previous response was empty. Retry now. " +
          "You MUST either call an available tool using a valid tool_call block " +
          "or return a non-empty final answer. " +
          "If the request requires project evidence, use the project tools yourself.",
      });

      continue;
    }

    // Check for tool calls in the response.
    // parseToolCalls extracts ALL tool calls (multi-tool support),
    // enabling parallel execution of independent read-only tools.
    const allToolCalls = parseToolCalls(modelContent);
    const toolCall = allToolCalls[0] ?? null;

    if (!toolCall) {
      // Requests for repository/runtime evidence cannot honestly complete
      // before at least one project tool has SUCCEEDED. A recorded call
      // is not evidence — a failed/unavailable tool must never be masked
      // as a successful repository inspection.
      const requiresProjectEvidence =
        /\b(inspect|working tree|git status|project status|current project|use (?:your )?(?:project )?tools|verify (?:the )?(?:project|repo|build|tests?)|run (?:the )?(?:build|tests?|typecheck)|read (?:the )?(?:repo|repository|file)|search (?:the )?(?:repo|repository|codebase)|scan(?:\s+(?:the\s+)?(?:project|repo|repository|codebase))?|audit(?:\s+(?:the\s+)?(?:project|repo|repository))?|diagnose(?:\s+(?:this|the)\s+(?:project|repo|repository))?)\b/i.test(prompt);

      const hasSuccessfulToolEvidence = toolCalls.some((tc) => tc.result.success);
      const cleanContent = stripToolCallBlocks(modelContent);

      if (requiresProjectEvidence && !hasSuccessfulToolEvidence) {

        // An honest failure report IS an acceptable answer: the model
        // recorded the failed attempt and explicitly states verification
        // could not be completed. A fabricated success is NOT — that is
        // re-prompted until the model either produces real evidence or
        // an honest failure explanation.
        const lastFailure = toolCalls[toolCalls.length - 1];
        const acknowledgesFailure =
          lastFailure !== undefined &&
          !lastFailure.result.success &&
          /\b(could not|couldn't|failed|unable|not available|not able|did not (?:run|execute)|was not (?:run|executed)|error)\b/i.test(cleanContent);

        if (acknowledgesFailure) {
          // Accept the honest failure — the loop records it and never
          // claims verified repository state.
          if (missionId && escalation) escalation.recordFailure(missionId, "tool", lastFailure.result.message);
          return {
            content: cleanContent,
            toolCalls,
            rounds,
            durationMs: Date.now() - startTime,
            usage: { total_tokens: totalTokens },
            termination: "verification_failed",
            escalations: escalationEvents.length ? escalationEvents : undefined,
          };
        }

        // ─── Deterministic repository evidence, before any re-prompt ──
        // The request needs repository evidence and the model has not
        // produced any. Asking it again — and again, until the round
        // limit — is what produced "LiTT could not obtain required
        // project evidence before reaching the tool-call round limit".
        // The runtime can obtain that evidence itself, so it does:
        // one real execution of the canonical read-only inspection,
        // through the same dispatch path and lifecycle events as a
        // model-selected call.
        //
        // EXACT DISPATCH INVARIANT: this deterministic acquisition may
        // ONLY run when the model has made ZERO tool calls. If the model
        // already called a tool (even if it failed), substituting a
        // DIFFERENT tool (project.status) silently replaces the model's
        // requested tool A with tool B — the exact bug where
        // project.read_file became project.status. When tool calls
        // exist, the model is re-prompted to retry instead.
        if (!projectEvidenceAttempted && toolCalls.length === 0) {
          const acquired = await acquireProjectEvidence();

          if (acquired?.result.success) {
            // Real runtime evidence now exists. Hand it to the model and
            // let it answer from it — the VerificationGate still owns
            // whether the mission is COMPLETE.
            const entry = options.tools.get(acquired.toolId);
            messages.push({ role: "assistant", content: modelContent });
            messages.push({
              role: "user",
              content:
                (entry
                  ? renderToolResult(entry, acquired.result)
                  : `Tool "${acquired.toolName}" returned:\n${acquired.result.message}`) +
                `\n\nLiTT ran this inspection for you — it is verified runtime evidence. ` +
                `Answer the request from it. Do not ask the user to run commands, and do ` +
                `not state anything this evidence does not show.`,
            });
            continue;
          }

          if (acquired) {
            // The deterministic inspection genuinely failed. Fail ONCE,
            // with the REAL underlying error — never ten re-prompts, and
            // never a project-state claim.
            return {
              content:
                `LiTT could not obtain repository evidence: ${acquired.result.message}\n\n` +
                `No project-state claim is being made.`,
              toolCalls,
              rounds,
              durationMs: Date.now() - startTime,
              usage: { total_tokens: totalTokens },
              termination: "verification_failed",
              escalations: escalationEvents.length ? escalationEvents : undefined,
            };
          }
          // acquired === null: no canonical inspection capability is
          // registered for this loop. Fall through to the pre-existing
          // re-prompt path below — still fail-closed, unchanged.
        }

        if (round >= maxRounds - 1) {
          const failureDetails = toolCalls.length > 0
            ? `\n\nTool failures:\n${toolCalls.map((tc) => `- ${tc.toolId}: ${tc.result.message}`).join("\n")}`
            : "";
          return {
            content:
              "LiTT could not obtain required project evidence before reaching the tool-call round limit. " +
              "No project-state claim is being made." + failureDetails,
            toolCalls,
            rounds,
            durationMs: Date.now() - startTime,
            usage: { total_tokens: totalTokens },
            termination: toolCalls.length > 0 ? "verification_failed" : "max_rounds",
            escalations: escalationEvents.length ? escalationEvents : undefined,
          };
        }

        messages.push({
          role: "assistant",
          content: modelContent,
        });

        const failureContext = toolCalls.length > 0
          ? `\n\nYour previous tool call(s) failed:\n${toolCalls.map((tc) => `- ${tc.toolId}: ${tc.result.message}`).join("\n")}\n` +
            `Do NOT claim repository state as verified. Retry with an available tool, or state plainly that verification could not be completed.`
          : "";

        messages.push({
          role: "user",
          content:
            "You have not gathered successful project evidence yet. " +
            "Do not answer from memory and do not ask the user to run commands. " +
            "Call the appropriate project tool now. For repository identity and Git state, begin with project.status." +
            failureContext,
        });

        continue;
      }

      // No tool call — the model claims it is done.
      //
      // THE CRITICAL V1 RULE:
      //   COMPLETE ≠ model says done
      //   COMPLETE = runtime proved it passed
      //
      // If a VerificationGate is configured, we run it here. Only if the
      // gate proves the project passes do we terminate with "complete".
      // If the gate fails, we feed the failures back to the model as a
      // repair request and continue the loop — the model must actually
      // fix the failures and reach a state the runtime can prove.
      //
      // MUTATION COMPLETION REQUIREMENT:
      //   If the user explicitly requested an edit/mutation, the run
      //   cannot report success unless observable mutation evidence
      //   exists. A mutation that failed must NOT be erased by a later
      //   successful read-only tool. A clean diff after a mutation
      //   request means NON-COMPLETION.
      //
      //   This check ONLY applies when NO verification gate is configured.
      //   When a gate is configured, the gate is the truth boundary — it
      //   will catch the missing mutation itself. Applying the mutation
      //   check before the gate would prevent the gate from running and
      //   break the gate-driven repair loop.
      if (!options.verificationGate && mutationRequested && mutationFailed && !mutationSucceeded) {
        // A required mutation failed and was never recovered. Feed the
        // real failure back to the model — do not silently continue as
        // if successful.
        if (round >= maxRounds - 1) {
          return {
            content:
              `The requested mutation failed and was not recovered before the round limit. ` +
              `The task was NOT completed. No success is being claimed.\n\n` +
              cleanContent,
            toolCalls,
            rounds,
            durationMs: Date.now() - startTime,
            usage: { total_tokens: totalTokens },
            termination: "failed",
            escalations: escalationEvents.length ? escalationEvents : undefined,
          };
        }
        messages.push({ role: "assistant", content: modelContent });
        messages.push({
          role: "user",
          content:
            `You were asked to make an edit/mutation, but the mutation tool failed. ` +
            `The failure is NOT resolved. Do not claim success. ` +
            `Retry the mutation with a correct approach, or state plainly that the edit could not be completed.\n\n` +
            `Failed tool calls:\n${toolCalls.filter((tc) => !tc.result.success).map((tc) => `- ${tc.toolId}: ${tc.result.message}`).join("\n")}`,
        });
        continue;
      }

      if (!options.verificationGate && mutationRequested && !mutationSucceeded && !mutationFailed) {
        // The user asked for a mutation but no mutation tool was even
        // attempted. The model gave a final answer without making the
        // requested edit. This is NON-COMPLETION.
        if (round >= maxRounds - 1) {
          return {
            content:
              `The requested edit/mutation was not performed. No mutation evidence exists ` +
              `(no file modified, no diff produced). The task was NOT completed. ` +
              `No success is being claimed.\n\n${cleanContent}`,
            toolCalls,
            rounds,
            durationMs: Date.now() - startTime,
            usage: { total_tokens: totalTokens },
            termination: "failed",
            escalations: escalationEvents.length ? escalationEvents : undefined,
          };
        }
        messages.push({ role: "assistant", content: modelContent });
        messages.push({
          role: "user",
          content:
            `You were asked to make an edit/mutation, but no mutation was performed. ` +
            `Do not claim success without making the edit. ` +
            `Use project.run to make the edit, then show the diff with project.diff. ` +
            `If the edit cannot be made, state plainly that it failed.`,
        });
        continue;
      }

      // ─── General failure propagation ────────────────────────────────
      // If any tool call failed and the model claims done without
      // acknowledging the failure, do NOT accept "complete". Feed the
      // real failure back to the model — do not silently continue as
      // though it succeeded. Later successful read-only checks must
      // not erase an earlier unrecovered failure.
      if (!options.verificationGate) {
        const failedTools = toolCalls.filter((tc) => !tc.result.success);
        if (failedTools.length > 0) {
          // Check if the model's response acknowledges the failure.
          const acknowledgesFailure = /\b(could not|couldn't|failed|unable|not able|did not (?:run|execute|succeed)|was not (?:run|executed|successful)|error|not completed|did not (?:complete|succeed))\b/i.test(cleanContent);
          if (!acknowledgesFailure) {
            // The model is claiming success despite a failed tool call.
            // Feed the failure back — do not accept "complete".
            if (round >= maxRounds - 1) {
              return {
                content:
                  `A tool call failed but the model claimed success without acknowledging the failure. ` +
                  `The task was NOT completed. No success is being claimed.\n\n` +
                  `Failed tool calls:\n${failedTools.map((tc) => `- ${tc.toolId}: ${tc.result.message}`).join("\n")}\n\n` +
                  cleanContent,
                toolCalls,
                rounds,
                durationMs: Date.now() - startTime,
                usage: { total_tokens: totalTokens },
                termination: "failed",
                escalations: escalationEvents.length ? escalationEvents : undefined,
              };
            }
            messages.push({ role: "assistant", content: modelContent });
            messages.push({
              role: "user",
              content:
                `A tool call failed but you claimed success without acknowledging it. ` +
                `Do NOT claim success when a tool failed. ` +
                `Retry the failed operation, or state plainly that it failed.\n\n` +
                `Failed tool calls:\n${failedTools.map((tc) => `- ${tc.toolId}: ${tc.result.message}`).join("\n")}`,
            });
            continue;
          }
        }
      }

      if (!options.verificationGate) {
        // No gate — preserve original behavior (model "done" = complete)
        // Record success — the model gave a non-empty final answer.
        if (missionId && escalation) escalation.recordSuccess(missionId);
        return {
          content: cleanContent,
          toolCalls,
          rounds,
          durationMs: Date.now() - startTime,
          usage: { total_tokens: totalTokens },
          termination: "complete",
          escalations: escalationEvents.length ? escalationEvents : undefined,
        };
      }

      // Run the gate — the runtime truth boundary.
      const verification = await options.verificationGate.verify();
      lastVerification = verification;

      if (verification.proven) {
        // The runtime PROVED it. This is the only honest "complete".
        if (missionId && escalation) escalation.recordSuccess(missionId);
        return {
          content: cleanContent,
          toolCalls,
          rounds,
          durationMs: Date.now() - startTime,
          usage: { total_tokens: totalTokens },
          termination: "complete",
          verification,
          escalations: escalationEvents.length ? escalationEvents : undefined,
        };
      }

      // Gate failed — feed the failures back to the model for repair.
      // This is the V1 observe-failures → repair loop.
      if (options.emitter) {
        options.emitter({
          type: "litt_event",
          subtype: "verification_failed_repair",
          ts: Date.now(),
          data: {
            runId: verification.runId,
            message: verification.message,
            failedChecks: verification.checks
              .filter((c) => c.status !== "skipped" && c.status !== "success")
              .map((c) => ({ id: c.id, status: c.status, message: c.message, stderr: c.stderr })),
          },
        });
      }

      // Escalation: the model claimed done but the gate proved it wrong.
      // This is a reasoning failure. Record it and try a stronger model.
      // The repair feedback (pushed below) is still added to the
      // conversation so the new (stronger) model sees what to fix.
      if (missionId && escalation) {
        escalation.recordFailure(missionId, "reasoning", verification.message);
        tryEscalate();
      }

      messages.push({ role: "assistant", content: modelContent });
      messages.push({
        role: "user",
        content:
          `Verification gate result: NOT PROVEN. The runtime ran the project's ` +
          `checks and at least one failed. You are NOT done.\n\n${verification.message}\n\n` +
          `Failed checks:\n` +
          verification.checks
            .filter((c) => c.status !== "skipped" && c.status !== "success")
            .map((c) => {
              const detail = c.stderr ? `\n--- stderr ---\n${c.stderr.slice(0, 4000)}` : "";
              const out = c.stdout ? `\n--- stdout ---\n${c.stdout.slice(0, 2000)}` : "";
              return `- ${c.id}: ${c.status} — ${c.message}${detail}${out}`;
            })
            .join("\n") +
          `\n\nFix the failures above, then say you are done only after the ` +
          `verification gate passes. Do not claim completion until the runtime proves it.`,
      });
      // Continue the loop — the model gets a chance to repair.
      continue;
    }

    // ─── Multi-tool parallel execution ──────────────────────────────
    // When the model emits multiple tool calls in one turn AND all of
    // them are read-only (no mutations, no approvals needed), execute
    // them in parallel through the gateway. This reduces round-trips
    // for compound read-only queries like "what framework and branch".
    //
    // Safety rules:
    //   - ALL tools must be read-only (readOnly: true, mutating: false)
    //   - If ANY tool is mutating or requires approval, fall back to
    //     sequential execution of only the FIRST tool call (backward
    //     compatibility — the remaining tools are handled in the next
    //     loop round after the model sees the first result).
    //   - Each tool gets its own canonical toolCallId, runtime event,
    //     and gateway dispatch — no shortcuts around security.
    //   - Results are normalized in document order before feeding back
    //     to the model so the conversation is deterministic.

    // Resolve all tool entries and check if parallel execution is safe.
    const allEntries: Array<{ call: ParsedToolCall; entry: ToolEntry | null }> =
      allToolCalls.map((c) => ({ call: c, entry: options.tools.get(c.toolId) }));

    // Check if ALL tool calls are for known read-only tools.
    const allReadOnly = allEntries.length > 0 && allEntries.every(
      ({ entry }) => entry !== null &&
        entry.definition.readOnly === true &&
        entry.metadata.mutating === false,
    );

    // If only one tool call, or if not all read-only, execute just the
    // first one sequentially (preserves existing behavior for mutations
    // and dependent tool chains).
    const callsToExecute = (allReadOnly && allEntries.length > 1)
      ? allEntries
      : allEntries.slice(0, 1);

    // If the first tool is unknown, report and continue with bounded retry.
    // After MAX_UNKNOWN_TOOL_RETRIES consecutive unknown-tool errors, the
    // loop terminates as failed — never silently maps an unknown tool to
    // an unrelated fallback tool, and never loops forever.
    if (callsToExecute.length > 0 && callsToExecute[0].entry === null) {
      unknownToolRetries++;
      if (unknownToolRetries > MAX_UNKNOWN_TOOL_RETRIES) {
        return {
          content:
            `LiTT could not execute the requested tool "${callsToExecute[0].call.toolId}" ` +
            `after ${MAX_UNKNOWN_TOOL_RETRIES} attempts. The tool is not available. ` +
            `Available tools: ${toolDefs.map((t) => t.id).join(", ")}. ` +
            `No fallback tool was substituted. The requested tool was NOT substituted with another tool. ` +
            `The task was NOT completed.`,
          toolCalls,
          rounds,
          durationMs: Date.now() - startTime,
          usage: { total_tokens: totalTokens },
          termination: "error",
          escalations: escalationEvents.length ? escalationEvents : undefined,
        };
      }
      messages.push({ role: "assistant", content: modelContent });
      messages.push({
        role: "user",
        content: `Error: Unknown tool "${callsToExecute[0].call.toolId}". ` +
          `This tool does not exist and was NOT substituted with another tool. ` +
          `Available tools: ${toolDefs.map((t) => t.id).join(", ")}. ` +
          `Retry with one of the available tools, or state plainly that the task cannot be completed.`,
      });
      continue;
    }
    // Reset the counter on a successful tool resolution.
    unknownToolRetries = 0;

    // ─── Execute tool calls (parallel if all read-only, else single) ───
    // Dispatch goes through the ONE shared path defined above — the same
    // one the runtime's deterministic evidence acquisition uses.
    const execResults = callsToExecute.length > 1
      ? await Promise.all(callsToExecute.map(({ call, entry }) => dispatchToolCall(call, entry!)))
      : [await dispatchToolCall(callsToExecute[0].call, callsToExecute[0].entry!)];

    // ─── Normalize results in document order ───────────────────────
    // Process results in the same order as the tool calls appeared in
    // the model response. This ensures deterministic evidence ordering.
    for (let i = 0; i < execResults.length; i++) {
      const { call, entry } = callsToExecute[i];
      recordToolOutcome(call, entry!, execResults[i]);
    }

    // Append the assistant's tool call(s) and ALL tool results to the
    // conversation. For parallel execution, all results are combined
    // into a single user message so the model sees all evidence at once.
    messages.push({ role: "assistant", content: modelContent });
    messages.push({
      role: "user",
      content: execResults
        .map(({ result }, i) => renderToolResult(callsToExecute[i].entry!, result))
        .join("\n\n"),
    });
  }

  if (rounds >= maxRounds && termination === "complete") {
    // If a gate is configured, hitting max rounds means we never reached
    // a runtime-proven COMPLETE — that is a verification failure, not a
    // benign max_rounds. The single most important rule: COMPLETE must
    // be proved by the runtime, not claimed by the model.
    if (options.verificationGate) {
      termination = "verification_failed";
    } else {
      termination = "max_rounds";
    }
  }

  // Build a truthful partial answer when the loop exhausted its rounds.
  // If tool calls were made, summarize what actually happened — never
  // discard useful tool evidence behind a generic "ran out of rounds" message.
  function buildMaxRoundsContent(): string {
    if (toolCalls.length === 0) {
      return termination === "verification_failed"
        ? "I could not get the verification gate to pass within the round limit. The mission is NOT runtime-proven COMPLETE."
        : "I reached the maximum number of tool-call rounds without a final answer.";
    }

    // Summarize actual tool evidence — truthful, never fabricated.
    const succeeded = toolCalls.filter((tc) => tc.result.success);
    const failed = toolCalls.filter((tc) => !tc.result.success);

    const parts: string[] = [];
    parts.push("I inspected the project but couldn't finish the full task before the execution limit.");

    if (succeeded.length > 0) {
      parts.push("\nCompleted:");
      for (const tc of succeeded) {
        const detail = tc.result.message ? `: ${tc.result.message.slice(0, 200)}` : "";
        parts.push(`- ${tc.toolId}${detail}`);
      }
    }

    if (failed.length > 0) {
      parts.push("\nFailed:");
      for (const tc of failed) {
        const detail = tc.result.message ? `: ${tc.result.message.slice(0, 200)}` : "";
        parts.push(`- ${tc.toolId}${detail}`);
      }
    }

    parts.push("\nI did not verify the project as fully healthy.");
    return parts.join("\n");
  }

  return {
    content: buildMaxRoundsContent(),
    toolCalls,
    rounds,
    durationMs: Date.now() - startTime,
    usage: { total_tokens: totalTokens },
    termination,
    verification: lastVerification,
    escalations: escalationEvents.length ? escalationEvents : undefined,
  };
}

// ─── System prompt builder ─────────────────────────────────────────

/**
 * Build the default system prompt that includes tool definitions
 * and optional project identity (so the model doesn't guess).
 */
export function buildDefaultSystemPrompt(tools: ToolDefinition[], project?: ProjectContext | null): string {
  const toolList = tools.map((t) => {
    const params = Object.entries(t.inputSchema.properties ?? {})
      .map(([key, schema]) => {
        const s = schema as { type?: string; description?: string };
        return `    "${key}": ${s.type ?? "any"}${s.description ? ` — ${s.description}` : ""}`;
      })
      .join("\n");
    return `- ${t.id}: ${t.description}${params ? `\n  Parameters:\n${params}` : ""}`;
  }).join("\n");

  const projectSection = project
    ? `\nProject context (canonical — do not guess or hallucinate):
  - Name: ${project.name}
  - Root: ${project.root}
  - Branch: ${project.branch ?? "unknown"}
  - Authenticated: ${project.authenticated ?? "unknown"}${project.authenticated && project.authEmail ? ` (user: ${project.authEmail})` : ""}${project.authProvider ? ` via ${project.authProvider}` : ""}
  - REMOTE server: ${project.remoteUrl ?? "not configured"}${project.remoteReachable != null ? ` (${project.remoteReachable ? "reachable" : "unreachable"})` : ""}
All tool calls execute in this project. Do not assume a different project.`
    : "";

  return `You are LiTT, the AI development agent for LiTTree Lab Studios.
You help users build software by calling tools and providing insights.

CRITICAL OPERATOR RULES:
- Never return an empty response.
- When the user asks you to inspect, verify, check, test, build, search, read, or examine the current project, you MUST gather evidence with the available project tools before giving the final answer.
- Never ask the user to run a command that an available project tool can run for you.
- Do not claim project state, Git state, test state, build state, or file contents without tool evidence.
- If a tool fails, report the actual failure instead of pretending the inspection succeeded.
${projectSection}

Available tools:
${toolList}

To call a tool, output a tool call block in this exact format:

\`\`\`tool_call
{ "tool": "<tool_id>", "inputs": { "<param>": "<value>" } }
\`\`\`

After receiving the tool result, you can either call another tool or
provide a final text answer. Be concise and actionable. If a tool fails,
explain what went wrong and suggest next steps.`;
}

// ─── Helper: extract args from tool call for CommandExecutor ───────

/**
 * Map a tool call's inputs to the args array expected by CommandExecutor.
 *
 * The CommandExecutor takes (command, args[]) where command is the
 * executable name and args are the structured arguments. For project
 * tools, the tool name IS the command (e.g. "status" → "git status").
 *
 * For the "run" tool, the inputs contain { command, args } which map
 * directly to the CommandExecutor's parameters.
 */
function extractArgsFromToolCall(toolName: string, inputs: Record<string, unknown>): string[] {
  // For project.run, the inputs contain the actual command and args
  if (toolName === "run") {
    const cmd = typeof inputs.command === "string" ? inputs.command : "";
    const cmdArgs = Array.isArray(inputs.args)
      ? inputs.args.filter((a): a is string => typeof a === "string")
      : [];
    // CommandExecutor.execute() takes (command, args) separately,
    // but we're passing the tool name as the command and the actual
    // command+args as the args array. The runCommand() boundary will
    // interpret this correctly.
    return [cmd, ...cmdArgs];
  }

  // For other tools, pass the inputs as key=value pairs
  // The tool handlers will interpret these
  const result: string[] = [];
  for (const [key, value] of Object.entries(inputs)) {
    if (typeof value === "string") {
      result.push(`--${key}`, value);
    } else if (typeof value === "boolean" && value) {
      result.push(`--${key}`);
    } else if (typeof value === "number") {
      result.push(`--${key}`, String(value));
    }
  }
  return result;
}
