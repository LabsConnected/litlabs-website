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
import type { VerificationGate, VerificationResult } from "./verification-gate.js";

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
  verificationGate?: VerificationGate | null;
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
}

export interface AgentToolCallRecord {
  toolCallId: string;
  toolId: string;
  toolName: string;
  inputs: Record<string, unknown>;
  result: ToolResult;
  durationMs: number;
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
 */
export interface ParsedToolCall {
  toolId: string;
  inputs: Record<string, unknown>;
}

export function parseToolCall(content: string): ParsedToolCall | null {
  // Look for ```tool_call ... ``` blocks
  const match = content.match(/```tool_call\s*\n([\s\S]*?)\n```/);
  if (!match) return null;

  try {
    const parsed = JSON.parse(match[1]);
    if (typeof parsed.tool === "string") {
      return {
        toolId: parsed.tool,
        inputs: typeof parsed.inputs === "object" && parsed.inputs !== null
          ? parsed.inputs as Record<string, unknown>
          : {},
      };
    }
  } catch {
    // Malformed JSON — not a valid tool call
  }

  return null;
}

/**
 * Extract the text content without the tool_call blocks.
 */
export function stripToolCallBlocks(content: string): string {
  return content.replace(/```tool_call\s*\n[\s\S]*?\n```/g, "").trim();
}

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

  for (let round = 0; round < maxRounds; round++) {
    rounds++;

    // Call the model
    let modelContent = "";
    const modelEvents: ModelStreamEvent[] = [];

    try {
      await options.model.stream(messages, (event) => {
        modelEvents.push(event);
        if (options.onModelStream) {
          try { options.onModelStream(event); } catch { /* listener errors don't crash the loop */ }
        }
        if (event.type === "delta") {
          modelContent += event.text;
        }
      });
    } catch (err) {
      termination = "error";
      return {
        content: `Model error: ${err instanceof Error ? err.message : String(err)}`,
        toolCalls,
        rounds,
        durationMs: Date.now() - startTime,
        usage: { total_tokens: totalTokens },
        termination,
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
    if (!modelContent.trim()) {
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

    // Check for tool calls in the response
    const toolCall = parseToolCall(modelContent);

    if (!toolCall) {
      // Requests for repository/runtime evidence cannot honestly complete
      // before at least one project tool has executed.
      const requiresProjectEvidence =
        /\b(inspect|working tree|git status|project status|current project|use (?:your )?(?:project )?tools|verify (?:the )?(?:project|repo|build|tests?)|run (?:the )?(?:build|tests?|typecheck)|read (?:the )?(?:repo|repository|file)|search (?:the )?(?:repo|repository|codebase))\b/i.test(prompt);

      if (requiresProjectEvidence && toolCalls.length === 0) {
        if (round >= maxRounds - 1) {
          return {
            content:
              "LiTT could not obtain required project evidence before reaching the tool-call round limit. " +
              "No project-state claim is being made.",
            toolCalls,
            rounds,
            durationMs: Date.now() - startTime,
            usage: { total_tokens: totalTokens },
            termination: "max_rounds",
          };
        }

        messages.push({
          role: "assistant",
          content: modelContent,
        });

        messages.push({
          role: "user",
          content:
            "You have not gathered any project evidence yet. " +
            "Do not answer from memory and do not ask the user to run commands. " +
            "Call the appropriate project tool now. For repository identity and Git state, begin with project.status.",
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
      const cleanContent = stripToolCallBlocks(modelContent);

      if (!options.verificationGate) {
        // No gate — preserve original behavior (model "done" = complete)
        return {
          content: cleanContent,
          toolCalls,
          rounds,
          durationMs: Date.now() - startTime,
          usage: { total_tokens: totalTokens },
          termination: "complete",
        };
      }

      // Run the gate — the runtime truth boundary.
      const verification = await options.verificationGate.verify();
      lastVerification = verification;

      if (verification.proven) {
        // The runtime PROVED it. This is the only honest "complete".
        return {
          content: cleanContent,
          toolCalls,
          rounds,
          durationMs: Date.now() - startTime,
          usage: { total_tokens: totalTokens },
          termination: "complete",
          verification,
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

    // Look up the tool in the registry
    const toolEntry: ToolEntry | null = options.tools.get(toolCall.toolId);
    if (!toolEntry) {
      // Unknown tool — tell the model and continue
      messages.push({ role: "assistant", content: modelContent });
      messages.push({
        role: "user",
        content: `Error: Unknown tool "${toolCall.toolId}". Available tools: ${toolDefs.map((t) => t.id).join(", ")}`,
      });
      continue;
    }

    // Generate canonical tool call ID
    const toolCallId = `tc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    // Emit agent_tool_call event
    if (options.emitter) {
      options.emitter({
        type: "litt_event",
        subtype: "agent_tool_call",
        ts: Date.now(),
        toolCallId,
        data: {
          tool: toolEntry.definition.name,
          toolId: toolEntry.definition.id,
          inputs: toolCall.inputs,
        },
      });
    }

    // Track command start in the runtime store
    if (options.store) {
      options.store.commandStart(
        toolEntry.definition.name,
        [],
        options.cwd,
        `agent_${toolCallId}`,
      );
    }

    // Dispatch the tool call through the ExecutionGateway.
    //
    // The gateway is the ONE canonical execution authority. It enforces:
    //   - Identity verification
    //   - Grant verification
    //   - Policy decision (PLAN/ACT/AUTO + capability classification)
    //   - Approval enforcement
    //   - Credential lease
    //
    // For project.run: gateway → CommandExecutor → runCommand() (hardened)
    // For other tools: gateway → ToolRegistry → handler (after policy check)
    //
    // The legacy ToolRegistry.execute() bypass is ONLY available when no
    // gateway is provided — this is for unit tests with mock tools only.
    // In production, the gateway MUST be provided.
    const toolStartTime = Date.now();
    let result: ToolResult;
    try {
      if (options.gateway) {
        // ─── CANONICAL path: ExecutionGateway ───
        const gwResult = await options.gateway.execute({
          toolId: toolCall.toolId,
          inputs: toolCall.inputs,
          cwd: options.cwd,
          mode: options.mode ?? "act",
          identity: {
            tenantId: "agent-tenant",
            userId: options.userId ?? "agent-user",
            actorId: options.userId ?? "agent-user",
            trusted: false, // model-originated execution is untrusted
            interaction: "interactive",
          },
          runId: `agent_${toolCallId}`,
          toolCallId,
          onStream: options.onToolStream as ((chunk: { stream: "stdout" | "stderr"; text: string; ts: number }) => void) | undefined,
        });
        result = gwResult.result;
      } else if (options.executor) {
        // ─── Deprecated: direct CommandExecutor (for backward compat) ───
        const cmdResult = await options.executor.execute(
          toolEntry.definition.name,
          extractArgsFromToolCall(toolEntry.definition.name, toolCall.inputs),
          {
            cwd: options.cwd,
            mode: options.mode,
            runId: `agent_${toolCallId}`,
            toolCallId,
            commandLabel: toolEntry.definition.name,
            onStream: options.onToolStream,
          },
        );
        result = cmdResult.result;
      } else {
        // ─── TEST ONLY: direct ToolRegistry.execute() (no security) ───
        // This bypasses ALL security boundaries. Only for unit tests.
        result = await options.tools.execute(toolCall.toolId, {
          cwd: options.cwd,
          projectId: null,
          userId: options.userId ?? null,
          shell: options.shell,
        }, toolCall.inputs);
      }
    } catch (err) {
      result = {
        status: "failed",
        success: false,
        message: `Tool execution error: ${err instanceof Error ? err.message : String(err)}`,
        data: {},
      };
    }
    const toolDurationMs = Date.now() - toolStartTime;

    // Track command end in the runtime store
    if (options.store) {
      options.store.commandEnd(
        toolEntry.definition.name,
        result.success,
        result.data?.exitCode as number | null ?? null,
        toolDurationMs,
        result.message,
        `agent_${toolCallId}`,
      );
    }

    const toolCallRecord: AgentToolCallRecord = {
      toolCallId,
      toolId: toolEntry.definition.id,
      toolName: toolEntry.definition.name,
      inputs: toolCall.inputs,
      result,
      durationMs: toolDurationMs,
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
          status: result.status,
          success: result.success,
          message: result.message,
          durationMs: toolDurationMs,
        },
      });
    }

    // Append the assistant's tool call and the tool result to the conversation
    messages.push({ role: "assistant", content: modelContent });
    messages.push({
      role: "user",
      content: `Tool "${toolEntry.definition.name}" returned:\n${JSON.stringify({
        status: result.status,
        message: result.message,
        data: result.data,
      }, null, 2)}`,
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

  return {
    content: termination === "max_rounds"
      ? "I reached the maximum number of tool-call rounds without a final answer."
      : termination === "verification_failed"
        ? "I could not get the verification gate to pass within the round limit. The mission is NOT runtime-proven COMPLETE."
        : "",
    toolCalls,
    rounds,
    durationMs: Date.now() - startTime,
    usage: { total_tokens: totalTokens },
    termination,
    verification: lastVerification,
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
