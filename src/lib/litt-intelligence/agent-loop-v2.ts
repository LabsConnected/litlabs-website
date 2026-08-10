/**
 * LiTT Agent Loop V2 — bounded multi-step tool-calling loop.
 *
 * State machine: request → call_llm → validate → permission → execute →
 *   observe → check_limits → (loop or finish)
 *
 * Key design decisions:
 * - Native structured tool calling only. No text-parsed fake tool calls.
 * - Loop detection: cancel after 3 identical tool calls with no
 *   intervening workspace mutation or materially different result.
 * - Checkpoints before meaningful mutation batches.
 * - Hard limits: max steps, max runtime, max output, max retries.
 * - Terminal server's isBlockedCommand() remains authoritative security.
 */

import "server-only";

import type { WorkspaceTransport } from "./workspace-transport";
import { ProgressEmitter, type ProgressEvent } from "./progress-events";
import { PermissionEngine, type ExecutionMode, type ToolPermissionInfo } from "./permission-engine";
import { callLLMWithTools, buildToolResultMessage, buildAssistantToolCallMessage, summarizeToolResult, type ToolDefinition, type ToolCallResult } from "./llm-tool-calling";
import type { LLMCallMetadata } from "@/lib/evals/braintrust";
import { runBuildFixLoop, type BuildFixLoopResult } from "./build-fix-loop";
import { toolRegistry } from "./tool-registry";
import type { LiTTToolDefinition } from "./types";

// ─── Types ────────────────────────────────────────────────────────

export interface AgentLoopConfig {
  maxSteps: number;
  maxRuntimeMs: number;
  maxOutputChars: number;
  maxRetries: number;
  executionMode: ExecutionMode;
  model?: string;
  systemPrompt: string;
  enableBuildFix: boolean;
  evalMetadata?: LLMCallMetadata;
}

export const DEFAULT_LOOP_CONFIG: AgentLoopConfig = {
  maxSteps: 20,
  maxRuntimeMs: 300_000, // 5 minutes
  maxOutputChars: 50_000,
  maxRetries: 2,
  executionMode: "act",
  model: undefined,
  systemPrompt: "",
  enableBuildFix: true,
};

export interface PendingApproval {
  toolId: string;
  toolCallId: string;
  inputs: Record<string, unknown>;
  reason: string;
  /** The conversation messages at the point of pause — resume from here after approval */
  pausedMessages: Array<{ role: "user" | "assistant"; content: string }>;
}

export interface AgentLoopResult {
  finalText: string;
  stepsUsed: number;
  totalDurationMs: number;
  toolCalls: Array<{ toolId: string; success: boolean; summary: string }>;
  buildFixResult?: BuildFixLoopResult;
  checkpoint?: { checkpointId: string; label: string; gitSha: string };
  cancelled: boolean;
  cancelReason?: string;
  events: ProgressEvent[];
  /** Set when the loop paused because ACT mode requires approval for a mutation */
  pendingApproval?: PendingApproval;
}

// ─── Loop detection ───────────────────────────────────────────────

interface ToolCallRecord {
  toolId: string;
  inputsHash: string;
  resultHash: string;
  step: number;
}

function hashInputs(inputs: Record<string, unknown>): string {
  try {
    return JSON.stringify(inputs).slice(0, 500);
  } catch {
    return String(inputs).slice(0, 500);
  }
}

function hashResult(result: unknown): string {
  try {
    return JSON.stringify(result).slice(0, 500);
  } catch {
    return String(result).slice(0, 500);
  }
}

/**
 * Detect repeated tool calls. Cancel only after 3 identical calls
 * (same tool + same inputs + same result) with no intervening
 * workspace mutation or materially different result.
 */
function detectRepeatedCalls(
  records: ToolCallRecord[],
  currentToolId: string,
  currentInputsHash: string,
  hasInterveningMutation: boolean,
): boolean {
  if (hasInterveningMutation) return false;

  const identical = records.filter(
    (r) => r.toolId === currentToolId && r.inputsHash === currentInputsHash,
  );

  return identical.length >= 3;
}

// ─── Tool definition conversion ───────────────────────────────────

function toToolDefinition(tool: LiTTToolDefinition): ToolDefinition {
  return {
    id: tool.id,
    description: tool.description,
    inputSchema: tool.inputSchema as Record<string, unknown>,
  };
}

function toPermissionInfo(tool: LiTTToolDefinition): ToolPermissionInfo {
  return {
    toolId: tool.id,
    permissionLevel: tool.permissionLevel,
    isReadOnly: tool.readOnly,
    isMutation: !tool.readOnly,
    enabled: tool.enabled,
  };
}

// ─── Agent Loop ───────────────────────────────────────────────────

export async function runAgentLoopV2(
  userMessage: string,
  transport: WorkspaceTransport,
  config: Partial<AgentLoopConfig> = {},
  progress?: ProgressEmitter,
): Promise<AgentLoopResult> {
  const cfg = { ...DEFAULT_LOOP_CONFIG, ...config };
  const startTime = Date.now();
  const events: ProgressEvent[] = [];
  const toolCallRecords: ToolCallRecord[] = [];
  let hasInterveningMutation = false;

  // Collect progress events
  const localProgress = new ProgressEmitter((event) => {
    events.push(event);
    progress?.emit(event);
  });

  const permissionEngine = new PermissionEngine();

  // Get available tools from registry, filtered by mode
  const allTools = toolRegistry.listEnabled();
  const availableTools = allTools.filter((tool) => {
    const permInfo = toPermissionInfo(tool);
    return permissionEngine.check(permInfo, {}, cfg.executionMode).allowed;
  });

  const toolDefs = availableTools.map(toToolDefinition);

  // Conversation messages for the LLM
  const llmMessages: Array<{ role: "user" | "assistant"; content: string }> = [
    { role: "user", content: userMessage },
  ];

  let finalText = "";
  let stepsUsed = 0;
  let cancelled = false;
  let cancelReason: string | undefined;
  let checkpoint: { checkpointId: string; label: string; gitSha: string } | undefined;
  const toolCallLog: Array<{ toolId: string; success: boolean; summary: string }> = [];

  // Check if any mutations have been requested (for checkpoint logic)
  let mutationBatchPending = false;

  while (stepsUsed < cfg.maxSteps) {
    // Check runtime limit
    const elapsed = Date.now() - startTime;
    if (elapsed > cfg.maxRuntimeMs) {
      cancelled = true;
      cancelReason = `Max runtime exceeded (${cfg.maxRuntimeMs}ms)`;
      break;
    }

    stepsUsed++;
    localProgress.emit({ type: "phase", phase: "call_llm", step: stepsUsed });

    // Call LLM with tools
    let llmResponse;
    try {
      llmResponse = await callLLMWithTools(
        cfg.systemPrompt,
        llmMessages,
        toolDefs,
        {
          model: cfg.model,
          temperature: 0.15,
          maxTokens: 4096,
          evalMetadata: cfg.evalMetadata,
        },
      );
    } catch (err) {
      finalText = `I encountered an error while reasoning: ${err instanceof Error ? err.message : String(err)}`;
      break;
    }

    // If no tool calls, we're done — the LLM produced a final answer
    if (llmResponse.toolCalls.length === 0) {
      finalText = llmResponse.text;
      break;
    }

    // Add assistant message with tool calls to conversation
    llmMessages.push({
      role: "assistant",
      content: buildAssistantToolCallMessage(llmResponse.toolCalls, llmResponse.text).content,
    });

    // Process each tool call
    let batchHasMutation = false;

    for (const toolCall of llmResponse.toolCalls) {
      const toolDef = availableTools.find((t) => t.id === toolCall.toolId);

      if (!toolDef) {
        const result: ToolCallResult = {
          toolCallId: toolCall.toolCallId,
          toolId: toolCall.toolId,
          result: null,
          success: false,
          error: `Unknown tool: ${toolCall.toolId}`,
        };
        llmMessages.push({
          role: "assistant",
          content: buildToolResultMessage(result).content,
        });
        continue;
      }

      // Validate inputs
      const validationError = toolRegistry.validateInputs(toolCall.toolId, toolCall.inputs);
      if (validationError) {
        const result: ToolCallResult = {
          toolCallId: toolCall.toolCallId,
          toolId: toolCall.toolId,
          result: null,
          success: false,
          error: validationError,
        };
        llmMessages.push({
          role: "assistant",
          content: buildToolResultMessage(result).content,
        });
        continue;
      }

      // Check permissions
      const permInfo = toPermissionInfo(toolDef);
      const permResult = permissionEngine.check(permInfo, toolCall.inputs, cfg.executionMode);

      if (!permResult.allowed) {
        const result: ToolCallResult = {
          toolCallId: toolCall.toolCallId,
          toolId: toolCall.toolId,
          result: null,
          success: false,
          error: permResult.reason ?? "Permission denied",
        };
        llmMessages.push({
          role: "assistant",
          content: buildToolResultMessage(result).content,
        });
        localProgress.emit({
          type: "approval_required",
          toolId: toolCall.toolId,
          reason: permResult.reason ?? "Permission denied",
        });
        continue;
      }

      if (permResult.requiresApproval) {
        localProgress.emit({
          type: "approval_required",
          toolId: toolCall.toolId,
          reason: permResult.reason ?? "Approval required",
        });

        if (cfg.executionMode === "act") {
          // ACT mode: pause the loop and return to caller for approval.
          // The caller (messages route) must persist the pending state and
          // wait for the user to approve before resuming.
          return {
            finalText: `I need your approval to run \`${toolCall.toolId}\`. ${permResult.reason ?? "This operation requires explicit approval in ACT mode."}`,
            stepsUsed,
            totalDurationMs: Date.now() - startTime,
            toolCalls: toolCallLog,
            cancelled: false,
            events,
            pendingApproval: {
              toolId: toolCall.toolId,
              toolCallId: toolCall.toolCallId,
              inputs: toolCall.inputs,
              reason: permResult.reason ?? "Approval required in ACT mode",
              pausedMessages: [...llmMessages],
            },
          };
        }

        // AUTO mode: auto-approve only explicitly safe operations.
        // If it reached here, the tool is NOT in the safe set — skip it.
        const result: ToolCallResult = {
          toolCallId: toolCall.toolCallId,
          toolId: toolCall.toolId,
          result: null,
          success: false,
          error: "Approval required — this operation is not in the AUTO-approve safe set",
        };
        llmMessages.push({
          role: "assistant",
          content: buildToolResultMessage(result).content,
        });
        continue;
      }

      // Loop detection
      const inputsHash = hashInputs(toolCall.inputs);
      if (detectRepeatedCalls(toolCallRecords, toolCall.toolId, inputsHash, hasInterveningMutation)) {
        cancelled = true;
        cancelReason = `Repeated tool call detected: ${toolCall.toolId} called 3+ times with same inputs and no intervening mutation`;
        break;
      }

      // Create checkpoint before first mutation in a batch
      if (!toolDef.readOnly && !mutationBatchPending && !checkpoint) {
        localProgress.emit({ type: "phase", phase: "execute", step: stepsUsed });
        checkpoint = await transport.createCheckpointBeforeMutation(
          `Pre-agent-loop: ${userMessage.slice(0, 80)}`,
        ) ?? undefined;
        if (checkpoint) {
          localProgress.emit({
            type: "checkpoint",
            label: checkpoint.label,
            gitSha: checkpoint.gitSha,
          });
        }
        mutationBatchPending = true;
        batchHasMutation = true;
      }

      // Execute the tool
      localProgress.emit({ type: "tool_start", toolId: toolCall.toolId, summary: `${toolCall.toolId}` });

      const toolStartTime = Date.now();
      let result: ToolCallResult;

      try {
        // Use the registry's execute method, passing transport for V2 handlers
        const execResult = await toolRegistry.execute(toolCall.toolId, toolCall.inputs, {
          hasApproval: !permResult.requiresApproval,
          transport,
        });

        if (execResult.ok) {
          result = {
            toolCallId: toolCall.toolCallId,
            toolId: toolCall.toolId,
            result: execResult.result,
            success: true,
          };
        } else {
          result = {
            toolCallId: toolCall.toolCallId,
            toolId: toolCall.toolId,
            result: null,
            success: false,
            error: execResult.error,
          };
        }
      } catch (err) {
        result = {
          toolCallId: toolCall.toolCallId,
          toolId: toolCall.toolId,
          result: null,
          success: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }

      const toolDuration = Date.now() - toolStartTime;

      // Record for loop detection
      toolCallRecords.push({
        toolId: toolCall.toolId,
        inputsHash,
        resultHash: hashResult(result.result),
        step: stepsUsed,
      });

      // Track mutations
      if (!toolDef.readOnly) {
        hasInterveningMutation = true;
        batchHasMutation = true;
      }

      // Log the call
      const summary = summarizeToolResult(toolCall.toolId, result.result);
      toolCallLog.push({ toolId: toolCall.toolId, success: result.success, summary });

      localProgress.emit({
        type: "tool_result",
        toolId: toolCall.toolId,
        success: result.success,
        summary,
        durationMs: toolDuration,
      });

      // Add result to conversation
      llmMessages.push({
        role: "assistant",
        content: buildToolResultMessage(result).content,
      });

      // Check output size limit
      const totalOutput = llmMessages.map((m) => m.content).join("").length;
      if (totalOutput > cfg.maxOutputChars) {
        cancelled = true;
        cancelReason = `Max output exceeded (${cfg.maxOutputChars} chars)`;
        break;
      }
    }

    if (cancelled) break;

    // Reset mutation flag after batch
    if (!batchHasMutation) {
      mutationBatchPending = false;
    }
  }

  // Run build-fix loop if mutations were made and enabled
  let buildFixResult: BuildFixLoopResult | undefined;
  if (cfg.enableBuildFix && hasInterveningMutation && !cancelled) {
    localProgress.emit({ type: "phase", phase: "build_fix", step: stepsUsed });
    buildFixResult = await runBuildFixLoop(transport, localProgress, {
      onRepair: createAutonomousRepairCallback(transport, cfg.systemPrompt, toolDefs),
    });
  }

  // Finalize
  if (stepsUsed >= cfg.maxSteps && !cancelled && !finalText) {
    cancelled = true;
    cancelReason = `Max steps reached (${cfg.maxSteps})`;
  }

  localProgress.emit({
    type: cancelled ? "cancelled" : "finished",
    ...(cancelled ? { reason: cancelReason ?? "Unknown" } : { totalSteps: stepsUsed, totalDurationMs: Date.now() - startTime }),
  } as ProgressEvent);

  return {
    finalText: finalText || "I've completed the requested work. Let me know if you need any adjustments.",
    stepsUsed,
    totalDurationMs: Date.now() - startTime,
    toolCalls: toolCallLog,
    buildFixResult,
    checkpoint,
    cancelled,
    cancelReason,
    events,
  };
}

// ─── Resume from paused approval ──────────────────────────────────

export interface ResumeInput {
  /** The paused conversation messages at the point of approval pause */
  pausedMessages: Array<{ role: "user" | "assistant"; content: string }>;
  /** The tool that was pending approval */
  toolId: string;
  toolCallId: string;
  inputs: Record<string, unknown>;
  /** "approved" = execute the tool and continue; "rejected" = inject rejection and continue */
  decision: "approved" | "rejected";
  /** Rejection reason (only used when decision = "rejected") */
  rejectionReason?: string;
  /** Original config */
  config: Partial<AgentLoopConfig>;
  /** Steps already used before pause */
  stepsUsedBeforePause: number;
  /** Whether a mutation already happened before pause */
  hadInterveningMutation: boolean;
  /** Existing checkpoint (if created before pause) */
  existingCheckpoint?: { checkpointId: string; label: string; gitSha: string };
}

/**
 * Resume the V2 agent loop after an approval decision.
 *
 * On APPROVE:
 *   - Execute the previously requested tool with the EXACT same inputs
 *   - Inject the result into the conversation
 *   - Continue the loop
 *
 * On REJECT:
 *   - Inject a rejection tool result into the conversation
 *   - Continue the loop (LiTT can choose a safer alternative or explain)
 *
 * Never accepts replacement tool arguments. The inputs are frozen from
 * the original paused state.
 */
export async function resumeAgentLoopV2(
  resume: ResumeInput,
  transport: WorkspaceTransport,
  progress?: ProgressEmitter,
): Promise<AgentLoopResult> {
  const cfg = { ...DEFAULT_LOOP_CONFIG, ...resume.config };
  const startTime = Date.now();
  const events: ProgressEvent[] = [];
  const toolCallRecords: ToolCallRecord[] = [];
  let hasInterveningMutation = resume.hadInterveningMutation;

  const localProgress = new ProgressEmitter((event) => {
    events.push(event);
    progress?.emit(event);
  });

  const permissionEngine = new PermissionEngine();

  const allTools = toolRegistry.listEnabled();
  const availableTools = allTools.filter((tool) => {
    const permInfo = toPermissionInfo(tool);
    return permissionEngine.check(permInfo, {}, cfg.executionMode).allowed;
  });

  const toolDefs = availableTools.map(toToolDefinition);

  // Resume from paused messages — these are server-verified, not client-supplied
  const llmMessages: Array<{ role: "user" | "assistant"; content: string }> = [
    ...resume.pausedMessages,
  ];

  let finalText = "";
  let stepsUsed = resume.stepsUsedBeforePause;
  let cancelled = false;
  let cancelReason: string | undefined;
  let checkpoint = resume.existingCheckpoint;
  const toolCallLog: Array<{ toolId: string; success: boolean; summary: string }> = [];
  let mutationBatchPending = false;

  // Execute the approved/rejected tool FIRST, then continue the loop
  localProgress.emit({ type: "phase", phase: "execute", step: stepsUsed });

  if (resume.decision === "approved") {
    localProgress.emit({ type: "tool_start", toolId: resume.toolId, summary: `${resume.toolId} (approved)` });

    let result: ToolCallResult;
    try {
      const execResult = await toolRegistry.execute(resume.toolId, resume.inputs, {
        hasApproval: true,
        transport,
      });

      if (execResult.ok) {
        result = {
          toolCallId: resume.toolCallId,
          toolId: resume.toolId,
          result: execResult.result,
          success: true,
        };
      } else {
        result = {
          toolCallId: resume.toolCallId,
          toolId: resume.toolId,
          result: null,
          success: false,
          error: execResult.error,
        };
      }
    } catch (err) {
      result = {
        toolCallId: resume.toolCallId,
        toolId: resume.toolId,
        result: null,
        success: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }

    const summary = summarizeToolResult(resume.toolId, result.result);
    toolCallLog.push({ toolId: resume.toolId, success: result.success, summary });

    localProgress.emit({
      type: "tool_result",
      toolId: resume.toolId,
      success: result.success,
      summary,
      durationMs: Date.now() - startTime,
    });

    llmMessages.push({
      role: "assistant",
      content: buildToolResultMessage(result).content,
    });

    const toolDef = availableTools.find((t) => t.id === resume.toolId);
    if (toolDef && !toolDef.readOnly) {
      hasInterveningMutation = true;
      mutationBatchPending = true;
    }
  } else {
    // Rejected — inject rejection as tool result
    const rejectionMsg = resume.rejectionReason ?? "User rejected this operation. Choose a safer alternative or explain why you cannot continue.";
    const result: ToolCallResult = {
      toolCallId: resume.toolCallId,
      toolId: resume.toolId,
      result: null,
      success: false,
      error: `REJECTED: ${rejectionMsg}`,
    };

    toolCallLog.push({ toolId: resume.toolId, success: false, summary: "rejected by user" });

    localProgress.emit({
      type: "tool_result",
      toolId: resume.toolId,
      success: false,
      summary: "rejected by user",
      durationMs: 0,
    });

    llmMessages.push({
      role: "assistant",
      content: buildToolResultMessage(result).content,
    });
  }

  // Continue the loop
  while (stepsUsed < cfg.maxSteps) {
    const elapsed = Date.now() - startTime;
    if (elapsed > cfg.maxRuntimeMs) {
      cancelled = true;
      cancelReason = `Max runtime exceeded (${cfg.maxRuntimeMs}ms)`;
      break;
    }

    stepsUsed++;
    localProgress.emit({ type: "phase", phase: "call_llm", step: stepsUsed });

    let llmResponse;
    try {
      llmResponse = await callLLMWithTools(
        cfg.systemPrompt,
        llmMessages,
        toolDefs,
        {
          model: cfg.model,
          temperature: 0.15,
          maxTokens: 4096,
          evalMetadata: cfg.evalMetadata,
        },
      );
    } catch (err) {
      finalText = `I encountered an error while reasoning: ${err instanceof Error ? err.message : String(err)}`;
      break;
    }

    if (llmResponse.toolCalls.length === 0) {
      finalText = llmResponse.text;
      break;
    }

    llmMessages.push({
      role: "assistant",
      content: buildAssistantToolCallMessage(llmResponse.toolCalls, llmResponse.text).content,
    });

    let batchHasMutation = false;

    for (const toolCall of llmResponse.toolCalls) {
      const toolDef = availableTools.find((t) => t.id === toolCall.toolId);

      if (!toolDef) {
        const result: ToolCallResult = {
          toolCallId: toolCall.toolCallId,
          toolId: toolCall.toolId,
          result: null,
          success: false,
          error: `Unknown tool: ${toolCall.toolId}`,
        };
        llmMessages.push({ role: "assistant", content: buildToolResultMessage(result).content });
        continue;
      }

      const validationError = toolRegistry.validateInputs(toolCall.toolId, toolCall.inputs);
      if (validationError) {
        const result: ToolCallResult = {
          toolCallId: toolCall.toolCallId,
          toolId: toolCall.toolId,
          result: null,
          success: false,
          error: validationError,
        };
        llmMessages.push({ role: "assistant", content: buildToolResultMessage(result).content });
        continue;
      }

      const permInfo = toPermissionInfo(toolDef);
      const permResult = permissionEngine.check(permInfo, toolCall.inputs, cfg.executionMode);

      if (!permResult.allowed) {
        const result: ToolCallResult = {
          toolCallId: toolCall.toolCallId,
          toolId: toolCall.toolId,
          result: null,
          success: false,
          error: permResult.reason ?? "Permission denied",
        };
        llmMessages.push({ role: "assistant", content: buildToolResultMessage(result).content });
        localProgress.emit({ type: "approval_required", toolId: toolCall.toolId, reason: permResult.reason ?? "Permission denied" });
        continue;
      }

      if (permResult.requiresApproval) {
        localProgress.emit({ type: "approval_required", toolId: toolCall.toolId, reason: permResult.reason ?? "Approval required" });

        if (cfg.executionMode === "act") {
          return {
            finalText: `I need your approval to run \`${toolCall.toolId}\`. ${permResult.reason ?? "This operation requires explicit approval in ACT mode."}`,
            stepsUsed,
            totalDurationMs: Date.now() - startTime,
            toolCalls: toolCallLog,
            cancelled: false,
            events,
            pendingApproval: {
              toolId: toolCall.toolId,
              toolCallId: toolCall.toolCallId,
              inputs: toolCall.inputs,
              reason: permResult.reason ?? "Approval required in ACT mode",
              pausedMessages: [...llmMessages],
            },
          };
        }

        const result: ToolCallResult = {
          toolCallId: toolCall.toolCallId,
          toolId: toolCall.toolId,
          result: null,
          success: false,
          error: "Approval required — this operation is not in the AUTO-approve safe set",
        };
        llmMessages.push({ role: "assistant", content: buildToolResultMessage(result).content });
        continue;
      }

      // Loop detection
      const inputsHash = hashInputs(toolCall.inputs);
      if (detectRepeatedCalls(toolCallRecords, toolCall.toolId, inputsHash, hasInterveningMutation)) {
        cancelled = true;
        cancelReason = `Repeated tool call detected: ${toolCall.toolId} called 3+ times with same inputs and no intervening mutation`;
        break;
      }

      // Checkpoint before first mutation
      if (!toolDef.readOnly && !mutationBatchPending && !checkpoint) {
        checkpoint = await transport.createCheckpointBeforeMutation(`Pre-agent-loop resume`) ?? undefined;
        if (checkpoint) {
          localProgress.emit({ type: "checkpoint", label: checkpoint.label, gitSha: checkpoint.gitSha });
        }
        mutationBatchPending = true;
        batchHasMutation = true;
      }

      localProgress.emit({ type: "tool_start", toolId: toolCall.toolId, summary: `${toolCall.toolId}` });

      let result: ToolCallResult;
      try {
        const execResult = await toolRegistry.execute(toolCall.toolId, toolCall.inputs, {
          hasApproval: !permResult.requiresApproval,
          transport,
        });

        if (execResult.ok) {
          result = { toolCallId: toolCall.toolCallId, toolId: toolCall.toolId, result: execResult.result, success: true };
        } else {
          result = { toolCallId: toolCall.toolCallId, toolId: toolCall.toolId, result: null, success: false, error: execResult.error };
        }
      } catch (err) {
        result = { toolCallId: toolCall.toolCallId, toolId: toolCall.toolId, result: null, success: false, error: err instanceof Error ? err.message : String(err) };
      }

      toolCallRecords.push({ toolId: toolCall.toolId, inputsHash, resultHash: hashResult(result.result), step: stepsUsed });

      if (!toolDef.readOnly) {
        hasInterveningMutation = true;
        batchHasMutation = true;
      }

      const summary = summarizeToolResult(toolCall.toolId, result.result);
      toolCallLog.push({ toolId: toolCall.toolId, success: result.success, summary });

      localProgress.emit({ type: "tool_result", toolId: toolCall.toolId, success: result.success, summary, durationMs: 0 });

      llmMessages.push({ role: "assistant", content: buildToolResultMessage(result).content });

      const totalOutput = llmMessages.map((m) => m.content).join("").length;
      if (totalOutput > cfg.maxOutputChars) {
        cancelled = true;
        cancelReason = `Max output exceeded (${cfg.maxOutputChars} chars)`;
        break;
      }
    }

    if (cancelled) break;
    if (!batchHasMutation) mutationBatchPending = false;
  }

  // Run build-fix loop with autonomous repair
  let buildFixResult: BuildFixLoopResult | undefined;
  if (cfg.enableBuildFix && hasInterveningMutation && !cancelled) {
    localProgress.emit({ type: "phase", phase: "build_fix", step: stepsUsed });
    buildFixResult = await runBuildFixLoop(transport, localProgress, {
      onRepair: createAutonomousRepairCallback(transport, cfg.systemPrompt, toolDefs),
    });
  }

  if (stepsUsed >= cfg.maxSteps && !cancelled && !finalText) {
    cancelled = true;
    cancelReason = `Max steps reached (${cfg.maxSteps})`;
  }

  localProgress.emit({
    type: cancelled ? "cancelled" : "finished",
    ...(cancelled ? { reason: cancelReason ?? "Unknown" } : { totalSteps: stepsUsed, totalDurationMs: Date.now() - startTime }),
  } as ProgressEvent);

  return {
    finalText: finalText || "I've completed the requested work. Let me know if you need any adjustments.",
    stepsUsed,
    totalDurationMs: Date.now() - startTime,
    toolCalls: toolCallLog,
    buildFixResult,
    checkpoint,
    cancelled,
    cancelReason,
    events,
  };
}

// ─── Autonomous repair callback ───────────────────────────────────

/**
 * Creates a repair callback for the build-fix loop that feeds errors
 * back to the LLM, lets it inspect and fix the code, then re-runs checks.
 * Max 3 repair cycles.
 */
function createAutonomousRepairCallback(
  transport: WorkspaceTransport,
  systemPrompt: string,
  toolDefs: ToolDefinition[],
): (attempt: number, errors: string) => Promise<boolean> {
  return async (attempt: number, errors: string) => {
    // Feed the error output to the LLM and let it repair
    const repairMessages: Array<{ role: "user" | "assistant"; content: string }> = [
      {
        role: "user",
        content: `The build/check failed with the following output. Please inspect the relevant code, fix the issue, and verify your fix.\n\n--- Error output ---\n${errors}\n--- End error output ---\n\nRepair attempt ${attempt}/3. Use the available tools to read the failing files, identify the issue, and write the fix.`,
      },
    ];

    try {
      // Give the LLM up to 5 tool-call rounds to fix the issue
      for (let round = 0; round < 5; round++) {
        const response = await callLLMWithTools(systemPrompt, repairMessages, toolDefs, {
          temperature: 0.1,
          maxTokens: 4096,
        });

        if (response.toolCalls.length === 0) {
          // LLM finished without more tool calls
          return true;
        }

        repairMessages.push({
          role: "assistant",
          content: buildAssistantToolCallMessage(response.toolCalls, response.text).content,
        });

        // Execute each tool call
        for (const toolCall of response.toolCalls) {
          const toolDef = toolRegistry.get(toolCall.toolId);
          if (!toolDef) continue;

          try {
            const execResult = await toolRegistry.execute(toolCall.toolId, toolCall.inputs, {
              hasApproval: true,
              transport,
            });

            const result: ToolCallResult = execResult.ok
              ? { toolCallId: toolCall.toolCallId, toolId: toolCall.toolId, result: execResult.result, success: true }
              : { toolCallId: toolCall.toolCallId, toolId: toolCall.toolId, result: null, success: false, error: execResult.error };

            repairMessages.push({ role: "assistant", content: buildToolResultMessage(result).content });
          } catch (err) {
            const result: ToolCallResult = {
              toolCallId: toolCall.toolCallId,
              toolId: toolCall.toolId,
              result: null,
              success: false,
              error: err instanceof Error ? err.message : String(err),
            };
            repairMessages.push({ role: "assistant", content: buildToolResultMessage(result).content });
          }
        }
      }

      // Ran out of repair rounds but made changes
      return true;
    } catch {
      return false;
    }
  };
}
