/**
 * DirectorStep — executable unit of work in the Run Execution Loop.
 * These types define the bridge between the Director's plan and the execution layer.
 */

export type DirectorStepType =
  | "read_file"
  | "write_file"
  | "run_command"
  | "search_code"
  | "web_check"
  | "db_query"
  | "review"
  | "finish";

export type DirectorStepStatus =
  | "pending"
  | "approved"
  | "running"
  | "success"
  | "failed"
  | "skipped";

export type DirectorRiskLevel = "low" | "medium" | "high" | "critical";

export type DirectorMode = "plan" | "act";

export type DirectorRunStatus =
  | "planned"
  | "running"
  | "waiting_approval"
  | "completed"
  | "failed"
  | "cancelled";

export interface DirectorStep {
  id: string;
  type: DirectorStepType;
  title: string;
  description: string;
  target?: string;
  command?: string;
  requiresApproval: boolean;
  riskLevel: DirectorRiskLevel;
  status: DirectorStepStatus;
  result?: string;
  error?: string;
  startedAt?: string;
  finishedAt?: string;
}

export interface DirectorRunRequest {
  message: string;
  projectId?: string;
  mode: DirectorMode;
  autoApprove?: boolean;
}

export interface DirectorRunResponse {
  runId: string;
  status: DirectorRunStatus;
  plan: {
    goal: string;
    steps: DirectorStep[];
  };
  nextAction?: DirectorStep;
}

export interface ExecuteStepRequest {
  runId: string;
  stepId: string;
}

export interface ExecuteStepResponse {
  step: DirectorStep;
  runStatus: DirectorRunStatus;
  nextAction?: DirectorStep | null;
}

export function classifyDirectorRisk(command: string): DirectorRiskLevel {
  const c = command.toLowerCase();
  if (/(rm\s+-rf|git\s+push\s+--force|format\s+c:|del\s+|remove-item|drop\s+table|deploy|production)/.test(c)) return "critical";
  if (/(git\s+push|npm\s+publish|publish|deploy|\.\/node_modules|network|sendmail|curl\s|wget\s|http)/.test(c)) return "high";
  if (/(npm\s+install|pnpm\s+install|yarn\s+install|git\s+add|rm\s+|delete|remove)/.test(c)) return "medium";
  return "low";
}

export function stepRequiresApproval(step: DirectorStep): boolean {
  if (step.type === "read_file" || step.type === "search_code") return false;
  if (step.type === "run_command") {
    const risk = classifyDirectorRisk(step.command || "");
    return risk !== "low";
  }
  if (step.type === "write_file") return true;
  if (step.type === "web_check") return false;
  if (step.type === "db_query") return true;
  return true;
}
