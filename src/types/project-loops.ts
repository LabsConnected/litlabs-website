/**
 * Project Loops — types
 *
 * A "loop" is an automated build cycle:
 *   Goal → Inspect → Plan → Build → Test → Show Diff → Approve/Fix → Repeat
 *
 * The runner is hard-capped on iterations, cost, and file changes so it can
 * never spin forever. The user is the only one who can ship / deploy.
 */

export type LoopStatus =
  | "draft"
  | "planning"
  | "executing"
  | "testing"
  | "reviewing"
  | "awaiting_approval"
  | "completed"
  | "failed"
  | "cancelled";

export type LoopPhase =
  | "queued"
  | "inspecting"
  | "planning"
  | "editing"
  | "testing"
  | "reviewing"
  | "awaiting_approval"
  | "shipping"
  | "done";

export type LoopRole = "director" | "engineer" | "qa" | "reviewer" | "ship";

export type LoopEventLevel = "info" | "success" | "warn" | "error" | "phase";

export interface LoopEvent {
  id: string;
  loopId: string;
  iteration: number;
  role?: LoopRole;
  phase: LoopPhase;
  level: LoopEventLevel;
  message: string;
  detail?: string;
  at: string; // ISO
}

export interface LoopFileChange {
  path: string;
  additions: number;
  deletions: number;
  status: "modified" | "added" | "deleted" | "renamed";
  patch?: string;
}

export interface LoopDiff {
  iteration: number;
  baseSha: string;
  headSha: string;
  files: LoopFileChange[];
  summary: string;
  prUrl?: string;
}

export interface LoopTestResult {
  name: string;
  passed: boolean;
  durationMs: number;
  message?: string;
}

export interface LoopReview {
  iteration: number;
  passed: boolean;
  score: number; // 0-100
  findings: string[];
  blockers: string[];
}

export interface LoopLimits {
  maxIterations: number;
  maxTokens: number;
  maxCostCents: number;
  maxFileChanges: number;
  testTimeoutMs: number;
}

export const DEFAULT_LIMITS: LoopLimits = {
  maxIterations: 5,
  maxTokens: 250_000,
  maxCostCents: 500, // $5
  maxFileChanges: 25,
  testTimeoutMs: 5 * 60 * 1000, // 5 min
};

export interface LoopApproval {
  iteration: number;
  decision: "approve" | "iterate" | "edit_instructions" | "revert" | "ship";
  note?: string;
  at: string;
}

export interface ProjectLoop {
  id: string;
  projectId?: string;
  repo: string; // "owner/name"
  baseBranch: string;
  workingBranch: string;
  goal: string;
  acceptanceCriteria: string[];
  status: LoopStatus;
  phase: LoopPhase;
  iteration: number;
  maxIterations: number;
  limits: LoopLimits;
  createdBy?: string;
  createdAt: string;
  updatedAt: string;
  /** Tokens consumed so far (across all iterations). */
  tokensUsed: number;
  /** Cost in cents consumed so far. */
  costCents: number;
  /** Files changed so far (cumulative). */
  fileChanges: number;
  /** Most recent diff, if any. */
  lastDiff?: LoopDiff;
  /** Most recent review, if any. */
  lastReview?: LoopReview;
  /** Most recent approval, if any. */
  lastApproval?: LoopApproval;
  /** PR / ship info once shipping agent runs. */
  pullRequestUrl?: string;
  /** Snapshot of the working branch at the start of the loop, for revert. */
  rollbackSha?: string;
}

export const PHASE_LABELS: Record<LoopPhase, string> = {
  queued: "Queued",
  inspecting: "Inspecting repository",
  planning: "Creating plan",
  editing: "Editing files",
  testing: "Running tests",
  reviewing: "Reviewing diff",
  awaiting_approval: "Waiting for approval",
  shipping: "Shipping",
  done: "Done",
};

export const ROLE_LABELS: Record<LoopRole, string> = {
  director: "Director",
  engineer: "Engineer",
  qa: "QA",
  reviewer: "Reviewer",
  ship: "Ship",
};

export const STATUS_LABELS: Record<LoopStatus, string> = {
  draft: "Draft",
  planning: "Planning",
  executing: "Executing",
  testing: "Testing",
  reviewing: "Reviewing",
  awaiting_approval: "Awaiting approval",
  completed: "Completed",
  failed: "Failed",
  cancelled: "Cancelled",
};
