/**
 * Browser Job Executor
 *
 * The execution engine that picks up a queued browser job and runs it
 * to completion. Dispatches to the appropriate job handler based on
 * job_type, manages status transitions, and writes the result.
 *
 * This is called asynchronously (via Next.js after() or a future CF
 * Queue consumer) after the enqueue endpoint returns the jobId.
 *
 * Status machine:
 *   queued → running → completed | failed
 *   queued → running → awaiting_approval → (waits for human) → approved → running → completed
 *
 * The executor is designed to be transport-agnostic — it can be called
 * from after() in a Next.js route today, or from a CF Queue consumer
 * tomorrow, without changing the job API surface.
 */

import "server-only";
import {
  claimJob,
  completeJob,
  failJob,
  auditBrowserJob,
  emitJobEvent,
  type BrowserJob,
  type JobType,
} from "@/lib/browser-jobs";
import { inspectGhlWorkflow } from "@/lib/ghl/ghl-workflow-inspector";

// ─── Types ──────────────────────────────────────────────────────

export interface JobHandlerResult {
  success: boolean;
  result: Record<string, unknown>;
  error?: string;
}

export type JobHandler = (job: BrowserJob) => Promise<JobHandlerResult>;

// ─── Job handler registry ───────────────────────────────────────

const handlers: Partial<Record<JobType, JobHandler>> = {
  "ghl.workflow.inspect": async (job) => {
    const params = job.params as { workflowName?: string; ghlBaseUrl?: string };
    if (!params.workflowName) {
      return {
        success: false,
        result: {},
        error: "workflowName is required for ghl.workflow.inspect",
      };
    }

    try {
      const inspection = await inspectGhlWorkflow({
        userId: job.userId,
        jobId: job.id,
        params: {
          workflowName: params.workflowName,
          ghlBaseUrl: params.ghlBaseUrl,
        },
      });

      return {
        success: true,
        result: inspection as unknown as Record<string, unknown>,
      };
    } catch (err) {
      return {
        success: false,
        result: {},
        error: err instanceof Error ? err.message : "GHL workflow inspection failed",
      };
    }
  },

  "ghl.workflow.list": async (_job) => {
    // Future: list all workflows in GHL
    return {
      success: false,
      result: {},
      error: "ghl.workflow.list is not yet implemented",
    };
  },

  "ghl.workflow.finish": async (_job) => {
    // Future: create/finish a GHL workflow with If/Else branches
    return {
      success: false,
      result: {},
      error: "ghl.workflow.finish is not yet implemented — requires approval gates",
    };
  },
};

// ─── Execution ──────────────────────────────────────────────────

/**
 * Execute a browser job by ID.
 *
 * 1. Atomically claim the job (queued → running)
 * 2. Dispatch to the registered handler for the job type
 * 3. Update status to completed or failed
 * 4. Write audit log
 *
 * If the job is already claimed (no longer queued), this is a no-op.
 * This makes retry safe — duplicate executions are silently skipped.
 */
export async function executeBrowserJob(jobId: string, userId: string): Promise<void> {
  const start = Date.now();

  // 1. Atomically claim the job
  const job = await claimJob(jobId);
  if (!job) {
    // Job was already claimed, cancelled, or doesn't belong to this user
    return;
  }

  // Emit job.started event
  await emitJobEvent({
    jobId,
    type: "job.started",
    message: `Started ${job.jobType}${job.goal ? `: ${job.goal}` : ""}`,
    metadata: { jobType: job.jobType, riskLevel: job.riskLevel, requestedBy: job.requestedBy },
  });

  const handler = handlers[job.jobType];
  if (!handler) {
    await failJob(jobId, `No handler registered for job type "${job.jobType}"`);
    await emitJobEvent({
      jobId,
      type: "job.failed",
      message: `No handler registered for job type "${job.jobType}"`,
      metadata: { reason: "no_handler" },
    });
    await auditBrowserJob({
      jobId,
      jobType: job.jobType,
      userId,
      status: "failed",
      success: false,
      durationMs: Date.now() - start,
      error: `No handler for job type`,
      requestedBy: job.requestedBy,
    });
    return;
  }

  // 2. Execute the handler
  let handlerResult: JobHandlerResult;
  try {
    handlerResult = await handler(job);
  } catch (err) {
    handlerResult = {
      success: false,
      result: {},
      error: err instanceof Error ? err.message : "Job execution failed",
    };
    await emitJobEvent({
      jobId,
      type: "job.failed",
      message: err instanceof Error ? err.message : "Job execution failed",
      metadata: { reason: "exception" },
    });
  }

  const durationMs = Date.now() - start;

  // 3. Update job status
  if (handlerResult.success) {
    await completeJob(jobId, handlerResult.result);
    await emitJobEvent({
      jobId,
      type: "job.completed",
      message: `Job completed successfully`,
      metadata: { durationMs },
    });
  } else {
    await failJob(jobId, handlerResult.error ?? "Job failed without error message");
    await emitJobEvent({
      jobId,
      type: "job.failed",
      message: handlerResult.error ?? "Job failed without error message",
      metadata: { durationMs, reason: "handler_error" },
    });
  }

  // 4. Audit log — never logs job params or result contents
  await auditBrowserJob({
    jobId,
    jobType: job.jobType,
    userId,
    status: handlerResult.success ? "completed" : "failed",
    success: handlerResult.success,
    durationMs,
    error: handlerResult.success ? undefined : handlerResult.error,
    requestedBy: job.requestedBy,
  });
}

/**
 * Check if a job type has a registered handler.
 */
export function hasJobHandler(jobType: JobType): boolean {
  return !!handlers[jobType];
}
