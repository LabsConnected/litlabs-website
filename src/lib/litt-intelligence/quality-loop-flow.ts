/**
 * LiTT Quality Loop — run-flow orchestrator.
 *
 * This is the bridge between the pure gated stage machine
 * (quality-loop.ts) and the live agent execution loop (agent-loop-v2.ts).
 *
 * How it works:
 * - A run opts in via AgentLoopConfig.qualityLoop. The session records
 *   evidence from two sources:
 *     1. SYSTEM observations — mutating tool calls (BUILD), preview reaching
 *        ready (RUN), build-fix results (TEST), completed deployments
 *        (DEPLOY), live-URL verification (VERIFY), and the visual judge
 *        (INSPECT/CRITIQUE). These are machine-verified facts.
 *     2. AGENT markers — the agent declares cognitive-stage completion by
 *        emitting lines like `QUALITY: design — <summary>` in its messages.
 *        These are recorded with source "agent" and are visible in the
 *        evidence ledger, so self-reporting is auditable, not silent.
 * - Stages advance by implication: when a later stage has evidence, earlier
 *   evidenced stages are passed. Skippable stages with no evidence are
 *   skipped with a recorded reason. Non-skippable stages with no evidence
 *   stay open — and the final verdict honestly refuses success.
 * - After the agent produces its final answer, the visual judge inspects the
 *   live preview once. A below-threshold scorecard forces a bounded return
 *   to DESIGN with the critique attached (max MAX_DESIGN_PASSES passes).
 * - The loop itself never throws mid-run: every hook degrades to recorded
 *   "unavailable" outcomes. The gate bites at finalize() time, where
 *   declareSuccess() decides whether success may be claimed.
 */

import "server-only";

import {
  MAX_DESIGN_PASSES,
  QUALITY_STAGES,
  REQUIRED_STAGES_BY_SCOPE,
  STAGE_REQUIREMENTS,
  classifyTaskScope,
  createQualityLoop,
  currentStage,
  declareSuccess,
  passStage,
  recordEvidence,
  skipStage,
  skipStageOutOfScope,
  summarizeLoop,
  type EvidenceSource,
  type QualityLoopState,
  type QualityStage,
  type QualityTaskScope,
  type StageEvidence,
  type SuccessVerdict,
} from "./quality-loop";
import {
  defaultScreenshotCapturer,
  runVisualJudge,
  type JudgeOutcome,
} from "./visual-judge";
import { buildPreviewProxyUrl } from "@/lib/terminal-internal-client";
import { verifyProductionUrl } from "./deploy";
import type { LLMMessage } from "./llm-tool-calling";

// ─── Session ──────────────────────────────────────────────────────

export interface QualityLoopSession {
  state: QualityLoopState;
  /** The user's original request — judge context + brief fallback. */
  userRequest: string;
  /**
   * System-determined task scope (trivial | standard | full): which stages
   * apply to this run. Set at session start from the user's request; never
   * agent-declared. Survives approval-pause via the snapshot.
   */
  taskScope: QualityTaskScope;
  /** Set once the preview reaches ready. */
  previewUrl?: string;
  /** Set once a deployment completes. */
  deployedUrl?: string;
  /** True once the post-answer visual inspection has run. */
  inspectionRan: boolean;
  /** Why INSPECT/CRITIQUE were skipped, when they were. */
  inspectionNote?: string;
  /** True after a below-threshold critique — next mutations count as fixes. */
  critiqueFailed: boolean;
  /** Machine observations not yet filed into the stage machine. */
  observations: QualityLoopObservation[];
  /** True once any mutating tool succeeded — gates read-back evidence. */
  mutationSeen?: boolean;
}

export interface QualityLoopObservation {
  stage: QualityStage;
  evidence: Omit<StageEvidence, "at"> & { at?: string };
}

/**
 * JSON-safe quality state carried across an approval pause.  The quality
 * ledger is deliberately persisted as data, rather than reconstructed from
 * assistant prose after resume.
 */
export interface QualityLoopSnapshot {
  state: QualityLoopState;
  userRequest: string;
  /** System-determined task scope; absent in pre-scope snapshots. */
  taskScope?: QualityTaskScope;
  previewUrl?: string;
  deployedUrl?: string;
  inspectionRan: boolean;
  inspectionNote?: string;
  critiqueFailed: boolean;
  observations: QualityLoopObservation[];
  mutationSeen?: boolean;
}

export function snapshotQualityLoopSession(session: QualityLoopSession): QualityLoopSnapshot {
  return JSON.parse(JSON.stringify(session)) as QualityLoopSnapshot;
}

export function restoreQualityLoopSession(snapshot: QualityLoopSnapshot): QualityLoopSession {
  const session = JSON.parse(JSON.stringify(snapshot)) as QualityLoopSession;
  // Snapshots predating task scopes carry no scope: classify deterministically
  // from the stored request. The scope is system-computed either way.
  if (!session.taskScope) session.taskScope = classifyTaskScope(session.userRequest ?? "");
  return session;
}

export function startQualityLoopSession(opts: {
  runId: string;
  projectId: string;
  userId: string;
  userRequest: string;
  snapshot?: QualityLoopSnapshot;
}): QualityLoopSession {
  if (
    opts.snapshot &&
    opts.snapshot.state.projectId === opts.projectId &&
    opts.snapshot.state.userId === opts.userId
  ) {
    // A resume never loosens the gate — the snapshot carries its scope.
    return restoreQualityLoopSession(opts.snapshot);
  }

  const session: QualityLoopSession = {
    state: createQualityLoop({
      runId: opts.runId,
      projectId: opts.projectId,
      userId: opts.userId,
    }),
    userRequest: opts.userRequest,
    // System-determined from the request — never agent-declared.
    taskScope: classifyTaskScope(opts.userRequest),
    inspectionRan: false,
    critiqueFailed: false,
    observations: [],
    mutationSeen: false,
  };

  // UNDERSTAND for targeted work is established by the request itself:
  // the system records it instead of demanding a written brief. A full
  // build still needs the agent's structured brief (audience, goals…).
  if (session.taskScope !== "full" && opts.userRequest.trim()) {
    fileObservation(session, "understand", {
      summary: `Request captured (${session.taskScope} task): ${opts.userRequest.trim().slice(0, 300)}`,
      by: "system",
      detail: { taskScope: session.taskScope },
    });
  }
  return session;
}

/**
 * Whether a run should be quality-gated. ACT and AUTO modes opt in when
 * there is a project to gate; PLAN mode is read-only inspection and never
 * gates. The agent loop itself is mode-agnostic — this predicate is the
 * single place the mode decision lives, shared by the initial-run and
 * approval-resume entry points.
 */
export function shouldEnableQualityLoop(
  executionMode: string | undefined,
  projectId: string | null | undefined,
): projectId is string {
  return (executionMode === "act" || executionMode === "auto") && !!projectId;
}

/**
 * Stages whose gate demands machine-verified evidence. An agent's
 * self-report ("QUALITY: deploy — shipped it") can never satisfy these:
 * a public deployment claim must be backed by the deployment system
 * (noteDeployment) and the live-URL check (verifyLiveUrl), never by the
 * agent's word. This is what keeps the loop from ever auto-approving a
 * deploy — especially in AUTO mode, where no human is watching.
 */
const MACHINE_EVIDENCE_STAGES: ReadonlySet<QualityStage> = new Set([
  "build",
  "run",
  "inspect",
  "critique",
  "test",
  "deploy",
  "verify",
]);

function hasMachineEvidence(
  state: QualityLoopState,
  stage: QualityStage,
  predicate?: (detail: Record<string, unknown> | undefined) => boolean,
): boolean {
  return state.stages[stage].evidence.some((e) => {
    if (e.by === "agent") return false;
    return predicate ? predicate(e.detail) : true;
  });
}

/**
 * Whether a stage with evidence may be passed. Deploy/verify additionally
 * require at least one non-agent evidence record — agent self-report
 * alone leaves the stage open and the gate holds.
 *
 * Trivial-scope exception: for a trivial task the build IS the mutation,
 * so a system-recorded successful mutation is machine evidence for BUILD.
 * There is no "runnable entry artifact" to inspect for a one-line edit,
 * and demanding one would stall every trivial task forever. The agent's
 * word alone still never suffices (by !== "agent" is required).
 */
function stagePassable(
  state: QualityLoopState,
  stage: QualityStage,
  taskScope: QualityTaskScope = "full",
): boolean {
  const s = state.stages[stage];
  if (s.evidence.length === 0) return false;
  if (blockedReason(state, stage)) return false;
  if (taskScope === "trivial" && stage === "build") {
    return s.evidence.some((e) => e.by !== "agent");
  }
  if (MACHINE_EVIDENCE_STAGES.has(stage)) {
    // Targeted work (trivial/standard scope) is verified at the scale of the
    // change: a successful mutation is the build, and reading the changed
    // file back is an inspection. A full build keeps the strict proofs.
    const targeted = taskScope !== "full";
    const predicates: Partial<Record<QualityStage, (detail: Record<string, unknown> | undefined) => boolean>> = {
      build: (detail) => detail?.artifactVerified === true || (targeted && detail?.mutationVerified === true),
      run: (detail) => detail?.reachable === true,
      inspect: (detail) =>
        (detail?.browserInspected === true && detail?.styleHealthy === true && detail?.consoleClean === true) ||
        (targeted && detail?.readBackVerified === true),
      critique: (detail) => detail?.visualVerified === true && detail?.passed === true && detail?.consoleClean === true,
      test: (detail) => detail?.executedChecks === true && detail?.passed === true,
      deploy: (detail) => detail?.deploymentVerified === true,
      verify: (detail) => detail?.passed === true && detail?.httpStatus === 200,
    };
    if (!hasMachineEvidence(state, stage, predicates[stage])) return false;
  }
  return true;
}

// ─── Agent stage markers ──────────────────────────────────────────

/**
 * Lines like `QUALITY: design — Chose a two-column layout…` in assistant
 * text declare cognitive-stage completion. Recorded with source "agent"
 * so the ledger shows exactly what the agent claimed.
 */
export const QUALITY_MARKER_PATTERN =
  /^\s*QUALITY\s*:\s*([a-z_]+)\s*[—–\-:]\s*(.+?)\s*$/gim;

function isQualityStage(s: string): s is QualityStage {
  return (QUALITY_STAGES as readonly string[]).includes(s);
}

/**
 * Scan assistant messages for QUALITY markers and file them as
 * agent-sourced evidence. Idempotent: the same (stage, summary) pair is
 * never recorded twice. Returns the number of new evidence records.
 */
export function harvestStageMarkers(
  session: QualityLoopSession,
  messages: Array<Pick<LLMMessage, "role" | "content">>,
): number {
  let recorded = 0;
  for (const m of messages) {
    if (m.role !== "assistant" || !m.content) continue;
    QUALITY_MARKER_PATTERN.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = QUALITY_MARKER_PATTERN.exec(m.content)) !== null) {
      const stage = match[1].toLowerCase();
      const summary = match[2].trim().slice(0, 500);
      if (!isQualityStage(stage) || !summary) continue;
      const alreadyFiled = session.state.stages[stage].evidence.some(
        (e) => e.by === "agent" && e.summary === summary,
      );
      const alreadyPending = session.observations.some(
        (o) => o.stage === stage && o.evidence.by === "agent" && o.evidence.summary === summary,
      );
      if (alreadyFiled || alreadyPending) continue;
      fileObservation(session, stage, {
        summary,
        by: "agent",
      });
      recorded++;
    }
  }
  return recorded;
}

// ─── Machine observations ─────────────────────────────────────────

function fileObservation(
  session: QualityLoopSession,
  stage: QualityStage,
  evidence: Omit<StageEvidence, "at"> & { at?: string },
): void {
  session.observations.push({ stage, evidence });
  reconcile(session);
}

/** Record a build only after the workspace has been inspected for an actual
 * runnable entry artifact. Tool success alone is intentionally insufficient. */
export function noteBuildArtifacts(session: QualityLoopSession, files: string[]): void {
  try {
    if (files.length === 0) return;
    fileObservation(session, "build", {
      summary: `Runnable build artifact verified in the workspace (${files.length} files found).`,
      artifacts: files.slice(0, 100),
      by: "system",
      detail: { artifactVerified: true },
    });
  } catch {
    // Evidence recording must never break the run.
  }
}

/** Record preview evidence only after the runtime reports ready and the
 * caller has confirmed it is reachable. */
export function notePreviewReady(session: QualityLoopSession, previewUrl: string): void {
  try {
    if (!previewUrl.trim()) return;
    session.previewUrl = previewUrl;
    fileObservation(session, "run", {
      summary: `Preview server reached ready status: ${previewUrl}`,
      artifacts: [previewUrl],
      by: "system",
      detail: { reachable: true },
    });
  } catch {
    // Evidence recording must never break the run.
  }
}

/**
 * Skippable stages the agent itself can render moot by moving on.
 * inspect/critique/fix are system-driven (the visual judge) and deploy is
 * deployment-driven — those are only ever skipped in the finalize sweep,
 * never by implication, so the judge always gets its chance to run.
 */
/** Re-exported so the agent loop can bound re-inspection after redesigns. */
export { MAX_DESIGN_PASSES };

const IMPLICATION_SKIPPABLE: ReadonlySet<QualityStage> = new Set(["research", "polish"]);

/**
 * Move pending observations for the current-or-earlier stages into the
 * evidence ledger. Returns true when anything was filed.
 */
function fileDueObservations(session: QualityLoopSession): boolean {
  const state = session.state;
  const current = currentStage(state);
  const currentIdx = current ? QUALITY_STAGES.indexOf(current) : QUALITY_STAGES.length;
  let filed = false;
  for (let i = session.observations.length - 1; i >= 0; i--) {
    const obs = session.observations[i];
    if (QUALITY_STAGES.indexOf(obs.stage) <= currentIdx) {
      try {
        recordEvidence(state, obs.stage, obs.evidence);
      } catch {
        // Engine rejected it (shouldn't happen for current-or-earlier,
        // but never let the gate crash the run).
        continue;
      }
      session.observations.splice(i, 1);
      filed = true;
    }
  }
  return filed;
}

/**
 * A stage is blocked when its latest evidence explicitly reports failure
 * (detail.passed === false — recorded by verifyLiveUrl and noteBuildFix).
 * Failed evidence must never be "passed" by implication or by the
 * finalize sweep: only a later passing observation clears the block.
 */
function blockedReason(state: QualityLoopState, stage: QualityStage): string | null {
  const evidence = state.stages[stage].evidence;
  if (evidence.length === 0) return null;
  const latest = evidence[evidence.length - 1];
  const detail = latest.detail as { passed?: boolean; reason?: string } | undefined;
  if (detail && detail.passed === false) {
    return detail.reason ?? `${stage} evidence reports failure`;
  }
  return null;
}

function reconcile(session: QualityLoopSession): void {
  const state = session.state;
  const required = new Set<QualityStage>(REQUIRED_STAGES_BY_SCOPE[session.taskScope]);
  let progressed = true;
  while (progressed) {
    progressed = false;

    // 1. File observations for current-or-earlier stages.
    if (fileDueObservations(session)) progressed = true;

    // 2. Implied advancement from the current stage.
    const c = currentStage(state);
    if (c) {
      const s = state.stages[c];
      const cIdx = QUALITY_STAGES.indexOf(c);
      const laterHasEvidence = QUALITY_STAGES.slice(cIdx + 1).some(
        (st) =>
          state.stages[st].evidence.length > 0 ||
          session.observations.some((o) => o.stage === st),
      );
      // Stages outside the task's scope never block: skip them with a
      // recorded reason once later-stage work proves the run moved on.
      // Deploy/verify keep their own rules (they bind to the deploy
      // request, not to the task scope).
      const scopeSkippable =
        c !== "deploy" && c !== "verify" && !required.has(c);
      if (
        s.evidence.length > 0 &&
        stagePassable(state, c, session.taskScope) &&
        laterHasEvidence &&
        (s.status === "pending" || s.status === "active")
      ) {
        try {
          passStage(state, c);
          progressed = true;
        } catch {
          // Strict engine refused; leave the stage open.
        }
      } else if (
        s.evidence.length === 0 &&
        laterHasEvidence &&
        (IMPLICATION_SKIPPABLE.has(c) || scopeSkippable) &&
        (s.status === "pending" || s.status === "active")
      ) {
        try {
          if (IMPLICATION_SKIPPABLE.has(c)) {
            skipStage(
              state,
              c,
              "No evidence recorded; advanced by implication from later-stage work.",
            );
          } else {
            // Reachable only when scopeSkippable (see the branch condition).
            skipStageOutOfScope(
              state,
              c,
              session.taskScope,
              `Stage does not apply to the ${session.taskScope} task scope (system-determined).`,
            );
          }
          progressed = true;
        } catch {
          // Leave open.
        }
      }
    }
  }
}

export interface ToolResultEvidence {
  success: boolean;
  /** Raw tool handler result (may carry status/url fields). */
  result: unknown;
  mutating: boolean;
  summary: string;
}

/**
 * Record machine evidence from a tool execution. Never throws.
 * - Successful mutating tool call → BUILD evidence.
 * - preview.status "ready" / preview.start success → RUN evidence + URL.
 */
export function noteToolResult(
  session: QualityLoopSession,
  toolId: string,
  tool: ToolResultEvidence,
  workspaceId: string,
): void {
  try {
    if (tool.success && tool.mutating) {
      session.mutationSeen = true;
      fileObservation(session, "build", {
        summary: `Mutating tool "${toolId}" succeeded: ${tool.summary.slice(0, 300)}`,
        artifacts: [toolId],
        by: "system",
        detail: { mutationVerified: true },
      });
      if (session.critiqueFailed) {
        fileObservation(session, "fix", {
          summary: `Fix applied after below-threshold visual critique ("${toolId}": ${tool.summary.slice(0, 200)})`,
          artifacts: [toolId],
          by: "system",
        });
      }
    }

    const payload =
      tool.result && typeof tool.result === "object"
        ? (tool.result as Record<string, unknown>)
        : null;

    // Check tools executed through the workspace are TEST evidence the
    // moment they run — no need to wait for the post-run build-fix loop.
    if (CHECK_TOOL_IDS.has(toolId)) {
      const exitCode = typeof payload?.exitCode === "number" ? payload.exitCode : null;
      const passed = tool.success && payload?.success !== false && (exitCode === null || exitCode === 0);
      fileObservation(session, "test", {
        summary: passed
          ? `Check "${toolId}" executed and passed.`
          : `Check "${toolId}" executed and failed${exitCode !== null ? ` (exit ${exitCode})` : ""}.`,
        artifacts: [`${toolId}:${passed ? "pass" : "fail"}`],
        by: "system",
        detail: passed
          ? { passed: true, executedChecks: true }
          : { passed: false, executedChecks: true, reason: `${toolId} failed` },
      });
    }
    const previewReady =
      tool.success &&
      ((toolId === "preview.status" && payload?.status === "ready") ||
        (toolId === "preview.start" && payload?.success !== false));
    if (previewReady) {
      const url = buildPreviewProxyUrl(workspaceId);
      notePreviewReady(session, url);
    }
  } catch {
    // Evidence recording must never break the run.
  }
}

/** Workspace check tools whose results are TEST evidence. */
const CHECK_TOOL_IDS: ReadonlySet<string> = new Set([
  "test.run",
  "build.run",
  "typecheck.run",
  "lint.run",
]);

/**
 * Record that a file changed by this run was read back from the workspace
 * and holds what the run wrote — INSPECT evidence at the scale of a
 * targeted edit. Only counts after a successful mutation, and only when
 * the caller actually re-read the file from the workspace.
 */
export function noteMutationReadBack(
  session: QualityLoopSession,
  check: { path: string; readable: boolean; contentMatches: boolean | null },
): void {
  try {
    if (!session.mutationSeen) return;
    const ok = check.readable && check.contentMatches !== false;
    fileObservation(session, "inspect", {
      summary: ok
        ? `Changed file read back from the workspace: ${check.path}` +
          (check.contentMatches === true ? " (content matches the edit)." : ".")
        : `Read-back of ${check.path} did not confirm the edit.`,
      artifacts: [check.path],
      by: "system",
      detail: ok
        ? { readBackVerified: true, contentMatches: check.contentMatches }
        : { readBackVerified: false, passed: false, reason: `Read-back of ${check.path} did not confirm the edit` },
    });
  } catch {
    // Never break the run.
  }
}

/** Record build-fix (typecheck/lint/test) results as TEST evidence. */
export function noteBuildFix(
  session: QualityLoopSession,
  result: { allPassed: boolean; results?: Array<{ check: string; passed: boolean }> },
): void {
  try {
    const checks = result.results ?? [];
    const failed = checks.filter((c) => !c.passed).map((c) => c.check);
    const executedChecks = checks.length > 0;
    const passed = result.allPassed && executedChecks && failed.length === 0;
    fileObservation(session, "test", {
      summary: passed
        ? `Build/typecheck/test checks all passed (${checks.length} checks).`
        : `Build-fix loop finished with failing checks after repair attempts.`,
      artifacts: checks.map((c) => `${c.check}:${c.passed ? "pass" : "fail"}`),
      by: "system" as EvidenceSource,
      // Failing checks must NOT satisfy the TEST gate — same convention
      // as verifyLiveUrl: detail.passed === false blocks the finalize sweep.
      detail: passed
        ? { passed: true, executedChecks: true }
        : {
            passed: false,
            executedChecks,
            reason: failed.length > 0
              ? `Failing checks: ${failed.join(", ")}`
              : "No checks were executed",
          },
    });
  } catch {
    // Never break the run.
  }
}

/** Record a completed deployment as DEPLOY evidence. */
export function noteDeployment(session: QualityLoopSession, publicUrl: string): void {
  try {
    session.deployedUrl = publicUrl;
    fileObservation(session, "deploy", {
      summary: `Deployment completed with live public URL: ${publicUrl}`,
      artifacts: [publicUrl],
      by: "system",
      detail: { deploymentVerified: true },
    });
  } catch {
    // Never break the run.
  }
}

/**
 * Fetch the live deployment URL and record VERIFY evidence. Uses the
 * existing deploy verification (HTTP fetch + content check). Any failure
 * is recorded honestly as unavailable — never a fabricated pass.
 */
export async function verifyLiveUrl(
  session: QualityLoopSession,
  publicUrl: string,
): Promise<void> {
  try {
    const result = await verifyProductionUrl(publicUrl, { timeoutMs: 30_000 });
    const statusMatch = result.detail.match(/\bHTTP\s+(\d{3})\b|\b(\d{3})\b/i);
    const httpStatus = Number(statusMatch?.[1] ?? statusMatch?.[2]);
    if (result.success && httpStatus === 200) {
      fileObservation(session, "verify", {
        summary: `Live URL verified serving expected content: ${result.detail.slice(0, 200)}`,
        artifacts: [publicUrl],
        by: "system",
        detail: { passed: true, httpStatus, detail: result.detail },
      });
    } else {
      fileObservation(session, "verify", {
        summary: `Live URL verification did not pass: ${result.detail.slice(0, 200)}`,
        artifacts: [publicUrl],
        by: "system",
        // A failed verification must NOT satisfy the VERIFY gate: the
        // finalize sweep treats evidence with detail.passed === false as
        // blocking, so a broken deploy can never read as shipped.
        detail: { passed: false, reason: result.detail.slice(0, 500) },
      });
    }
  } catch (err) {
    // Verification itself failed — record the attempt, not a pass.
    try {
      fileObservation(session, "verify", {
        summary: `Live URL verification could not run: ${err instanceof Error ? err.message : String(err)}.`,
        artifacts: [publicUrl],
        by: "system",
        detail: { passed: false, reason: err instanceof Error ? err.message : String(err) },
      });
    } catch {
      // Never break the run.
    }
  }
}

// ─── Visual inspection ────────────────────────────────────────────

export interface InspectionResult {
  ran: boolean;
  needsRedesign: boolean;
  fixes: string[];
  reason: string;
  score?: number;
}

function sessionBrief(session: QualityLoopSession): string | undefined {
  const e = session.state.stages.understand.evidence;
  return e.length > 0 ? e[e.length - 1].summary : undefined;
}

function sessionDesignIntent(session: QualityLoopSession): string | undefined {
  const e = session.state.stages.design.evidence;
  return e.length > 0 ? e[e.length - 1].summary : undefined;
}

/**
 * Run the visual-quality judge against the live preview. Called once, at
 * the point the agent produces its final answer. A below-threshold
 * scorecard forces a bounded return to DESIGN (needsRedesign), with the
 * critique attached. Never throws: every failure mode degrades to a
 * recorded "unavailable" outcome.
 */
export async function runQualityInspection(
  session: QualityLoopSession,
  opts?: {
    judgeCall?: (
      prompt: string,
      imageDataUrl: string,
    ) => Promise<{ text: string; model: string }>;
  },
): Promise<InspectionResult> {
  if (session.inspectionRan) {
    return { ran: true, needsRedesign: false, fixes: [], reason: "Inspection already ran for this run." };
  }
  session.inspectionRan = true;

  const url = session.previewUrl;
  if (!url) {
    session.inspectionNote =
      "No preview URL was available, so the visual inspection could not run. No score was fabricated.";
    return { ran: false, needsRedesign: false, fixes: [], reason: session.inspectionNote };
  }

  let outcome: JudgeOutcome;
  try {
    outcome = await runVisualJudge({
      screenshot: null,
      capture: defaultScreenshotCapturer,
      context: {
        userRequest: session.userRequest,
        brief: sessionBrief(session),
        designIntent: sessionDesignIntent(session),
        previewUrl: url,
      },
      judgeCall: opts?.judgeCall,
    });
  } catch (err) {
    outcome = {
      status: "unavailable",
      reason: `Visual inspection failed unexpectedly: ${err instanceof Error ? err.message : String(err)}. No score was fabricated.`,
    };
  }

  if (outcome.browserInspected && outcome.styleHealthy === false) {
    const reason = outcome.reason ?? "Preview styling failed to apply.";
    session.inspectionNote = reason;
    fileObservation(session, "inspect", {
      summary: reason,
      artifacts: [url],
      by: "system",
      detail: {
        browserInspected: true,
        styleHealthy: false,
        consoleClean: outcome.consoleClean === true,
        passed: false,
        styleProbe: outcome.styleProbe,
        reason,
      },
    });
    session.critiqueFailed = true;
    return {
      ran: true,
      needsRedesign: true,
      fixes: ["Inspect the preview CSS/Tailwind setup and repair the styling root cause before reloading the preview."],
      reason,
    };
  }

  if (outcome.status === "unavailable" || !outcome.scorecard || !outcome.verdict) {
    session.inspectionNote = outcome.reason ?? "Verification unavailable: visual inspection could not run.";
    return { ran: false, needsRedesign: false, fixes: [], reason: session.inspectionNote };
  }

  const card = outcome.scorecard;
  const verdict = outcome.verdict;

  fileObservation(session, "inspect", {
    summary: `Screenshot of the running preview captured for review: ${url}`,
    artifacts: [url],
    by: "system",
    detail: {
      browserInspected: outcome.browserInspected === true,
      styleHealthy: outcome.styleHealthy === true,
      consoleClean: outcome.consoleClean === true,
      passed: outcome.browserInspected === true && outcome.styleHealthy === true && outcome.consoleClean === true,
      styleProbe: outcome.styleProbe,
    },
  });
  fileObservation(session, "critique", {
    summary:
      `Visual-quality scorecard: ${card.overall.toFixed(1)}/10 — ` +
      (verdict.passed ? `passed threshold. ${card.summary}` : `below threshold. ${verdict.reason}`),
    artifacts: [url],
    by: "judge",
    detail: {
      overall: card.overall,
      passed: verdict.passed,
      visualVerified: outcome.browserInspected === true && outcome.styleHealthy === true && outcome.consoleClean === true && verdict.passed,
      consoleClean: outcome.consoleClean === true,
    },
  });

  if (!verdict.passed) {
    session.critiqueFailed = true;
    if (session.state.designPasses < MAX_DESIGN_PASSES) {
      session.state.designPasses += 1;
      return {
        ran: true,
        needsRedesign: true,
        fixes: card.prioritizedFixes,
        reason: verdict.reason,
        score: card.overall,
      };
    }
    fileObservation(session, "fix", {
      summary:
        `Below-threshold critique stands after ${MAX_DESIGN_PASSES} automatic design passes; ` +
        `shipping with known design debt.`,
      artifacts: [url],
      by: "system",
    });
    return {
      ran: true,
      needsRedesign: false,
      fixes: card.prioritizedFixes,
      reason: `${verdict.reason} (automatic design passes exhausted)`,
      score: card.overall,
    };
  }

  session.critiqueFailed = false;
  fileObservation(session, "fix", {
    summary: "Visual critique passed the quality threshold; no design fixes required.",
    artifacts: [url],
    by: "judge",
  });
  return { ran: true, needsRedesign: false, fixes: [], reason: verdict.reason, score: card.overall };
}

/** The follow-up prompt injected when the judge demands another design pass. */
export function buildRedesignPrompt(inspection: InspectionResult, passNumber: number): string {
  const fixes = inspection.fixes.map((f, i) => `${i + 1}. ${f}`).join("\n");
  return [
    `The visual-quality judge scored the preview ${inspection.score?.toFixed(1) ?? "below"} / 10, under the ${"7.0"} threshold: ${inspection.reason}`,
    "",
    "This is automatic design pass " + passNumber + " of " + MAX_DESIGN_PASSES + ". Address the prioritized fixes below, then verify the result in the preview:",
    fixes,
    "",
    "QUALITY: design — <one-line summary of what this pass changed>",
    "Emit QUALITY markers as you complete each stage, as usual.",
  ].join("\n");
}

// ─── Finalize ─────────────────────────────────────────────────────

export interface QualityFinale {
  verdict: SuccessVerdict;
  stages: ReturnType<typeof summarizeLoop>;
  designPasses: number;
  /** Observations that could never be filed (future stages stayed open). */
  unfiledObservations: number;
}

/**
 * Close out the loop and decide whether success may be declared.
 * The hard product rule lives here: every stage required by the task's
 * scope must have passed with evidence (deploy/verify bind to
 * deployRequested), no stage may have failed, and the verdict says so
 * explicitly. Stages outside the task's scope are skipped with a recorded
 * reason — they never block completion.
 */
export function finalizeQualityLoop(
  session: QualityLoopSession,
  opts: { deployRequested: boolean },
): QualityFinale {
  const state = session.state;
  const required = new Set<QualityStage>(REQUIRED_STAGES_BY_SCOPE[session.taskScope]);

  // Final sweep: file what became due, then pass or skip whatever is still
  // open, in order. Observations must be filed as the current stage moves
  // forward, otherwise evidence for later stages would get stuck behind a
  // stage the sweep just skipped (e.g. TEST evidence waiting on INSPECT).
  for (;;) {
    fileDueObservations(session);
    const c = currentStage(state);
    if (!c) break;
    const s = state.stages[c];
    // Stages outside the task's scope never block: skip with a recorded
    // reason. Deploy/verify keep their own rules (deploy request, not scope).
    const scopeSkippable =
      c !== "deploy" && c !== "verify" && !required.has(c);
    try {
      if (stagePassable(state, c, session.taskScope)) {
        passStage(state, c);
      } else if (s.evidence.length === 0 && STAGE_REQUIREMENTS[c].skippable) {
        const reason =
          (c === "inspect" || c === "critique") && session.inspectionNote
            ? session.inspectionNote
            : "Stage produced no evidence during the run.";
        skipStage(state, c, reason);
      } else if (s.evidence.length === 0 && scopeSkippable) {
        skipStageOutOfScope(
          state,
          c,
          session.taskScope,
          `Stage does not apply to the ${session.taskScope} task scope (system-determined).`,
        );
      } else {
        // Either no evidence on a required stage (gate holds), or the
        // latest evidence reports failure (gate holds harder).
        break;
      }
    } catch {
      break;
    }
  }

  const rawVerdict = declareSuccess(state, {
    deployRequested: opts.deployRequested,
    taskScope: session.taskScope,
  });
  // Surface blocking failure reasons honestly: the verdict names the
  // stages, and the reason names why they are stuck.
  const blocked = QUALITY_STAGES.flatMap((stage) => {
    const reason = blockedReason(state, stage);
    return reason ? [`${stage}: ${reason}`] : [];
  });
  const verdict: SuccessVerdict =
    blocked.length > 0 && !rawVerdict.ok
      ? { ...rawVerdict, reason: `${rawVerdict.reason} Blocked: ${blocked.join("; ")}` }
      : rawVerdict;
  return {
    verdict,
    stages: summarizeLoop(state),
    designPasses: state.designPasses,
    unfiledObservations: session.observations.length,
  };
}

// ─── Verdict text block ───────────────────────────────────────────

/**
 * Format the appended quality verdict as a compact collapsed markdown
 * checklist (one line per stage, ✓/✗/○). The leading "Quality check — "
 * marker line is part of the contract: the approval-resume path strips
 * the whole trailing block via {@link stripQualityVerdictSuffix}, and the
 * chat renderer collapses the ```quality-checklist fenced block.
 * Format-only: the verdict content (reason + per-stage statuses) is
 * unchanged.
 */
export function formatQualityVerdictBlock(finale: QualityFinale): string {
  const reason = finale.verdict.reason;
  const lowered = reason.charAt(0).toLowerCase() + reason.slice(1);
  const lines = finale.stages.map((s) => {
    const mark =
      s.status === "passed" ? "✓" : s.status === "failed" ? "✗" : "○";
    return `${mark} ${s.stage} — ${s.status}`;
  });
  return (
    `\n\nQuality check — ${lowered}\n` +
    "```quality-checklist\n" +
    lines.join("\n") +
    "\n```"
  );
}

/** Matcher for the trailing verdict block appended by
 * {@link formatQualityVerdictBlock}. Removes the marker line and
 * everything after it; ordinary model output is never touched. */
const QUALITY_VERDICT_SUFFIX_RE = /\n\nQuality check — [\s\S]*$/i;

/** Remove a stale machine-gate verdict suffix from resumed final text. */
export function stripQualityVerdictSuffix(text: string): string {
  return text.replace(QUALITY_VERDICT_SUFFIX_RE, "");
}

// ─── Agent prompt section ─────────────────────────────────────────

/**
 * Appended to the system prompt for quality-gated runs. Teaches the agent
 * the stage contract and the QUALITY marker convention.
 */
export const QUALITY_LOOP_PROMPT_SECTION = [
  "",
  "## Quality loop (hard product rule)",
  "",
  "You build products through a gated quality loop. Work the stages in order and declare",
  "each one as you complete it with a line of exactly this form:",
  "",
  "QUALITY: <stage> — <one-line summary of what you established>",
  "",
  "Stages: understand → research → plan → design → build → run → inspect →",
  "critique → fix → polish → test → deploy → verify.",
  "",
  "- UNDERSTAND: who this is for, the business goal, the conversion goal, brand and constraints. Never invent a business name or brand the user gave you — use their exact words.",
  "- RESEARCH: competitors, required features, references — or why none was needed.",
  "- PLAN: information architecture, user journeys, build steps, mobile behavior, empty/loading/error states.",
  "- DESIGN: typography, spacing system, visual hierarchy, component language, responsive layout, motion. Aim for distinctive, not generic.",
  "- BUILD: make the changes with tools.",
  "- RUN: start the preview and confirm it is healthy.",
  "- INSPECT / CRITIQUE: look at the running preview yourself; a separate visual judge will also score it.",
  "- FIX: address critique findings.",
  "- POLISH: copy, spacing, motion, feedback, edge cases, consistency.",
  "- TEST: run the checks; fix failures yourself and rerun.",
  "- DEPLOY: only when the user asked to ship.",
  "- VERIFY: open the live URL and confirm it serves what you built.",
  "",
  "You may not claim the work is done unless every stage that applies has its evidence",
  "declared. Your closing summary must report what each stage established — never claim",
  "a result (a deletion, a deployment, a passing check) that did not actually happen.",
].join("\n");

/**
 * Scope-specific guidance appended to the quality prompt. The scope is
 * system-determined from the user's request and is stated to the agent as
 * a fact, not a negotiation: it tells the agent which stages apply so it
 * neither performs rituals the task does not need (a preview for a typo
 * fix) nor skips stages the task does need.
 */
const TASK_SCOPE_PROMPT: Record<QualityTaskScope, string[]> = {
  trivial: [
    "",
    "Task scope for this run: TRIVIAL (determined by the system from the request).",
    "This is a single small text/content change. Only the BUILD stage applies: make the",
    "change with tools. The successful mutation is the evidence. Do not start previews,",
    "run design passes, or execute test suites for a one-line edit, and do not emit",
    "QUALITY markers for stages that do not apply.",
  ],
  standard: [
    "",
    "Task scope for this run: STANDARD (determined by the system from the request).",
    "Required stages: understand, plan, build, test. Declare each with a QUALITY marker as",
    "you complete it; run the checks and fix failures yourself. The other stages (design,",
    "run, inspect, critique, polish) are recorded if you do them but do not block completion.",
  ],
  full: [
    "",
    "Task scope for this run: FULL (determined by the system from the request).",
    "This is a product build: work every stage in order and declare each one. The visual",
    "judge will score your preview; a below-threshold score means another design pass.",
    "Deploy only if the user asked to ship.",
  ],
};

/** The quality-loop prompt section tailored to the run's task scope. */
export function buildQualityLoopPrompt(taskScope: QualityTaskScope): string {
  return [QUALITY_LOOP_PROMPT_SECTION, ...TASK_SCOPE_PROMPT[taskScope]].join("\n");
}
