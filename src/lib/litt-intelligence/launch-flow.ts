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

import type { WorkspaceTransport } from "./workspace-transport";
import { runAgentLoopV2, type AgentLoopResult, type AgentLoopConfig } from "./agent-loop-v2";
import type { LLMCallMetadata } from "@/lib/evals/braintrust";
import { runDeployFlow, resolveDeployConfig, verifyProductionUrl, type DeployFlowOptions, type DeployResult, type DeployProvider } from "./deploy";
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
  enableBuildFix?: boolean;
  enableDeploy?: boolean;
  deployEnvironment?: "production" | "preview";
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
  runDeployFlow?: (options: DeployFlowOptions) => Promise<DeployResult>;
  /** Injected for tests. */
  resolveDeployConfig?: () => { ok: true; config: { provider: DeployProvider; token: string; projectId: string; productionUrl?: string } } | { ok: false; error: string };
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
  deployResult?: DeployResult;
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

    const agentResult = await (options.runAgentLoop ?? runAgentLoopV2)(
      options.userMessage,
      transport,
      {
        systemPrompt: options.systemPrompt ?? "",
        model: options.model,
        executionMode: options.executionMode ?? "act",
        enableBuildFix: options.enableBuildFix ?? true,
        evalMetadata: options.evalMetadata,
        signal,
      },
      progress,
    );
    lastAgentLoopResult = agentResult;

    if (agentResult.pendingApproval) {
      return baseResult({
        success: false,
        status: "failed",
        finalText: `I need your approval to continue: ${agentResult.pendingApproval.reason}`,
        pendingApproval: agentResult.pendingApproval,
        repairAttempts: agentResult.buildFixResult?.repairAttempts ?? 0,
        runtimeRepairAttempts,
      });
    }

    if (agentResult.cancelled) {
      return baseResult({
        success: false,
        status: "cancelled",
        finalText: agentResult.cancelReason
          ? `Cancelled: ${agentResult.cancelReason}`
          : "The launch was cancelled before completion.",
        cancelled: true,
        cancelReason: agentResult.cancelReason,
        repairAttempts: agentResult.buildFixResult?.repairAttempts ?? 0,
        runtimeRepairAttempts,
      });
    }

    if (agentResult.modelFailed) {
      return baseResult({
        success: false,
        status: "failed",
        finalText: `The model could not complete the request: ${agentResult.modelFailed}`,
        error: agentResult.modelFailed,
        repairAttempts: agentResult.buildFixResult?.repairAttempts ?? 0,
        runtimeRepairAttempts,
      });
    }

    if (agentResult.buildFixResult && !agentResult.buildFixResult.allPassed) {
      return baseResult({
        success: false,
        status: "failed",
        finalText:
          `The project did not pass all checks after ${agentResult.buildFixResult.repairAttempts} repair attempts.\n` +
          formatBuildFixErrors(agentResult.buildFixResult),
        buildFixResult: agentResult.buildFixResult,
        repairAttempts: agentResult.buildFixResult.repairAttempts,
        runtimeRepairAttempts,
      });
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
          signal,
        },
        progress,
      );
      lastAgentLoopResult = repairResult;

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
          finalText: `The model could not complete the repair: ${repairResult.modelFailed}`,
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
      return baseResult({
        finalText: `The preview could not be started after ${runtimeRepairAttempts} repair attempts. ${error}`,
        error,
        runtimeRepairAttempts,
      });
    }

    const previewUrl = (options.buildPreviewUrl ?? buildPreviewProxyUrl)(transport.workspaceId);
    progress.emit({ type: "preview_result", success: true, previewUrl });

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

    // Phase 3: deploy
    checkSignal(signal);
    emitStep(progress, steps, "Deploying to production...");
    progress.emit({ type: "phase", phase: "deploy", step: agentResult.stepsUsed + 2 });

    const envConfig = (options.resolveDeployConfig ?? resolveDeployConfig)();
    if (!envConfig.ok) {
      progress.emit({ type: "deploy_result", success: false, error: envConfig.error });
      return baseResult({
        status: "failed",
        previewUrl,
        finalText: `Deployment cannot run: ${envConfig.error}`,
        error: envConfig.error,
        repairAttempts: agentResult.buildFixResult?.repairAttempts ?? 0,
        runtimeRepairAttempts,
      });
    }

    progress.emit({
      type: "deploy_start",
      environment: options.deployEnvironment ?? "production",
      provider: envConfig.config.provider,
    });

    const deployFlowOptions: DeployFlowOptions = {
      config: envConfig.config,
      signal,
    };

    const deployResult = await (options.runDeployFlow ?? runDeployFlow)(deployFlowOptions);

    if (!deployResult.success) {
      progress.emit({ type: "deploy_result", success: false, error: deployResult.error });
      return baseResult({
        status: "failed",
        previewUrl,
        finalText: deployResult.error
          ? `Deployment failed: ${deployResult.error}`
          : "Deployment failed for an unknown reason.",
        error: deployResult.error,
        deployResult,
        repairAttempts: agentResult.buildFixResult?.repairAttempts ?? 0,
        runtimeRepairAttempts,
      });
    }

    const productionUrl = deployResult.productionUrl ?? null;
    progress.emit({ type: "deploy_result", success: true, productionUrl });

    if (productionUrl) {
      checkSignal(signal);
      const verify =
        deployResult.verification ??
        (await verifyProductionUrl(productionUrl));
      progress.emit({
        type: "deploy_verify",
        url: verify.url ?? productionUrl,
        success: verify.success,
        detail: verify.detail,
      });

      if (!verify.success) {
        return baseResult({
          status: "failed",
          previewUrl,
          productionUrl,
          finalText: `Deployment succeeded but the production URL could not be verified: ${verify.detail}`,
          error: verify.detail,
          deployResult,
          repairAttempts: agentResult.buildFixResult?.repairAttempts ?? 0,
          runtimeRepairAttempts,
        });
      }
    }

    return baseResult({
      success: true,
      status: "deployed",
      previewUrl,
      productionUrl,
      finalText: productionUrl
        ? `Deployed and verified: ${productionUrl}`
        : "Deployment succeeded, but no production URL was returned for verification.",
      deployResult,
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
