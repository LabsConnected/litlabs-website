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

export type ProgressEvent =
  | { type: "phase"; phase: AgentLoopPhase; step: number }
  | { type: "tool_start"; toolId: string; summary: string }
  | { type: "tool_result"; toolId: string; success: boolean; summary: string; durationMs: number }
  | { type: "approval_required"; toolId: string; reason: string }
  | { type: "checkpoint"; label: string; gitSha: string }
  | { type: "build_start"; check: string }
  | { type: "build_result"; check: string; passed: boolean; errorCount?: number }
  | { type: "repair_attempt"; attempt: number; maxAttempts: number }
  | { type: "finished"; totalSteps: number; totalDurationMs: number }
  | { type: "cancelled"; reason: string }
  | { type: "model_routing"; model: string; provider: string; fallbackFrom?: string; category?: string; latencyMs?: number }
  | { type: "model_failed"; model: string; category: string; message: string }
  | { type: "reasoning"; summary: string }
  | { type: "status"; summary: string };

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
  | "finished"
  | "cancelled";

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
