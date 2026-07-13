import { AgentTask, OrchestrationSession, AgentRole } from "@/types/agents";
import { supabase } from "./supabase";

export class AgentOrchestrator {
  private session: OrchestrationSession | null = null;

  async createSession(rootAgentRole: AgentRole, context: Record<string, unknown> = {}) {
    const { data, error } = await supabase
      .from("orchestration_sessions")
      .insert({
        status: "running",
        root_agent_role: rootAgentRole,
        context,
      })
      .select("*")
      .single();

    if (error) throw error;
    this.session = data as OrchestrationSession;
    return this.session;
  }

  async enqueueTask(
    sessionId: string,
    expectedRole?: AgentRole,
    payload: Record<string, unknown> = {},
    parentTaskId?: string,
    sequenceOrder?: number
  ) {
    const { data: existing } = await supabase
      .from("agent_tasks")
      .select("sequence_order")
      .eq("session_id", sessionId)
      .order("sequence_order", { ascending: false })
      .limit(1);

    const nextOrder = sequenceOrder ?? (existing?.[0]?.sequence_order ?? 0) + 1;

    const { data, error } = await supabase
      .from("agent_tasks")
      .insert({
        session_id: sessionId,
        expected_role: expectedRole,
        payload,
        parent_task_id: parentTaskId,
        sequence_order: nextOrder,
        status: "queued",
      })
      .select("*")
      .single();

    if (error) throw error;
    return data as AgentTask;
  }

  async completeTask(taskId: string, successToken: string, resultSummary?: string) {
    const { data, error } = await supabase
      .from("agent_tasks")
      .update({
        status: "completed",
        success_token: successToken,
        result_summary: resultSummary ?? null,
      })
      .eq("id", taskId)
      .select("*")
      .single();

    if (error) throw error;
    return data as AgentTask;
  }

  async failTask(taskId: string, errorToken: string, resultSummary?: string) {
    const { data, error } = await supabase
      .from("agent_tasks")
      .update({
        status: "failed",
        error_token: errorToken,
        result_summary: resultSummary ?? null,
      })
      .eq("id", taskId)
      .select("*")
      .single();

    if (error) throw error;
    return data as AgentTask;
  }

  async getSessionTasks(sessionId: string) {
    const { data, error } = await supabase
      .from("agent_tasks")
      .select("*")
      .eq("session_id", sessionId)
      .order("sequence_order", { ascending: true });

    if (error) throw error;
    return (data ?? []) as AgentTask[];
  }
}

export const orchestrator = new AgentOrchestrator();