/**
 * Project Loops — runner
 *
 * The while-loop that drives a ProjectLoop through its phases:
 *   Inspect → Plan → Edit → Test → Review → (Approve | Iterate)
 *
 * Hard-capped by:
 *   - maxIterations
 *   - maxTokens
 *   - maxCostCents
 *   - maxFileChanges
 *   - testTimeoutMs
 *
 * The loop is observable: every phase and every agent decision emits a
 * `LoopEvent` through the `emit` callback. The runner never throws on
 * user-correctable failures — instead it transitions the loop to
 * `awaiting_approval` so the human can decide what to do next.
 *
 * Per-phase prompts live in `roles.ts`; this file is pure orchestration.
 */

import {
  DEFAULT_LIMITS,
  type LoopDiff,
  type LoopEvent,
  type LoopFileChange,
  type LoopPhase,
  type LoopReview,
  type LoopRole,
  type ProjectLoop,
} from "@/types/project-loops";
import {
  runDirectorPlan,
  runEngineerEdit,
  runQaTests,
  runReviewer,
  type RepoSnapshot,
} from "@/lib/project-loops/roles";
import {
  ensureWorkingBranch,
  readRepoSnapshot,
  applyFileChanges,
  githubAvailable,
} from "@/lib/project-loops/github";

export type RunOptions = {
  /** Live event sink — every phase + decision shows up here. */
  emit: (event: LoopEvent) => void | Promise<void>;
  /** Optional signal to cancel a running loop from outside. */
  signal?: AbortSignal;
  /** Override the default per-phase delay (used in tests / demos). */
  phaseDelayMs?: number;
};

export type RunResult = {
  status: ProjectLoop["status"];
  phase: LoopPhase;
  reason?: string;
  diff?: LoopDiff;
  review?: LoopReview;
};

/** Reason a loop iteration stopped. */
type StopReason =
  | "approved"
  | "max_iterations"
  | "max_tokens"
  | "max_cost"
  | "max_files"
  | "test_timeout"
  | "blocked_by_reviewer"
  | "cancelled"
  | "error";

const newId = () =>
  `evt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error("cancelled"));
      return;
    }
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(t);
        reject(new Error("cancelled"));
      },
      { once: true },
    );
  });
}

function emptySnapshot(): RepoSnapshot {
  return { available: false, files: [], languages: [] };
}

function synthesizeDiff(
  files: { path: string; content: string }[],
): LoopFileChange[] {
  return files.map((f) => ({
    path: f.path,
    additions: f.content.split("\n").length,
    deletions: 0,
    status: "modified" as const,
    patch: f.content.slice(0, 500),
  }));
}

/**
 * Run a single iteration of the loop:
 *   inspect → plan → edit → test → review
 *
 * Returns a partial result. The outer runner decides whether to iterate
 * again or surface the diff for human approval.
 */
export async function runIteration(
  loop: ProjectLoop,
  opts: RunOptions,
): Promise<{
  diff?: LoopDiff;
  review?: LoopReview;
  tokensUsed: number;
  costCents: number;
  fileChanges: number;
  stopReason?: StopReason;
}> {
  const limits = { ...DEFAULT_LIMITS, ...loop.limits };
  const iteration = loop.iteration + 1;
  const delay = opts.phaseDelayMs ?? 0;

  let tokensUsed = 0;
  let costCents = 0;
  let fileChanges = 0;

  const phase = async (
    p: LoopPhase,
    role: LoopRole | undefined,
    level: LoopEvent["level"],
    message: string,
    detail?: string,
  ) => {
    await opts.emit({
      id: newId(),
      loopId: loop.id,
      iteration,
      role,
      phase: p,
      level,
      message,
      detail,
      at: new Date().toISOString(),
    });
    if (delay > 0) await sleep(delay, opts.signal);
  };

  /* ── 1. Inspect ─────────────────────────────────────────────────── */
  await phase("inspecting", "director", "phase", "Inspecting repository");
  let snapshot: RepoSnapshot = emptySnapshot();
  if (githubAvailable()) {
    try {
      snapshot = await readRepoSnapshot(loop);
    } catch (err) {
      await phase(
        "inspecting",
        "director",
        "warn",
        "Could not read repo from GitHub — continuing in dry-run mode",
        err instanceof Error ? err.message : String(err),
      );
    }
  } else {
    await phase(
      "inspecting",
      "director",
      "info",
      "No GitHub App credentials — running in simulation mode",
    );
  }

  /* ── 2. Plan (Director) ─────────────────────────────────────────── */
  await phase("planning", "director", "phase", "Creating plan");
  const planResult = await runDirectorPlan(loop, snapshot);
  tokensUsed += planResult.tokensUsed;
  costCents += planResult.costCents;
  if (planResult.text) {
    await phase(
      "planning",
      "director",
      "info",
      `Plan ready: ${planResult.text.slice(0, 160)}`,
    );
  }

  if (opts.signal?.aborted) {
    return { tokensUsed, costCents, fileChanges, stopReason: "cancelled" };
  }

  /* ── 3. Edit (Engineer) ─────────────────────────────────────────── */
  await phase("editing", "engineer", "phase", "Editing files");
  const editResult = await runEngineerEdit(loop, snapshot, planResult.text);
  tokensUsed += editResult.tokensUsed;
  costCents += editResult.costCents;
  fileChanges += editResult.files.length;

  let applied: LoopFileChange[] = [];
  if (editResult.files.length > 0) {
    if (githubAvailable()) {
      try {
        applied = await applyFileChanges(loop, editResult.files);
      } catch (err) {
        await phase(
          "editing",
          "engineer",
          "warn",
          "Could not commit to GitHub — falling back to dry-run diff",
          err instanceof Error ? err.message : String(err),
        );
        applied = synthesizeDiff(editResult.files);
      }
    } else {
      applied = synthesizeDiff(editResult.files);
    }
  }

  if (fileChanges > limits.maxFileChanges) {
    await phase(
      "editing",
      "engineer",
      "error",
      `Hit file-change cap (${limits.maxFileChanges}). Stopping.`,
    );
    return {
      tokensUsed,
      costCents,
      fileChanges,
      stopReason: "max_files",
      diff: applied.length > 0 ? buildDiff(loop, snapshot, applied) : undefined,
    };
  }

  await phase(
    "editing",
    "engineer",
    fileChanges > 0 ? "success" : "info",
    fileChanges > 0
      ? `Edited ${fileChanges} file${fileChanges === 1 ? "" : "s"}`
      : "No edits produced for this iteration",
  );

  if (opts.signal?.aborted) {
    return { tokensUsed, costCents, fileChanges, stopReason: "cancelled" };
  }

  const diff: LoopDiff | undefined =
    applied.length > 0 ? buildDiff(loop, snapshot, applied) : undefined;

  /* ── 4. Test (QA) ───────────────────────────────────────────────── */
  await phase("testing", "qa", "phase", "Running tests");
  const testResult = await runQaTests(loop, diff);
  tokensUsed += testResult.tokensUsed;
  costCents += testResult.costCents;

  const failed = testResult.results.filter((t) => !t.passed);
  await phase(
    "testing",
    "qa",
    failed.length === 0 ? "success" : "warn",
    failed.length === 0
      ? `All ${testResult.results.length} checks passed`
      : `${failed.length} of ${testResult.results.length} checks failed`,
    failed.map((f) => f.message).join("\n") || undefined,
  );

  if (opts.signal?.aborted) {
    return { tokensUsed, costCents, fileChanges, stopReason: "cancelled" };
  }

  /* ── 5. Review (Reviewer) ───────────────────────────────────────── */
  await phase("reviewing", "reviewer", "phase", "Reviewing diff");
  const review = await runReviewer(loop, diff, testResult.results);
  tokensUsed += review.tokensUsed;
  costCents += review.costCents;

  await phase(
    "reviewing",
    "reviewer",
    review.passed ? "success" : "warn",
    review.passed
      ? `Review passed (${review.score}/100)`
      : `Review flagged ${review.blockers.length} blocker${review.blockers.length === 1 ? "" : "s"}`,
    review.findings.join("\n") || undefined,
  );

  return {
    diff,
    review: {
      iteration,
      passed: review.passed,
      score: review.score,
      findings: review.findings,
      blockers: review.blockers,
    },
    tokensUsed,
    costCents,
    fileChanges,
    stopReason: review.passed ? undefined : "blocked_by_reviewer",
  };
}

function buildDiff(
  loop: ProjectLoop,
  snapshot: RepoSnapshot,
  files: LoopFileChange[],
): LoopDiff {
  return {
    iteration: loop.iteration + 1,
    baseSha: snapshot.headSha || "unknown",
    headSha: `pending-${Date.now().toString(36)}`,
    files,
    summary: `${files.length} file${files.length === 1 ? "" : "s"} changed in iteration ${loop.iteration + 1}`,
  };
}

/* ── Top-level loop driver ──────────────────────────────────────── */

/**
 * Drive a `ProjectLoop` through its iterations until the human approves,
 * the limits trip, or the loop is cancelled. Each step emits a `LoopEvent`.
 */
export async function runLoop(
  loop: ProjectLoop,
  opts: RunOptions,
): Promise<RunResult> {
  const limits = { ...DEFAULT_LIMITS, ...loop.limits };

  // Pre-flight: make sure the working branch exists (no-op in dry-run).
  if (githubAvailable()) {
    try {
      await ensureWorkingBranch(loop);
    } catch (err) {
      await opts.emit({
        id: newId(),
        loopId: loop.id,
        iteration: 0,
        phase: "inspecting",
        level: "warn",
        message: "Could not create working branch — continuing in dry-run mode",
        detail: err instanceof Error ? err.message : String(err),
        at: new Date().toISOString(),
      });
    }
  }

  let workingLoop = loop;
  let lastDiff: LoopDiff | undefined;
  let lastReview: LoopReview | undefined;
  let lastReason: StopReason | undefined;

  while (workingLoop.iteration < limits.maxIterations) {
    if (opts.signal?.aborted) {
      return { status: "cancelled", phase: workingLoop.phase, reason: "cancelled" };
    }

    if (workingLoop.tokensUsed >= limits.maxTokens) {
      lastReason = "max_tokens";
      break;
    }
    if (workingLoop.costCents >= limits.maxCostCents) {
      lastReason = "max_cost";
      break;
    }

    const result = await runIteration(workingLoop, opts);

    // Apply cumulative usage to the loop snapshot.
    workingLoop = {
      ...workingLoop,
      iteration: workingLoop.iteration + 1,
      tokensUsed: workingLoop.tokensUsed + result.tokensUsed,
      costCents: workingLoop.costCents + result.costCents,
      fileChanges: workingLoop.fileChanges + result.fileChanges,
    };

    if (result.diff) lastDiff = result.diff;
    if (result.review) lastReview = result.review;

    if (result.stopReason === "cancelled") {
      return { status: "cancelled", phase: workingLoop.phase, reason: "cancelled" };
    }
    if (result.stopReason === "max_files") {
      lastReason = "max_files";
      break;
    }

    // If the reviewer passed, hand off to the human.
    if (result.review?.passed) {
      await opts.emit({
        id: newId(),
        loopId: workingLoop.id,
        iteration: workingLoop.iteration,
        phase: "awaiting_approval",
        level: "phase",
        message: "Awaiting your approval",
        at: new Date().toISOString(),
      });
      return {
        status: "awaiting_approval",
        phase: "awaiting_approval",
        diff: lastDiff,
        review: lastReview,
      };
    }

    // Otherwise we'll iterate again. Emit a "fixing" event so the UI
    // can show progress.
    if (workingLoop.iteration < limits.maxIterations) {
      await opts.emit({
        id: newId(),
        loopId: workingLoop.id,
        iteration: workingLoop.iteration,
        phase: "editing",
        level: "phase",
        message: `Fixing issues (iteration ${workingLoop.iteration + 1})`,
        at: new Date().toISOString(),
      });
    }
  }

  // Loop fell through. Decide a final status.
  const finalStatus: ProjectLoop["status"] =
    lastReason === "max_iterations"
      ? "completed"
      : lastReason === "max_tokens" ||
          lastReason === "max_cost" ||
          lastReason === "max_files"
        ? "failed"
        : "failed";

  await opts.emit({
    id: newId(),
    loopId: workingLoop.id,
    iteration: workingLoop.iteration,
    phase: "done",
    level: finalStatus === "completed" ? "success" : "error",
    message:
      finalStatus === "completed"
        ? "Reached max iterations without reviewer approval"
        : `Loop stopped: ${lastReason ?? "unknown"}`,
    at: new Date().toISOString(),
  });

  return {
    status: finalStatus,
    phase: "done",
    reason: lastReason,
    diff: lastDiff,
    review: lastReview,
  };
}

/* ── Re-exports for convenience ───────────────────────────────── */

export { DEFAULT_LIMITS } from "@/types/project-loops";
export type { ProjectLoop, LoopEvent, LoopDiff, LoopReview } from "@/types/project-loops";
export {
  runDirectorPlan,
  runEngineerEdit,
  runQaTests,
  runReviewer,
} from "@/lib/project-loops/roles";
