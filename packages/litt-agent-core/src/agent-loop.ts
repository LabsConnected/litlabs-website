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
  /** System prompt (prepended to the conversation) */
  systemPrompt?: string;
  /** Project context to embed in the default system prompt (prevents model hallucination) */
  projectContext?: { name: string; root: string; branch?: string | null } | null;
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
   *   error:                model call failed
   *   cancelled:            loop was cancelled
   */
  termination: "complete" | "verification_failed" | "max_rounds" | "error" | "cancelled";
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
/** A line that looks like a bare JSON tool object (single line). */
const BARE_TOOL_JSON_RE = /^[ \t]*\{[^\n]*?"tool"[ \t]*:/m;
function parseToolJson(raw: string): ParsedToolCall | null {
  try {
    const parsed = JSON.parse(raw.trim());
    if (parsed && typeof parsed === "object" && typeof (parsed as { tool?: unknown }).tool === "string") {
      const inputs = (parsed as { inputs?: unknown }).inputs;
      return {
        toolId: (parsed as { tool: string }).tool,
        inputs: typeof inputs === "object" && inputs !== null
          ? inputs as Record<string, unknown>
          : {},
      };
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

export function parseToolCall(content: string): ParsedToolCall | null {
  // 1. Fenced ```tool_call ... ``` block.
  const match = content.match(TOOL_CALL_FENCE_RE);
  if (match) {
    const parsed = parseToolJson(match[1]);
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
  //    contradiction). Scan every brace-balanced span that contains a
  //    `"tool":` key and try to parse it.
  for (let idx = 0; idx < content.length; idx++) {
    if (content[idx] !== "{") continue;
    const span = balancedJsonSpan(content, idx);
    if (!span || !/"tool"[ \t]*:/.test(span)) continue;
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

  // 2. ALL bare JSON tool objects on their own lines.
  const bareRe = /^[ \t]*\{[^\n]*?"tool"[ \t]*:/gm;
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
    if (!span || !/"tool"[ \t]*:/.test(span)) continue;
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
  let stripped = content.replace(/```tool_call[ \t]*\r?\n?[\s\S]*?```/gi, "");
  // Strip bare JSON tool objects (fenced handling above; this covers
  // unfenced `{ "tool": ... }` objects that models emit without fences,
  // even when split from the surrounding prose by a newline or not).
  for (let guard = 0; guard < 8; guard++) {
    let removed = false;
    for (let idx = 0; idx < stripped.length; idx++) {
      if (stripped[idx] !== "{") continue;
      const span = balancedJsonSpan(stripped, idx);
      if (!span || !/"tool"[ \t]*:/.test(span)) continue;
      stripped = stripped.slice(0, idx) + stripped.slice(idx + span.length);
      removed = true;
      break;
    }
    if (!removed) break;
  }
  return stripped.trim();
}

// ─── Mission Planning ──────────────────────────────────────────────

// ─── Agent Loop ────────────────────────────────────────────────────

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

  // Build the conversation
  const messages: ChatMessage[] = [
    { role: "system", content: systemPrompt },
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

  for (let round = 0; round < maxRounds; round++) {
    rounds++;

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

    // Never silently accept an empty model turn.
    // Empty output is not a successful assistant response and must not
    // become a blank completed turn in CLI/Desktop surfaces.
    //
    // EXCEPTION: when the model emitted ONLY native tool_calls (no prose
    // deltas), the provider attaches the translated `tool_call` fence block
    // to the returned ModelResult.content (not as a delta event, since the
    // block is a LiTT-internal construct, not model prose). In that case
    // modelContent is empty but modelResult.content carries the tool call —
    // adopt it so the loop's single parser can execute the tool instead of
    // misclassifying the turn as an empty response.
    if (!modelContent.trim() && modelResult?.content?.trim()) {
      modelContent = modelResult.content;
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

    // If the first tool is unknown, report and continue (backward compat).
    if (callsToExecute.length > 0 && callsToExecute[0].entry === null) {
      messages.push({ role: "assistant", content: modelContent });
      messages.push({
        role: "user",
        content: `Error: Unknown tool "${callsToExecute[0].call.toolId}". Available tools: ${toolDefs.map((t) => t.id).join(", ")}`,
      });
      continue;
    }

    // ─── Execute tool calls (parallel if all read-only, else single) ───
    const toolStartTime = Date.now();
    const executeOne = async (
      parsed: ParsedToolCall,
      entry: ToolEntry,
    ): Promise<{ toolCallId: string; result: ToolResult; durationMs: number }> => {
      const tcId = `tc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

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
          const cmdResult = await options.executor.execute(
            entry.definition.name,
            extractArgsFromToolCall(entry.definition.name, parsed.inputs),
            {
              cwd: options.cwd,
              mode: options.mode,
              runId: `agent_${tcId}`,
              toolCallId: tcId,
              commandLabel: entry.definition.name,
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
      const dur = Date.now() - toolStartTime;
      return { toolCallId: tcId, result: res, durationMs: dur };
    };

    // Execute all calls — parallel if all read-only, else single.
    const execResults = callsToExecute.length > 1
      ? await Promise.all(callsToExecute.map(({ call, entry }) => executeOne(call, entry!)))
      : [await executeOne(callsToExecute[0].call, callsToExecute[0].entry!)];

    // ─── Normalize results in document order ───────────────────────
    // Process results in the same order as the tool calls appeared in
    // the model response. This ensures deterministic evidence ordering.
    for (let i = 0; i < execResults.length; i++) {
      const { toolCallId, result, durationMs } = execResults[i];
      const { call, entry } = callsToExecute[i];
      const toolEntry = entry!;

      // Track command end in the runtime store
      if (options.store) {
        options.store.commandEnd(
          toolEntry.definition.name,
          result.success,
          result.data?.exitCode as number | null ?? null,
          durationMs,
          result.message,
          `agent_${toolCallId}`,
        );
      }

      const toolCallRecord: AgentToolCallRecord = {
        toolCallId,
        toolId: toolEntry.definition.id,
        toolName: toolEntry.definition.name,
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
            tool: toolEntry.definition.name,
            toolId: toolEntry.definition.id,
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
    }

    // Append the assistant's tool call(s) and ALL tool results to the
    // conversation. For parallel execution, all results are combined
    // into a single user message so the model sees all evidence at once.
    messages.push({ role: "assistant", content: modelContent });
    const resultLines = execResults.map(({ result }, i) => {
      const { entry } = callsToExecute[i];
      return `Tool "${entry!.definition.name}" returned:\n${JSON.stringify({
        status: result.status,
        message: result.message,
        data: result.data,
      }, null, 2)}`;
    });
    messages.push({
      role: "user",
      content: resultLines.join("\n\n"),
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
export function buildDefaultSystemPrompt(tools: ToolDefinition[], project?: { name: string; root: string; branch?: string | null } | null): string {
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
