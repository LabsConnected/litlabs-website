/**
 * LiTT Launch Flow — prompt → plan → generate → build → preview → deploy.
 *
 * This orchestrator wires together the existing V2 agent loop, build-fix
 * loop, workspace preview runtime, and deployment verification into one
 * bounded, truthful state machine.
 *
 * Design goals:
 * - Never claim success before validation passes.
 * - Surface real build/runtime/deploy errors.
 * - Bounded repair for both build-time and runtime failures.
 * - Preserve existing project work (checkpoint before mutation is handled by
 *   the V2 agent loop and transport checkpoint helpers).
 * - Honest cancellation and exhaustion states.
 */

import "server-only";

import { randomUUID } from "crypto";
import type { WorkspaceTransport } from "./workspace-transport";
import { runAgentLoopV2, type AgentLoopResult, type AgentLoopConfig, DEFAULT_LOOP_CONFIG } from "./agent-loop-v2";
import { toolRegistry } from "./tool-registry";
import type { LLMCallMetadata } from "@/lib/evals/braintrust";
import type { BuildFixLoopResult } from "./build-fix-loop";
import { ProgressEmitter } from "./progress-events";
import { buildPreviewProxyUrl } from "@/lib/terminal-internal-client";

// ─── Types ────────────────────────────────────────────────────────

export interface LaunchFlowOptions {
  userMessage: string;
  projectId: string;
  userId: string;
  transport: WorkspaceTransport;
  systemPrompt?: string;
  model?: string;
  executionMode?: AgentLoopConfig["executionMode"];
  /**
   * Kernel intent routing flag (decision.routing.requiresExecution). When true
   * and the first agent pass applies zero workspace mutations, the flow issues
   * one bounded reprompt so weak models that end their turn after announcing
   * writes get a second chance to actually write the files.
   */
  requiresExecution?: boolean;
  enableBuildFix?: boolean;
  enableDeploy?: boolean;
  /**
   * Quality-loop opt-in, passed through to the main agent-loop phase.
   * When set, the build is gated by the UNDERSTAND→VERIFY evidence stages
   * plus the visual-quality judge. (Was silently dropped before AUTO-mode
   * support: the option existed on the route's loop config but never
   * reached the agent loop.)
   */
  qualityLoop?: AgentLoopConfig["qualityLoop"];
  maxPreviewWaitMs?: number;
  previewPollIntervalMs?: number;
  maxRuntimeRepairAttempts?: number;
  runtimeRepairBudgetSteps?: number;
  signal?: AbortSignal;
  progress?: ProgressEmitter;
  evalMetadata?: LLMCallMetadata;
  /** Injected for tests. */
  runAgentLoop?: (
    userMessage: string,
    transport: WorkspaceTransport,
    config: Partial<AgentLoopConfig>,
    progress?: ProgressEmitter,
  ) => Promise<AgentLoopResult>;
  /** Injected for tests. */
  buildPreviewUrl?: (workspaceId: string) => string;
}

export interface LaunchFlowResult {
  success: boolean;
  status: "preview_ready" | "deployed" | "failed" | "cancelled";
  previewUrl?: string | null;
  productionUrl?: string | null;
  finalText: string;
  buildFixResult?: BuildFixLoopResult;
  error?: string;
  repairAttempts: number;
  runtimeRepairAttempts: number;
  steps: string[];
  pendingApproval?: AgentLoopResult["pendingApproval"];
  /** The last agent-loop result that ran the plan/build/repair phase. */
  agentLoopResult?: AgentLoopResult;
  cancelled: boolean;
  cancelReason?: string;
  totalDurationMs: number;
}

class LaunchFlowCancelledError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "LaunchFlowCancelledError";
  }
}

// ─── Helpers ──────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatBuildFixErrors(result: BuildFixLoopResult): string {
  const failed = result.results.filter((r) => !r.passed);
  if (failed.length === 0) return "";
  return failed
    .map((r) => `- ${r.check} failed (exit ${r.exitCode}): ${r.stderr?.slice(0, 500) || r.stdout?.slice(0, 500) || "no output"}`)
    .join("\n");
}

function emitStep(progress: ProgressEmitter, steps: string[], summary: string): void {
  steps.push(summary);
  progress.emit({ type: "status", summary });
}

function checkSignal(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw new LaunchFlowCancelledError(signal.reason as string);
  }
}

/** True when at least one successful call went to a non-read-only tool. */
function hasAppliedMutation(result: AgentLoopResult): boolean {
  return result.toolCalls.some((call) => {
    if (!call.success) return false;
    return toolRegistry.get(call.toolId)?.readOnly === false;
  });
}

async function startAndWaitForPreview(
  transport: WorkspaceTransport,
  opts: {
    maxWaitMs: number;
    pollIntervalMs: number;
    signal?: AbortSignal;
  },
  progress: ProgressEmitter,
): Promise<"ready" | "failed" | "timeout"> {
  await transport.startPreview();

  const deadline = Date.now() + opts.maxWaitMs;
  while (Date.now() < deadline) {
    checkSignal(opts.signal);

    const status = await transport.getPreviewStatus();
    progress.emit({ type: "preview_status", status: status.status, healthy: status.status === "ready" && !status.error });

    if (status.status === "ready" && !status.error) return "ready";
    if (status.status === "failed" || status.error) return "failed";

    await sleep(opts.pollIntervalMs);
  }

  return "timeout";
}

// ─── Main Orchestrator ────────────────────────────────────────────

export async function runLaunchFlow(options: LaunchFlowOptions): Promise<LaunchFlowResult> {
  const startTime = Date.now();
  const progress = options.progress ?? new ProgressEmitter();
  const transport = options.transport;
  const signal = options.signal;
  const steps: string[] = [];
  let runtimeRepairAttempts = 0;
  const maxRuntimeRepairAttempts = options.maxRuntimeRepairAttempts ?? 2;

  let lastAgentLoopResult: AgentLoopResult | undefined;

  const baseResult = (overrides: Partial<LaunchFlowResult>): LaunchFlowResult => ({
    success: false,
    status: "failed",
    finalText: "Launch did not complete.",
    repairAttempts: 0,
    runtimeRepairAttempts: 0,
    steps,
    cancelled: false,
    agentLoopResult: lastAgentLoopResult,
    totalDurationMs: Date.now() - startTime,
    ...overrides,
  });

  try {
    checkSignal(signal);

    // Preserve existing work by creating a checkpoint before any mutation.
    const initialCheckpoint = await transport.createCheckpointBeforeMutation(
      `Pre-launch: ${options.userMessage.slice(0, 80)}`,
    ).catch(() => null);
    if (initialCheckpoint) {
      progress.emit({ type: "checkpoint", label: initialCheckpoint.label, gitSha: initialCheckpoint.gitSha });
    }

    // Phase 1: plan / generate / edit / build-fix via the V2 agent loop
    emitStep(progress, steps, "Planning and generating the project...");
    progress.emit({ type: "phase", phase: "call_llm", step: 1 });

    const runPhase1 = (message: string) =>
      (options.runAgentLoop ?? runAgentLoopV2)(
        message,
        transport,
        {
          systemPrompt: options.systemPrompt ?? "",
          model: options.model,
          executionMode: options.executionMode ?? "act",
          enableBuildFix: options.enableBuildFix ?? true,
          evalMetadata: options.evalMetadata,
          // Always bounded by the global launch budget — a reprompt must not
          // restart the clock.
          maxRuntimeMs: Math.max(0, startTime + DEFAULT_LOOP_CONFIG.maxRuntimeMs - Date.now()),
          // The launch flow needs more room than the bare agent-loop defaults:
          // a full build explores the workspace, writes multiple files, runs
          // build-fix, starts a preview, and deploys — all within the 10-minute
          // runtime budget. The output-char and step limits are safety valves
          // that must not trigger during normal build activity; the runtime
          // budget remains the real bound.
          maxSteps: 40,
          maxOutputChars: 200_000,
          signal,
          // Quality loop: gate the main build phase when the caller opted in.
          // (The repair phase below runs without it — it is a bounded
          // sub-task of the already-gated build, not a new build.)
          qualityLoop: options.qualityLoop,
        },
        progress,
      );

    const guardPhase1 = (r: AgentLoopResult): LaunchFlowResult | null => {
      if (r.pendingApproval) {
        // If the agent already wrote files before hitting the approval gate,
        // start the preview so the user can see the result while deciding
        // whether to approve the deploy. The preview is not a sensitive
        // action — it's just a local dev server. Without this, a website
        // build that pauses for deploy approval shows no preview at all,
        // even though the files exist and are ready to serve.
        if (hasAppliedMutation(r)) {
          try {
            checkSignal(signal);
            emitStep(progress, steps, "Starting live preview...");
            progress.emit({ type: "phase", phase: "preview", step: r.stepsUsed + 1 });
            progress.emit({ type: "preview_start" });
            void startAndWaitForPreview(
              transport,
              {
                maxWaitMs: options.maxPreviewWaitMs ?? 120_000,
                pollIntervalMs: 1_000,
                signal,
              },
              progress,
            ).then((previewStatus) => {
              if (previewStatus === "ready") {
                const previewUrl = (options.buildPreviewUrl ?? buildPreviewProxyUrl)(transport.workspaceId);
                progress.emit({ type: "preview_result", success: true, previewUrl });
              } else {
                progress.emit({ type: "preview_result", success: false, error: `Preview did not become ready (status: ${previewStatus})` });
              }
            }).catch(() => {
              progress.emit({ type: "preview_result", success: false, error: "Preview startup failed" });
            });
          } catch {
            // Preview start is best-effort — don't block the approval flow
          }
        }
        return baseResult({
          success: false,
          status: "failed",
          finalText: `I need your approval to continue: ${r.pendingApproval.reason}`,
          pendingApproval: r.pendingApproval,
          repairAttempts: r.buildFixResult?.repairAttempts ?? 0,
          runtimeRepairAttempts,
        });
      }

      if (r.cancelled) {
        return baseResult({
          success: false,
          status: "cancelled",
          finalText: r.cancelReason
            ? `Cancelled: ${r.cancelReason}`
            : "The launch was cancelled before completion.",
          cancelled: true,
          cancelReason: r.cancelReason,
          repairAttempts: r.buildFixResult?.repairAttempts ?? 0,
          runtimeRepairAttempts,
        });
      }

      if (r.modelFailed) {
        return baseResult({
          success: false,
          status: "failed",
          // Prefer the sanitized purpose-written failure message when the loop
          // produced one; otherwise surface the (sanitized) failure detail.
          finalText:
            r.modelFailureText ??
            `The model could not complete the request: ${r.modelFailed}`,
          error: r.modelFailed,
          repairAttempts: r.buildFixResult?.repairAttempts ?? 0,
          runtimeRepairAttempts,
        });
      }

      if (r.buildFixResult && !r.buildFixResult.allPassed) {
        return baseResult({
          success: false,
          status: "failed",
          finalText:
            `The project did not pass all checks after ${r.buildFixResult.repairAttempts} repair attempts.\n` +
            formatBuildFixErrors(r.buildFixResult),
          buildFixResult: r.buildFixResult,
          repairAttempts: r.buildFixResult.repairAttempts,
          runtimeRepairAttempts,
        });
      }

      return null;
    };

    let agentResult = await runPhase1(options.userMessage);
    lastAgentLoopResult = agentResult;
    // An execution abort that landed mid-loop surfaces inside the agent
    // result as a provider failure — re-check the signal so an explicit
    // cancellation is reported as "cancelled", not a model failure.
    checkSignal(signal);

    // A pause for a sensitive action (e.g. project.deploy) is not a failure:
    // the build output already exists in the workspace, so still bring the
    // preview up while the approval is pending — the user can review the
    // site before deciding. The pause result is returned after Phase 2.
    let pausedApproval = agentResult.pendingApproval;
    if (!pausedApproval) {
      const guarded = guardPhase1(agentResult);
      if (guarded) return guarded;

      // An execution request that ended with zero workspace mutations almost
      // always means a weak model closed its turn after announcing writes it
      // never made. Issue exactly one bounded reprompt, then continue — the
      // second result flows through the same guards.
      if (options.requiresExecution && !hasAppliedMutation(agentResult)) {
        emitStep(
          progress,
          steps,
          "No project files were changed — re-prompting the agent to apply the request...",
        );
        agentResult = await runPhase1(
          `Your previous reply announced changes but did not write any project files. ` +
          `Apply the original request now: ${options.userMessage}\n\n` +
          `Write or modify the project files with the file tools (files.write / apply_patch), then stop.`,
        );
        lastAgentLoopResult = agentResult;
        checkSignal(signal);
        pausedApproval = agentResult.pendingApproval;
        if (!pausedApproval) {
          const guarded = guardPhase1(agentResult);
          if (guarded) return guarded;
        }

        // An action request is not successful merely because a model emitted
        // prose (including pseudo-tool markup). No structured tool execution
        // means there is no mutation evidence to verify.
        if (!pausedApproval && !hasAppliedMutation(agentResult)) {
          return baseResult({
            status: "failed",
            finalText: "Tool execution unavailable: the selected model did not produce an executable tool call, so no project files were changed.",
            error: "TOOL_EXECUTION_UNAVAILABLE",
            repairAttempts: agentResult.buildFixResult?.repairAttempts ?? 0,
            runtimeRepairAttempts,
          });
        }
      }
    }

    // Phase 2: start and verify the live preview
    checkSignal(signal);
    emitStep(progress, steps, "Starting live preview...");
    progress.emit({ type: "phase", phase: "preview", step: agentResult.stepsUsed + 1 });
    progress.emit({ type: "preview_start" });

    let previewStatus = await startAndWaitForPreview(
      transport,
      {
        maxWaitMs: options.maxPreviewWaitMs ?? 120_000,
        pollIntervalMs: options.previewPollIntervalMs ?? 2_000,
        signal,
      },
      progress,
    );

    // Runtime repair loop
    while (previewStatus !== "ready" && runtimeRepairAttempts < maxRuntimeRepairAttempts) {
      runtimeRepairAttempts++;
      progress.emit({
        type: "repair_attempt",
        attempt: runtimeRepairAttempts,
        maxAttempts: maxRuntimeRepairAttempts,
      });
      emitStep(
        progress,
        steps,
        `Preview runtime failed — repair attempt ${runtimeRepairAttempts}/${maxRuntimeRepairAttempts}...`,
      );

      const status = await transport.getPreviewStatus().catch(() => ({ status: "failed" as const, error: "unknown" }));
      const runtimeError = (status as { error?: string | null }).error ?? "Preview server did not become ready";

      const repairMessage = `The preview server failed to start with this error:\n${runtimeError}\n\nInspect the project files, fix the root cause, and stop once you are done. I will re-start the preview and verify it.`;

      const repairResult = await (options.runAgentLoop ?? runAgentLoopV2)(
        repairMessage,
        transport,
        {
          systemPrompt: options.systemPrompt ?? "",
          model: options.model,
          executionMode: options.executionMode ?? "act",
          enableBuildFix: true,
          maxSteps: options.runtimeRepairBudgetSteps ?? 8,
          // Repair must not restart the global agent runtime budget.
          maxRuntimeMs: Math.max(0, startTime + DEFAULT_LOOP_CONFIG.maxRuntimeMs - Date.now()),
          maxOutputChars: 200_000,
          signal,
        },
        progress,
      );
      lastAgentLoopResult = repairResult;
      checkSignal(signal);

      if (repairResult.pendingApproval) {
        return baseResult({
          finalText: `I need your approval to continue: ${repairResult.pendingApproval.reason}`,
          pendingApproval: repairResult.pendingApproval,
          repairAttempts: agentResult.buildFixResult?.repairAttempts ?? 0,
          runtimeRepairAttempts,
        });
      }

      if (repairResult.cancelled) {
        return baseResult({
          status: "cancelled",
          finalText: repairResult.cancelReason
            ? `Cancelled during repair: ${repairResult.cancelReason}`
            : "The launch was cancelled during repair.",
          cancelled: true,
          cancelReason: repairResult.cancelReason,
          repairAttempts: agentResult.buildFixResult?.repairAttempts ?? 0,
          runtimeRepairAttempts,
        });
      }

      if (repairResult.modelFailed) {
        return baseResult({
          finalText:
            repairResult.modelFailureText ??
            `The model could not complete the repair: ${repairResult.modelFailed}`,
          error: repairResult.modelFailed,
          repairAttempts: agentResult.buildFixResult?.repairAttempts ?? 0,
          runtimeRepairAttempts,
        });
      }

      if (repairResult.buildFixResult && !repairResult.buildFixResult.allPassed) {
        return baseResult({
          finalText:
            `The repair attempt did not pass all checks after ${repairResult.buildFixResult.repairAttempts} tries.\n` +
            formatBuildFixErrors(repairResult.buildFixResult),
          buildFixResult: repairResult.buildFixResult,
          repairAttempts: agentResult.buildFixResult?.repairAttempts ?? 0,
          runtimeRepairAttempts,
        });
      }

      checkSignal(signal);
      emitStep(progress, steps, "Re-starting preview after repair...");
      progress.emit({ type: "preview_start" });

      previewStatus = await startAndWaitForPreview(
        transport,
        {
          maxWaitMs: options.maxPreviewWaitMs ?? 120_000,
          pollIntervalMs: options.previewPollIntervalMs ?? 2_000,
          signal,
        },
        progress,
      );
    }

    if (previewStatus !== "ready") {
      const status = await transport.getPreviewStatus().catch(() => ({ status: "failed" as const, error: "unknown" }));
      const error = (status as { error?: string | null }).error ?? `Preview did not become ready (status: ${previewStatus})`;
      progress.emit({ type: "preview_result", success: false, error });
      // A pending approval outranks a preview failure — the build completed
      // and the user still needs to approve the sensitive action.
      if (pausedApproval) {
        return baseResult({
          finalText:
            `I need your approval to continue: ${pausedApproval.reason} ` +
            `(Preview could not be started: ${error})`,
          pendingApproval: pausedApproval,
          repairAttempts: agentResult.buildFixResult?.repairAttempts ?? 0,
          runtimeRepairAttempts,
        });
      }
      return baseResult({
        finalText: `The preview could not be started after ${runtimeRepairAttempts} repair attempts. ${error}`,
        error,
        runtimeRepairAttempts,
      });
    }

    const previewUrl = (options.buildPreviewUrl ?? buildPreviewProxyUrl)(transport.workspaceId);
    progress.emit({ type: "preview_result", success: true, previewUrl });

    // Phase 1 paused for approval — preview is live; return the pause now.
    if (pausedApproval) {
      return baseResult({
        status: "preview_ready",
        previewUrl,
        finalText: `I need your approval to continue: ${pausedApproval.reason}`,
        pendingApproval: pausedApproval,
        buildFixResult: agentResult.buildFixResult,
        repairAttempts: agentResult.buildFixResult?.repairAttempts ?? 0,
        runtimeRepairAttempts,
      });
    }

    if (!options.enableDeploy) {
      return baseResult({
        success: true,
        status: "preview_ready",
        previewUrl,
        finalText: `The project is running and the live preview is ready: ${previewUrl}`,
        buildFixResult: agentResult.buildFixResult,
        repairAttempts: agentResult.buildFixResult?.repairAttempts ?? 0,
        runtimeRepairAttempts,
      });
    }

    // Phase 3: deploy — publishing is a sensitive action and MUST pause for
    // explicit approval, exactly like an agent-initiated `project.deploy`
    // call. Running a deploy inline here would bypass the approval gate —
    // and the previous runDeployFlow path targeted the site's own hosting
    // (DEPLOY_PRODUCTION_URL / a configured Railway service), not the user's
    // project. The pause resolves through the approvals endpoint, which
    // executes `project.deploy` via the normal tool pipeline
    // (deployUserProject → verified public /sites/<id> URL).
    checkSignal(signal);
    emitStep(progress, steps, "Ready to publish — waiting for deploy approval...");
    progress.emit({ type: "phase", phase: "deploy", step: agentResult.stepsUsed + 2 });
    progress.emit({
      type: "approval_required",
      toolId: "project.deploy",
      reason: "Sensitive action — requires explicit approval",
    });

    const deployApproval: NonNullable<AgentLoopResult["pendingApproval"]> = {
      toolId: "project.deploy",
      toolCallId: `phase3-deploy-${randomUUID()}`,
      inputs: {},
      reason: "Sensitive action — requires explicit approval",
      // Resume context: the original request, so the resumed loop's model
      // continuation knows what it was doing when it reports the live URL.
      pausedMessages: [{ role: "user", content: options.userMessage }],
    };
    // The messages route persists the paused run off agentLoopResult —
    // the synthesized pause must be visible there or the approval card
    // would have no pausedRunId to resume.
    lastAgentLoopResult = { ...agentResult, pendingApproval: deployApproval };

    return baseResult({
      status: "preview_ready",
      previewUrl,
      finalText: `I need your approval to continue: ${deployApproval.reason}`,
      pendingApproval: deployApproval,
      buildFixResult: agentResult.buildFixResult,
      repairAttempts: agentResult.buildFixResult?.repairAttempts ?? 0,
      runtimeRepairAttempts,
    });
  } catch (err) {
    if (err instanceof LaunchFlowCancelledError || signal?.aborted) {
      const reason =
        err instanceof LaunchFlowCancelledError
          ? err.message
          : signal?.reason instanceof Error
            ? signal.reason.message
            : String(signal?.reason ?? "cancelled");
      return baseResult({
        status: "cancelled",
        finalText: `Cancelled: ${reason}`,
        cancelled: true,
        cancelReason: reason,
      });
    }

    const message = err instanceof Error ? err.message : String(err);
    return baseResult({
      finalText: `Launch failed: ${message}`,
      error: message,
    });
  }
}
