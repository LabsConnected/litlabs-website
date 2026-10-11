import type { ActionRun, ActionRunStatus } from "@/lib/action-runtime/types";
import type { StudioTask } from "./task-types";

export type CanonicalBrowserJob = {
  jobId: string;
  jobType: "studio.browser";
  goal: string | null;
  riskLevel: "low";
  requestedBy: "studio";
  status: "queued" | "running" | "awaiting_approval" | "approved" | "completed" | "failed" | "cancelled";
  params: Record<string, string | null>;
  result: null;
  error: string | null;
  progress: { step: number; totalSteps: number; steps: never[] };
  browserSessionId: string | null;
  liveViewUrl: null;
  approvedBy: null;
  approvedAt: null;
  attempts: number;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
};

function mapStatus(status: ActionRunStatus): CanonicalBrowserJob["status"] {
  if (status === "queued") return "queued";
  if (["starting", "working"].includes(status)) return "running";
  if (["waiting_for_user", "paused"].includes(status)) return "awaiting_approval";
  if (status === "user_controlling") return "approved";
  if (status === "completed") return "completed";
  if (status === "failed") return "failed";
  return "cancelled";
}

export function canonicalBrowserJobsForScope(
  runs: readonly ActionRun[],
  tasks: readonly StudioTask[],
  runId?: string,
): CanonicalBrowserJob[] {
  const taskByRunId = new Map<string, string>();
  for (const task of tasks) {
    for (const id of [task.activeActionRunId, task.latestActionRunId]) {
      if (id) taskByRunId.set(id, task.title);
    }
  }
  return runs
    .filter((run) => taskByRunId.has(run.id) && (!runId || run.id === runId))
    .filter((run) => run.kind === "browser" || Boolean(run.browserSessionId))
    .map((run) => ({
      jobId: run.id,
      jobType: "studio.browser" as const,
      goal: run.currentActivity || taskByRunId.get(run.id) || "Browser activity",
      riskLevel: "low" as const,
      requestedBy: "studio" as const,
      status: mapStatus(run.status),
      params: { projectId: run.projectId, conversationId: run.conversationId, actionRunId: run.id, browserSessionId: run.browserSessionId },
      result: null,
      error: run.failureMessage,
      progress: { step: 0, totalSteps: 0, steps: [] as never[] },
      browserSessionId: run.browserSessionId,
      liveViewUrl: null,
      approvedBy: null,
      approvedAt: null,
      attempts: 1,
      createdAt: run.createdAt,
      startedAt: run.startedAt,
      completedAt: run.completedAt,
    }));
}
