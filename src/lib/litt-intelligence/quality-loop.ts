/**
 * LiTT Quality Loop — gated stage machine for serious builds.
 *
 * UNDERSTAND → RESEARCH → PLAN → DESIGN → BUILD → RUN → INSPECT →
 * CRITIQUE → FIX → POLISH → TEST → DEPLOY → VERIFY
 *
 * The hard product rule: the loop can never advance past a stage, and can
 * never declare success, without that stage's required evidence recorded.
 * A conversational acknowledgement is never evidence. Stages that genuinely
 * do not apply are marked `skipped` with an explicit reason — skipping is a
 * recorded decision, not a silent omission.
 *
 * This module is pure (no LLM calls, no I/O) so the gating rules are fully
 * unit-testable. The orchestrator lives in quality-loop-flow.ts.
 */

import "server-only";

// ─── Stage definitions ────────────────────────────────────────────

export const QUALITY_STAGES = [
  "understand",
  "research",
  "plan",
  "design",
  "build",
  "run",
  "inspect",
  "critique",
  "fix",
  "polish",
  "test",
  "deploy",
  "verify",
] as const;

export type QualityStage = (typeof QUALITY_STAGES)[number];

export type StageStatus = "pending" | "active" | "passed" | "skipped" | "failed";

/** What each stage must record before the loop may advance past it. */
export interface StageRequirement {
  stage: QualityStage;
  /** Human-readable description of the evidence this stage demands. */
  evidence: string;
  /**
   * When true, the stage may be marked skipped with an explicit reason
   * (e.g. RESEARCH when the brief establishes no external research is
   * needed; INSPECT/CRITIQUE when no screenshot infra is available).
   * Non-skippable stages must pass with evidence.
   */
  skippable: boolean;
}

export const STAGE_REQUIREMENTS: Record<QualityStage, StageRequirement> = {
  understand: {
    stage: "understand",
    evidence: "Structured brief: audience, business goal, conversion goal, brand, constraints.",
    skippable: false,
  },
  research: {
    stage: "research",
    evidence: "Research notes (competitors, required features, references) or an explicit no-research-needed reason.",
    skippable: true,
  },
  plan: {
    stage: "plan",
    evidence: "Plan: information architecture, user journeys, build steps, mobile behavior, empty/loading/error states.",
    skippable: false,
  },
  design: {
    stage: "design",
    evidence: "Design intent: typography, spacing system, visual hierarchy, component language, responsive layout, motion.",
    skippable: false,
  },
  build: {
    stage: "build",
    evidence: "A workspace inspection proves a runnable entry artifact exists after the build.",
    skippable: false,
  },
  run: {
    stage: "run",
    evidence: "Preview server reached ready status; preview URL recorded.",
    skippable: false,
  },
  inspect: {
    stage: "inspect",
    evidence: "Machine-captured screenshot of the running preview with a passing style probe.",
    // Once a preview exists, visual inspection is mandatory for UI/site
    // missions. A missing browser is verification-unavailable, never a pass.
    skippable: false,
  },
  critique: {
    stage: "critique",
    evidence: "Machine-captured screenshot reviewed by the visual judge with a passing scorecard.",
    skippable: false,
  },
  fix: {
    stage: "fix",
    evidence: "Design-pass fixes applied in response to a below-threshold critique, or a recorded decision that no fix was needed.",
    skippable: true,
  },
  polish: {
    stage: "polish",
    evidence: "Polish pass summary (copy, spacing, motion, feedback, edge cases) or a recorded decision that polish was not needed.",
    skippable: true,
  },
  test: {
    stage: "test",
    evidence: "At least one real build/typecheck/test check executed and all results passed.",
    skippable: false,
  },
  deploy: {
    stage: "deploy",
    evidence: "Deployment completed with a live public URL.",
    skippable: true,
  },
  verify: {
    stage: "verify",
    evidence: "The live URL was fetched and verified serving the expected content.",
    skippable: true,
  },
};

// ─── Evidence ─────────────────────────────────────────────────────

/** Who recorded a piece of evidence. */
export type EvidenceSource = "agent" | "system" | "judge" | "user";

export interface StageEvidence {
  /** Short statement of what was established. */
  summary: string;
  /** Supporting artifacts: file paths, URLs, check names, score references. */
  artifacts?: string[];
  /** ISO timestamp of when the evidence was recorded. */
  at: string;
  /** Who/what produced the evidence. */
  by: EvidenceSource;
  /** Optional machine-readable detail (scorecards, check results). */
  detail?: Record<string, unknown>;
}

export interface StageState {
  stage: QualityStage;
  status: StageStatus;
  evidence: StageEvidence[];
  /** Set when status is "skipped" — why this stage did not apply. */
  skipReason?: string;
  /** Set when status is "failed" — what went wrong. */
  failureReason?: string;
}

export interface QualityLoopState {
  /** Unique id for this loop run (correlates with the agent run). */
  runId: string;
  projectId: string;
  userId: string;
  version: typeof QUALITY_LOOP_VERSION;
  stages: Record<QualityStage, StageState>;
  /** How many DESIGN←CRITIQUE fix passes have run (bounded by MAX_DESIGN_PASSES). */
  designPasses: number;
  startedAt: string;
  updatedAt: string;
}

export const QUALITY_LOOP_VERSION = 1;

/** Maximum automatic DESIGN passes after a below-threshold critique. */
export const MAX_DESIGN_PASSES = 2;

// ─── Errors ───────────────────────────────────────────────────────

export class StageGateError extends Error {
  constructor(
    public readonly stage: QualityStage,
    message: string,
  ) {
    super(message);
    this.name = "StageGateError";
  }
}

// ─── Construction ─────────────────────────────────────────────────

function emptyStage(stage: QualityStage): StageState {
  return { stage, status: "pending", evidence: [] };
}

export function createQualityLoop(opts: {
  runId: string;
  projectId: string;
  userId: string;
}): QualityLoopState {
  const stages = {} as Record<QualityStage, StageState>;
  for (const stage of QUALITY_STAGES) {
    stages[stage] = emptyStage(stage);
  }
  const now = new Date().toISOString();
  return {
    runId: opts.runId,
    projectId: opts.projectId,
    userId: opts.userId,
    version: QUALITY_LOOP_VERSION,
    stages,
    designPasses: 0,
    startedAt: now,
    updatedAt: now,
  };
}

function touch(state: QualityLoopState): void {
  state.updatedAt = new Date().toISOString();
}

/** The stage the loop is currently working on (first non-terminal stage). */
export function currentStage(state: QualityLoopState): QualityStage | null {
  for (const stage of QUALITY_STAGES) {
    const status = state.stages[stage].status;
    if (status === "pending" || status === "active") return stage;
  }
  return null;
}

// ─── Transitions ──────────────────────────────────────────────────

/** Mark a stage active. Stages must activate in order. */
export function beginStage(state: QualityLoopState, stage: QualityStage): void {
  const current = currentStage(state);
  if (current !== stage) {
    throw new StageGateError(
      stage,
      `Cannot begin stage "${stage}" while stage "${current ?? "none"}" is current. Stages run in order.`,
    );
  }
  state.stages[stage].status = "active";
  touch(state);
}

/** Record evidence for a stage. Evidence may be recorded for the current
 *  stage or any earlier stage (late evidence is allowed); never for a
 *  future stage. */
export function recordEvidence(
  state: QualityLoopState,
  stage: QualityStage,
  evidence: Omit<StageEvidence, "at"> & { at?: string },
): void {
  const stageIndex = QUALITY_STAGES.indexOf(stage);
  const current = currentStage(state);
  const currentIndex = current ? QUALITY_STAGES.indexOf(current) : QUALITY_STAGES.length;
  if (stageIndex > currentIndex) {
    throw new StageGateError(
      stage,
      `Cannot record evidence for future stage "${stage}" (current: "${current ?? "none"}").`,
    );
  }
  const record: StageEvidence = {
    ...evidence,
    at: evidence.at ?? new Date().toISOString(),
  };
  state.stages[stage].evidence.push(record);
  if (state.stages[stage].status === "pending") {
    state.stages[stage].status = "active";
  }
  touch(state);
}

/** Mark a stage passed. Requires at least one evidence record. */
export function passStage(state: QualityLoopState, stage: QualityStage): void {
  const current = currentStage(state);
  if (current !== stage) {
    throw new StageGateError(
      stage,
      `Cannot pass stage "${stage}" while stage "${current ?? "none"}" is current.`,
    );
  }
  const s = state.stages[stage];
  if (s.evidence.length === 0) {
    throw new StageGateError(
      stage,
      `Stage "${stage}" cannot pass without evidence. Required: ${STAGE_REQUIREMENTS[stage].evidence}`,
    );
  }
  s.status = "passed";
  touch(state);
}

/**
 * Mark a stage skipped with an explicit reason. Only stages whose
 * requirement is skippable may be skipped. Skipping is a recorded
 * decision, never a silent omission.
 */
export function skipStage(state: QualityLoopState, stage: QualityStage, reason: string): void {
  const current = currentStage(state);
  if (current !== stage) {
    throw new StageGateError(
      stage,
      `Cannot skip stage "${stage}" while stage "${current ?? "none"}" is current.`,
    );
  }
  if (!STAGE_REQUIREMENTS[stage].skippable) {
    throw new StageGateError(
      stage,
      `Stage "${stage}" is not skippable. It must pass with evidence: ${STAGE_REQUIREMENTS[stage].evidence}`,
    );
  }
  if (!reason.trim()) {
    throw new StageGateError(stage, `Skipping stage "${stage}" requires an explicit reason.`);
  }
  const s = state.stages[stage];
  s.status = "skipped";
  s.skipReason = reason;
  touch(state);
}

/** Mark the current stage failed with a reason. A failed stage ends the loop. */
export function failStage(state: QualityLoopState, stage: QualityStage, reason: string): void {
  const current = currentStage(state);
  if (current !== stage) {
    throw new StageGateError(
      stage,
      `Cannot fail stage "${stage}" while stage "${current ?? "none"}" is current.`,
    );
  }
  const s = state.stages[stage];
  s.status = "failed";
  s.failureReason = reason;
  touch(state);
}

// ─── Success declaration ──────────────────────────────────────────

export interface SuccessVerdict {
  ok: boolean;
  /** Stages that must pass but have not (or failed). Empty when ok. */
  missing: QualityStage[];
  /** Human-readable justification. */
  reason: string;
}

/**
 * The hard product rule: success may be declared only when every
 * non-skippable stage has passed with evidence AND no stage has failed.
 * Deploy/verify are required only when a deployment was requested —
 * otherwise they may remain pending (e.g. paused for user approval).
 * When a deployment WAS requested, deploy/verify must have passed with
 * evidence: skipping shipment is not an option.
 *
 * @param deployRequested — true when the run was asked to ship/publish.
 */
export function declareSuccess(
  state: QualityLoopState,
  opts: { deployRequested: boolean },
): SuccessVerdict {
  const missing: QualityStage[] = [];

  for (const stage of QUALITY_STAGES) {
    const s = state.stages[stage];
    if (s.status === "failed") {
      missing.push(stage);
      continue;
    }
    // Deploy/verify bind to the deploy request, not to every build.
    // When a deployment was requested they are mandatory regardless of
    // their skippable flag — a skip is not a shipment.
    if (stage === "deploy" || stage === "verify") {
      if (!opts.deployRequested) continue;
      if (s.status !== "passed") missing.push(stage);
      continue;
    }
    const req = STAGE_REQUIREMENTS[stage];
    if (req.skippable) continue;
    if (s.status !== "passed") missing.push(stage);
  }

  if (missing.length === 0) {
    return {
      ok: true,
      missing: [],
      reason: "All required quality-loop stages passed with recorded evidence.",
    };
  }

  return {
    ok: false,
    missing,
    reason:
      `Cannot declare success: ${missing.length} required stage(s) lack evidence: ` +
      missing.map((s) => `"${s}" (${state.stages[s].status})`).join(", ") +
      ".",
  };
}

/** Compact summary of the loop for progress events and final reports. */
export function summarizeLoop(state: QualityLoopState): Array<{
  stage: QualityStage;
  status: StageStatus;
  evidenceCount: number;
}> {
  return QUALITY_STAGES.map((stage) => ({
    stage,
    status: state.stages[stage].status,
    evidenceCount: state.stages[stage].evidence.length,
  }));
}
