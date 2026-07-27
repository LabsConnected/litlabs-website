import "server-only";
import { getSupabaseAdmin } from "@/lib/supabase";
import type { VisualBuildStatus } from "./types";

export type VisualBuildLogLevel = "info" | "warn" | "error" | "success";

export type VisualBuildEvent =
  | "build_queued"
  | "plan_created"
  | "project_assets_searched"
  | "stock_assets_searched"
  | "asset_inspected"
  | "asset_rejected"
  | "asset_stored"
  | "asset_selected"
  | "assets_generated"
  | "manifest_saved"
  | "build_started"
  | "workspace_file_written"
  | "preview_ready"
  | "preview_failed"
  | "capture_started"
  | "capture_completed"
  | "capture_failed"
  | "review_completed"
  | "repair_proposed"
  | "repair_applied"
  | "repair_skipped"
  | "completion_gate_passed"
  | "completion_gate_failed"
  | "build_complete"
  | "build_partial"
  | "build_failed";

export interface VisualBuildLogInput {
  buildId: string;
  projectId: string;
  missionId: string;
  userId: string;
  stage: VisualBuildStatus | string;
  level?: VisualBuildLogLevel;
  event: VisualBuildEvent;
  payload?: Record<string, unknown>;
}

/**
 * Emit a visual build event to the visual_build_logs table.
 * Silent fail — logging must never break the orchestrator.
 */
export async function emitVisualBuildEvent(input: VisualBuildLogInput): Promise<void> {
  try {
    const admin = getSupabaseAdmin();
    if (!admin) return;

    await admin.from("visual_build_logs").insert({
      build_id: input.buildId,
      project_id: input.projectId,
      mission_id: input.missionId,
      user_id: input.userId,
      stage: input.stage,
      level: input.level ?? "info",
      event: input.event,
      payload: input.payload ?? {},
    });
  } catch {
    // Silent fail — observability must never break the build pipeline
  }
}

/**
 * Convenience helper that captures the common "stage transition" pattern.
 */
export function stageEvent(
  buildId: string,
  projectId: string,
  missionId: string,
  userId: string,
  stage: VisualBuildStatus,
  event: VisualBuildEvent,
  payload?: Record<string, unknown>,
): VisualBuildLogInput {
  return { buildId, projectId, missionId, userId, stage, event, level: "info", payload };
}
