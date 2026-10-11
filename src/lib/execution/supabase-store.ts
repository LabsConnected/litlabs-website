import "server-only";

import { supabaseAdmin } from "@/lib/supabase";
import type { ExecutionPlan, ExecutionState } from "@/lib/intent-router/types";
import type { ExecutionStore } from "./engine";

/** Durable execution state adapter. The engine remains persistence-agnostic. */
/**
 * @deprecated `litt_execution_runs` is deprecated and has zero callers.
 * Execution state is now persisted via `action_runs` (see
 * `src/lib/action-runtime/run-store.ts`) and `mission_runs` (see
 * `src/lib/missions/mission-repository.ts`). This class is retained only so
 * the `litt_execution_runs` table's shape stays documented; do not use it for
 * new code. The table itself is left in place by its creating migration and
 * may be dropped in a future cleanup migration once historical data retention
 * is confirmed.
 */
export class SupabaseExecutionStore implements ExecutionStore {
  constructor(
    private readonly userId: string,
    private readonly plan: ExecutionPlan,
    private readonly projectId?: string,
  ) {}

  async load(planId: string): Promise<ExecutionState | null> {
    const { data, error } = await supabaseAdmin
      .from("litt_execution_runs")
      .select("state")
      .eq("user_id", this.userId)
      .eq("plan_id", planId)
      .maybeSingle();
    if (error) throw new Error(`Failed to load execution state: ${error.message}`);
    return (data?.state as ExecutionState | null) ?? null;
  }

  async save(state: ExecutionState): Promise<void> {
    const { error } = await supabaseAdmin
      .from("litt_execution_runs")
      .upsert(
        {
          user_id: this.userId,
          project_id: this.projectId ?? null,
          plan_id: this.plan.id,
          prompt: this.plan.prompt,
          primary_intent: this.plan.primaryIntent,
          plan: this.plan,
          state,
          status: state.status,
          heartbeat_at: state.updatedAt,
          lease_expires_at: state.leaseExpiresAt ?? null,
          updated_at: state.updatedAt,
        },
        { onConflict: "user_id,plan_id" },
      );
    if (error) throw new Error(`Failed to persist execution state: ${error.message}`);
  }
}
