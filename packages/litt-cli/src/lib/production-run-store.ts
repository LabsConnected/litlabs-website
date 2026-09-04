/**
 * Production-finish run store — resumable state for the production finish workflow.
 *
 * When `litt production finish` pauses for an owner handoff (e.g., Stripe
 * account-owner confirmation), the current state is persisted so the run
 * can be resumed with `litt production finish --resume <runId>` or simply
 * `litt production finish` (which discovers the incomplete run).
 *
 * State is stored in a JSON file under the LiTT config directory:
 *   ~/.litt/production-runs/<runId>.json
 *
 * This is NOT the same as the CLI run-store (lib/run-store.ts) which
 * tracks agent mission runs. This is specifically for production-finish
 * orchestration state.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { redact } from "./secret-redaction.js";

// ─── Types ─────────────────────────────────────────────────────────────

export type FinishPhase =
  | "repository"
  | "operator"
  | "studio_code"
  | "pricing"
  | "stripe_catalog"
  | "stripe_security"
  | "webhook"
  | "sandbox_checkout"
  | "studio_acceptance"
  | "complete";

export type FinishStatus = "pending" | "in_progress" | "pass" | "blocked" | "failed";

export interface FinishStep {
  phase: FinishPhase;
  status: FinishStatus;
  startedAt?: string;
  completedAt?: string;
  detail?: string;
  /** If blocked, the reason and what the owner needs to do */
  handoff?: {
    title: string;
    description: string;
    /** URL to open (e.g., Stripe Dashboard) */
    url?: string;
    /** What to do after the owner completes their action */
    resumeAction: string;
  };
}

export interface FinishRun {
  id: string;
  startedAt: string;
  updatedAt: string;
  steps: FinishStep[];
  /** Index of the current step */
  currentStep: number;
  /** Whether the run is paused waiting for owner action */
  paused: boolean;
  /** Final verdict when complete */
  verdict?: "pass" | "fail";
}

// ─── Storage ───────────────────────────────────────────────────────────

function getRunsDir(): string {
  const dir = path.join(os.homedir(), ".litt", "production-runs");
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

function getRunPath(runId: string): string {
  return path.join(getRunsDir(), `${runId}.json`);
}

/**
 * Create a new production-finish run with all phases pending.
 */
export function createRun(): FinishRun {
  const runId = `run_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const now = new Date().toISOString();
  const run: FinishRun = {
    id: runId,
    startedAt: now,
    updatedAt: now,
    steps: [
      { phase: "repository", status: "pending" },
      { phase: "operator", status: "pending" },
      { phase: "studio_code", status: "pending" },
      { phase: "pricing", status: "pending" },
      { phase: "stripe_catalog", status: "pending" },
      { phase: "stripe_security", status: "pending" },
      { phase: "webhook", status: "pending" },
      { phase: "sandbox_checkout", status: "pending" },
      { phase: "studio_acceptance", status: "pending" },
    ],
    currentStep: 0,
    paused: false,
  };
  saveRun(run);
  return run;
}

/**
 * Save a run to disk. Secrets are redacted before saving.
 */
export function saveRun(run: FinishRun): void {
  run.updatedAt = new Date().toISOString();
  const json = JSON.stringify(run, null, 2);
  // Redact any potential secrets in the JSON (defense in depth)
  const safe = redact(json);
  fs.writeFileSync(getRunPath(run.id), safe, "utf-8");
}

/**
 * Load a run by ID.
 */
export function loadRun(runId: string): FinishRun | null {
  const p = getRunPath(runId);
  if (!fs.existsSync(p)) return null;
  try {
    const data = JSON.parse(fs.readFileSync(p, "utf-8"));
    return data as FinishRun;
  } catch {
    return null;
  }
}

/**
 * Find the most recent incomplete (paused or in-progress) run.
 * Returns null if all runs are complete or none exist.
 */
export function findIncompleteRun(): FinishRun | null {
  const dir = getRunsDir();
  const files = fs.readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => ({
      name: f,
      mtime: fs.statSync(path.join(dir, f)).mtimeMs,
    }))
    .sort((a, b) => b.mtime - a.mtime);

  for (const file of files) {
    const runId = file.name.replace(".json", "");
    const run = loadRun(runId);
    if (run && !run.verdict && (run.paused || run.steps.some((s) => s.status === "in_progress" || s.status === "blocked"))) {
      return run;
    }
  }
  return null;
}

/**
 * Mark a step as in-progress.
 */
export function startStep(run: FinishRun, phase: FinishPhase): void {
  const step = run.steps.find((s) => s.phase === phase);
  if (step) {
    step.status = "in_progress";
    step.startedAt = new Date().toISOString();
    run.currentStep = run.steps.findIndex((s) => s.phase === phase);
    saveRun(run);
  }
}

/**
 * Mark a step as passed.
 */
export function completeStep(run: FinishRun, phase: FinishPhase, detail?: string): void {
  const step = run.steps.find((s) => s.phase === phase);
  if (step) {
    step.status = "pass";
    step.completedAt = new Date().toISOString();
    step.detail = detail;
    saveRun(run);
  }
}

/**
 * Mark a step as blocked (waiting for owner action).
 */
export function blockStep(
  run: FinishRun,
  phase: FinishPhase,
  handoff: FinishStep["handoff"],
  detail?: string,
): void {
  const step = run.steps.find((s) => s.phase === phase);
  if (step) {
    step.status = "blocked";
    step.detail = detail;
    step.handoff = handoff;
    run.paused = true;
    saveRun(run);
  }
}

/**
 * Mark a step as failed (unrecoverable without code changes).
 */
export function failStep(run: FinishRun, phase: FinishPhase, detail?: string): void {
  const step = run.steps.find((s) => s.phase === phase);
  if (step) {
    step.status = "failed";
    step.detail = detail;
    saveRun(run);
  }
}

/**
 * Resume a paused run — clear the blocked status and set to in-progress.
 */
export function resumeRun(run: FinishRun): void {
  run.paused = false;
  const blockedStep = run.steps.find((s) => s.status === "blocked");
  if (blockedStep) {
    blockedStep.status = "in_progress";
  }
  saveRun(run);
}

/**
 * Mark the run as complete with a final verdict.
 */
export function finishRun(run: FinishRun, verdict: "pass" | "fail"): void {
  run.verdict = verdict;
  run.paused = false;
  // Add a complete marker step
  const completeStep: FinishStep = { phase: "complete", status: "pass", completedAt: new Date().toISOString() };
  if (!run.steps.find((s) => s.phase === "complete")) {
    run.steps.push(completeStep);
  }
  saveRun(run);
}

/**
 * Delete a run file (cleanup after successful completion).
 */
export function deleteRun(runId: string): void {
  const p = getRunPath(runId);
  if (fs.existsSync(p)) {
    fs.unlinkSync(p);
  }
}
