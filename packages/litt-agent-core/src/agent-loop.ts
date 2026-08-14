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
  /** System prompt (prepended to the conversation) */
  systemPrompt?: string;
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
  /** Permission mode */
  mode?: "plan" | "act" | "auto";
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
  /** Why the loop terminated */
  termination: "complete" | "max_rounds" | "error" | "cancelled";
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

  // Build the system prompt with tool definitions
  const toolDefs = options.tools.list();
  const systemPrompt = options.systemPrompt ?? buildDefaultSystemPrompt(toolDefs);

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

    // Check for tool calls in the response
    const toolCall = parseToolCall(modelContent);

    if (!toolCall) {
      // No tool call — this is the final answer
      const cleanContent = stripToolCallBlocks(modelContent);
      return {
        content: cleanContent,
        toolCalls,
        rounds,
        durationMs: Date.now() - startTime,
        usage: { total_tokens: totalTokens },
        termination: "complete",
      };
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

    // Dispatch through the shared ToolRegistry
    // The ToolRegistry uses the same ShellExecutor as the CommandExecutor
    const toolStartTime = Date.now();
    let result: ToolResult;
    try {
      result = await options.tools.execute(toolCall.toolId, {
        cwd: options.cwd,
        projectId: null,
        userId: options.userId ?? null,
        shell: options.shell,
      }, toolCall.inputs);
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
    termination = "max_rounds";
  }

  return {
    content: termination === "max_rounds"
      ? "I reached the maximum number of tool-call rounds without a final answer."
      : "",
    toolCalls,
    rounds,
    durationMs: Date.now() - startTime,
    usage: { total_tokens: totalTokens },
    termination,
  };
}

// ─── System prompt builder ─────────────────────────────────────────

/**
 * Build the default system prompt that includes tool definitions.
 */
export function buildDefaultSystemPrompt(tools: ToolDefinition[]): string {
  const toolList = tools.map((t) => {
    const params = Object.entries(t.inputSchema.properties ?? {})
      .map(([key, schema]) => {
        const s = schema as { type?: string; description?: string };
        return `    "${key}": ${s.type ?? "any"}${s.description ? ` — ${s.description}` : ""}`;
      })
      .join("\n");
    return `- ${t.id}: ${t.description}${params ? `\n  Parameters:\n${params}` : ""}`;
  }).join("\n");

  return `You are LiTT, the AI development agent for LiTTree Lab Studios.
You help users build software by calling tools and providing insights.

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
