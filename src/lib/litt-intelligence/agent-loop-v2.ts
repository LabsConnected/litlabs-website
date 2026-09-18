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
import { callLLMWithTools, buildToolResultMessage, buildAssistantToolCallMessage, summarizeToolResult, AllRoutesFailedError, AgentBudgetExhaustedError, type ToolDefinition, type ToolCallResult, type LLMMessage } from "./llm-tool-calling";
import type { LLMCallMetadata } from "@/lib/evals/braintrust";
import { runBuildFixLoop, type BuildFixLoopResult } from "./build-fix-loop";
import { buildPatchRecoveryMessage, validateApplyPatchInputs, validateFilesWriteInputs } from "./patch-validation";
import { computeWorkspaceChange } from "./workspace-change-producer";
import type { WorkspaceChangeEvidence } from "@/lib/studio/completion-evidence";
import { toolRegistry } from "./tool-registry";
import { resolveAvailableCapabilities } from "./capabilities";
import type { LiTTToolDefinition } from "./types";
import {
  QUALITY_LOOP_PROMPT_SECTION,
  buildRedesignPrompt,
  finalizeQualityLoop,
  harvestStageMarkers,
  MAX_DESIGN_PASSES,
  noteBuildFix,
  noteDeployment,
  noteToolResult,
  runQualityInspection,
  snapshotQualityLoopSession,
  startQualityLoopSession,
  verifyLiveUrl,
  type QualityFinale,
  type QualityLoopSession,
  type QualityLoopSnapshot,
} from "./quality-loop-flow";

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
  /** Upstream/client AbortSignal propagated to all provider calls. */
  signal?: AbortSignal;
  /**
   * Opt-in to the LiTT quality loop (gated UNDERSTAND→VERIFY stages +
   * visual-quality judge). When enabled, the loop records stage evidence
   * from tool events and agent declarations, runs one visual inspection
   * before the final answer, and attaches a success verdict to the result.
   * Additive only: the loop never throws mid-run and never blocks tool
   * execution; the gate bites at finalize() time.
   */
  qualityLoop?: {
    enabled: boolean;
    runId: string;
    projectId: string;
    userId: string;
    /** The user's original request (judge context). Falls back to the first user message. */
    userRequest?: string;
    /** Server-persisted evidence restored after an approval pause. */
    state?: QualityLoopSnapshot;
  };
}

export const DEFAULT_LOOP_CONFIG: AgentLoopConfig = {
  maxSteps: 20,
  maxRuntimeMs: 600_000, // 10 minutes — enough for full build+preview+deploy
  maxOutputChars: 50_000,
  maxRetries: 2,
  executionMode: "act",
  model: undefined,
  systemPrompt: "",
  enableBuildFix: true,
};

/**
 * A tool call the model emitted in the same batch as a call that paused for
 * approval. It was never validated, never executed, and never logged —
 * without persistence + re-injection on resume, approving one tool silently
 * drops the rest of the batch while the run reports "done".
 */
export interface DeferredToolCall {
  toolCallId: string;
  toolId: string;
  inputs: Record<string, unknown>;
}

export interface PendingApproval {
  toolId: string;
  toolCallId: string;
  inputs: Record<string, unknown>;
  reason: string;
  /** The conversation messages at the point of pause — resume from here after approval */
  pausedMessages: LLMMessage[];
  /** Quality evidence captured before this approval pause. */
  qualityLoopState?: QualityLoopSnapshot;
  /** The unexecuted remainder of the batch that hit this gate. */
  deferredToolCalls?: DeferredToolCall[];
  /** Run counters captured at pause time — resume must not restart them at 0. */
  stepsUsedAtPause?: number;
  hadInterveningMutationAtPause?: boolean;
}

export interface AgentLoopResult {
  finalText: string;
  stepsUsed: number;
  totalDurationMs: number;
  toolCalls: Array<{ toolId: string; success: boolean; summary: string; mutating: boolean }>;
  buildFixResult?: BuildFixLoopResult;
  checkpoint?: { checkpointId: string; label: string; gitSha: string };
  /**
   * What the run actually did to the workspace, compared against the
   * pre-mutation checkpoint. Undefined when no mutation was ever reached.
   * A "unknown" status means the comparison failed — never that the
   * workspace is untouched.
   */
  workspaceChange?: WorkspaceChangeEvidence;
  cancelled: boolean;
  cancelReason?: string;
  events: ProgressEvent[];
  /** Set when the loop ended because every model call failed (provider outage, billing, etc.) — sanitized, no secrets */
  modelFailed?: string;
  /** User-facing message for a model failure — truthful and sanitized.
   *  Only set when the loop produced a purpose-written failure message
   *  (all routes exhausted / budget exhausted). */
  modelFailureText?: string;
  /** Set when the loop paused because ACT mode requires approval for a mutation */
  pendingApproval?: PendingApproval;
  /**
   * Quality-loop finale for runs that opted in via config.qualityLoop.
   * The verdict is the machine-readable answer to "is this actually good
   * enough to ship?" — success may only be claimed when verdict.passed.
   */
  qualityLoop?: {
    verdict: QualityFinale["verdict"];
    stages: QualityFinale["stages"];
    designPasses: number;
  };
  /** Canonical quality ledger snapshot, including evidence not yet filed. */
  qualityLoopState?: QualityLoopSnapshot;
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
    // Unify the permission gate with the registry execution gate: a tool
    // whose capability is unavailable is never advertised or approved.
    requiredCapabilities: tool.requiredCapabilities,
  };
}

// ─── Quality loop hooks ───────────────────────────────────────────

/**
 * Quality-gate hook at the point the agent produces its final answer.
 * Harvests any final QUALITY stage markers, then runs the visual
 * inspection once. Returns true when a below-threshold critique demands
 * another design pass — a follow-up prompt has been injected into
 * llmMessages and the caller should `continue` the loop.
 * Never throws: inspection failures degrade to recorded "unavailable".
 */
async function maybeInspectBeforeFinal(
  qualitySession: QualityLoopSession | null,
  llmMessages: LLMMessage[],
  localProgress: ProgressEmitter,
  finalAnswerText: string,
  stepsUsed: number,
  maxSteps: number,
  cancelled: boolean,
): Promise<boolean> {
  if (!qualitySession || cancelled) return false;
  try {
    harvestStageMarkers(qualitySession, [
      { role: "assistant" as const, content: finalAnswerText },
    ]);
    // After a demanded redesign the judge must re-score the new output:
    // reset the once-per-session latch so the next final answer is judged
    // again. Bounded by MAX_DESIGN_PASSES inside runQualityInspection.
    if (
      qualitySession.critiqueFailed &&
      qualitySession.state.designPasses < MAX_DESIGN_PASSES
    ) {
      qualitySession.inspectionRan = false;
    }
    const inspection = await runQualityInspection(qualitySession);
    if (inspection.needsRedesign && stepsUsed < maxSteps) {
      localProgress.emit({ type: "phase", phase: "quality_redesign", step: stepsUsed });
      localProgress.emit({
        type: "status",
        summary:
          `Visual quality ${inspection.score?.toFixed(1) ?? "below"} / 10 ` +
          `under threshold — automatic design pass ${qualitySession.state.designPasses} of 2`,
      });
      llmMessages.push({
        role: "user",
        content: buildRedesignPrompt(inspection, qualitySession.state.designPasses),
      });
      return true;
    }
  } catch {
    // The gate must never break the run.
  }
  return false;
}

/**
 * Finalize a quality-gated run: record build-fix / deploy / verify
 * evidence, compute the success verdict, emit it for LiTT Live, and
 * attach it to the result. Returns the finale (null when not gated).
 */
async function finalizeQualityGatedRun(
  qualitySession: QualityLoopSession | null,
  opts: {
    buildFixResult?: BuildFixLoopResult;
    publicUrl?: string | null;
    deployAttempted: boolean;
    finalText: string;
    localProgress: ProgressEmitter;
  },
): Promise<QualityFinale | null> {
  if (!qualitySession) return null;
  try {
    if (opts.buildFixResult) noteBuildFix(qualitySession, opts.buildFixResult);
    if (opts.publicUrl) {
      noteDeployment(qualitySession, opts.publicUrl);
      await verifyLiveUrl(qualitySession, opts.publicUrl);
    }
    harvestStageMarkers(qualitySession, [
      { role: "assistant" as const, content: opts.finalText },
    ]);
    const finale = finalizeQualityLoop(qualitySession, {
      deployRequested: !!opts.publicUrl || opts.deployAttempted,
    });
    opts.localProgress.emit({
      type: "quality_verdict",
      passed: finale.verdict.ok,
      missing: [...finale.verdict.missing],
      reason: finale.verdict.reason,
      designPasses: finale.designPasses,
    });
    return finale;
  } catch {
    return null;
  }
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

  // Quality loop (opt-in): create the evidence session and teach the agent
  // the stage contract. All hooks below degrade gracefully — the gate
  // itself is enforced at finalize() time, never mid-run.
  let qualitySession: QualityLoopSession | null = null;
  if (cfg.qualityLoop?.enabled) {
    qualitySession = startQualityLoopSession({
      runId: cfg.qualityLoop.runId,
      projectId: cfg.qualityLoop.projectId,
      userId: cfg.qualityLoop.userId,
      userRequest: cfg.qualityLoop.userRequest ?? userMessage,
      snapshot: cfg.qualityLoop.state,
    });
    cfg.systemPrompt += QUALITY_LOOP_PROMPT_SECTION;
  }

  const events: ProgressEvent[] = [];
  const toolCallRecords: ToolCallRecord[] = [];
  let hasInterveningMutation = false;
  // Mutating tool calls that already executed successfully this run —
  // keyed by toolId+inputs. A replacement provider that re-emits an
  // identical mutation after failover replays the recorded result instead
  // of executing it again.
  const executedMutations = new Map<string, ToolCallResult>();
  const patchRecoveryAttempts = new Map<string, number>();

  // Collect progress events
  const localProgress = new ProgressEmitter((event) => {
    events.push(event);
    progress?.emit(event);
  });

  const permissionEngine = new PermissionEngine();

  // Capability set for this run — the single source of truth shared by the
  // permission gate (model-facing tool list + approval decisions below) and
  // the registry execution gate, so an approved tool can never fail closed
  // as "incapable" at execution time. See resolveAvailableCapabilities.
  const availableCapabilities = resolveAvailableCapabilities({ transport });

  // Get available tools from registry, filtered by mode AND capabilities
  const allTools = toolRegistry.listEnabled();
  const availableTools = allTools.filter((tool) => {
    const permInfo = toPermissionInfo(tool);
    return permissionEngine.check(permInfo, {}, cfg.executionMode, availableCapabilities).allowed;
  });

  const toolDefs = availableTools.map(toToolDefinition);

  // Conversation messages for the LLM
  const llmMessages: LLMMessage[] = [
    { role: "user", content: userMessage },
  ];

  let finalText = "";
  let stepsUsed = 0;
  let cancelled = false;
  let cancelReason: string | undefined;
  let modelFailed: string | undefined;
  let modelFailureText: string | undefined;
  let checkpoint: { checkpointId: string; label: string; gitSha: string } | undefined;
  const toolCallLog: Array<{ toolId: string; success: boolean; summary: string; mutating: boolean }> = [];
  let completedDeployment: CompletedDeployment | null = null;

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
    localProgress.emit({ type: "status", summary: `Step ${stepsUsed}: reasoning with ${cfg.model ?? "default model"}` });

    // Call LLM with tools (with automatic fallback)
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
          deadlineMs: startTime + cfg.maxRuntimeMs,
          signal: cfg.signal,
        },
      );
      if (llmResponse.responseShape && llmResponse.provider) {
        localProgress.emit({ type: "model_response", provider: llmResponse.provider, model: llmResponse.model, ...llmResponse.responseShape, finishReason: llmResponse.finishReason });
      }
      // Emit model routing event so LiTT Live shows which provider/model was actually used
      localProgress.emit({
        type: "model_routing",
        model: llmResponse.model,
        provider: llmResponse.provider ?? "unknown",
        fallbackFrom: cfg.model && llmResponse.model !== cfg.model ? cfg.model : undefined,
      });
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      // Emit model failure event with sanitized error (no secrets)
      localProgress.emit({
        type: "model_failed",
        model: cfg.model ?? "default",
        category: "all_fallbacks_exhausted",
        message: errMsg.slice(0, 200),
      });
      modelFailed = errMsg.slice(0, 200);
      finalText = completedDeployment
        ? describeProviderFailureAfterDeployment(completedDeployment, errMsg)
        : err instanceof AllRoutesFailedError
          ? err.userMessage
          : err instanceof AgentBudgetExhaustedError
            ? "I ran out of time before finishing this request. Your project and any completed work are preserved — try again."
            : `I encountered an error while reasoning: ${errMsg}`;
      modelFailureText =
        err instanceof AllRoutesFailedError || err instanceof AgentBudgetExhaustedError
          ? finalText
          : undefined;
      break;
    }

    // If no tool calls, we're done — the LLM produced a final answer
    if (llmResponse.toolCalls.length === 0) {
      // Quality gate: the visual judge may demand another design pass
      // before this answer is accepted as final.
      if (
        await maybeInspectBeforeFinal(
          qualitySession,
          llmMessages,
          localProgress,
          llmResponse.text ?? "",
          stepsUsed,
          cfg.maxSteps,
          cancelled,
        )
      ) {
        continue;
      }
      finalText = llmResponse.text;
      // Emit a reasoning summary so LiTT Live shows the final reasoning step
      if (llmResponse.text) {
        localProgress.emit({
          type: "reasoning",
          summary: llmResponse.text.slice(0, 150),
        });
      }
      break;
    }

    // Emit a reasoning summary for tool-calling steps (what LiTT is about to do)
    if (llmResponse.text) {
      localProgress.emit({
        type: "reasoning",
        summary: llmResponse.text.slice(0, 150),
      });
    }

    // Add assistant message with tool calls to conversation
    llmMessages.push(buildAssistantToolCallMessage(llmResponse.toolCalls, llmResponse.text, llmResponse.rawParts));
    if (qualitySession) {
      harvestStageMarkers(qualitySession, [{ role: "assistant" as const, content: llmResponse.text ?? "" }]);
    }

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
        llmMessages.push(buildToolResultMessage(result));
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
        llmMessages.push(buildToolResultMessage(result));
        continue;
      }

      // Duplicate-mutation protection: if this exact mutating call already
      // executed successfully in this run (e.g. a replacement provider
      // re-emitted it after failover), replay the recorded result instead
      // of executing the mutation a second time.
      const dedupeKey = `${toolCall.toolId}:${hashInputs(toolCall.inputs)}`;
      if (!toolDef.readOnly) {
        const prior = executedMutations.get(dedupeKey);
        if (prior) {
          llmMessages.push(buildToolResultMessage({
            toolCallId: toolCall.toolCallId,
            toolId: toolCall.toolId,
            result: prior.result,
            success: true,
          }));
          toolCallLog.push({ toolId: toolCall.toolId, success: true, summary: "skipped — already executed", mutating: true });
          localProgress.emit({
            type: "tool_result",
            toolId: toolCall.toolId,
            success: true,
            summary: "skipped — already executed",
            durationMs: 0,
          });
          continue;
        }
      }

      // Check permissions
      const permInfo = toPermissionInfo(toolDef);
      const permResult = permissionEngine.check(permInfo, toolCall.inputs, cfg.executionMode, availableCapabilities);

      if (!permResult.allowed) {
        const result: ToolCallResult = {
          toolCallId: toolCall.toolCallId,
          toolId: toolCall.toolId,
          result: null,
          success: false,
          error: permResult.reason ?? "Permission denied",
        };
        llmMessages.push(buildToolResultMessage(result));
        localProgress.emit({
          type: "approval_required",
          toolId: toolCall.toolId,
          reason: permResult.reason ?? "Permission denied",
        });
        continue;
      }

      // Pre-approval write sanity: an apply_patch or files.write whose
      // inputs are provably invalid (unresolved template placeholders like
      // [PERSON_NAME] or {{token}}, or a patch search string that cannot
      // match the target file) must never become an Approve/Reject card —
      // the approval freezes the inputs, so approving a dead write can only
      // fail on resume or persist the token verbatim. Feed the error back
      // as a tool result so the model re-reads and regenerates.
      if (permResult.allowed) {
        const writeError =
          toolCall.toolId === "apply_patch"
            ? await validateApplyPatchInputs(toolCall.inputs, transport)
            : toolCall.toolId === "files.write"
              ? validateFilesWriteInputs(toolCall.inputs)
              : null;
        if (writeError) {
          const recoveryKey = `${toolCall.toolId}:${String(toolCall.inputs.path ?? "")}`;
          const recoveryAttempt = (patchRecoveryAttempts.get(recoveryKey) ?? 0) + 1;
          patchRecoveryAttempts.set(recoveryKey, recoveryAttempt);
          const recoveryMessage = toolCall.toolId === "apply_patch"
            ? await buildPatchRecoveryMessage(toolCall.inputs, transport, writeError, recoveryAttempt)
            : writeError;
          const result: ToolCallResult = {
            toolCallId: toolCall.toolCallId,
            toolId: toolCall.toolId,
            result: null,
            success: false,
            error: recoveryMessage,
          };
          llmMessages.push(buildToolResultMessage(result));
          toolCallLog.push({ toolId: toolCall.toolId, success: false, summary: recoveryAttempt >= 2 ? "invalid write — stopped safely" : "invalid write — re-read and regenerate", mutating: false });
          localProgress.emit({
            type: "tool_result",
            toolId: toolCall.toolId,
            success: false,
            summary: recoveryAttempt >= 2 ? "Invalid patch repeated after disk re-read; stopped without mutation" : "Invalid patch re-read from disk; regenerate or use files.write",
            durationMs: 0,
          });
          if (toolCall.toolId === "apply_patch" && recoveryAttempt >= 2) {
            cancelled = true;
            cancelReason = "The model repeated an unsafe patch after the file was re-read; no mutation was executed";
            finalText = "I could not safely apply that change after re-reading the current file. No mutation was executed.";
            break;
          }
          continue;
        }
      }

      // Create the pre-mutation checkpoint BEFORE the approval gate, so the
      // resumed-after-approval run diffs the workspace truthfully instead of
      // reporting "unknown". Safe when the user rejects: this only snapshots
      // pre-mutation state and never writes workspace files.
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

      if (permResult.requiresApproval) {
        localProgress.emit({
          type: "approval_required",
          toolId: toolCall.toolId,
          reason: permResult.reason ?? "Approval required",
        });

        // The pre-mutation checkpoint is created BEFORE this pause (see
        // above), so the resumed run diffs the workspace truthfully instead
        // of reporting "unknown" ("could not verify whether files changed").
        // It is threaded through the pause result → paused-run record →
        // ResumeInput.existingCheckpoint.
        {
          // Pause the loop and return to the caller for approval — in AUTO
          // mode as well as ACT.
          //
          // AUTO previously SKIPPED any tool outside its safe set, feeding the
          // model an "approval required" error instead of asking the user. A
          // sensitive action was therefore unreachable in AUTO: the user was
          // never prompted, so `project.deploy` could never run. Pausing asks
          // the user instead, which still never grants AUTO more privilege
          // than ACT — the tool runs only after an explicit approval.
          //
          // The calls after this one in the batch were never executed. They
          // are captured as deferred calls on the pause so resume re-injects
          // them after the approved tool runs — approving one tool must not
          // silently drop the rest of the batch.
          return {
            finalText: `I need your approval to run \`${toolCall.toolId}\`. ${permResult.reason ?? "This operation requires explicit approval."}`,
            stepsUsed,
            totalDurationMs: Date.now() - startTime,
            toolCalls: toolCallLog,
            cancelled: false,
            events,
            checkpoint: checkpoint ?? undefined,
            pendingApproval: {
              toolId: toolCall.toolId,
              toolCallId: toolCall.toolCallId,
              inputs: toolCall.inputs,
              reason: permResult.reason ?? "Approval required",
              pausedMessages: [...llmMessages],
              qualityLoopState: qualitySession ? snapshotQualityLoopSession(qualitySession) : undefined,
              deferredToolCalls: deferredCallsAfterBatchPause(llmResponse.toolCalls, toolCall.toolCallId),
              stepsUsedAtPause: stepsUsed,
              hadInterveningMutationAtPause: hasInterveningMutation,
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
        llmMessages.push(buildToolResultMessage(result));
        continue;
      }

      // Loop detection
      const inputsHash = hashInputs(toolCall.inputs);
      if (detectRepeatedCalls(toolCallRecords, toolCall.toolId, inputsHash, hasInterveningMutation)) {
        cancelled = true;
        cancelReason = `Repeated tool call detected: ${toolCall.toolId} called 3+ times with same inputs and no intervening mutation`;
        break;
      }

      // Stop must also stop in-flight tool work: never start a tool call
      // once the caller has aborted.
      if (cfg.signal?.aborted) {
        cancelled = true;
        cancelReason = "Cancelled by user";
        break;
      }

      // Execute the tool
      localProgress.emit({ type: "tool_start", toolId: toolCall.toolId, summary: `${toolCall.toolId}` });

      const toolStartTime = Date.now();
      let result: ToolCallResult;

      try {
        // Use the registry's execute method, passing transport for V2 handlers
        const execResult = await toolRegistry.execute(toolCall.toolId, toolCall.inputs, {
          hasApproval: !permResult.requiresApproval,
          availableCapabilities,
          transport,
        });

        if (execResult.ok) {
          // Handlers use a structured { success: false, error } payload for
          // domain failures that do not throw (for example a lost terminal
          // connection).  The registry call itself succeeded, but the tool
          // operation did not.  Do not turn that into mutation evidence or a
          // false completed build.
          const handlerError = handlerFailureError(execResult.result);
          result = {
            toolCallId: toolCall.toolCallId,
            toolId: toolCall.toolId,
            result: execResult.result,
            success: handlerError === null,
            ...(handlerError !== null ? { error: handlerError } : {}),
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
        if (result.success) executedMutations.set(dedupeKey, result);
      }

      // Log the call
      const summary = summarizeToolResult(toolCall.toolId, result.result);
      toolCallLog.push({ toolId: toolCall.toolId, success: result.success, summary, mutating: !toolDef.readOnly });
      completedDeployment = readDeploymentOutcome(toolCall.toolId, result.result) ?? completedDeployment;
      if (qualitySession) {
        noteToolResult(
          qualitySession,
          toolCall.toolId,
          { success: result.success, result: result.result, mutating: !toolDef.readOnly, summary },
          transport.workspaceId,
        );
      }

      localProgress.emit({
        type: "tool_result",
        toolId: toolCall.toolId,
        success: result.success,
        summary,
        durationMs: toolDuration,
      });

      // Add result to conversation
      llmMessages.push(buildToolResultMessage(result));

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
      onRepair: createAutonomousRepairCallback(transport, cfg.systemPrompt, toolDefs, startTime + cfg.maxRuntimeMs, cfg.signal, cfg.executionMode),
    });
  }

  // Finalize
  if (stepsUsed >= cfg.maxSteps && !cancelled && !finalText) {
    cancelled = true;
    cancelReason = `Max steps reached (${cfg.maxSteps})`;
  }

  // Surface build-fix failures in the final text so callers cannot
  // accidentally report success when validation did not pass.
  // Never fabricate a completion claim. When the model produced no text,
  // report what the evidence supports instead of asserting success.
  const effectiveFinalText =
    finalText ||
    (buildFixResult && !buildFixResult.allPassed
      ? `The build checks did not all pass after ${buildFixResult.repairAttempts} repair attempts.`
      : describeSilentOutcome(toolCallLog, cancelled, cancelReason));

  // Quality gate: finalize the evidence ledger and compute the verdict.
  // When the verdict refuses success, say so plainly in the closing text
  // instead of letting it imply the work is done.
  const qualityFinale = await finalizeQualityGatedRun(qualitySession, {
    buildFixResult,
    publicUrl: completedDeployment?.publicUrl ?? null,
    deployAttempted: toolCallLog.some((t) => t.toolId === "project.deploy"),
    finalText: effectiveFinalText,
    localProgress,
  });
  const gatedFinalText =
    qualityFinale && !qualityFinale.verdict.ok
      ? `${effectiveFinalText}\n\nQuality check — ${qualityFinale.verdict.reason.charAt(0).toLowerCase()}${qualityFinale.verdict.reason.slice(1)}`
      : effectiveFinalText;

  localProgress.emit({
    type: cancelled ? "cancelled" : "finished",
    ...(cancelled ? { reason: cancelReason ?? "Unknown" } : { totalSteps: stepsUsed, totalDurationMs: Date.now() - startTime }),
  } as ProgressEvent);

  // What did this run actually do to the files?
  //
  // Tool success flags cannot answer that: a tool can write bytes and then
  // fail, and a cancelled run can be stopped after a write has landed. The
  // checkpoint above is the baseline, so the workspace is compared against
  // it whenever a mutation was reached. A failure to compare yields
  // "unknown" — never a claim that nothing changed.
  // A checkpoint only exists once a mutation was reached. An attempted
  // mutation with NO checkpoint (checkpoint creation itself failed) still
  // needs evidence — it resolves to "unknown", which is the honest answer,
  // rather than being silently omitted.
  const attemptedMutation = toolCallLog.some((call) => call.mutating);
  const workspaceChange = checkpoint || attemptedMutation
    ? await computeWorkspaceChange(transport, checkpoint ?? null)
    : undefined;

  return {
    finalText: gatedFinalText,
    stepsUsed,
    totalDurationMs: Date.now() - startTime,
    toolCalls: toolCallLog,
    buildFixResult,
    checkpoint,
    workspaceChange,
    cancelled,
    cancelReason,
    events,
    modelFailed,
    modelFailureText,
    qualityLoop: qualityFinale
      ? {
          verdict: qualityFinale.verdict,
          stages: qualityFinale.stages,
          designPasses: qualityFinale.designPasses,
        }
      : undefined,
    qualityLoopState: qualitySession ? snapshotQualityLoopSession(qualitySession) : undefined,
  };
}

/**
 * Text for a run where the model returned no final message.
 *
 * The previous default asserted "I've completed the requested work", which
 * claimed success for runs that changed nothing. This reports only what the
 * tool log actually supports.
 */
function describeSilentOutcome(
  toolCalls: Array<{ toolId: string; success: boolean; mutating: boolean }>,
  cancelled: boolean,
  cancelReason?: string,
): string {
  if (cancelled) {
    return `I stopped before finishing: ${cancelReason ?? "the run was cancelled"}. Nothing further was changed.`;
  }
  const succeeded = toolCalls.filter((c) => c.success);
  const mutations = succeeded.filter((c) => c.mutating);
  if (toolCalls.length === 0) {
    return "I did not run any tools and nothing was changed. Tell me how you'd like to proceed and I'll carry it out.";
  }
  if (mutations.length === 0) {
    return `I ran ${succeeded.length} read-only step(s) but made no changes. Nothing was created, modified, or deployed.`;
  }
  return `I completed ${succeeded.length} step(s), including ${mutations.length} change(s) to the workspace, but produced no closing summary. Review the work log for what changed.`;
}


/**
 * A deployment that already completed during this run.
 *
 * Held separately from the tool log so that if the provider dies on the
 * continuation turn, the closing text can still report the live URL. The
 * user's site IS published at that point; replacing that fact with a bare
 * "I encountered an error" would hide completed work — and would also invite
 * a retry that deploys a second time.
 */
interface CompletedDeployment {
  deploymentId: string | null;
  publicUrl: string;
}

/** Extract a completed deployment from a successful project.deploy result. */
function readDeploymentOutcome(toolId: string, result: unknown): CompletedDeployment | null {
  if (toolId !== "project.deploy" || !result || typeof result !== "object") return null;
  const payload = result as {
    success?: boolean;
    liveUrl?: unknown;
    deployment?: { deploymentId?: unknown; publicUrl?: unknown; status?: unknown };
  };
  if (payload.success !== true) return null;
  const url = typeof payload.liveUrl === "string" && payload.liveUrl
    ? payload.liveUrl
    : typeof payload.deployment?.publicUrl === "string" ? payload.deployment.publicUrl : null;
  if (!url) return null;
  return {
    deploymentId: typeof payload.deployment?.deploymentId === "string" ? payload.deployment.deploymentId : null,
    publicUrl: url,
  };
}

/** Closing text when the provider failed but a deployment had succeeded. */
function describeProviderFailureAfterDeployment(
  deployment: CompletedDeployment,
  errMsg: string,
): string {
  return (
    `Your site is live at ${deployment.publicUrl}. `
    + "The deployment completed and the URL was verified, so it does not need to be run again. "
    + `I then hit a provider error while writing the summary: ${errMsg}`
  );
}

// ─── Resume from paused approval ──────────────────────────────────

/**
 * Extract a domain-level failure from a tool handler's result payload.
 * Handlers signal failure by returning { success: false, error? } instead
 * of throwing (e.g. workspace transport errors). Returns the error message,
 * or null when the payload does not report failure.
 */
export function handlerFailureError(payload: unknown): string | null {
  if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    const rec = payload as Record<string, unknown>;
    if (rec.success === false) {
      if (typeof rec.error === "string" && rec.error.trim()) return rec.error;
      try {
        return JSON.stringify(payload).slice(0, 500);
      } catch {
        return "tool reported failure";
      }
    }
  }
  return null;
}

export interface ResumeInput {
  /** The paused conversation messages at the point of approval pause */
  pausedMessages: LLMMessage[];
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
  /**
   * Calls deferred from the batch that hit the approval gate. Executed
   * after the approved tool on resume (in batch order), through the same
   * validate → permission → dedupe → execute machinery as a live batch.
   */
  deferredToolCalls?: DeferredToolCall[];
  /**
   * Capability set the model-facing tool list was filtered with when the
   * user approved. Threaded into the resume execution gate so the approved
   * tool cannot fail closed as "incapable". Optional for backwards
   * compatibility — resume falls back to resolving fresh when absent.
   */
  availableCapabilities?: string[];
}

/**
 * Split a tool-call batch at the call that paused for approval: everything
 * after it was never executed and becomes the deferred remainder. Pure —
 * the caller persists the result on the paused run and re-injects it on
 * resume.
 */
export function deferredCallsAfterBatchPause(
  batch: Array<{ toolCallId: string; toolId: string; inputs: Record<string, unknown> }>,
  pausedToolCallId: string,
): DeferredToolCall[] {
  const idx = batch.findIndex((c) => c.toolCallId === pausedToolCallId);
  if (idx < 0) return [];
  return batch.slice(idx + 1).map((c) => ({
    toolCallId: c.toolCallId,
    toolId: c.toolId,
    inputs: c.inputs,
  }));
}

/**
 * Mutable run state shared with deferred-call re-injection. The helper
 * mutates this in place; the caller reads it back after the await.
 */
export interface DeferredToolBatchState {
  hasInterveningMutation: boolean;
  cancelled: boolean;
  cancelReason?: string;
  checkpoint?: { checkpointId: string; label: string; gitSha: string };
  mutationBatchPending: boolean;
  batchHasMutation: boolean;
  completedDeployment: CompletedDeployment | null;
}

export interface DeferredToolBatchContext {
  availableTools: LiTTToolDefinition[];
  executionMode: ExecutionMode;
  transport: WorkspaceTransport;
  llmMessages: LLMMessage[];
  toolCallLog: Array<{ toolId: string; success: boolean; summary: string; mutating: boolean }>;
  toolCallRecords: ToolCallRecord[];
  executedMutations: Map<string, ToolCallResult>;
  localProgress: ProgressEmitter;
  qualitySession: QualityLoopSession | null;
  startTime: number;
  stepsUsed: number;
  maxOutputChars: number;
  /** Upstream/client abort signal. Deferred execution must honor the same stop request as the resumed loop. */
  signal?: AbortSignal;
  state: DeferredToolBatchState;
}

export interface DeferredToolBatchResult {
  /**
   * Set when a deferred call hit a NEW approval gate. The remaining deferred
   * calls stay attached to it, so the next resume continues the batch —
   * the batch is never truncated, it just pauses again.
   */
  nestedApproval: PendingApproval | null;
}

/**
 * Execute deferred tool calls (the unexecuted remainder of the batch that
 * hit an approval gate) after the approved tool ran on resume.
 *
 * Each call goes through the same validate → dedupe → permission →
 * loop-detection → checkpoint → execute → log machinery as a live batch:
 * a deferred mutation that itself requires approval pauses AGAIN (nested
 * gate, remainder still attached), a disallowed one feeds back an honest
 * error result, and every call lands in the toolCalls transcript. This is
 * the "re-injection" half of the no-silent-truncation fix; the other half
 * is `deferredCallsAfterBatchPause` capturing the remainder at pause time.
 */
export async function executeDeferredToolCalls(
  deferred: DeferredToolCall[],
  ctx: DeferredToolBatchContext,
): Promise<DeferredToolBatchResult> {
  const { state } = ctx;
  const permissionEngine = new PermissionEngine();

  for (const toolCall of deferred) {
    // A resumed approval batch must honor the same user stop signal as the
    // surrounding agent loop. Check before every deferred execution so an
    // already-aborted resume executes zero remaining tools, and a mid-batch
    // abort prevents every later call from starting.
    if (ctx.signal?.aborted) {
      state.cancelled = true;
      state.cancelReason = "Cancelled by user";
      break;
    }

    const toolDef = ctx.availableTools.find((t) => t.id === toolCall.toolId);

    if (!toolDef) {
      const result: ToolCallResult = {
        toolCallId: toolCall.toolCallId,
        toolId: toolCall.toolId,
        result: null,
        success: false,
        error: `Unknown tool: ${toolCall.toolId}`,
      };
      ctx.llmMessages.push(buildToolResultMessage(result));
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
      ctx.llmMessages.push(buildToolResultMessage(result));
      continue;
    }

    // Duplicate-mutation protection: a deferred call identical to an
    // already-executed mutation replays the recorded result.
    const dedupeKey = `${toolCall.toolId}:${hashInputs(toolCall.inputs)}`;
    if (!toolDef.readOnly) {
      const prior = ctx.executedMutations.get(dedupeKey);
      if (prior) {
        ctx.llmMessages.push(buildToolResultMessage({
          toolCallId: toolCall.toolCallId,
          toolId: toolCall.toolId,
          result: prior.result,
          success: true,
        }));
        ctx.toolCallLog.push({ toolId: toolCall.toolId, success: true, summary: "skipped — already executed", mutating: true });
        ctx.localProgress.emit({
          type: "tool_result",
          toolId: toolCall.toolId,
          success: true,
          summary: "skipped — already executed",
          durationMs: 0,
        });
        continue;
      }
    }

    const permInfo = toPermissionInfo(toolDef);
    const permResult = permissionEngine.check(permInfo, toolCall.inputs, ctx.executionMode);

    if (!permResult.allowed) {
      const result: ToolCallResult = {
        toolCallId: toolCall.toolCallId,
        toolId: toolCall.toolId,
        result: null,
        success: false,
        error: permResult.reason ?? "Permission denied",
      };
      ctx.llmMessages.push(buildToolResultMessage(result));
      ctx.localProgress.emit({
        type: "approval_required",
        toolId: toolCall.toolId,
        reason: permResult.reason ?? "Permission denied",
      });
      continue;
    }

    if (permResult.requiresApproval) {
      ctx.localProgress.emit({
        type: "approval_required",
        toolId: toolCall.toolId,
        reason: permResult.reason ?? "Approval required",
      });

      if (ctx.executionMode === "act") {
        // Pause again — the calls after this one stay deferred on the new
        // gate, so the batch still loses nothing.
        return {
          nestedApproval: {
            toolId: toolCall.toolId,
            toolCallId: toolCall.toolCallId,
            inputs: toolCall.inputs,
            reason: permResult.reason ?? "Approval required",
            pausedMessages: [...ctx.llmMessages],
            qualityLoopState: ctx.qualitySession ? snapshotQualityLoopSession(ctx.qualitySession) : undefined,
            deferredToolCalls: deferredCallsAfterBatchPause(deferred, toolCall.toolCallId),
            stepsUsedAtPause: ctx.stepsUsed,
            hadInterveningMutationAtPause: state.hasInterveningMutation,
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
      ctx.llmMessages.push(buildToolResultMessage(result));
      continue;
    }

    // Loop detection
    const inputsHash = hashInputs(toolCall.inputs);
    if (detectRepeatedCalls(ctx.toolCallRecords, toolCall.toolId, inputsHash, state.hasInterveningMutation)) {
      state.cancelled = true;
      state.cancelReason = `Repeated tool call detected: ${toolCall.toolId} called 3+ times with same inputs and no intervening mutation`;
      break;
    }

    // Checkpoint before first mutation
    if (!toolDef.readOnly && !state.mutationBatchPending && !state.checkpoint) {
      ctx.localProgress.emit({ type: "phase", phase: "execute", step: ctx.stepsUsed });
      state.checkpoint = await ctx.transport.createCheckpointBeforeMutation(
        `Pre-agent-loop resume (deferred batch)`,
      ) ?? undefined;
      if (state.checkpoint) {
        ctx.localProgress.emit({
          type: "checkpoint",
          label: state.checkpoint.label,
          gitSha: state.checkpoint.gitSha,
        });
      }
      state.mutationBatchPending = true;
      state.batchHasMutation = true;
    }

    ctx.localProgress.emit({ type: "tool_start", toolId: toolCall.toolId, summary: `${toolCall.toolId} (deferred)` });

    let result: ToolCallResult;
    try {
      const execResult = await toolRegistry.execute(toolCall.toolId, toolCall.inputs, {
        hasApproval: !permResult.requiresApproval,
        transport: ctx.transport,
      });

      if (execResult.ok) {
        result = { toolCallId: toolCall.toolCallId, toolId: toolCall.toolId, result: execResult.result, success: true };
      } else {
        result = { toolCallId: toolCall.toolCallId, toolId: toolCall.toolId, result: null, success: false, error: execResult.error };
      }
    } catch (err) {
      result = { toolCallId: toolCall.toolCallId, toolId: toolCall.toolId, result: null, success: false, error: err instanceof Error ? err.message : String(err) };
    }

    ctx.toolCallRecords.push({ toolId: toolCall.toolId, inputsHash, resultHash: hashResult(result.result), step: ctx.stepsUsed });

    if (!toolDef.readOnly) {
      state.hasInterveningMutation = true;
      state.batchHasMutation = true;
      if (result.success) ctx.executedMutations.set(dedupeKey, result);
    }

    const summary = summarizeToolResult(toolCall.toolId, result.result);
    ctx.toolCallLog.push({ toolId: toolCall.toolId, success: result.success, summary, mutating: !toolDef.readOnly });
    state.completedDeployment = readDeploymentOutcome(toolCall.toolId, result.result) ?? state.completedDeployment;
    if (ctx.qualitySession) {
      noteToolResult(
        ctx.qualitySession,
        toolCall.toolId,
        { success: result.success, result: result.result, mutating: !toolDef.readOnly, summary },
        ctx.transport.workspaceId,
      );
    }

    ctx.localProgress.emit({ type: "tool_result", toolId: toolCall.toolId, success: result.success, summary, durationMs: 0 });

    ctx.llmMessages.push(buildToolResultMessage(result));

    const totalOutput = ctx.llmMessages.map((m) => m.content).join("").length;
    if (totalOutput > ctx.maxOutputChars) {
      state.cancelled = true;
      state.cancelReason = `Max output exceeded (${ctx.maxOutputChars} chars)`;
      break;
    }
  }

  return { nestedApproval: null };
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

  // Quality loop (opt-in): restore the server-persisted evidence session from
  // before the approval pause. The paused messages are still re-harvested for
  // idempotency, but conversation text is not the source of machine evidence.
  let qualitySession: QualityLoopSession | null = null;
  if (cfg.qualityLoop?.enabled) {
    qualitySession = startQualityLoopSession({
      runId: cfg.qualityLoop.runId,
      projectId: cfg.qualityLoop.projectId,
      userId: cfg.qualityLoop.userId,
      userRequest: cfg.qualityLoop.userRequest ?? "",
      snapshot: cfg.qualityLoop.state,
    });
    cfg.systemPrompt += QUALITY_LOOP_PROMPT_SECTION;
  }

  const events: ProgressEvent[] = [];
  const toolCallRecords: ToolCallRecord[] = [];
  let hasInterveningMutation = resume.hadInterveningMutation;
  const executedMutations = new Map<string, ToolCallResult>();

  const localProgress = new ProgressEmitter((event) => {
    events.push(event);
    progress?.emit(event);
  });

  const permissionEngine = new PermissionEngine();

  // Capability set for the resumed run. Prefer the set captured at approval
  // time (the model-facing tool list the user approved against); fall back
  // to resolving fresh so runs paused before this field existed self-heal
  // instead of failing closed on every capability-gated tool.
  const availableCapabilities =
    resume.availableCapabilities ?? resolveAvailableCapabilities({ transport });

  const allTools = toolRegistry.listEnabled();
  const availableTools = allTools.filter((tool) => {
    const permInfo = toPermissionInfo(tool);
    return permissionEngine.check(permInfo, {}, cfg.executionMode, availableCapabilities).allowed;
  });

  const toolDefs = availableTools.map(toToolDefinition);

  // Resume from paused messages — these are server-verified, not client-supplied
  const llmMessages: LLMMessage[] = [
    ...resume.pausedMessages,
  ];
  if (qualitySession) {
    // Re-harvest agent stage markers from before the approval pause.
    harvestStageMarkers(qualitySession, resume.pausedMessages);
  }

  let finalText = "";
  let stepsUsed = resume.stepsUsedBeforePause;
  let cancelled = false;
  let cancelReason: string | undefined;
  let modelFailed: string | undefined;
  let modelFailureText: string | undefined;
  let checkpoint = resume.existingCheckpoint;
  const toolCallLog: Array<{ toolId: string; success: boolean; summary: string; mutating: boolean }> = [];
  let completedDeployment: CompletedDeployment | null = null;
  let mutationBatchPending = false;
  let batchHasMutation = false;

  // Execute the approved/rejected tool FIRST, then continue the loop
  localProgress.emit({ type: "phase", phase: "execute", step: stepsUsed });

  if (resume.decision === "approved") {
    localProgress.emit({ type: "tool_start", toolId: resume.toolId, summary: `${resume.toolId} (approved)` });

    let result: ToolCallResult;
    if (cfg.signal?.aborted) {
      // The run was stopped while awaiting approval: the approved tool
      // must not execute. Surface cancelled without running it.
      cancelled = true;
      cancelReason = "Cancelled by user";
      result = {
        toolCallId: resume.toolCallId,
        toolId: resume.toolId,
        result: null,
        success: false,
        error: "Cancelled by user",
      };
    } else try {
      const execResult = await toolRegistry.execute(resume.toolId, resume.inputs, {
        hasApproval: true,
        availableCapabilities,
        transport,
      });

      if (execResult.ok) {
        // A handler can execute without throwing yet still report a
        // domain-level failure ({ success: false, ... }) — e.g. the
        // workspace transport is unreachable and files.mkdir returns
        // { success: false, error }. Recording that as a successful
        // mutation is a lie the rest of the run builds on: the toolCalls
        // log would claim success, it would count as an intervening
        // mutation (weakening loop detection, triggering build-fix for
        // nothing), and the run could complete "successfully" with
        // nothing created. Surface it as the failure it is so the
        // model can retry or report, and the run result stays truthful.
        const handlerError = handlerFailureError(execResult.result);
        if (handlerError !== null) {
          result = {
            toolCallId: resume.toolCallId,
            toolId: resume.toolId,
            result: execResult.result,
            success: false,
            error: handlerError,
          };
        } else {
          result = {
            toolCallId: resume.toolCallId,
            toolId: resume.toolId,
            result: execResult.result,
            success: true,
          };
        }
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
    // A resumed call is one that required approval, so treat an unknown
    // tool as mutating rather than silently crediting a read-only step.
    const resumedReadOnly = availableTools.find((t) => t.id === resume.toolId)?.readOnly ?? false;
    toolCallLog.push({ toolId: resume.toolId, success: result.success, summary, mutating: !resumedReadOnly });
    completedDeployment = readDeploymentOutcome(resume.toolId, result.result) ?? completedDeployment;

    localProgress.emit({
      type: "tool_result",
      toolId: resume.toolId,
      success: result.success,
      summary,
      durationMs: Date.now() - startTime,
    });

    llmMessages.push(buildToolResultMessage(result));

    const toolDef = availableTools.find((t) => t.id === resume.toolId);
    // Only a successful mutation counts: a failed approved call must not
    // be cached as executed work or weaken loop detection.
    if (toolDef && !toolDef.readOnly && result.success) {
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

    toolCallLog.push({
      toolId: resume.toolId,
      success: false,
      summary: "rejected by user",
      mutating: !(availableTools.find((t) => t.id === resume.toolId)?.readOnly ?? false),
    });

    localProgress.emit({
      type: "tool_result",
      toolId: resume.toolId,
      success: false,
      summary: "rejected by user",
      durationMs: 0,
    });

    llmMessages.push(buildToolResultMessage(result));
  }

  // Re-inject the deferred remainder of the batch that hit the approval
  // gate: these calls were never executed before the pause, and approving
  // the gated tool must not silently drop them. Deferred mutations that
  // themselves require approval pause AGAIN (nested gate with the rest
  // still attached) rather than running unapproved. On REJECT the model
  // re-plans from the rejection result, so there is nothing to re-inject.
  if (resume.decision === "approved" && resume.deferredToolCalls && resume.deferredToolCalls.length > 0) {
    const deferredState: DeferredToolBatchState = {
      hasInterveningMutation,
      cancelled,
      cancelReason,
      checkpoint,
      mutationBatchPending,
      batchHasMutation,
      completedDeployment,
    };
    const deferredResult = await executeDeferredToolCalls(resume.deferredToolCalls, {
      availableTools,
      executionMode: cfg.executionMode,
      transport,
      llmMessages,
      toolCallLog,
      toolCallRecords,
      executedMutations,
      localProgress,
      qualitySession,
      startTime,
      stepsUsed,
      maxOutputChars: cfg.maxOutputChars,
      signal: cfg.signal,
      state: deferredState,
    });
    hasInterveningMutation = deferredState.hasInterveningMutation;
    cancelled = deferredState.cancelled;
    cancelReason = deferredState.cancelReason;
    checkpoint = deferredState.checkpoint;
    mutationBatchPending = deferredState.mutationBatchPending;
    batchHasMutation = deferredState.batchHasMutation;
    completedDeployment = deferredState.completedDeployment;

    if (deferredResult.nestedApproval) {
      return {
        finalText: `I need your approval to run \`${deferredResult.nestedApproval.toolId}\`. ${deferredResult.nestedApproval.reason}`,
        stepsUsed,
        totalDurationMs: Date.now() - startTime,
        toolCalls: toolCallLog,
        cancelled: false,
        events,
        pendingApproval: deferredResult.nestedApproval,
      };
    }
  }

  // Continue the loop
  while (stepsUsed < cfg.maxSteps && !cancelled) {
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
          deadlineMs: startTime + cfg.maxRuntimeMs,
          signal: cfg.signal,
        },
      );
      if (llmResponse.responseShape && llmResponse.provider) {
        localProgress.emit({ type: "model_response", provider: llmResponse.provider, model: llmResponse.model, ...llmResponse.responseShape, finishReason: llmResponse.finishReason });
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      localProgress.emit({
        type: "model_failed",
        model: cfg.model ?? "default",
        category: "all_fallbacks_exhausted",
        message: errMsg.slice(0, 200),
      });
      modelFailed = errMsg.slice(0, 200);
      finalText = completedDeployment
        ? describeProviderFailureAfterDeployment(completedDeployment, errMsg)
        : err instanceof AllRoutesFailedError
          ? err.userMessage
          : err instanceof AgentBudgetExhaustedError
            ? "I ran out of time before finishing this request. Your project and any completed work are preserved — try again."
            : `I encountered an error while reasoning: ${errMsg}`;
      modelFailureText =
        err instanceof AllRoutesFailedError || err instanceof AgentBudgetExhaustedError
          ? finalText
          : undefined;
      break;
    }

    if (llmResponse.toolCalls.length === 0) {
      if (
        await maybeInspectBeforeFinal(
          qualitySession,
          llmMessages,
          localProgress,
          llmResponse.text ?? "",
          stepsUsed,
          cfg.maxSteps,
          cancelled,
        )
      ) {
        continue;
      }
      finalText = llmResponse.text;
      break;
    }

    llmMessages.push(buildAssistantToolCallMessage(llmResponse.toolCalls, llmResponse.text, llmResponse.rawParts));
    if (qualitySession) {
      harvestStageMarkers(qualitySession, [{ role: "assistant" as const, content: llmResponse.text ?? "" }]);
    }

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
        llmMessages.push(buildToolResultMessage(result));
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
        llmMessages.push(buildToolResultMessage(result));
        continue;
      }

      const dedupeKey = `${toolCall.toolId}:${hashInputs(toolCall.inputs)}`;
      if (!toolDef.readOnly) {
        const prior = executedMutations.get(dedupeKey);
        if (prior) {
          llmMessages.push(buildToolResultMessage({
            toolCallId: toolCall.toolCallId,
            toolId: toolCall.toolId,
            result: prior.result,
            success: true,
          }));
          toolCallLog.push({ toolId: toolCall.toolId, success: true, summary: "skipped — already executed", mutating: true });
          localProgress.emit({ type: "tool_result", toolId: toolCall.toolId, success: true, summary: "skipped — already executed", durationMs: 0 });
          continue;
        }
      }

      const permInfo = toPermissionInfo(toolDef);
      const permResult = permissionEngine.check(permInfo, toolCall.inputs, cfg.executionMode, availableCapabilities);

      if (!permResult.allowed) {
        const result: ToolCallResult = {
          toolCallId: toolCall.toolCallId,
          toolId: toolCall.toolId,
          result: null,
          success: false,
          error: permResult.reason ?? "Permission denied",
        };
        llmMessages.push(buildToolResultMessage(result));
        localProgress.emit({ type: "approval_required", toolId: toolCall.toolId, reason: permResult.reason ?? "Permission denied" });
        continue;
      }

      // Create the pre-mutation checkpoint BEFORE the approval gate (same
      // guarantee as the initial loop): a nested approval pause carries the
      // checkpoint so the next resume diffs truthfully instead of "unknown".
      if (!toolDef.readOnly && !mutationBatchPending && !checkpoint) {
        checkpoint = await transport.createCheckpointBeforeMutation(`Pre-agent-loop resume`) ?? undefined;
        if (checkpoint) {
          localProgress.emit({ type: "checkpoint", label: checkpoint.label, gitSha: checkpoint.gitSha });
        }
        mutationBatchPending = true;
        batchHasMutation = true;
      }

      if (permResult.requiresApproval) {
        localProgress.emit({ type: "approval_required", toolId: toolCall.toolId, reason: permResult.reason ?? "Approval required" });

        // Pause for approval in AUTO as well as ACT — the same contract as
        // the initial loop. A resumed run that reaches a second gated tool
        // must produce a resumable paused run; the previous AUTO branch
        // fed the model an "approval required" tool error instead, so the
        // run "completed" with text asking for an approval that had no
        // button — a dead end the user could never answer.
        // As in the initial loop, the calls after this one were never
        // executed — capture them as deferred calls so the next resume
        // re-injects them after the approved tool.
        return {
          finalText: `I need your approval to run \`${toolCall.toolId}\`. ${permResult.reason ?? "This operation requires explicit approval."}`,
          stepsUsed,
          totalDurationMs: Date.now() - startTime,
          toolCalls: toolCallLog,
          cancelled: false,
          events,
          checkpoint: checkpoint ?? undefined,
          pendingApproval: {
            toolId: toolCall.toolId,
            toolCallId: toolCall.toolCallId,
            inputs: toolCall.inputs,
            reason: permResult.reason ?? "Approval required",
            pausedMessages: [...llmMessages],
            qualityLoopState: qualitySession ? snapshotQualityLoopSession(qualitySession) : undefined,
            deferredToolCalls: deferredCallsAfterBatchPause(llmResponse.toolCalls, toolCall.toolCallId),
            stepsUsedAtPause: stepsUsed,
            hadInterveningMutationAtPause: hasInterveningMutation,
          },
        };
      }

      // Loop detection
      const inputsHash = hashInputs(toolCall.inputs);
      if (detectRepeatedCalls(toolCallRecords, toolCall.toolId, inputsHash, hasInterveningMutation)) {
        cancelled = true;
        cancelReason = `Repeated tool call detected: ${toolCall.toolId} called 3+ times with same inputs and no intervening mutation`;
        break;
      }

      // Stop must also stop in-flight tool work: never start a tool call
      // once the caller has aborted.
      if (cfg.signal?.aborted) {
        cancelled = true;
        cancelReason = "Cancelled by user";
        break;
      }

      localProgress.emit({ type: "tool_start", toolId: toolCall.toolId, summary: `${toolCall.toolId}` });

      let result: ToolCallResult;
      try {
        const execResult = await toolRegistry.execute(toolCall.toolId, toolCall.inputs, {
          hasApproval: !permResult.requiresApproval,
          availableCapabilities,
          transport,
        });

        if (execResult.ok) {
          // Same domain-failure normalization as the other execute sites:
          // a handler returning { success: false } is a failed mutation,
          // never a success.
          const handlerError = handlerFailureError(execResult.result);
          result = {
            toolCallId: toolCall.toolCallId,
            toolId: toolCall.toolId,
            result: execResult.result,
            success: handlerError === null,
            ...(handlerError !== null ? { error: handlerError } : {}),
          };
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
        if (result.success) executedMutations.set(dedupeKey, result);
      }

      const summary = summarizeToolResult(toolCall.toolId, result.result);
      toolCallLog.push({ toolId: toolCall.toolId, success: result.success, summary, mutating: !toolDef.readOnly });
      completedDeployment = readDeploymentOutcome(toolCall.toolId, result.result) ?? completedDeployment;
      if (qualitySession) {
        noteToolResult(
          qualitySession,
          toolCall.toolId,
          { success: result.success, result: result.result, mutating: !toolDef.readOnly, summary },
          transport.workspaceId,
        );
      }

      localProgress.emit({ type: "tool_result", toolId: toolCall.toolId, success: result.success, summary, durationMs: 0 });

      llmMessages.push(buildToolResultMessage(result));

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
      onRepair: createAutonomousRepairCallback(transport, cfg.systemPrompt, toolDefs, startTime + cfg.maxRuntimeMs, cfg.signal, cfg.executionMode),
    });
  }

  if (stepsUsed >= cfg.maxSteps && !cancelled && !finalText) {
    cancelled = true;
    cancelReason = `Max steps reached (${cfg.maxSteps})`;
  }

  const effectiveFinalText =
    finalText ||
    (buildFixResult && !buildFixResult.allPassed
      ? `The build checks did not all pass after ${buildFixResult.repairAttempts} repair attempts.`
      : describeSilentOutcome(toolCallLog, cancelled, cancelReason));

  // Quality gate: finalize the evidence ledger and compute the verdict.
  const qualityFinale = await finalizeQualityGatedRun(qualitySession, {
    buildFixResult,
    publicUrl: completedDeployment?.publicUrl ?? null,
    deployAttempted: toolCallLog.some((t) => t.toolId === "project.deploy"),
    finalText: effectiveFinalText,
    localProgress,
  });
  const gatedFinalText =
    qualityFinale && !qualityFinale.verdict.ok
      ? `${effectiveFinalText}\n\nQuality check — ${qualityFinale.verdict.reason.charAt(0).toLowerCase()}${qualityFinale.verdict.reason.slice(1)}`
      : effectiveFinalText;

  localProgress.emit({
    type: cancelled ? "cancelled" : "finished",
    ...(cancelled ? { reason: cancelReason ?? "Unknown" } : { totalSteps: stepsUsed, totalDurationMs: Date.now() - startTime }),
  } as ProgressEvent);

  // What did this run actually do to the files?
  //
  // Tool success flags cannot answer that: a tool can write bytes and then
  // fail, and a cancelled run can be stopped after a write has landed. The
  // checkpoint above is the baseline, so the workspace is compared against
  // it whenever a mutation was reached. A failure to compare yields
  // "unknown" — never a claim that nothing changed.
  // A checkpoint only exists once a mutation was reached. An attempted
  // mutation with NO checkpoint (checkpoint creation itself failed) still
  // needs evidence — it resolves to "unknown", which is the honest answer,
  // rather than being silently omitted.
  const attemptedMutation = toolCallLog.some((call) => call.mutating);
  const workspaceChange = checkpoint || attemptedMutation
    ? await computeWorkspaceChange(transport, checkpoint ?? null)
    : undefined;

  return {
    finalText: gatedFinalText,
    stepsUsed,
    totalDurationMs: Date.now() - startTime,
    toolCalls: toolCallLog,
    buildFixResult,
    checkpoint,
    workspaceChange,
    cancelled,
    cancelReason,
    events,
    modelFailed,
    modelFailureText,
    qualityLoop: qualityFinale
      ? {
          verdict: qualityFinale.verdict,
          stages: qualityFinale.stages,
          designPasses: qualityFinale.designPasses,
        }
      : undefined,
    qualityLoopState: qualitySession ? snapshotQualityLoopSession(qualitySession) : undefined,
  };
}

// ─── Autonomous repair callback ───────────────────────────────────

/**
 * Creates a repair callback for the build-fix loop that feeds errors
 * back to the LLM, lets it inspect and fix the code, then re-runs checks.
 * Max 3 repair cycles.
 */
export function createAutonomousRepairCallback(
  transport: WorkspaceTransport,
  systemPrompt: string,
  toolDefs: ToolDefinition[],
  deadlineMs?: number,
  signal?: AbortSignal,
  executionMode: ExecutionMode = "act",
  // Capability set for repair-loop tool execution. Defaults to the resolved
  // deployment set so repair tools (files.patch, checkpoint.*) cannot fail
  // closed as "incapable" — the same unified-gate guarantee as the main loop.
  availableCapabilities: string[] = resolveAvailableCapabilities({ transport }),
): (attempt: number, errors: string) => Promise<boolean> {
  const permissionEngine = new PermissionEngine();
  return async (attempt: number, errors: string) => {
    // Feed the error output to the LLM and let it repair
    const repairMessages: LLMMessage[] = [
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
          deadlineMs,
          signal,
        });

        if (response.toolCalls.length === 0) {
          // LLM finished without more tool calls
          return true;
        }

        repairMessages.push(buildAssistantToolCallMessage(response.toolCalls, response.text, response.rawParts));

        // Execute each tool call — routed through the same permission
        // check the main loop uses. Repair is autonomous: there is no
        // user to approve a gated call, so a denied or
        // approval-requiring call fails closed (the model sees the gate
        // and must work around it) instead of executing silently with
        // hasApproval: true.
        for (const toolCall of response.toolCalls) {
          // Stop must also stop repair work: never start a tool call once
          // the caller has aborted.
          if (signal?.aborted) {
            return false;
          }

          const toolDef = toolRegistry.get(toolCall.toolId);
          if (!toolDef) continue;

          const repairPermResult = permissionEngine.check(
            toPermissionInfo(toolDef),
            toolCall.inputs,
            executionMode,
          );
          if (!repairPermResult.allowed || repairPermResult.requiresApproval) {
            repairMessages.push(buildToolResultMessage({
              toolCallId: toolCall.toolCallId,
              toolId: toolCall.toolId,
              result: null,
              success: false,
              error: repairPermResult.requiresApproval
                ? `Permission gate: ${repairPermResult.reason ?? "this operation requires explicit approval"} — approval cannot be granted during autonomous repair, so the call was not executed.`
                : `${repairPermResult.reason ?? "Permission denied"} — the call was not executed.`,
            }));
            continue;
          }

          try {
            const execResult = await toolRegistry.execute(toolCall.toolId, toolCall.inputs, {
              hasApproval: true,
              availableCapabilities,
              transport,
            });

            // Same domain-failure normalization as the main loop: a
            // handler returning { success: false } is a failed repair
            // step, never a success.
            const handlerError = execResult.ok ? handlerFailureError(execResult.result) : null;
            const result: ToolCallResult = execResult.ok
              ? {
                  toolCallId: toolCall.toolCallId,
                  toolId: toolCall.toolId,
                  result: execResult.result,
                  success: handlerError === null,
                  ...(handlerError !== null ? { error: handlerError } : {}),
                }
              : { toolCallId: toolCall.toolCallId, toolId: toolCall.toolId, result: null, success: false, error: execResult.error };

            repairMessages.push(buildToolResultMessage(result));
          } catch (err) {
            const result: ToolCallResult = {
              toolCallId: toolCall.toolCallId,
              toolId: toolCall.toolId,
              result: null,
              success: false,
              error: err instanceof Error ? err.message : String(err),
            };
            repairMessages.push(buildToolResultMessage(result));
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
