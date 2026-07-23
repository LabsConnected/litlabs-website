import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { logAgentEvent } from "@/lib/agent-logger";
import { jarvis } from "@/lib/litt";
import { OpenRouterExecutor } from "@/lib/llm-executor";

export interface WorkerConfig {
  agentSlug: string;
  pollIntervalMs: number;
  maxConcurrency: number;
}

export class AgentWorkerMatrix {
  private config: WorkerConfig;
  private activeTasksCount: number = 0;
  private isRunning: boolean = false;
  private _supabaseAdmin: SupabaseClient | null = null;

  constructor(config: WorkerConfig) {
    this.config = config;
  }

  private get supabase(): SupabaseClient {
    if (!this._supabaseAdmin) {
      const secretKey =
        process.env.SUPABASE_SERVICE_ROLE_KEY ||
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

      if (!secretKey) {
        throw new Error(
          "🔱 Critical System Fault: Neither SUPABASE_SERVICE_ROLE_KEY nor NEXT_PUBLIC_SUPABASE_ANON_KEY could be resolved from the environment context.",
        );
      }

      this._supabaseAdmin = createClient(
        "https://rokbfvuoqildggnhappy.supabase.co",
        secretKey,
      );
    }
    return this._supabaseAdmin;
  }

  public async start() {
    if (this.isRunning) return;
    this.isRunning = true;

    // Verify connection/keys immediately on startup
    try {
      void this.supabase;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(
        `\x1b[31m[❌ FATAL INITIALIZATION FAULT] ${message}\x1b[0m`,
      );
      this.isRunning = false;
      throw err;
    }

    await jarvis.systemAlert({
      message: `Background execution matrix initialized for ${this.config.agentSlug}. Concurrency limit: ${this.config.maxConcurrency}`,
      severity: "low",
    });

    this.pollLoop();
  }

  public stop() {
    this.isRunning = false;
    console.log(
      `\x1b[33m[🔱 SYSTEM] Shutting down background worker matrix for ${this.config.agentSlug}...\x1b[0m`,
    );
  }

  private async pollLoop() {
    while (this.isRunning) {
      try {
        if (this.activeTasksCount < this.config.maxConcurrency) {
          await this.fetchAndProcessNextTask();
        }
      } catch (err) {
        console.error(
          "[Worker Fault] Polling loop error:",
          err instanceof Error ? err.message : String(err),
        );
      }

      await new Promise((resolve) =>
        setTimeout(resolve, this.config.pollIntervalMs),
      );
    }
  }

  private async fetchAndProcessNextTask() {
    const { data: queuedTasks, error } = await this.supabase
      .from("agent_tasks")
      .select("*")
      .eq("status", "queued")
      .eq("assigned_to", this.config.agentSlug)
      .order("sequence_order", { ascending: true });

    if (error) throw error;
    if (!queuedTasks || queuedTasks.length === 0) return;

    for (const candidate of queuedTasks) {
      if (await this.areDependenciesSatisfied(candidate)) {
        const targetTask = candidate;
        this.activeTasksCount++;
        this.executeTask(targetTask).finally(() => {
          this.activeTasksCount--;
        });
        return;
      }
    }
  }

  private async areDependenciesSatisfied(
    task: Record<string, unknown>,
  ): Promise<boolean> {
    const deps =
      ((task.task_input as Record<string, unknown>)?.dependsOn as
        | string[]
        | undefined) || [];
    if (deps.length === 0) return true;

    const { data: parents, error } = await this.supabase
      .from("agent_tasks")
      .select("status")
      .in("status", ["success", "failed", "cancelled"])
      .eq("session_id", task.session_id as string);

    if (error) {
      console.error("Failed to inspect dependency tasks:", error);
      return false;
    }

    const completedIds = new Set(
      (parents || []).map((p: Record<string, unknown>) => String(p.status)),
    );
    return deps.every((depId) => completedIds.has(depId));
  }

  private async executeTask(task: Record<string, unknown>) {
    const timestamp = new Date().toISOString();

    try {
      const { error: claimError } = await this.supabase
        .from("agent_tasks")
        .update({ status: "processing", updated_at: timestamp })
        .eq("id", task.id);

      if (claimError) throw claimError;

      await logAgentEvent(
        this.config.agentSlug,
        "info",
        `Acquired execution thread context for task [${task.id}]`,
      );

      const executor = new OpenRouterExecutor();
      const inference = await executor.run({
        id: String(task.id),
        sessionId: String((task as Record<string, unknown>).session_id || ""),
        input: {
          prompt: String(
            (
              (task as Record<string, unknown>).task_input as Record<
                string,
                unknown
              >
            )?.prompt || "",
          ),
          context: (
            (task as Record<string, unknown>).task_input as Record<
              string,
              unknown
            >
          )?.context as Record<string, unknown> | undefined,
          provider: (
            (task as Record<string, unknown>).task_input as Record<
              string,
              unknown
            >
          )?.provider as "openrouter" | "bedrock" | undefined,
          model: (
            (task as Record<string, unknown>).task_input as Record<
              string,
              unknown
            >
          )?.model as string | undefined,
        },
      });

      const finalizedTimestamp = new Date().toISOString();
      const { error: successError } = await this.supabase
        .from("agent_tasks")
        .update({
          status: "success",
          task_output: {
            text: inference.text,
            usage: inference.usage,
            provider: inference.provider,
            model: inference.model,
            completed_at: finalizedTimestamp,
          },
          updated_at: finalizedTimestamp,
        })
        .eq("id", task.id);

      if (successError) throw successError;

      await logAgentEvent(
        this.config.agentSlug,
        "success",
        `Task [${task.id}] pipeline completed successfully.`,
      );
    } catch (execError) {
      const failTimestamp = new Date().toISOString();
      const message =
        execError instanceof Error ? execError.message : String(execError);
      await this.supabase
        .from("agent_tasks")
        .update({
          status: "failed",
          task_output: {
            critical_fault: message,
            collapsed_at: failTimestamp,
          },
          updated_at: failTimestamp,
        })
        .eq("id", task.id);

      await jarvis.systemAlert({
        message: `Fatal thread crash on task [${task.id}]: ${message}`,
        severity: "critical",
      });
    }
  }
}
