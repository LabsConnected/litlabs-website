export type AgentRole =
  | "LiTT Code"
  | "Forge"
  | "Pulse"
  | "Visionary"
  | "Nexus";

export interface Agent {
  id: string;
  role: AgentRole;
  display_name: string;
  system_prompt: string;
  model_id?: string | null;
  parameters: Record<string, unknown>;
  active: boolean;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface AgentTask {
  id: string;
  session_id: string;
  agent_id?: string | null;
  parent_task_id?: string | null;
  sequence_order: number;
  expected_role?: AgentRole | null;
  payload: Record<string, unknown>;
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  success_token?: string | null;
  error_token?: string | null;
  result_summary?: string | null;
  created_at: string;
  updated_at: string;
}

export interface OrchestrationSession {
  id: string;
  status: "running" | "paused" | "completed" | "failed" | "cancelled";
  root_agent_role: AgentRole;
  context: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}