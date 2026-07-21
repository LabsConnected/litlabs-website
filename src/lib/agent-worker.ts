import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { logAgentEvent } from "@/lib/agent-logger";
import { litt } from "@/lib/litt";
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

  // Worker identity + heartbeat state
  private workerId: string | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private currentTaskId: string | null = null;
  private readonly HEARTBEAT_INTERVAL_MS = 20_000;

  constructor(config: WorkerConfig) {
    this.config = config;
  }

  private get supabase(): SupabaseClient {
    if (!this._supabaseAdmin) {
      const url =
        process.env.SUPABASE_URL ||
        process.env.NEXT_PUBLIC_SUPABASE_URL;

      const secretKey =
        process.env.SUPABASE_SERVICE_ROLE_KEY ||
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

      if (!url || !secretKey) {
        throw new Error(
          "🔱 Critical System Fault: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (or NEXT_PUBLIC_SUPABASE_ANON_KEY) must be set.",
        );
      }

      this._supabaseAdmin = createClient(url, secretKey);
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

    // Register this worker instance and start heartbeating
    await this.registerWorker();
    this.startHeartbeat();

    await litt.systemAlert({
      message: `Background execution matrix initialized for ${this.config.agentSlug}. Concurrency limit: ${this.config.maxConcurrency}`,
      severity: "low",
    });

    this.pollLoop();
  }

  public stop() {
    this.isRunning = false;
    this.stopHeartbeat();
    // Best-effort mark stopped
    void this.markWorkerStopped();
    console.log(
      `\x1b[33m[🔱 SYSTEM] Shutting down background worker matrix for ${this.config.agentSlug}...\x1b[0m`,
    );
  }

  private async registerWorker() {
    try {
      const hostname = typeof process !== "undefined" ? (process.env.HOSTNAME || "unknown") : "browser";
      const version = process.env.npm_package_version || "0.0.0";

      // Upsert by worker_name + hostname to keep a stable identity across restarts
      const { data, error } = await this.supabase
        .from("worker_instances")
        .upsert(
          {
            worker_name: this.config.agentSlug,
            hostname,
            version,
            status: "online",
            last_heartbeat_at: new Date().toISOString(),
            stopped_at: null,
            last_error: null,
          },
          { onConflict: "worker_name,hostname" }
        )
        .select("id")
        .single();

      if (error) {
        console.warn("[worker] register upsert failed:", error.message);
        return;
      }
      this.workerId = data?.id ?? null;
    } catch (e) {
      console.warn("[worker] register error:", e instanceof Error ? e.message : String(e));
    }
  }

  private startHeartbeat() {
    if (this.heartbeatTimer) return;
    this.heartbeatTimer = setInterval(() => {
      void this.sendHeartbeat(this.currentTaskId);
    }, this.HEARTBEAT_INTERVAL_MS);
    // Fire one immediately
    void this.sendHeartbeat(this.currentTaskId);
  }

  private stopHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private async sendHeartbeat(currentTaskId?: string | null) {
    if (!this.workerId) return;
    const nowIso = new Date().toISOString();
    const effectiveTask = currentTaskId ?? this.currentTaskId;

    try {
      await this.supabase
        .from("worker_instances")
        .update({
          last_heartbeat_at: nowIso,
          current_task_id: effectiveTask ?? null,
          status: "online",
        })
        .eq("id", this.workerId);

      // Renew lease on the running task so long executions don't get falsely expired
      if (effectiveTask) {
        const leaseMinutes = 5;
        const newLease = new Date(Date.now() + leaseMinutes * 60_000).toISOString();
        await this.supabase
          .from("agent_tasks")
          .update({
            lease_expires_at: newLease,
            updated_at: nowIso,
          })
          .eq("id", effectiveTask);
      }
    } catch (e) {
      // Non-fatal
    }
  }

  private async markWorkerStopped() {
    if (!this.workerId) return;
    try {
      await this.supabase
        .from("worker_instances")
        .update({
          stopped_at: new Date().toISOString(),
          status: "stopped",
          current_task_id: null,
        })
        .eq("id", this.workerId);
    } catch {
      // ignore
    }
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
    // 1. Lease recovery: reclaim expired claimed/running tasks for this worker's assignment
    await this.recoverExpiredLeases();

    // 2. Find candidates
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
        // 3. Atomic claim with lease
        const claimed = await this.claimTaskAtomically(candidate);
        if (!claimed) continue; // someone else claimed it

        this.activeTasksCount++;
        // Heartbeat will include current task id during execution
        this.executeTask(claimed).finally(() => {
          this.activeTasksCount--;
          // Clear current task from heartbeat after done
          void this.sendHeartbeat(null);
        });
        return;
      }
    }
  }

  /**
   * Atomic claim using UPDATE with WHERE status=queued.
   * Sets claimed_* and a short lease.
   */
  private async claimTaskAtomically(task: Record<string, unknown>): Promise<Record<string, unknown> | null> {
    const now = new Date();
    const leaseMinutes = 5; // short lease; worker renews while running
    const leaseExpires = new Date(now.getTime() + leaseMinutes * 60_000).toISOString();

    const { data, error } = await this.supabase
      .from("agent_tasks")
      .update({
        status: "claimed",
        claimed_by: this.workerId || null,
        claimed_at: now.toISOString(),
        lease_expires_at: leaseExpires,
        started_at: now.toISOString(),
        attempt_count: ((task.attempt_count as number) || 0) + 1,
        updated_at: now.toISOString(),
      })
      .eq("id", task.id)
      .eq("status", "queued")
      .select("*")
      .single();

    if (error || !data) {
      return null;
    }

    // Immediately set to running and send heartbeat with task
    const runTs = new Date().toISOString();
    const { data: running } = await this.supabase
      .from("agent_tasks")
      .update({
        status: "running",
        updated_at: runTs,
      })
      .eq("id", data.id)
      .select("*")
      .single();

    this.currentTaskId = String(data.id);
    await this.sendHeartbeat(this.currentTaskId);
    return running || data;
  }

  /**
   * Recover tasks whose lease has expired.
   * If attempts remain, back to queued/retry_scheduled; else failed.
   */
  private async recoverExpiredLeases() {
    const nowIso = new Date().toISOString();

    // Find expired claimed or running for our assignment
    const { data: expired, error } = await this.supabase
      .from("agent_tasks")
      .select("id, attempt_count, max_attempts, status")
      .in("status", ["claimed", "running"])
      .eq("assigned_to", this.config.agentSlug)
      .lt("lease_expires_at", nowIso);

    if (error || !expired || expired.length === 0) return;

    for (const t of expired as Array<{ id: string; attempt_count: number; max_attempts: number; status: string }>) {
      const attempts = (t.attempt_count || 0);
      const max = t.max_attempts || 3;

      if (attempts >= max) {
        await this.supabase
          .from("agent_tasks")
          .update({
            status: "failed",
            last_error: "Lease expired and max attempts reached",
            updated_at: nowIso,
            lease_expires_at: null,
          })
          .eq("id", t.id);
      } else {
        await this.supabase
          .from("agent_tasks")
          .update({
            status: "queued",
            claimed_by: null,
            claimed_at: null,
            lease_expires_at: null,
            updated_at: nowIso,
          })
          .eq("id", t.id);
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
      .in("status", ["completed", "failed", "cancelled"])
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

      // Normalize to "completed" for health surface expectations
      const doneTs = new Date().toISOString();
      await this.supabase
        .from("agent_tasks")
        .update({
          status: "completed",
          completed_at: doneTs,
          updated_at: doneTs,
        })
        .eq("id", task.id);

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

      await litt.systemAlert({
        message: `Fatal thread crash on task [${task.id}]: ${message}`,
        severity: "critical",
      });
    }
  }
}
