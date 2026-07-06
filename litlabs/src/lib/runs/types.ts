export type RunStatus =
  | "pending"
  | "needs_approval"
  | "running"
  | "paused"
  | "completed"
  | "failed"
  | "cancelled";
export type RunSource = "chat" | "terminal" | "api" | "workflow" | "agent";
export type RunRiskLevel = "low" | "medium" | "high" | "critical";
export type RunStepType =
  | "step"
  | "terminal_output"
  | "diff"
  | "review"
  | "error"
  | "approval"
  | "artifact"
  | "tool"
  | "system";
export type RunStepStatus =
  | "queued"
  | "running"
  | "done"
  | "error"
  | "skipped"
  | "awaiting_approval";
export type RunArtifactKind =
  | "diff"
  | "screenshot"
  | "log"
  | "file"
  | "preview"
  | "error"
  | "report";

export type Run = {
  id: string;
  project_id?: string | null;
  owner_id: string;
  status: RunStatus;
  source: RunSource;
  intent: string;
  plan?: Record<string, unknown> | null;
  risk_level: RunRiskLevel;
  metadata?: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
  started_at?: string | null;
  finished_at?: string | null;
};

export type RunStep = {
  id: string;
  run_id: string;
  type: RunStepType;
  title: string;
  status: RunStepStatus;
  command?: string | null;
  risk_level?: RunRiskLevel | null;
  input?: Record<string, unknown> | null;
  output?: Record<string, unknown> | null;
  exit_code?: number | null;
  started_at: string;
  finished_at?: string | null;
};

export type RunArtifact = {
  id: string;
  run_id: string;
  step_id?: string | null;
  kind: RunArtifactKind;
  path: string;
  mime?: string | null;
  meta?: Record<string, unknown> | null;
  created_at: string;
};

export type DirectorPlan = {
  goal: string;
  steps: Array<{
    id: string;
    title: string;
    type: "tool" | "terminal" | "diff" | "review" | "finish";
    command?: string;
    expected_files?: string[];
    tool?: string;
    args?: Record<string, unknown>;
    needs_approval?: boolean;
    risk_level?: RunRiskLevel;
  }>;
};
