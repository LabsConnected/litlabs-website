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
 * - Checkpoint before every meaningful mutation (per-mutation rollback points).
 * - Hard limits: max steps, max runtime, max output, max retries.
 * - Terminal server's isBlockedCommand() remains authoritative security.
 */

import "server-only";

import { randomUUID } from "crypto";
import { postRunCheckpointLabel } from "@/lib/studio/checkpoint-pairs";
import { emitUsageEvent, getMeteringContext } from "@/lib/metering";
import { calculateLlmCost } from "@/lib/llm-cost-engine";
import type { WorkspaceTransport } from "./workspace-transport";
import { ProgressEmitter, type ProgressEvent } from "./progress-events";
import { PermissionEngine, type ExecutionMode, type ToolPermissionInfo } from "./permission-engine";
import { callLLMWithTools, buildToolResultMessage, buildAssistantToolCallMessage, summarizeToolResult, AllRoutesFailedError, AgentBudgetExhaustedError, type ToolDefinition, type ToolCallResult, type LLMMessage } from "./llm-tool-calling";
// Re-exported so launch-flow can seed a continued loop's messages.
export type { LLMMessage };
import type { LLMCallMetadata } from "@/lib/evals/braintrust";
import { runBuildFixLoop, type BuildFixLoopResult } from "./build-fix-loop";
import { buildPatchRecoveryMessage, validateApplyPatchInputs, validateFilesWriteInputs } from "./patch-validation";
import { computeWorkspaceChange } from "./workspace-change-producer";
import type { WorkspaceChangeEvidence } from "@/lib/studio/completion-evidence";
import { recordModelFailure } from "./provider-registry";
import {
  FILE_WRITE_TOOL_IDS,
  NO_BUILD_CAPABLE_MODEL,
  findModelRecord,
  getModelConfigSource,
  recordHealthOutcome,
  selectBuildModel,
} from "./model-registry";
import { toolRegistry } from "./tool-registry";
import type { ActionExecutionContext } from "@/lib/action-runtime";
import { resolveAvailableCapabilities } from "./capabilities";
import type { LiTTToolDefinition } from "./types";
import {
  buildQualityLoopPrompt,
  buildRedesignPrompt,
  finalizeQualityLoop,
  harvestStageMarkers,
  MAX_DESIGN_PASSES,
  noteBuildFix,
  noteDeployment,
  noteToolResult,
  noteMutationReadBack,
  runQualityInspection,
  snapshotQualityLoopSession,
  startQualityLoopSession,
  verifyLiveUrl,
  type QualityFinale,
  type QualityLoopSession,
  type QualityLoopSnapshot,
  formatQualityVerdictBlock,
} from "./quality-loop-flow";
// LiTT Tool Orchestrator (fix/litt-tool-orchestrator): goal → capability
// planning, tool health, reference-match workflow, run observability.
import { planCapabilities, buildCapabilityPlanPrompt } from "./capability-planner";
import {
  resolveToolHealth,
  filterOfferableTools,
  buildToolHealthPromptNote,
} from "./tool-health";
import {
  isReferenceMatchRequest,
  extractReferenceUrls,
  REFERENCE_MATCH_WORKFLOW,
} from "./reference-match";
import {
  startRunObservability,
  recordToolsOffered,
  recordToolCall as recordObsToolCall,
  recordApproval as recordObsApproval,
  recordFallback as recordObsFallback,
  recordVerificationEvidence,
  finishRunObservability,
  friendlyActivityLabel,
} from "./run-observability";
import { isTerminalOwnerUser } from "@/lib/terminal-owner";

/**
 * Apply the Tool Orchestrator prompts to a loop config (Parts A, B, H).
 * Idempotent per config object — safe to call on both the initial run
 * and the approval-resume path (which rebuilds cfg from the original
 * config and would otherwise lose the orchestration prompts).
 *
 * Returns the computed capability plan for observability wiring.
 */
function applyOrchestratorPrompts(
  cfg: { systemPrompt: string },
  userMessage: string,
): import("./capability-planner").CapabilityPlan {
  const capabilityPlan = planCapabilities(userMessage);
  cfg.systemPrompt += "\n\n" + buildCapabilityPlanPrompt(capabilityPlan);

  if (capabilityPlan.isReferenceMatch || isReferenceMatchRequest(userMessage)) {
    const refUrls = extractReferenceUrls(userMessage);
    cfg.systemPrompt +=
      "\n\n" + REFERENCE_MATCH_WORKFLOW +
      (refUrls.length > 0
        ? `\nReference URL(s) supplied: ${refUrls.join(", ")}`
        : `\nNo reference URL detected in the message — ask the user for the reference link or screenshot before implementing.`);
  }
  return capabilityPlan;
}

// Station Control Bridge (chunk E): importing the barrel registers every
// station action into the station registry (module side effects); the
// explicit call below advertises them into the tool registry. No import
// cycle: station-control imports tool-registry, which never imports this
// module.
import { registerAllStationActions } from "@/lib/station-control";
import { setStationEventSink, summarizeStationEvent } from "@/lib/station-control/loop-events";

/**
 * Advertise station actions as agent tools, once at module scope.
 * Idempotent — on an id collision the EXISTING tool keeps its definition,
 * so the stabilized registry is never clobbered by the bridge.
 */
registerAllStationActions();

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
  /** Require a structured tool call on the first model turn of an execution flow. */
  requireToolCallOnFirstStep?: boolean;
  /**
   * Early bounded capability guard (BUILD runs): the loop tracks consecutive
   * steps in which the model emitted tool calls but ZERO file-writing calls
   * (files.write / apply_patch / edit). After maxStepsWithoutFileWrite such
   * steps the serving model is ruled incompatible for this run and the loop
   * switches to the next registry build model; when the chain is exhausted
   * the run fails with NO_BUILD_CAPABLE_MODEL. Default 3; 0 disables.
   */
  buildCapabilityGuard?: {
    maxStepsWithoutFileWrite?: number;
  };
  /**
   * Messages to seed the conversation with before the user message.
   * Used by the launch flow's bounded reprompt to CONTINUE an existing
   * loop (preserving a patch-recovery message and the re-read file
   * content) instead of starting a blind fresh loop.
   */
  initialMessages?: LLMMessage[];
  evalMetadata?: LLMCallMetadata;
  /** Upstream/client AbortSignal propagated to all provider calls. */
  signal?: AbortSignal;
  /**
   * The authenticated user's ID. Injected server-side into user-scoped
   * tools (browser.*) at execution time — the model must never supply
   * userId itself. When absent, browser tools fail closed on validation.
   */
  userId?: string;
  /**
   * Studio conversation this run belongs to. Injected server-side into
   * `browser.start_session` (for multi-turn session reuse) — the model
   * must never supply it itself.
   */
  conversationId?: string;
  /**
   * Browser session this loop invocation is driving (when the loop IS the
   * browser agent). Used for per-action metering idempotency keys
   * (`metering:browser:{sessionId}:{actionIndex}`); the action index is the
   * 1-based loop step. Unset for non-browser runs.
   */
  browserSessionId?: string;
  /** Parent ActionRun owning this work; injected server-side. */
  actionRunId?: string;
  /**
   * Item 5a — optional durable event sink for the Activity truth.
   * When set, every ProgressEvent emitted through this run's
   * `localProgress` is also offered to the hook. The loop invokes it in
   * emit order on a per-run promise chain; failures are logged and
   * swallowed — persistence can NEVER break the run.
   */
  persistEvent?: (event: ProgressEvent) => Promise<void>;
  /**
   * Canonical execution context for the entire run. Prefer this over the
   * legacy actionRunId field: it carries tenant, conversation, and project
   * identity together so tool handlers never reconstruct them from inputs.
   */
  actionContext?: ActionExecutionContext;
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
  /**
   * P1: Server-derived entitlement for managed paid providers.
   * NEVER from client input. When true, LITT_PAID routes (managed
   * OpenAI) are eligible as last-resort fallback in v2 routing.
   */
  allowLittPaidProviders?: boolean;
}

export const DEFAULT_LOOP_CONFIG: AgentLoopConfig = {
  maxSteps: 50,
  maxRuntimeMs: 1_800_000, // 30 minutes — a real multi-file build needs the room (was 10 min)
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
   * Post-run checkpoint: created once the run's changes landed (workspace
   * status "changed"). Paired with `checkpoint` (the pre-run baseline) so
   * the Studio can Accept (keep this) or Revert (restore the baseline),
   * and both survive a refresh (they are persisted checkpoint rows).
   */
  afterCheckpoint?: { checkpointId: string; label: string; gitSha: string };
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
  /**
   * Set when the loop ended in an honest failure that must be reported as
   * FAILED, never completed — e.g. the model kept asking for approval in
   * prose instead of emitting the gated tool call, so no approval card was
   * ever created and no mutations happened. Carries the user-facing
   * truthful message. Distinct from `cancelled` (user/system stop) and
   * `modelFailed` (provider outage).
   */
  failedHonestly?: string;
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
  /**
   * The conversation messages at loop end (copy). Lets a caller continue
   * the SAME conversation for a bounded reprompt — e.g. the launch flow
   * re-seeds these so a rejected patch's recovery context (validation
   * error + re-read file content) survives the second attempt.
   */
  finalMessages?: LLMMessage[];
  /**
   * Run observability record (Part J): goal, capability plan, tools
   * offered/called, failures, fallbacks, approvals, verification
   * evidence. Internal diagnostics — not user-facing.
   */
  runObservability?: import("./run-observability").RunObservability;
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

// ─── Mid-build stall recovery ─────────────────────────────────────

/**
 * A zero-tool-call reply is normally the model's final answer — but when
 * the text itself announces more work ("Now, I'll create the Footer
 * component"), accepting it as final silently stalls the build: the run
 * reports finished/Idle with the work half done, no error, and no
 * recovery. These markers detect the announcement so the loop can nudge
 * the model to emit the tool calls it promised instead of stopping.
 */
const CONTINUATION_MARKERS: RegExp[] = [
  /\bnow,?\s+i(?:'ll| will)\b/i,
  /\bnext,?\s+i(?:'ll| will)\b/i,
  /\bi(?:'ll| will)\s+now\s+(?:create|add|write|build|generate|update|fix|implement|continue|finish|handle|proceed)\b/i,
  /\blet me\s+(?:create|add|write|build|generate|update|fix|continue|finish)\b/i,
  /\bmoving on to\b/i,
  /\bup next\b/i,
];

/** How many times a run may nudge a stalled model before failing honestly. */
const MAX_CONTINUATION_NUDGES = 2;

export function announcesMoreWork(text: string): boolean {
  return CONTINUATION_MARKERS.some((re) => re.test(text));
}

/**
 * A zero-tool-call reply that asks for approval in PROSE ("please confirm
 * and give approval to apply the change") instead of emitting the
 * approval-gated tool call never pauses the loop — the pause only happens
 * on a real tool call whose permission check yields `requiresApproval`.
 * Accepting the prose as final settles the run "Complete" with zero
 * mutations and no approval card ever created: a silent fake-complete.
 * These markers route the prose approval-ask to the bounded-nudge path
 * instead, so the model is told to emit the real tool call.
 */
const APPROVAL_ASK_MARKERS: RegExp[] = [
  /please confirm/i,
  /give approval/i,
  /need your approval/i,
  /confirm.*proceed/i,
];

/**
 * Present-continuous work claims ("I'm adding…", "I'm updating…") with
 * zero tool calls: the work is announced as happening right now, but
 * nothing was executed. Same fake-complete hole as the prose
 * approval-ask — none of the CONTINUATION_MARKERS match present
 * continuous tense.
 */
const PROSE_WORK_CLAIM_MARKERS: RegExp[] = [
  /i['’]m\s+(adding|updating|writing|creating|applying|editing|modifying)\b/i,
];

export function asksForApprovalInProse(text: string): boolean {
  return APPROVAL_ASK_MARKERS.some((re) => re.test(text));
}

export function claimsOngoingWork(text: string): boolean {
  return PROSE_WORK_CLAIM_MARKERS.some((re) => re.test(text));
}

type ZeroCallResolution =
  | { action: "final" }
  | { action: "nudge"; nudgeMessage: string }
  | { action: "stall" }
  /** The model kept up a behavior that can never succeed (e.g. asking for
      approval in prose instead of emitting the gated tool call). The run
      must end FAILED with a truthful message — never "Complete". */
  | { action: "fail"; failureMessage: string };

/**
 * Decide what a zero-tool-call model reply means. Plain prose is the
 * final answer. Prose that announces more work gets bounded nudges to
 * emit the promised tool calls; when the nudges are exhausted the run
 * must fail honestly rather than claim completion. Prose that asks for
 * approval (or claims work is happening) without emitting the tool call
 * gets a targeted nudge to emit the call; on exhaustion the run fails
 * honestly — no approval card was ever created, so completing would lie.
 */
export function resolveZeroToolCalls(text: string, nudgesUsed: number): ZeroCallResolution {
  // The prose approval-ask is the most specific signal and is checked
  // first: the model wants to perform a gated mutation but never emitted
  // the tool call, so no approval card exists.
  if (asksForApprovalInProse(text) || claimsOngoingWork(text)) {
    if (nudgesUsed < MAX_CONTINUATION_NUDGES) {
      return {
        action: "nudge",
        nudgeMessage:
          "Prose approval requests don't create approval cards — no approval was recorded and no files were changed. " +
          "Emit the file tool call (e.g. `files.write`) now; the approval gate will pause the run and surface the approval card for the user.",
      };
    }
    return {
      action: "fail",
      failureMessage:
        "I couldn't apply the requested file change: I asked for approval in words instead of emitting the file tool call, " +
        "so no approval card was created and no files were changed. Nothing was modified — please try again.",
    };
  }
  if (!announcesMoreWork(text)) return { action: "final" };
  if (nudgesUsed < MAX_CONTINUATION_NUDGES) {
    return {
      action: "nudge",
      nudgeMessage:
        "You announced further work but emitted no tool calls, so nothing more was executed. " +
        "Continue now: emit the tool calls for the next step.",
    };
  }
  return { action: "stall" };
}

// ─── Tool definition conversion ───────────────────────────────────

function toToolDefinition(tool: LiTTToolDefinition): ToolDefinition {
  return {
    id: tool.id,
    description: tool.description,
    inputSchema: tool.inputSchema as Record<string, unknown>,
  };
}

/**
 * Browser tools are user-scoped: the session manager keys every session by
 * the authenticated user, and sessions must never be addressable across
 * users. The model must never supply userId itself (it would hallucinate
 * it) — the server injects the real authenticated userId here, overriding
 * anything the model passed.
 */
/**
 * Trusted execution context for the whole run — built ONCE from
 * server-authenticated config and passed DOWN through ToolRegistry.
 * The ActionRun identity is never a model-visible tool input.
 */
function actionContextFrom(cfg: {
  actionContext?: ActionExecutionContext;
  actionRunId?: string;
  userId?: string;
  conversationId?: string;
  projectId?: string;
}): ActionExecutionContext | undefined {
  if (cfg.actionContext) return cfg.actionContext;
  return cfg.actionRunId && cfg.userId
    ? {
        actionRunId: cfg.actionRunId,
        userId: cfg.userId,
        conversationId: cfg.conversationId,
        projectId: cfg.projectId,
      }
    : undefined;
}

function withUserScopeForBrowserTools(
  toolId: string,
  inputs: Record<string, unknown>,
  userId: string | undefined,
  conversationId?: string | undefined,
): Record<string, unknown> {
  if (userId && toolId.startsWith("browser.")) {
    const scoped: Record<string, unknown> = { ...inputs, userId };
    // Session reuse key: the agent's browser.start_session call gets the
    // server-known conversationId so an existing live session can be
    // reused across chat turns. The model never supplies this itself.
    if (toolId === "browser.start_session" && conversationId) {
      scoped.conversationId = conversationId;
    }
    return scoped;
  }
  return inputs;
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

/**
 * Phase 3: enrich the approval reason for mutating browser tools so the
 * in-chat approval card names the exact action and target (e.g. `Click
 * "Buy now" on example.com`) instead of a generic "Mutation requires
 * approval". Non-browser tools keep the permission engine's reason
 * untouched. Never throws — a description failure falls back to the
 * permission engine's reason.
 */
async function pauseReasonFor(
  toolId: string,
  inputs: Record<string, unknown>,
  fallback: string,
): Promise<string> {
  if (!toolId.startsWith("browser.")) return fallback;
  try {
    const { approvalReasonForBrowserAction } = await import("./browser-approval");
    return await approvalReasonForBrowserAction(toolId, inputs, fallback);
  } catch {
    return fallback;
  }
}

// ─── Quality loop hooks ───────────────────────────────────────────

/**
 * Every run whose changes actually landed gets a durable post-run
 * checkpoint (a git commit + project_checkpoints row) — the user never has
 * to remember to create one. Never throws; a failure just means no
 * after-checkpoint (the pre-run baseline still exists for Revert).
 */
async function createAfterRunCheckpoint(
  transport: WorkspaceTransport,
  workspaceChange: WorkspaceChangeEvidence | undefined,
  request: string | null,
  localProgress: ProgressEmitter,
): Promise<{ checkpointId: string; label: string; gitSha: string } | undefined> {
  if (workspaceChange?.status !== "changed") return undefined;
  try {
    const after = await transport.createCheckpointBeforeMutation(postRunCheckpointLabel(request));
    if (!after) return undefined;
    localProgress.emit({ type: "checkpoint", label: after.label, gitSha: after.gitSha, kind: "after" });
    return after;
  } catch {
    return undefined;
  }
}

/**
 * After a successful file mutation, re-read the file from the workspace and
 * record INSPECT evidence (targeted-edit verification). For writes, the
 * read-back must equal the written content; for search/replace patches,
 * every replacement must be present. Unified-diff patches can only be
 * confirmed readable. Never throws — verification failures are recorded
 * honestly, never as passes.
 */
async function verifyMutationReadBack(
  session: QualityLoopSession,
  transport: WorkspaceTransport,
  toolId: string,
  inputs: Record<string, unknown> | undefined,
  mutated: boolean,
): Promise<void> {
  if (!mutated || !inputs) return;
  if (toolId !== "files.write" && toolId !== "files.patch" && toolId !== "apply_patch") return;
  const path = typeof inputs.path === "string" ? inputs.path : null;
  if (!path) return;
  let content: string;
  try {
    content = (await transport.readFile(path)).content;
  } catch {
    noteMutationReadBack(session, { path, readable: false, contentMatches: false });
    return;
  }
  let contentMatches: boolean | null = null;
  if (toolId === "files.write" && typeof inputs.content === "string") {
    contentMatches = content === inputs.content;
  } else if (toolId === "apply_patch" && Array.isArray(inputs.patches)) {
    const replaces = (inputs.patches as Array<{ replace?: unknown }>)
      .map((p) => (typeof p?.replace === "string" ? p.replace : null))
      .filter((r): r is string => r !== null && r.length > 0);
    contentMatches = replaces.length > 0 ? replaces.every((r) => content.includes(r)) : null;
  }
  noteMutationReadBack(session, { path, readable: true, contentMatches });
}

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

/**
 * Item 5a — wire the optional `persistEvent` hook into a run's progress
 * stream. Events flow through a per-run promise chain so they persist in
 * emit order; each failure is logged and the chain continues. The loop
 * itself never awaits persistence — it can only observe.
 */
function attachEventPersistence(
  emitter: ProgressEmitter,
  persistEvent: AgentLoopConfig["persistEvent"],
): void {
  if (!persistEvent) return;
  let tail: Promise<void> = Promise.resolve();
  emitter.on((event) => {
    tail = tail
      .then(() => persistEvent(event))
      .catch((err) => {
        // Persistence failure must NEVER break the run.
        console.error("[agent-loop] persistEvent failed; continuing run", {
          errorClass: err instanceof Error ? err.message : "unknown",
        });
      });
  });
}

// ─── Canonical metering (P0) ─────────────────────────────────────
//
// Every LLM call the loop makes is one metered provider attempt: one
// usage_events row + one cost_events row via the canonical emitter.
//
// P0 invariant (Larry): per logical user action there are N cost_events
// (one per provider attempt — retries/failovers count) but exactly ONE
// billable usage_event. Here one loop step = one logical action: a
// successful step emits billable=true; a failed step emits billable=false
// with the provider cost still recorded.
//
// callLLMWithTools does not expose real token usage, so input/output
// tokens are chars/4 ESTIMATES — clearly labeled, never presented as
// measured. Provider cost comes from calculateLlmCost (0 for free models).
// The $1/1K-bit conversion behind retail bits is a PRICING MODEL, not fact.
//
// Emission is fire-and-forget: metering must never break or slow the run.

/** Rough token estimate when the provider call exposes no usage. */
const ESTIMATED_CHARS_PER_TOKEN = 4;

function estimateTokensForChars(chars: number): number {
  return Math.max(1, Math.ceil(Math.max(0, chars) / ESTIMATED_CHARS_PER_TOKEN));
}

function loopInputChars(messages: LLMMessage[]): number {
  let chars = 0;
  for (const m of messages) {
    chars += m.content?.length ?? 0;
    // Tool-call argument payloads are model input too.
    if (m.tool_calls) {
      for (const tc of m.tool_calls) chars += tc.function?.arguments?.length ?? 0;
    }
  }
  return chars;
}

/**
 * Compact BUILD inputs to fit within a provider-safe token budget.
 * Preserves: tool schemas, system prompt, current user request, recent history.
 * Trims: older conversation history first.
 * Target: 6.5k-7k tokens to leave headroom under 8k provider limits.
 */
function compactBuildInputs(
  systemPrompt: string,
  messages: LLMMessage[],
  toolDefs: ToolDefinition[],
  maxInputTokens: number = 7000
): { systemPrompt: string; messages: LLMMessage[]; compacted: boolean } {
  const toolChars = JSON.stringify(toolDefs).length;
  const systemChars = systemPrompt.length;
  const baseTokens = estimateTokensForChars(toolChars + systemChars);
  
  // If base (tools + system) already exceeds budget, we cannot proceed safely
  if (baseTokens >= maxInputTokens) {
    return { systemPrompt, messages, compacted: false };
  }
  
  const availableForMessages = maxInputTokens - baseTokens;
  const messageTokens = estimateTokensForChars(loopInputChars(messages));
  
  if (messageTokens <= availableForMessages) {
    return { systemPrompt, messages, compacted: false };
  }
  
  // Trim older messages, keep the most recent (current request + recent history)
  // Always keep at least the last 2 messages (current + immediate context)
  const compacted = [...messages];
  while (compacted.length > 2) {
    const tokens = estimateTokensForChars(loopInputChars(compacted));
    if (tokens <= availableForMessages) break;
    // Remove the oldest message (index 0), but preserve system-like first message if present
    // Actually: remove from the middle, keeping first (context) and last (current)
    // Simpler: remove oldest non-essential (index 1, keeping index 0 as anchor)
    if (compacted.length > 3) {
      compacted.splice(1, 1); // Remove second-oldest, keep first as anchor
    } else {
      compacted.shift(); // Only 3 left, remove oldest
    }
  }
  
  return { systemPrompt, messages: compacted, compacted: true };
}

interface LoopStepMetering {
  cfg: AgentLoopConfig;
  /** 1-based loop step = the action index for this LLM call. */
  stepIndex: number;
  /** Stable id for this loop invocation (idempotency grain). */
  meteringRunId: string;
  provider: string;
  model: string;
  inputChars: number;
  outputChars: number;
  status: "success" | "failed";
  error?: string;
}

/**
 * Emit one canonical metering event for a loop step's LLM call.
 * Identity/feature come from the ambient metering context (routes set it
 * at the request boundary); falls back to the loop config's userId (a
 * Clerk id in the standard auth path). No-ops when no identity resolves.
 */
function emitLoopStepMetering(input: LoopStepMetering): void {
  try {
    const ctx = getMeteringContext();
    const userId = ctx?.userId ?? null;
    // cfg.userId is the Clerk id in the standard auth path — pass it as
    // clerkId so the emitter resolves it to users.id (cached lookup).
    const clerkId = ctx?.clerkId ?? input.cfg.userId ?? null;
    if (!userId && !clerkId) return;

    const feature = ctx?.feature ?? "agent-chat";
    // Browser-agent steps report under the "browser" capability so browser
    // cost reconciles separately from studio-chat LLM cost.
    const capability = feature === "browser-agent" ? "browser" : "llm";

    // ESTIMATES — callLLMWithTools exposes no token usage. Labeled as
    // estimates here and stored as plain token counts downstream.
    const inputTokens = estimateTokensForChars(input.inputChars);
    const outputTokens = estimateTokensForChars(input.outputChars);
    const { providerCostMicros } = calculateLlmCost({
      provider: input.provider,
      model: input.model,
      promptTokens: inputTokens,
      completionTokens: outputTokens,
      isByok: false,
    });

    const idempotencyKey =
      feature === "browser-agent" && input.cfg.browserSessionId
        ? `metering:browser:${input.cfg.browserSessionId}:${input.stepIndex}`
        : `metering:llm:${input.meteringRunId}:${input.stepIndex}`;

    // Fire-and-forget: the emitter is best-effort and never throws, but the
    // loop must not even wait on it.
    void emitUsageEvent({
      userId: userId ?? undefined,
      clerkId: clerkId ?? undefined,
      runId: ctx?.runId ?? undefined,
      projectId: ctx?.projectId ?? undefined,
      feature,
      capability,
      provider: input.provider,
      model: input.model,
      inputTokens,
      outputTokens,
      providerCostMicros,
      status: input.status,
      // P0 invariant: exactly one billable event per logical action —
      // failed attempts are recorded billable=false, cost still captured.
      billable: input.status === "success",
      error: input.error,
      idempotencyKey,
      // The logical action IS this LLM call: failover retries inside
      // callLLMWithTools are invisible here, so one event per step keeps
      // per-original_request_id billable counts at <= 1.
      originalRequestId: idempotencyKey,
    }).catch(() => {});
  } catch {
    // Metering must never break the run — swallow everything.
  }
}

export async function runAgentLoopV2(
  userMessage: string,
  transport: WorkspaceTransport,
  config: Partial<AgentLoopConfig> = {},
  progress?: ProgressEmitter,
): Promise<AgentLoopResult> {
  try {
    return await runAgentLoopV2Inner(userMessage, transport, config, progress);
  } finally {
    // Station Control Bridge (chunk E): always release this run's event
    // sink, even when the run throws.
    setStationEventSink(transport, null);
  }
}

async function runAgentLoopV2Inner(
  userMessage: string,
  transport: WorkspaceTransport,
  config: Partial<AgentLoopConfig> = {},
  progress?: ProgressEmitter,
): Promise<AgentLoopResult> {
  const cfg = { ...DEFAULT_LOOP_CONFIG, ...config };
  const startTime = Date.now();

  // Canonical metering: stable per-invocation id so per-step events are
  // idempotent across replays. Prefers the ambient metering context's run
  // id (set by the route to the agent-billing run) so settleRun can link
  // the ledger debit to the already-emitted billable attempt events
  // instead of creating a duplicate billable event (P0 invariant).
  const meteringRunId =
    getMeteringContext()?.runId ?? cfg.qualityLoop?.runId ?? randomUUID();

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
    cfg.systemPrompt += buildQualityLoopPrompt(qualitySession.taskScope);
  }

  // ── LiTT Tool Orchestrator: goal → capability planning (Parts A, B, H) ──
  // Classify what this goal needs BEFORE substantive execution. The plan
  // is internal machine-readable state; its prompt rendering tells the
  // model which of its real capabilities materially improve THIS goal.
  // Reference-match requests ("make mine look like this") trigger the
  // reference workflow instead of a generic build.
  const capabilityPlan = applyOrchestratorPrompts(cfg, userMessage);

  // ── Run observability (Part J) ──
  const runObs = startRunObservability({
    runId: meteringRunId,
    goal: userMessage.slice(0, 500),
    agentMode: cfg.executionMode,
    capabilityPlan,
  });

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
  // Item 5a — persist loop events to the run's durable action_events log.
  attachEventPersistence(localProgress, cfg.persistEvent);

  // Station Control Bridge (chunk E): route station action execution events
  // (action_started / action_completed / action_failed / approval_required)
  // into this run's Activity stream. Keyed by this run's transport instance
  // — not a module global — so concurrent runs in one process cannot
  // cross-wire events. Cleared in the exported wrapper's finally above.
  setStationEventSink(transport, (event) => {
    localProgress.emit({ type: "status", summary: summarizeStationEvent(event) });
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

  // ── Tool health (Part F) ──
  // Don't advertise tools that cannot execute. The terminal owner gate
  // (terminal-server) returns Forbidden for non-owners by design — for
  // those users terminal.execute resolves UNAVAILABLE here, so the model
  // never sees it and can't burn steps retrying a guaranteed failure.
  // This is truthful capability reporting, not an auth bypass: the
  // terminal server remains the authoritative enforcer.
  const toolHealthMap = resolveToolHealth(
    availableTools.map((t) => t.id),
    {
      terminal: {
        userId: cfg.userId,
        // Mirror of terminal-server/terminal-owner-gate.ts for health
        // reporting only. Undefined (unknown) → degraded, not unavailable.
        isTerminalOwner:
          cfg.userId != null ? isTerminalOwnerUser(cfg.userId) : undefined,
      },
    },
  );
  const { offerable: offerableToolIds, degraded: degradedToolIds } =
    filterOfferableTools(toolHealthMap);
  const offerableTools = availableTools.filter((t) => offerableToolIds.includes(t.id));
  const healthNote = buildToolHealthPromptNote(toolHealthMap);
  if (healthNote) {
    cfg.systemPrompt += "\n\n" + healthNote;
  }

  // ── Observability: record what the model was offered (Part J) ──
  recordToolsOffered(
    runObs,
    offerableTools.map((t) => t.id),
    [...toolHealthMap.values()],
  );
  if (degradedToolIds.length > 0) {
    for (const id of degradedToolIds) {
      recordObsFallback(runObs, {
        fromToolId: id,
        toAlternative: "safe alternative or honest report",
        reason: "tool degraded at offer time",
      });
    }
  }

  const toolDefs = offerableTools.map(toToolDefinition);

  // Conversation messages for the LLM. A reprompt continues the SAME
  // conversation: seeded messages (e.g. a patch-recovery message with the
  // re-read file content) come first so the model regenerates against
  // real context instead of starting blind.
  const llmMessages: LLMMessage[] = [
    ...(cfg.initialMessages ?? []),
    { role: "user", content: userMessage },
  ];

  let finalText = "";
  let stepsUsed = 0;
  let cancelled = false;
  let cancelReason: string | undefined;
  let modelFailed: string | undefined;
  let modelFailureText: string | undefined;
  let failedHonestly: string | undefined;
  let checkpoint: { checkpointId: string; label: string; gitSha: string } | undefined;
  const toolCallLog: Array<{ toolId: string; success: boolean; summary: string; mutating: boolean }> = [];
  let completedDeployment: CompletedDeployment | null = null;
  // Bounded recovery when the model announces more work but emits no tool
  // calls (the silent mid-build stall) — see resolveZeroToolCalls.
  let continuationNudges = 0;

  // Early bounded capability guard (BUILD runs only, via
  // cfg.buildCapabilityGuard): consecutive steps where the model emitted
  // tool calls but ZERO file-writing calls. Fires within ~3 steps instead
  // of burning the whole run budget on a model that can read but not write.
  const buildGuardMaxSteps = cfg.buildCapabilityGuard?.maxStepsWithoutFileWrite ?? 0;
  let buildGuardZeroWriteSteps = 0;
  const buildGuardWindowModels = new Set<string>(); // canonicalIds ("" = unmapped)
  let buildGuardWindowProvider = "";
  let buildGuardWindowModel = "";
  const buildGuardExcluded = new Set<string>();
  const buildGuardTried: Array<{ canonicalId: string; reason: string }> = [];
  let buildGuardModelHint: string | undefined;

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
    const stepStartTime = Date.now();
    localProgress.emit({ type: "phase", phase: "call_llm", step: stepsUsed });
    localProgress.emit({ type: "status", summary: `Step ${stepsUsed}: reasoning with ${cfg.model ?? "default model"}` });

    // Call LLM with tools (with automatic fallback)
    let llmResponse;
    const llmStartTime = Date.now();
    // The build capability guard may have switched the serving model
    // mid-run; its hint routes through planBasicRoutes on the next step.
    const requestedModel = buildGuardModelHint ?? cfg.model;
    // Compact BUILD inputs to stay under provider token limits (e.g. Groq 8k).
    // Target 7k to leave headroom for tool-call overhead and tokenization variance.
    const compacted = compactBuildInputs(cfg.systemPrompt, llmMessages, toolDefs, 7000);
    if (compacted.compacted) {
      // Log the compaction for observability (no sensitive content)
      console.log(`[agent-loop] Compacted BUILD inputs: ${llmMessages.length} -> ${compacted.messages.length} messages`);
    }
    try {
      llmResponse = await callLLMWithTools(
        compacted.systemPrompt,
        compacted.messages,
        toolDefs,
        {
          model: requestedModel,
          temperature: 0.15,
          maxTokens: 4096,
          toolChoice: cfg.requireToolCallOnFirstStep && stepsUsed === 1 ? "required" : "auto",
          evalMetadata: cfg.evalMetadata,
          deadlineMs: startTime + cfg.maxRuntimeMs,
          signal: cfg.signal,
          // Preventive BUILD guard: when the run is capability-guarded, the
          // initial routing starts on a proven file writer instead of a
          // chat-only model that the 3-step guard would rule out anyway.
          requireReliableFileWriting: cfg.buildCapabilityGuard != null,
          // P1: Server-derived paid-provider entitlement (never from client).
          allowLittPaidProviders: cfg.allowLittPaidProviders,
        },
      );
      const llmDurationMs = Date.now() - llmStartTime;
      if (llmResponse.responseShape && llmResponse.provider) {
        localProgress.emit({ type: "model_response", provider: llmResponse.provider, model: llmResponse.model, ...llmResponse.responseShape, finishReason: llmResponse.finishReason });
      }
      // Emit model routing event so LiTT Live shows which provider/model was actually used.
      // latencyMs records how long the model call took, so a slow step can be
      // attributed to the model call vs tool execution (tool_result has durationMs).
      // canonicalId + configSource record the SELECTED model in run evidence
      // (no secrets) — the registry is the source of truth for the mapping.
      const routedRecord = findModelRecord(llmResponse.provider ?? "unknown", llmResponse.model);
      localProgress.emit({
        type: "model_routing",
        model: llmResponse.model,
        provider: llmResponse.provider ?? "unknown",
        fallbackFrom: requestedModel && llmResponse.model !== requestedModel ? requestedModel : undefined,
        latencyMs: llmDurationMs,
        canonicalId: routedRecord?.canonicalId,
        configSource: routedRecord ? getModelConfigSource(routedRecord.canonicalId) : undefined,
      });
      // Canonical metering (P0): one usage+cost event per step's LLM call.
      // provider/model are from the ACTUAL call; token counts are chars/4
      // estimates (callLLMWithTools exposes no usage) — see helper.
      emitLoopStepMetering({
        cfg,
        stepIndex: stepsUsed,
        meteringRunId,
        provider: llmResponse.provider ?? "unknown",
        model: llmResponse.model,
        inputChars: loopInputChars(llmMessages),
        outputChars: llmResponse.text?.length ?? 0,
        status: "success",
      });
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      // Canonical metering (P0): failed attempts are recorded billable=false
      // with the cost still captured — never a second billable event.
      emitLoopStepMetering({
        cfg,
        stepIndex: stepsUsed,
        meteringRunId,
        provider: "unknown",
        model: requestedModel ?? "unknown",
        inputChars: loopInputChars(llmMessages),
        outputChars: 0,
        status: "failed",
        error: errMsg.slice(0, 500),
      });
      // Emit model failure event with sanitized error (no secrets)
      // NOTE: Use "all-routes" not cfg.model — cfg.model is the user's hint
      // (e.g. "gemini-2.5-flash") which may have been excluded by config
      // (e.g. GEMINI_DISABLED). Reporting the hint as "failed" is misleading.
      localProgress.emit({
        type: "model_failed",
        model: "all-routes",
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

    // A zero-tool-call reply is normally the model's final answer — unless
    // the text announces more work it never started. Accepting that as
    // final is the silent mid-build stall: the run reports finished/Idle
    // with half the build done, no error, and no recovery. Nudge the
    // model (bounded) to emit the promised tool calls; when the nudges
    // are exhausted, fail honestly instead of claiming completion.
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
      const zeroCallText = llmResponse.text ?? "";
      const resolution = resolveZeroToolCalls(zeroCallText, continuationNudges);
      if (resolution.action === "nudge") {
        continuationNudges++;
        localProgress.emit({
          type: "status",
          summary:
            "The model announced more work but emitted no tool calls — asking it to continue...",
        });
        llmMessages.push({ role: "assistant", content: zeroCallText });
        llmMessages.push({ role: "user", content: resolution.nudgeMessage });
        continue;
      }
      if (resolution.action === "stall") {
        cancelled = true;
        cancelReason =
          "The model announced further work but produced no tool calls after retrying; stopping instead of claiming the build is complete.";
        finalText =
          "I stopped mid-build: I announced more work but could not produce the next actions. " +
          "Your project and everything completed so far are preserved — try again to continue.";
        localProgress.emit({
          type: "status",
          summary: "Stopping: the model announced more work but produced no tool calls.",
        });
        break;
      }
      if (resolution.action === "fail") {
        // Honest failure, not a cancellation: the model kept asking for
        // approval in prose (or claiming work was happening) instead of
        // emitting the gated tool call, so no approval card was ever
        // created and nothing was mutated. Report FAILED, never Complete.
        failedHonestly = resolution.failureMessage;
        finalText = resolution.failureMessage;
        localProgress.emit({
          type: "status",
          summary: "Stopping: the model asked for approval in prose instead of emitting the tool call — no approval card was created.",
        });
        break;
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
    // Snapshot for the build capability guard: which log entries this step added.
    const toolCallLogLenBeforeBatch = toolCallLog.length;

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

      // Create a pre-mutation checkpoint BEFORE the approval gate, ahead of
      // EVERY mutating tool call — each mutation gets its own rollback
      // point, so the resumed-after-approval run diffs the workspace
      // truthfully instead of reporting "unknown". Safe when the user
      // rejects: this only snapshots pre-mutation state and never writes
      // workspace files. Read-only tools never checkpoint.
      if (!toolDef.readOnly) {
        localProgress.emit({ type: "phase", phase: "execute", step: stepsUsed });
        checkpoint = await transport.createCheckpointBeforeMutation(
          `Pre-mutation: ${toolCall.toolId} (step ${stepsUsed})`,
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
        // Phase 3: browser mutations get an action-and-target description
        // so the in-chat approval card says what is being approved.
        const approvalReason = await pauseReasonFor(
          toolCall.toolId,
          toolCall.inputs,
          permResult.reason ?? "Approval required",
        );
        localProgress.emit({
          type: "approval_required",
          toolId: toolCall.toolId,
          reason: approvalReason,
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
            finalText: `I need your approval to run \`${toolCall.toolId}\`. ${approvalReason}`,
            stepsUsed,
            totalDurationMs: Date.now() - startTime,
            toolCalls: toolCallLog,
            cancelled: false,
            events,
            checkpoint: checkpoint ?? undefined,
            // Observability (Part J): the run pauses here awaiting approval.
            runObservability: finishRunObservability(runObs, "awaiting_approval"),
            pendingApproval: {
              toolId: toolCall.toolId,
              toolCallId: toolCall.toolCallId,
              inputs: toolCall.inputs,
              reason: approvalReason,
              pausedMessages: [...llmMessages],
              qualityLoopState: qualitySession ? snapshotQualityLoopSession(qualitySession) : undefined,
              deferredToolCalls: deferredCallsAfterBatchPause(llmResponse.toolCalls, toolCall.toolCallId),
              stepsUsedAtPause: stepsUsed,
              hadInterveningMutationAtPause: hasInterveningMutation,
            },
            finalMessages: [...llmMessages],
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
        const execResult = await toolRegistry.execute(toolCall.toolId, withUserScopeForBrowserTools(toolCall.toolId, toolCall.inputs, cfg.userId ?? actionContextFrom(cfg)?.userId, cfg.conversationId ?? actionContextFrom(cfg)?.conversationId), {
          hasApproval: !permResult.requiresApproval,
          availableCapabilities,
          transport,
          signal: cfg.signal,
          actionContext: actionContextFrom(cfg),
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
      // Observability (Part J): record the tool call for the run record.
      recordObsToolCall(runObs, {
        toolId: toolCall.toolId,
        success: result.success,
        summary: summary.slice(0, 200),
        mutating: !toolDef.readOnly,
        latencyMs: toolDuration,
        errorClass: result.success ? undefined : "tool_error",
      });
      // Friendly Activity label for the UI (Part J).
      localProgress.emit({
        type: "status",
        summary: friendlyActivityLabel(toolCall.toolId),
      });
      const deploymentOutcome = readDeploymentOutcome(toolCall.toolId, result.result);
      if (deploymentOutcome) {
        // Verification evidence (Part J): a deployment produced a live URL.
        recordVerificationEvidence(runObs, "deployment", deploymentOutcome.publicUrl);
      }
      completedDeployment = deploymentOutcome ?? completedDeployment;
      if (qualitySession) {
        noteToolResult(
          qualitySession,
          toolCall.toolId,
          { success: result.success, result: result.result, mutating: !toolDef.readOnly, summary },
          transport.workspaceId,
        );
        await verifyMutationReadBack(qualitySession, transport, toolCall.toolId, toolCall.inputs, result.success && !toolDef.readOnly);
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

    // Early bounded capability guard (BUILD runs only): a model that keeps
    // emitting tool calls but never file-writing calls is ruled out within
    // ~buildGuardMaxSteps steps instead of burning the run budget. The
    // cohere/north-mini-code incident (45 minutes, zero files) is exactly
    // what this prevents. Zero-tool-call steps never reach here — they go
    // through the resolveZeroToolCalls stall handling above.
    if (buildGuardMaxSteps > 0) {
      const stepCalls = toolCallLog.slice(toolCallLogLenBeforeBatch);
      const fileWrites = stepCalls.filter((c) => FILE_WRITE_TOOL_IDS.has(c.toolId)).length;
      if (fileWrites > 0) {
        buildGuardZeroWriteSteps = 0;
        buildGuardWindowModels.clear();
      } else {
        buildGuardZeroWriteSteps++;
        const serving = findModelRecord(llmResponse.provider ?? "unknown", llmResponse.model);
        buildGuardWindowModels.add(serving?.canonicalId ?? "");
        buildGuardWindowProvider = llmResponse.provider ?? "unknown";
        buildGuardWindowModel = llmResponse.model;
      }

      if (buildGuardZeroWriteSteps >= buildGuardMaxSteps) {
        const distinctModels = [...buildGuardWindowModels].filter((id) => id !== "");
        const reason = `${buildGuardZeroWriteSteps} consecutive steps with tool calls but zero file-writing calls`;
        let excludedCanonicalId: string | undefined;
        if (distinctModels.length === 1) {
          // The whole window was served by one registry model: rule it out
          // for this run. The registry records the failure (learns), and a
          // 10-minute model cooldown keeps the per-step router off it for
          // the rest of this run's budget.
          excludedCanonicalId = distinctModels[0];
          buildGuardExcluded.add(excludedCanonicalId);
          recordHealthOutcome(excludedCanonicalId, false, "no_file_write_calls");
          recordModelFailure(buildGuardWindowProvider, buildGuardWindowModel);
          buildGuardTried.push({ canonicalId: excludedCanonicalId, reason });
        } else {
          buildGuardTried.push({
            canonicalId: distinctModels.length === 0 ? "unmapped" : distinctModels.join("+"),
            reason: `${reason} (serving model changed mid-window)`,
          });
        }
        localProgress.emit({
          type: "build_model_incompatible",
          canonicalId: excludedCanonicalId ?? "unmapped",
          provider: buildGuardWindowProvider,
          stepsObserved: buildGuardZeroWriteSteps,
          zeroWriteSteps: buildGuardZeroWriteSteps,
          reason: "no_file_write_calls_in_window",
        });

        // P1: entitlement-aware. The guard must never switch an unentitled run
        // onto a LITT_PAID registry model that planBasicRoutes would refuse to
        // route to — that combination ends the run with NO_BUILD_CAPABLE_MODEL.
        const next = selectBuildModel(buildGuardExcluded, {
          allowLittPaidProviders: cfg.allowLittPaidProviders,
        });
        if (!next) {
          const listing = buildGuardTried.map((t) => `- ${t.canonicalId}: ${t.reason}`).join("\n");
          modelFailed = NO_BUILD_CAPABLE_MODEL;
          modelFailureText =
            `No build-capable model is available. Models tried:\n${listing}\n` +
            `No model produced a file-writing tool call within the bounded window, so the run stops instead of burning the budget.`;
          finalText =
            "I couldn't complete this build: none of the available models produced file-writing tool calls. " +
            "Your project and everything completed so far are preserved — try again later or pick a different model.";
          localProgress.emit({
            type: "status",
            summary: "Stopping: no build-capable model produced file-writing tool calls.",
          });
          break;
        }
        // Continue the SAME conversation on the next eligible build model —
        // the hint routes through planBasicRoutes on the following step.
        buildGuardModelHint = next.providerModelId;
        localProgress.emit({
          type: "status",
          summary: `Switching build model to ${next.canonicalId} — the previous model produced no file writes in ${buildGuardZeroWriteSteps} steps.`,
        });
        buildGuardZeroWriteSteps = 0;
        buildGuardWindowModels.clear();
      }
    }

    // Reset mutation flag after batch
    if (!batchHasMutation) {
      mutationBatchPending = false;
    }

    // Per-step timing: total step duration + cumulative elapsed, so the work log
    // can show exactly where the minutes went on a slow build.
    localProgress.emit({
      type: "step_timing",
      step: stepsUsed,
      stepDurationMs: Date.now() - stepStartTime,
      elapsedMs: Date.now() - startTime,
    });
  }

  // Run build-fix loop if mutations were made and enabled
  let buildFixResult: BuildFixLoopResult | undefined;
  if (cfg.enableBuildFix && hasInterveningMutation && !cancelled) {
    localProgress.emit({ type: "phase", phase: "build_fix", step: stepsUsed });
    buildFixResult = await runBuildFixLoop(transport, localProgress, {
      onRepair: createAutonomousRepairCallback(transport, cfg.systemPrompt, toolDefs, startTime + cfg.maxRuntimeMs, cfg.signal, cfg.executionMode, undefined, actionContextFrom(cfg), cfg.allowLittPaidProviders),
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
      ? `${effectiveFinalText}${formatQualityVerdictBlock(qualityFinale)}`
      : effectiveFinalText;

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

  if (workspaceChange) {
    localProgress.emit({ type: "workspace_change", ...workspaceChange });
  }
  const afterCheckpoint = await createAfterRunCheckpoint(transport, workspaceChange, userMessage, localProgress);
  localProgress.emit({
    type: cancelled ? "cancelled" : "finished",
    ...(cancelled
      ? { reason: cancelReason ?? "Unknown" }
      : {
          totalSteps: stepsUsed,
          totalDurationMs: Date.now() - startTime,
          success: qualityFinale ? qualityFinale.verdict.ok : true,
        }),
  } as ProgressEvent);

  return {
    finalText: gatedFinalText,
    stepsUsed,
    totalDurationMs: Date.now() - startTime,
    toolCalls: toolCallLog,
    buildFixResult,
    checkpoint,
    afterCheckpoint,
    workspaceChange,
    cancelled,
    cancelReason,
    events,
    modelFailed,
    modelFailureText,
    failedHonestly,
    qualityLoop: qualityFinale
      ? {
          verdict: qualityFinale.verdict,
          stages: qualityFinale.stages,
          designPasses: qualityFinale.designPasses,
        }
      : undefined,
    qualityLoopState: qualitySession ? snapshotQualityLoopSession(qualitySession) : undefined,
    finalMessages: [...llmMessages],
    // Observability (Part J): the complete run record.
    runObservability: finishRunObservability(
      runObs,
      cancelled ? "cancelled" : modelFailed || failedHonestly ? "failed" : "completed",
    ),
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
  /**
   * Authenticated user id — injected into user-scoped tools (browser.*)
   * at execution time. The model never supplies userId itself.
   */
  userId?: string;
  /**
   * Studio conversation id — injected into browser.start_session for
   * multi-turn session reuse (mirrors AgentLoopConfig.conversationId).
   */
  conversationId?: string;
  /** Parent ActionRun for server-side ActionExecutionContext propagation. */
  actionRunId?: string;
  /** Full trusted context propagated to ToolRegistry.execute. */
  actionContext?: ActionExecutionContext;
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
      // Phase 3: browser mutations get an action-and-target description
      // on the nested gate too.
      const approvalReason = await pauseReasonFor(
        toolCall.toolId,
        toolCall.inputs,
        permResult.reason ?? "Approval required",
      );
      ctx.localProgress.emit({
        type: "approval_required",
        toolId: toolCall.toolId,
        reason: approvalReason,
      });

      if (ctx.executionMode === "act") {
        // Pause again — the calls after this one stay deferred on the new
        // gate, so the batch still loses nothing.
        return {
          nestedApproval: {
            toolId: toolCall.toolId,
            toolCallId: toolCall.toolCallId,
            inputs: toolCall.inputs,
            reason: approvalReason,
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

    // Checkpoint before EVERY mutation in the deferred batch (the same
    // per-mutation guarantee as the initial loop): the resumed run keeps
    // producing a rollback point for each mutation across the pause
    // boundary, so the workspace always diffs truthfully. Read-only tools
    // never checkpoint.
    if (!toolDef.readOnly) {
      ctx.localProgress.emit({ type: "phase", phase: "execute", step: ctx.stepsUsed });
      state.checkpoint = await ctx.transport.createCheckpointBeforeMutation(
        `Pre-mutation resume (deferred batch): ${toolCall.toolId}`,
      ) ?? undefined;
      if (state.checkpoint) {
        ctx.localProgress.emit({
          type: "checkpoint",
          label: state.checkpoint.label,
          gitSha: state.checkpoint.gitSha,
        });
      }
    }

    ctx.localProgress.emit({ type: "tool_start", toolId: toolCall.toolId, summary: `${toolCall.toolId} (deferred)` });

    let result: ToolCallResult;
    try {
      const execResult = await toolRegistry.execute(toolCall.toolId, withUserScopeForBrowserTools(toolCall.toolId, toolCall.inputs, ctx.userId ?? ctx.actionContext?.userId, ctx.conversationId ?? ctx.actionContext?.conversationId), {
        hasApproval: !permResult.requiresApproval,
        transport: ctx.transport,
        signal: ctx.signal,
        actionContext: ctx.actionContext ?? actionContextFrom(ctx),
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
      await verifyMutationReadBack(ctx.qualitySession, ctx.transport, toolCall.toolId, toolCall.inputs, result.success && !toolDef.readOnly);
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
  try {
    return await resumeAgentLoopV2Inner(resume, transport, progress);
  } finally {
    // Station Control Bridge (chunk E): always release this run's event
    // sink, even when the run throws.
    setStationEventSink(transport, null);
  }
}

async function resumeAgentLoopV2Inner(
  resume: ResumeInput,
  transport: WorkspaceTransport,
  progress?: ProgressEmitter,
): Promise<AgentLoopResult> {
  const cfg = { ...DEFAULT_LOOP_CONFIG, ...resume.config };
  const startTime = Date.now();

  // Canonical metering (P0): same per-step emission as the fresh loop —
  // stable per-resume id so resumed steps stay idempotent.
  const meteringRunId =
    getMeteringContext()?.runId ?? cfg.qualityLoop?.runId ?? randomUUID();

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
    cfg.systemPrompt += buildQualityLoopPrompt(qualitySession.taskScope);
  }

  // ── LiTT Tool Orchestrator on resume (Parts A, B, H, D) ──
  // The resume rebuilds cfg from the original config, losing the initial
  // run's orchestration prompts. Re-apply deterministically from the
  // original user message (first user-role message in the paused
  // conversation) so the resumed run keeps the same capability plan and
  // reference-match workflow — tool-chain continuity across the approval
  // pause.
  const resumeUserMessage =
    resume.pausedMessages.find((m) => m.role === "user")?.content ?? "";
  const resumeCapabilityPlan =
    applyOrchestratorPrompts(cfg, resumeUserMessage);

  // ── Run observability on resume (Part J, D) ──
  // The approval pause breaks the original run's observability record
  // (not yet persisted across pauses); start a continuation record linked
  // by runId so the resumed segment's tool use is still captured.
  const resumeRunObs = startRunObservability({
    runId: `${meteringRunId}:resume`,
    goal: resumeUserMessage.slice(0, 500),
    agentMode: cfg.executionMode,
    capabilityPlan: resumeCapabilityPlan,
  });

  const events: ProgressEvent[] = [];
  const toolCallRecords: ToolCallRecord[] = [];
  let hasInterveningMutation = resume.hadInterveningMutation;
  const executedMutations = new Map<string, ToolCallResult>();

  const localProgress = new ProgressEmitter((event) => {
    events.push(event);
    progress?.emit(event);
  });
  // Item 5a — persist resumed-loop events to the run's durable
  // action_events log (same hook as the initial run).
  attachEventPersistence(localProgress, cfg.persistEvent);

  // Station Control Bridge (chunk E): route station action execution events
  // into this resumed run's Activity stream. Same transport-keyed sink as
  // runAgentLoopV2Inner; cleared in the exported wrapper's finally above.
  setStationEventSink(transport, (event) => {
    localProgress.emit({ type: "status", summary: summarizeStationEvent(event) });
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

  // ── Tool health on resume (Part F) ──
  // Same truthful filtering as the initial run: don't re-advertise tools
  // that cannot execute (e.g. terminal for non-owners).
  const resumeToolHealthMap = resolveToolHealth(
    availableTools.map((t) => t.id),
    {
      terminal: {
        userId: cfg.userId,
        isTerminalOwner:
          cfg.userId != null ? isTerminalOwnerUser(cfg.userId) : undefined,
      },
    },
  );
  const { offerable: resumeOfferableIds } = filterOfferableTools(resumeToolHealthMap);
  const resumeOfferableTools = availableTools.filter((t) =>
    resumeOfferableIds.includes(t.id),
  );
  const resumeHealthNote = buildToolHealthPromptNote(resumeToolHealthMap);
  if (resumeHealthNote) {
    cfg.systemPrompt += "\n\n" + resumeHealthNote;
  }

  const toolDefs = resumeOfferableTools.map(toToolDefinition);

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
  let failedHonestly: string | undefined;
  let checkpoint = resume.existingCheckpoint;
  const toolCallLog: Array<{ toolId: string; success: boolean; summary: string; mutating: boolean }> = [];
  let completedDeployment: CompletedDeployment | null = null;
  // NOTE: checkpoints are now created before EVERY mutation, so this flag no
  // longer gates anything. It is retained only because it is part of the
  // DeferredToolBatchState shape threaded through pause/resume records.
  let mutationBatchPending = false;
  let batchHasMutation = false;
  // Bounded recovery when the model announces more work but emits no tool
  // calls (the silent mid-build stall) — see resolveZeroToolCalls.
  let continuationNudges = 0;

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
      const execResult = await toolRegistry.execute(resume.toolId, withUserScopeForBrowserTools(resume.toolId, resume.inputs, cfg.userId ?? actionContextFrom(cfg)?.userId, cfg.conversationId ?? actionContextFrom(cfg)?.conversationId), {
        hasApproval: true,
        availableCapabilities,
        transport,
        signal: cfg.signal,
        actionContext: actionContextFrom(cfg),
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
    // Observability (Part J): record the approved tool execution.
    recordObsToolCall(resumeRunObs, {
      toolId: resume.toolId,
      success: result.success,
      summary: summary.slice(0, 200),
      mutating: !resumedReadOnly,
      errorClass: result.success ? undefined : "tool_error",
    });
    recordObsApproval(resumeRunObs, resume.toolId, "granted");
    completedDeployment = readDeploymentOutcome(resume.toolId, result.result) ?? completedDeployment;
    // Acceptance 2026-09-28: the APPROVED tool — the actual edit in an
    // approval-gated run — was never fed to the quality ledger, so a
    // successful edit still reported "build (pending)". Record it like
    // any other executed tool.
    if (qualitySession) {
      noteToolResult(
        qualitySession,
        resume.toolId,
        { success: result.success, result: result.result, mutating: !resumedReadOnly, summary },
        transport.workspaceId,
      );
      await verifyMutationReadBack(qualitySession, transport, resume.toolId, resume.inputs, result.success && !resumedReadOnly);
    }

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
      userId: cfg.userId,
      conversationId: cfg.conversationId,
      actionRunId: cfg.actionRunId,
      actionContext: actionContextFrom(cfg),
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
          toolChoice: cfg.requireToolCallOnFirstStep && stepsUsed === 1 ? "required" : "auto",
          evalMetadata: cfg.evalMetadata,
          deadlineMs: startTime + cfg.maxRuntimeMs,
          signal: cfg.signal,
          // Same preventive BUILD guard as the main loop: a resumed BUILD
          // run starts on a proven file writer.
          requireReliableFileWriting: cfg.buildCapabilityGuard != null,
          // P1: Server-derived paid-provider entitlement (never from client).
          allowLittPaidProviders: cfg.allowLittPaidProviders,
        },
      );
      if (llmResponse.responseShape && llmResponse.provider) {
        localProgress.emit({ type: "model_response", provider: llmResponse.provider, model: llmResponse.model, ...llmResponse.responseShape, finishReason: llmResponse.finishReason });
      }
      // Canonical metering (P0): one usage+cost event per resumed step's
      // LLM call. provider/model are from the ACTUAL call; token counts
      // are chars/4 estimates — see emitLoopStepMetering.
      emitLoopStepMetering({
        cfg,
        stepIndex: stepsUsed,
        meteringRunId,
        provider: llmResponse.provider ?? "unknown",
        model: llmResponse.model,
        inputChars: loopInputChars(llmMessages),
        outputChars: llmResponse.text?.length ?? 0,
        status: "success",
      });
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      // Canonical metering (P0): failed attempts billable=false, cost kept.
      emitLoopStepMetering({
        cfg,
        stepIndex: stepsUsed,
        meteringRunId,
        provider: "unknown",
        model: cfg.model ?? "unknown",
        inputChars: loopInputChars(llmMessages),
        outputChars: 0,
        status: "failed",
        error: errMsg.slice(0, 500),
      });
      localProgress.emit({
        type: "model_failed",
        model: "all-routes",
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

    // A zero-tool-call reply is normally the model's final answer — unless
    // the text announces more work it never started. Accepting that as
    // final is the silent mid-build stall: the run reports finished/Idle
    // with half the build done, no error, and no recovery. Nudge the
    // model (bounded) to emit the promised tool calls; when the nudges
    // are exhausted, fail honestly instead of claiming completion.
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
      const zeroCallText = llmResponse.text ?? "";
      const resolution = resolveZeroToolCalls(zeroCallText, continuationNudges);
      if (resolution.action === "nudge") {
        continuationNudges++;
        localProgress.emit({
          type: "status",
          summary:
            "The model announced more work but emitted no tool calls — asking it to continue...",
        });
        llmMessages.push({ role: "assistant", content: zeroCallText });
        llmMessages.push({ role: "user", content: resolution.nudgeMessage });
        continue;
      }
      if (resolution.action === "stall") {
        cancelled = true;
        cancelReason =
          "The model announced further work but produced no tool calls after retrying; stopping instead of claiming the build is complete.";
        finalText =
          "I stopped mid-build: I announced more work but could not produce the next actions. " +
          "Your project and everything completed so far are preserved — try again to continue.";
        localProgress.emit({
          type: "status",
          summary: "Stopping: the model announced more work but produced no tool calls.",
        });
        break;
      }
      if (resolution.action === "fail") {
        // Honest failure, not a cancellation: the model kept asking for
        // approval in prose (or claiming work was happening) instead of
        // emitting the gated tool call, so no approval card was ever
        // created and nothing was mutated. Report FAILED, never Complete.
        failedHonestly = resolution.failureMessage;
        finalText = resolution.failureMessage;
        localProgress.emit({
          type: "status",
          summary: "Stopping: the model asked for approval in prose instead of emitting the tool call — no approval card was created.",
        });
        break;
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

      // Create the pre-mutation checkpoint BEFORE the approval gate, ahead of
      // EVERY mutating tool call (same per-mutation guarantee as the initial
      // loop): a nested approval pause carries the latest checkpoint so the
      // next resume diffs truthfully instead of "unknown". Read-only tools
      // never checkpoint.
      if (!toolDef.readOnly) {
        checkpoint = await transport.createCheckpointBeforeMutation(`Pre-mutation resume: ${toolCall.toolId} (step ${stepsUsed})`) ?? undefined;
        if (checkpoint) {
          localProgress.emit({ type: "checkpoint", label: checkpoint.label, gitSha: checkpoint.gitSha });
        }
      }

      if (permResult.requiresApproval) {
        // Phase 3: browser mutations get an action-and-target description
        // on the resumed-run gate too.
        const approvalReason = await pauseReasonFor(
          toolCall.toolId,
          toolCall.inputs,
          permResult.reason ?? "Approval required",
        );
        localProgress.emit({ type: "approval_required", toolId: toolCall.toolId, reason: approvalReason });

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
          finalText: `I need your approval to run \`${toolCall.toolId}\`. ${approvalReason}`,
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
            reason: approvalReason,
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
        const execResult = await toolRegistry.execute(toolCall.toolId, withUserScopeForBrowserTools(toolCall.toolId, toolCall.inputs, cfg.userId ?? actionContextFrom(cfg)?.userId, cfg.conversationId ?? actionContextFrom(cfg)?.conversationId), {
          hasApproval: !permResult.requiresApproval,
          availableCapabilities,
          transport,
          signal: cfg.signal,
          actionContext: actionContextFrom(cfg),
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
        await verifyMutationReadBack(qualitySession, transport, toolCall.toolId, toolCall.inputs, result.success && !toolDef.readOnly);
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
      onRepair: createAutonomousRepairCallback(transport, cfg.systemPrompt, toolDefs, startTime + cfg.maxRuntimeMs, cfg.signal, cfg.executionMode, undefined, actionContextFrom(cfg), cfg.allowLittPaidProviders),
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
      ? `${effectiveFinalText}${formatQualityVerdictBlock(qualityFinale)}`
      : effectiveFinalText;

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

  if (workspaceChange) {
    localProgress.emit({ type: "workspace_change", ...workspaceChange });
  }
  const afterCheckpoint = await createAfterRunCheckpoint(
    transport,
    workspaceChange,
    cfg.qualityLoop?.userRequest ?? null,
    localProgress,
  );
  localProgress.emit({
    type: cancelled ? "cancelled" : "finished",
    ...(cancelled
      ? { reason: cancelReason ?? "Unknown" }
      : {
          totalSteps: stepsUsed,
          totalDurationMs: Date.now() - startTime,
          success: qualityFinale ? qualityFinale.verdict.ok : true,
        }),
  } as ProgressEvent);

  return {
    finalText: gatedFinalText,
    stepsUsed,
    totalDurationMs: Date.now() - startTime,
    toolCalls: toolCallLog,
    buildFixResult,
    checkpoint,
    afterCheckpoint,
    workspaceChange,
    cancelled,
    cancelReason,
    events,
    modelFailed,
    modelFailureText,
    failedHonestly,
    qualityLoop: qualityFinale
      ? {
          verdict: qualityFinale.verdict,
          stages: qualityFinale.stages,
          designPasses: qualityFinale.designPasses,
        }
      : undefined,
    qualityLoopState: qualitySession ? snapshotQualityLoopSession(qualitySession) : undefined,
    finalMessages: [...llmMessages],
    // Observability (Part J): the resumed segment's run record.
    runObservability: finishRunObservability(
      resumeRunObs,
      cancelled ? "cancelled" : modelFailed || failedHonestly ? "failed" : "completed",
    ),
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
  actionContext?: ActionExecutionContext,
  // P1: Server-derived paid-provider entitlement (never from client).
  allowLittPaidProviders?: boolean,
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
          // P1: Server-derived paid-provider entitlement (never from client).
          allowLittPaidProviders,
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
            const execResult = await toolRegistry.execute(
              toolCall.toolId,
              withUserScopeForBrowserTools(
                toolCall.toolId,
                toolCall.inputs,
                actionContext?.userId,
                actionContext?.conversationId,
              ),
              {
                hasApproval: true,
                availableCapabilities,
                transport,
                signal,
                actionContext,
              },
            );

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
