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
import {
  recordActionEventActivity,
  type ActionEventInput,
  type ActionExecutionContext,
} from "@/lib/action-runtime";
import { ProgressEmitter } from "./progress-events";
import { buildPreviewProxyUrl } from "@/lib/terminal-internal-client";
import {
  noteBuildArtifacts,
  notePreviewReady,
  restoreQualityLoopSession,
  snapshotQualityLoopSession,
} from "./quality-loop-flow";

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
   * Require a real website entry artifact before this flow can report a
   * successful build. Production chat enables this for execution requests;
   * keeping it opt-in preserves the lower-level orchestration tests and
   * non-website callers.
   */
  requireProjectArtifacts?: boolean;
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
  /**
   * Canonical parent run context created by the authenticated orchestrator.
   * Launch flow must propagate it to every agent-loop pass so files,
   * terminal, preview, deployment, and browser work share one ActionRun.
   */
  actionContext?: ActionExecutionContext;
  /** Conversation scope for trusted context/user-scoped tools. */
  conversationId?: string;
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

async function recordPreviewRuntimeEvent(
  actionContext: ActionExecutionContext | undefined,
  type: ActionEventInput["type"],
  payload: Record<string, string>,
  message: string,
): Promise<void> {
  if (!actionContext) return;
  await recordActionEventActivity({
    runId: actionContext.actionRunId,
    userId: actionContext.userId,
    type,
    payload,
    message,
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
  actionContext?: ActionExecutionContext,
): Promise<"ready" | "failed" | "timeout"> {
  let terminalEventRecorded = false;
  let previewStartPersistFailed = false;
  const recordTerminal = async (
    type: "preview.ready" | "preview.failed",
    payload: Record<string, string>,
    message: string,
  ) => {
    terminalEventRecorded = true;
    await recordPreviewRuntimeEvent(actionContext, type, payload, message);
  };

  try {
    try {
      await recordPreviewRuntimeEvent(
        actionContext,
        "preview.started",
        { workspaceId: transport.workspaceId },
        "Starting project preview",
      );
    } catch (persistError) {
      console.error("[action-runtime] preview start could not be persisted; preview start aborted", {
        runId: actionContext?.actionRunId,
        workspaceId: transport.workspaceId,
        errorClass: persistError instanceof Error ? persistError.message : String(persistError),
      });
      previewStartPersistFailed = true;
      throw persistError;
    }
    await transport.startPreview();
  } catch (error) {
    // A rejected start request (e.g. preview_no_dev_command on a workspace
    // with no servable entry) is a normal "failed" outcome — returning it
    // lets callers run the repair loop or surface a pending approval
    // instead of escaping as a generic launch crash. A runtime persistence
    // failure is different: it remains an explicit error and never retries
    // hidden untracked work.
    progress.emit({ type: "preview_status", status: "failed", healthy: false });
    if (!terminalEventRecorded) {
      await recordTerminal(
        "preview.failed",
        { error: error instanceof Error ? error.message.slice(0, 300) : "preview_start_failed" },
        "Project preview failed to start",
      );
    }
    if (previewStartPersistFailed) throw error;
    return "failed";
  }

  try {
    const deadline = Date.now() + opts.maxWaitMs;
    while (Date.now() < deadline) {
      checkSignal(opts.signal);

      const status = await transport.getPreviewStatus();
      progress.emit({ type: "preview_status", status: status.status, healthy: status.status === "ready" && !status.error });

      if (status.status === "ready" && !status.error) {
        await recordTerminal(
          "preview.ready",
          { workspaceId: transport.workspaceId, ...(status.port ? { port: String(status.port) } : {}) },
          "Project preview is ready",
        );
        return "ready";
      }
      if (status.status === "failed" || status.error) {
        await recordTerminal(
          "preview.failed",
          { error: (status.error ?? `Preview status ${status.status}`).slice(0, 300) },
          "Project preview failed",
        );
        return "failed";
      }

      await sleep(opts.pollIntervalMs);
    }

    await recordTerminal(
      "preview.failed",
      { error: "preview_ready_timeout" },
      "Project preview timed out",
    );
    return "timeout";
  } catch (error) {
    if (!terminalEventRecorded) {
      await recordTerminal(
        "preview.failed",
        { error: error instanceof Error ? error.message.slice(0, 300) : "preview_wait_failed" },
        "Project preview failed",
      );
    }
    throw error;
  }
}

export interface ProjectArtifactCheck {
  ok: boolean;
  files: string[];
  error?: string;
}

const WEBSITE_ENTRY_FILES = new Set([
  "index.html",
  "index.htm",
  "app/page.tsx",
  "app/page.ts",
  "app/page.jsx",
  "app/page.js",
  "pages/index.tsx",
  "pages/index.ts",
  "pages/index.jsx",
  "pages/index.js",
  "src/main.tsx",
  "src/main.ts",
  "src/main.jsx",
  "src/main.js",
]);

/**
 * Marker comment the platform seeds into blank-workspace entry files
 * (source of truth: terminal-server/workspace/welcome-screen.ts
 * WELCOME_SCREEN_MARKER). A build that stalled before replacing the
 * starter leaves this marker behind — the filename check alone cannot
 * tell a real project from the welcome screen, so entry candidates are
 * read and rejected when the marker is still present.
 */
const WELCOME_SCREEN_MARKER = "LITT-WELCOME-SCREEN";

/**
 * Verify that a website build produced a real entry artifact in the bound
 * workspace. This deliberately asks the workspace transport rather than
 * trusting tool-call metadata or the model's final prose.
 */
export async function verifyProjectArtifacts(
  transport: Pick<WorkspaceTransport, "listFiles" | "readFile">,
): Promise<ProjectArtifactCheck> {
  const files: string[] = [];
  const queue: Array<{ path: string; depth: number }> = [{ path: ".", depth: 0 }];
  const visited = new Set<string>();

  try {
    while (queue.length > 0 && files.length < 500) {
      const current = queue.shift()!;
      if (visited.has(current.path)) continue;
      visited.add(current.path);

      const { entries } = await transport.listFiles(current.path);
      for (const entry of entries) {
        const name = String(entry.name || "").replace(/\\/g, "/");
        if (!name || name === "." || name === ".." || name.includes("/")) continue;
        const relative = current.path === "." ? name : `${current.path}/${name}`;
        if (entry.type === "folder" || entry.type === "directory") {
          if (current.depth < 4 && !name.startsWith(".")) {
            queue.push({ path: relative, depth: current.depth + 1 });
          }
        } else {
          files.push(relative);
        }
      }
    }
  } catch (error) {
    return {
      ok: false,
      files,
      error: error instanceof Error ? error.message : "Could not inspect project artifacts",
    };
  }

  const entryFiles = [...WEBSITE_ENTRY_FILES]
    .map((entry) => files.find((file) => file.toLowerCase() === entry))
    .filter((file): file is string => file !== undefined);
  if (entryFiles.length === 0) {
    return {
      ok: false,
      files,
      error: "No runnable website entry file was created in the project workspace.",
    };
  }

  // The blank workspace ships a welcome screen under the entry filename
  // (e.g. index.html). A run that stalled before replacing it must not
  // pass this gate — read each candidate and reject the ones that still
  // carry the welcome-screen marker. An unreadable file keeps the old
  // filename-only signal so exotic transports do not newly fail.
  let realEntryFound = false;
  let welcomeOnly = false;
  for (const entry of entryFiles) {
    let content: string | null = null;
    try {
      content = (await transport.readFile(entry)).content;
    } catch {
      content = null;
    }
    if (content === null || !content.includes(WELCOME_SCREEN_MARKER)) {
      realEntryFound = true;
      break;
    }
    welcomeOnly = true;
  }
  if (!realEntryFound && welcomeOnly) {
    return {
      ok: false,
      files,
      error:
        "The project workspace still shows the blank starter screen — no real project files were created.",
    };
  }

  return { ok: true, files };
}

/**
 * After an approved mutation, prove the artifact is on disk and bring up a
 * real preview. Used by approval-resume handling so the resumed path has the
 * same physical-artifact gate as the initial launch path.
 */
export async function ensureProjectPreviewReady(
  transport: WorkspaceTransport,
  options: { maxWaitMs?: number; pollIntervalMs?: number } = {},
  progress: ProgressEmitter = new ProgressEmitter(),
  actionContext?: ActionExecutionContext,
): Promise<{ ok: boolean; files: string[]; error?: string }> {
  let artifacts: ProjectArtifactCheck = { ok: false, files: [] };
  for (let attempt = 0; attempt < 3; attempt++) {
    artifacts = await verifyProjectArtifacts(transport);
    if (artifacts.ok) break;
    if (attempt < 2) await sleep(250);
  }
  if (!artifacts.ok) return artifacts;

  try {
    const status = await startAndWaitForPreview(
      transport,
      {
        maxWaitMs: options.maxWaitMs ?? 120_000,
        pollIntervalMs: options.pollIntervalMs ?? 1_000,
      },
      progress,
      actionContext,
    );
    if (status !== "ready") {
      const runtime = await transport.getPreviewStatus().catch(() => null);
      return {
        ok: false,
        files: artifacts.files,
        error: runtime?.error ?? `Preview did not become ready (status: ${status})`,
      };
    }
    return { ok: true, files: artifacts.files };
  } catch (error) {
    return {
      ok: false,
      files: artifacts.files,
      error: error instanceof Error ? error.message : "Preview startup failed",
    };
  }
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
  // Tenant/project identity is reconstructed from authenticated launch-flow
  // options, never trusted from a forwarded object. The actionRunId itself is
  // the only value taken from the orchestrator's context.
  const actionContext: ActionExecutionContext | undefined = options.actionContext
    ? {
        actionRunId: options.actionContext.actionRunId,
        userId: options.userId,
        conversationId: options.actionContext.conversationId ?? options.conversationId,
        projectId: options.projectId,
      }
    : undefined;

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
          requireToolCallOnFirstStep: options.requiresExecution === true,
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
          userId: options.userId,
          conversationId: actionContext?.conversationId ?? options.conversationId,
          actionContext,
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
              actionContext,
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
            finalText: "Tool execution unavailable: no available model produced a file-writing tool call after two attempts, so no project files were changed. Try a model with stronger tool-calling support (e.g. Gemini).",
            error: "TOOL_EXECUTION_UNAVAILABLE",
            repairAttempts: agentResult.buildFixResult?.repairAttempts ?? 0,
            runtimeRepairAttempts,
          });
        }
      }
    }

    // A pause that landed before any workspace mutation has nothing to
    // serve — starting a preview on an empty workspace fails with
    // preview_no_dev_command and masks the pending approval behind a
    // misleading launch error. Return the pause directly; the approval
    // boundary brings the preview up once the approved mutation lands.
    if (pausedApproval && !hasAppliedMutation(agentResult)) {
      return baseResult({
        finalText: `I need your approval to continue: ${pausedApproval.reason}`,
        pendingApproval: pausedApproval,
        repairAttempts: agentResult.buildFixResult?.repairAttempts ?? 0,
        runtimeRepairAttempts,
      });
    }

    // Phase 2: start and verify the live preview
    checkSignal(signal);
    if ((options.requireProjectArtifacts || options.qualityLoop?.enabled) && !pausedApproval) {
      const artifacts = await verifyProjectArtifacts(transport);
      if (!artifacts.ok) {
        return baseResult({
          status: "failed",
          finalText: `The build did not produce a runnable project. ${artifacts.error ?? "Required project files are missing."}`,
          error: "PROJECT_ARTIFACTS_MISSING",
          repairAttempts: agentResult.buildFixResult?.repairAttempts ?? 0,
          runtimeRepairAttempts,
        });
      }
      if (agentResult.qualityLoopState) {
        const qualitySession = restoreQualityLoopSession(agentResult.qualityLoopState);
        noteBuildArtifacts(qualitySession, artifacts.files);
        agentResult = {
          ...agentResult,
          qualityLoopState: snapshotQualityLoopSession(qualitySession),
        };
        lastAgentLoopResult = agentResult;
      }
    }
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
      actionContext,
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
          userId: options.userId,
          conversationId: actionContext?.conversationId ?? options.conversationId,
          actionContext,
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
        actionContext,
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

    if (agentResult.qualityLoopState) {
      const qualitySession = restoreQualityLoopSession(agentResult.qualityLoopState);
      notePreviewReady(qualitySession, previewUrl);
      agentResult = {
        ...agentResult,
        qualityLoopState: snapshotQualityLoopSession(qualitySession),
      };
      lastAgentLoopResult = agentResult;
    }

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
      qualityLoopState: agentResult.qualityLoopState,
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
