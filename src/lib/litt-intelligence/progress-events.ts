/**
 * Progress Events — structured action-level events for Studio UI.
 *
 * Events describe tool actions and results, NOT chain-of-thought.
 * The Studio UI renders these as a progress timeline:
 *   ✓ Inspected repository
 *   ✓ Found dashboard components
 *   ● Running tests...
 *   ○ Production build
 */

import type { StructuredDiagnostic } from "./diagnostic-parser";

export type ProgressEvent =
  | { type: "phase"; phase: AgentLoopPhase; step: number }
  | { type: "tool_start"; toolId: string; summary: string }
  | { type: "tool_result"; toolId: string; success: boolean; summary: string; durationMs: number }
  | { type: "approval_required"; toolId: string; reason: string }
  | { type: "checkpoint"; label: string; gitSha: string; kind?: "before" | "after" }
  | { type: "build_start"; check: string }
  | { type: "build_result"; check: string; passed: boolean; errorCount?: number; diagnostics?: StructuredDiagnostic[] }
  | { type: "workspace_change"; status: "changed" | "unchanged" | "unknown"; files?: string[]; diff?: string; additions?: number; deletions?: number; checkpointSha?: string; unknownReason?: string }
  | { type: "repair_attempt"; attempt: number; maxAttempts: number }
  | { type: "preview_start" }
  | { type: "preview_status"; status: string; healthy?: boolean }
  | { type: "preview_result"; success: boolean; previewUrl?: string | null; error?: string }
  | { type: "deploy_start"; environment: string; provider?: string }
  | { type: "deploy_status"; status: string; deploymentId?: string }
  | { type: "deploy_result"; success: boolean; productionUrl?: string | null; error?: string }
  | { type: "deploy_verify"; url: string; success: boolean; detail?: string }
  | { type: "finished"; totalSteps: number; totalDurationMs: number; success?: boolean }
  | { type: "cancelled"; reason: string }
  | { type: "model_routing"; model: string; provider: string; fallbackFrom?: string; category?: string; latencyMs?: number; canonicalId?: string; configSource?: "code-default" | "env-override" | "registry" }
  | { type: "build_model_incompatible"; canonicalId: string; provider: string; stepsObserved: number; zeroWriteSteps: number; reason: string }
  | { type: "step_timing"; step: number; stepDurationMs: number; elapsedMs: number }
  | { type: "model_response"; provider: string; model: string; finishReason: string; contentType: string; contentLength: number; messageKeys: string[]; toolCalls: Array<{ name: string; idPresent: boolean; argumentsJsonValid: boolean; argumentKeys: string[]; argumentLength: number }> }
  | { type: "model_failed"; model: string; category: string; message: string }
  | { type: "route_plan"; routes: Array<{ provider: string; models: string[] }>; excluded: Array<{ provider: string; reason: string }> }
  | { type: "reasoning"; summary: string }
  | { type: "status"; summary: string }
  | { type: "quality_verdict"; passed: boolean; missing: string[]; reason: string; designPasses: number };

export type AgentLoopPhase =
  | "idle"
  | "inspect"
  | "call_llm"
  | "validate"
  | "permission"
  | "execute"
  | "observe"
  | "check_limits"
  | "build_fix"
  | "preview"
  | "deploy"
  | "quality_redesign"
  | "quality_stage_declaration"
  | "finished"
  | "cancelled";

/**
 * Round 14 — what counts as PROGRESS for stall detection.
 *
 * The resume watchdog's stall clock used to refresh on EVERY loop
 * event. A wrap-up route-retry storm (route_plan → model_routing →
 * model_failed, repeated for minutes while every provider route
 * fails) therefore looked exactly like progress, and the watchdog
 * could never fire — the run sat "alive" while doing nothing. The
 * 2026-11-17 lion proof's tail died in precisely that storm.
 *
 * Substantive progress = the loop's state actually advancing: a
 * phase change, a tool starting or returning, a workspace change,
 * a checkpoint, a build/preview/deploy step, a quality verdict, a
 * repair attempt, an approval gate, or the run finishing. Model
 * routing/response/failure bookkeeping, step timings, reasoning
 * summaries, and free-text status narration are NOT progress — they
 * can all be produced by a loop that is going nowhere.
 */
const SUBSTANTIVE_PROGRESS_TYPES: ReadonlySet<ProgressEvent["type"]> = new Set([
  "phase",
  "tool_start",
  "tool_result",
  "approval_required",
  "checkpoint",
  "build_start",
  "build_result",
  "workspace_change",
  "repair_attempt",
  "preview_start",
  "preview_status",
  "preview_result",
  "deploy_start",
  "deploy_status",
  "deploy_result",
  "deploy_verify",
  "quality_verdict",
  "finished",
  "cancelled",
]);

export function isSubstantiveProgressEvent(event: ProgressEvent): boolean {
  return SUBSTANTIVE_PROGRESS_TYPES.has(event.type);
}

export class ProgressEmitter {
  private listeners: Array<(event: ProgressEvent) => void> = [];

  constructor(private onEvent?: (event: ProgressEvent) => void) {
    if (onEvent) this.listeners.push(onEvent);
  }

  emit(event: ProgressEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // listener errors are non-fatal
      }
    }
  }

  on(listener: (event: ProgressEvent) => void): void {
    this.listeners.push(listener);
  }
}
