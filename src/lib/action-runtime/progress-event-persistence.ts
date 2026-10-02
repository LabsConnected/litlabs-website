import "server-only";

import { appendActionEvent } from "./run-store";
import type { ActionEventType } from "./types";
import type { ProgressEvent } from "@/lib/litt-intelligence/progress-events";

/**
 * Item 5a — one Activity truth.
 *
 * The agent loop's ProgressEvents are the raw stream of what a run did
 * (tool calls, builds, checks, checkpoints, workspace changes, previews,
 * deploys). This module maps them into durable `action_events` rows on the
 * run's ActionRun so the Studio Activity feed reads ONE persisted truth
 * instead of chat messages or a localStorage cache.
 *
 * High-frequency stream noise (phase, status, step_timing, model_routing,
 * model_response) is deliberately NOT persisted — the Activity feed renders
 * action-level events, and persisting per-step chatter would add a Supabase
 * round trip per emit with no feed value. `mapProgressEventToActionEvent`
 * returns null for those types and the hook skips them.
 *
 * Every persisted payload carries a human-readable `label` plus the typed
 * fields the Activity panel renders; secrets are scrubbed by
 * `sanitizeActionPayload` inside `appendActionEvent`.
 */

export interface MappedLoopEvent {
  type: ActionEventType;
  payload: Record<string, unknown>;
}

const MAX_DIFF_CHARS = 6000;
const MAX_FILES_LISTED = 20;

function truncate(value: string | undefined, max: number): string | undefined {
  if (value === undefined) return undefined;
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

function basePayload(event: ProgressEvent): Record<string, unknown> {
  return { emittedAt: new Date().toISOString(), loopEvent: event.type };
}

/**
 * Map one loop ProgressEvent to a durable action_events row. Returns null
 * for stream-noise types that the Activity feed does not render.
 */
export function mapProgressEventToActionEvent(
  event: ProgressEvent,
): MappedLoopEvent | null {
  switch (event.type) {
    case "tool_start":
      return {
        type: "tool.started",
        payload: {
          ...basePayload(event),
          toolId: event.toolId,
          summary: event.summary,
          label: event.summary || `Running ${event.toolId}`,
        },
      };
    case "tool_result":
      return {
        type: event.success ? "tool.completed" : "tool.failed",
        payload: {
          ...basePayload(event),
          toolId: event.toolId,
          success: event.success,
          summary: event.summary,
          durationMs: event.durationMs,
          label: event.summary || `${event.toolId} ${event.success ? "completed" : "failed"}`,
        },
      };
    case "approval_required":
      return {
        type: "approval.required",
        payload: {
          ...basePayload(event),
          toolId: event.toolId,
          reason: event.reason,
          label: `Approval required: ${event.toolId}`,
        },
      };
    case "checkpoint":
      return {
        type: "agent.status",
        payload: {
          ...basePayload(event),
          kind: "checkpoint",
          gitSha: event.gitSha,
          label: `Checkpoint: ${event.label}`,
        },
      };
    case "build_start":
      return {
        type: "agent.status",
        payload: {
          ...basePayload(event),
          kind: "build_start",
          check: event.check,
          label: `Running check: ${event.check}`,
        },
      };
    case "build_result":
      return {
        type: "agent.status",
        payload: {
          ...basePayload(event),
          kind: "build_result",
          check: event.check,
          passed: event.passed,
          errorCount: event.errorCount,
          label: event.passed ? `Check passed: ${event.check}` : `Check failed: ${event.check}`,
        },
      };
    case "workspace_change": {
      const files = event.files ?? [];
      const diff = truncate(event.diff, MAX_DIFF_CHARS);
      const fileSummary =
        event.status === "changed"
          ? `${files.length} file${files.length === 1 ? "" : "s"}`
          : event.status;
      return {
        type: "agent.status",
        payload: {
          ...basePayload(event),
          kind: "workspace_change",
          status: event.status,
          fileCount: files.length,
          files: files.slice(0, MAX_FILES_LISTED),
          filesTruncated: files.length > MAX_FILES_LISTED,
          additions: event.additions,
          deletions: event.deletions,
          diff,
          diffTruncated: (event.diff?.length ?? 0) > MAX_DIFF_CHARS,
          checkpointSha: event.checkpointSha,
          label:
            event.status === "changed"
              ? `Workspace changed: ${fileSummary}` +
                (event.additions !== undefined || event.deletions !== undefined
                  ? ` (+${event.additions ?? 0}/−${event.deletions ?? 0})`
                  : "")
              : `Workspace ${event.status}`,
        },
      };
    }
    case "repair_attempt":
      return {
        type: "agent.status",
        payload: {
          ...basePayload(event),
          kind: "repair_attempt",
          attempt: event.attempt,
          maxAttempts: event.maxAttempts,
          label: `Repair attempt ${event.attempt} of ${event.maxAttempts}`,
        },
      };
    case "preview_start":
      return {
        type: "preview.started",
        payload: { ...basePayload(event), label: "Starting preview" },
      };
    case "preview_status":
      return {
        type: "agent.status",
        payload: {
          ...basePayload(event),
          kind: "preview_status",
          status: event.status,
          healthy: event.healthy,
          label: `Preview: ${event.status}`,
        },
      };
    case "preview_result":
      return {
        type: event.success ? "preview.ready" : "preview.failed",
        payload: {
          ...basePayload(event),
          success: event.success,
          previewUrl: event.previewUrl,
          error: event.error,
          label: event.success ? "Preview ready" : "Preview failed",
        },
      };
    case "deploy_start":
      return {
        type: "deployment.started",
        payload: {
          ...basePayload(event),
          environment: event.environment,
          provider: event.provider,
          label: `Deploying to ${event.environment}`,
        },
      };
    case "deploy_status":
      return {
        type: "deployment.status",
        payload: {
          ...basePayload(event),
          status: event.status,
          deploymentId: event.deploymentId,
          label: `Deploy: ${event.status}`,
        },
      };
    case "deploy_result":
      return {
        type: event.success ? "deployment.completed" : "deployment.failed",
        payload: {
          ...basePayload(event),
          success: event.success,
          productionUrl: event.productionUrl,
          error: event.error,
          label: event.success ? "Deploy completed" : "Deploy failed",
        },
      };
    case "deploy_verify":
      return {
        type: "deployment.status",
        payload: {
          ...basePayload(event),
          kind: "deploy_verify",
          url: event.url,
          success: event.success,
          detail: event.detail,
          label: event.success ? `Verified ${event.url}` : `Verification failed: ${event.url}`,
        },
      };
    case "finished":
      return {
        type: event.success === false ? "agent.failed" : "agent.completed",
        payload: {
          ...basePayload(event),
          totalSteps: event.totalSteps,
          totalDurationMs: event.totalDurationMs,
          success: event.success,
          label: `Run finished (${event.totalSteps} step${event.totalSteps === 1 ? "" : "s"})`,
        },
      };
    case "cancelled":
      return {
        type: "run.cancelled",
        payload: {
          ...basePayload(event),
          reason: event.reason,
          label: `Run cancelled: ${event.reason}`,
        },
      };
    case "model_failed":
      return {
        type: "agent.status",
        payload: {
          ...basePayload(event),
          kind: "model_failed",
          model: event.model,
          category: event.category,
          message: event.message,
          label: event.model === "all-routes"
            ? "All AI routes unavailable"
            : `Model failed: ${event.model}`,
        },
      };
    case "reasoning":
      return {
        type: "agent.status",
        payload: {
          ...basePayload(event),
          kind: "reasoning",
          label: event.summary,
        },
      };
    case "quality_verdict":
      return {
        type: "agent.status",
        payload: {
          ...basePayload(event),
          kind: "quality_verdict",
          passed: event.passed,
          missing: event.missing,
          reason: event.reason,
          label: event.passed ? "Quality gate passed" : `Quality gate failed: ${event.reason}`,
        },
      };
    // Stream noise — not persisted; the Activity feed renders
    // action-level events, not per-step chatter.
    case "phase":
    case "status":
    case "step_timing":
    case "model_routing":
    case "model_response":
    default:
      return null;
  }
}

/**
 * Build the loop's `persistEvent` hook for one run. The returned function
 * maps each loop event and appends it to the run's `action_events` log.
 * It throws on persistence failure — the loop's persistence chain catches
 * and logs so a DB failure can NEVER break the run.
 */
export function makePersistProgressEvent(input: {
  runId: string;
  userId: string;
}): (event: ProgressEvent) => Promise<void> {
  const { runId, userId } = input;
  return async (event: ProgressEvent): Promise<void> => {
    const mapped = mapProgressEventToActionEvent(event);
    if (!mapped) return;
    await appendActionEvent({
      runId,
      userId,
      type: mapped.type,
      payload: mapped.payload,
    });
  };
}
