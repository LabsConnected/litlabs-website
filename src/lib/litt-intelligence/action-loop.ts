/**
 * Planning and Action Execution Loop
 *
 * Converts recommendations into controlled action plans and executes
 * them through the tool registry with observation, verification, and
 * repair cycles.
 *
 * Execution phases:
 *   understand → scan → research → plan → awaiting_approval →
 *   executing → observing → verifying → repairing → completed/failed
 *
 * LiTT must not claim an action happened merely because it generated
 * instructions. Every step must be executed, observed, and verified.
 */

import { randomUUID } from "crypto";
import type {
  LiTTActionPlan,
  LiTTActionStep,
  Assumption,
  ActionPhase,
  ToolRisk,
} from "./types";
import { toolRegistry } from "./tool-registry";

// ─── Plan builder ───────────────────────────────────────────────

export class ActionPlanner {
  /**
   * Create an action plan from a goal and a set of steps.
   * Assumptions are explicitly recorded — they must be verified
   * before execution.
   */
  createPlan(
    userId: string,
    projectId: string,
    goal: string,
    steps: Omit<LiTTActionStep, "id" | "approvalStatus">[],
    assumptions: Omit<Assumption, "id">[] = [],
  ): LiTTActionPlan {
    const planId = `plan-${randomUUID()}`;
    const now = new Date().toISOString();

    const stepsWithIds: LiTTActionStep[] = steps.map((step) => ({
      ...step,
      id: `step-${randomUUID()}`,
      approvalStatus: step.risk === "none" || step.risk === "low" ? "not_required" : "pending",
    }));

    const assumptionsWithIds: Assumption[] = assumptions.map((a) => ({
      ...a,
      id: `assume-${randomUUID()}`,
    }));

    // Determine plan risk from steps
    const planRisk = this.calculatePlanRisk(stepsWithIds);

    return {
      id: planId,
      userId,
      projectId,
      goal,
      assumptions: assumptionsWithIds,
      steps: stepsWithIds,
      risk: planRisk,
      approvalRequired: planRisk === "high" || planRisk === "critical",
      createdAt: now,
      phase: "plan",
    };
  }

  private calculatePlanRisk(steps: LiTTActionStep[]): "low" | "medium" | "high" | "critical" {
    if (steps.some((s) => s.risk === "critical")) return "critical";
    if (steps.some((s) => s.risk === "high")) return "high";
    if (steps.some((s) => s.risk === "medium")) return "medium";
    return "low";
  }
}

// ─── Action executor ────────────────────────────────────────────

export interface ExecutionEvent {
  stepId: string;
  phase: ActionPhase;
  timestamp: string;
  detail: string;
  success?: boolean;
}

export class ActionExecutor {
  private events: ExecutionEvent[] = [];
  private listeners = new Set<(event: ExecutionEvent) => void>();

  /**
   * Execute an action plan step by step.
   * Pauses at awaiting_approval when approval is required.
   */
  async execute(
    plan: LiTTActionPlan,
    options: {
      hasApproval?: boolean;
      availableCapabilities?: string[];
    } = {},
  ): Promise<{ plan: LiTTActionPlan; events: ExecutionEvent[] }> {
    const updatedPlan: LiTTActionPlan = { ...plan, phase: "executing" };
    const events: ExecutionEvent[] = [];

    // Check approval
    if (updatedPlan.approvalRequired && !options.hasApproval) {
      updatedPlan.phase = "awaiting_approval";
      const event: ExecutionEvent = {
        stepId: "plan",
        phase: "awaiting_approval",
        timestamp: new Date().toISOString(),
        detail: "Plan requires approval before execution",
      };
      events.push(event);
      this.emit(event);
      return { plan: updatedPlan, events };
    }

    // Execute steps in dependency order
    const executed = new Set<string>();
    const maxIterations = updatedPlan.steps.length * 3; // Allow retries

    for (let iteration = 0; iteration < maxIterations; iteration++) {
      let progress = false;

      for (const step of updatedPlan.steps) {
        if (executed.has(step.id)) continue;
        if (step.actualStatus === "success" || step.actualStatus === "skipped") {
          executed.add(step.id);
          continue;
        }

        // Check dependencies
        const depsMet = step.dependencies.every((dep) => executed.has(dep));
        if (!depsMet) continue;

        progress = true;

        // Check attempts
        const attempts = step.attempts ?? 0;
        if (attempts >= step.maxAttempts) {
          step.actualStatus = "failed";
          const event: ExecutionEvent = {
            stepId: step.id,
            phase: "failed",
            timestamp: new Date().toISOString(),
            detail: `Step exceeded max attempts (${step.maxAttempts})`,
            success: false,
          };
          events.push(event);
          this.emit(event);
          executed.add(step.id);
          continue;
        }

        // Execute the step
        const result = await this.executeStep(step, options);
        step.attempts = attempts + 1;
        step.actualOutput = result.output;
        step.actualStatus = result.status;

        const event: ExecutionEvent = {
          stepId: step.id,
          phase: result.status === "success" ? "completed" : "failed",
          timestamp: new Date().toISOString(),
          detail: result.detail,
          success: result.status === "success",
        };
        events.push(event);
        this.emit(event);

        if (result.status === "success") {
          executed.add(step.id);
        } else if (result.status === "failed") {
          // Try repair if verification action is defined
          if (step.verificationAction && attempts < step.maxAttempts - 1) {
            const repairEvent: ExecutionEvent = {
              stepId: step.id,
              phase: "repairing",
              timestamp: new Date().toISOString(),
              detail: `Attempting repair: ${step.verificationAction}`,
            };
            events.push(repairEvent);
            this.emit(repairEvent);
            updatedPlan.phase = "repairing";
          } else {
            executed.add(step.id);
          }
        }
      }

      if (!progress) break;
    }

    // Determine final phase
    const allSucceeded = updatedPlan.steps.every((s) => s.actualStatus === "success");
    const anyFailed = updatedPlan.steps.some((s) => s.actualStatus === "failed");

    if (allSucceeded) {
      updatedPlan.phase = "completed";
    } else if (anyFailed) {
      updatedPlan.phase = "failed";
    }

    return { plan: updatedPlan, events };
  }

  private async executeStep(
    step: LiTTActionStep,
    options: { hasApproval?: boolean; availableCapabilities?: string[] },
  ): Promise<{ status: "success" | "failed"; output?: string; detail: string }> {
    const result = await toolRegistry.execute(step.toolId, step.inputs, {
      hasApproval: options.hasApproval,
      availableCapabilities: options.availableCapabilities,
    });

    if (result.ok) {
      return {
        status: "success",
        output: JSON.stringify(result.result),
        detail: `Step executed successfully`,
      };
    } else {
      return {
        status: "failed",
        detail: result.error,
      };
    }
  }

  /**
   * Subscribe to execution events.
   */
  onEvent(listener: (event: ExecutionEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(event: ExecutionEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // non-fatal
      }
    }
  }

  /**
   * Get all events from the current execution.
   */
  getEvents(): ExecutionEvent[] {
    return [...this.events];
  }

  /**
   * Clear events — used between executions.
   */
  reset(): void {
    this.events = [];
  }
}

// ─── Verification ───────────────────────────────────────────────

/**
 * Verify that an action actually happened.
 * LiTT must not claim an action happened merely because it generated
 * instructions — it must check the real result.
 */
export function verifyStepResult(
  step: LiTTActionStep,
  expectedPattern?: RegExp,
): { verified: boolean; reason: string } {
  if (step.actualStatus !== "success") {
    return {
      verified: false,
      reason: `Step status is "${step.actualStatus}", not "success"`,
    };
  }

  if (!step.actualOutput) {
    return {
      verified: false,
      reason: "No output recorded — cannot verify result",
    };
  }

  if (expectedPattern && !expectedPattern.test(step.actualOutput)) {
    return {
      verified: false,
      reason: `Output does not match expected pattern: ${expectedPattern.source}`,
    };
  }

  return {
    verified: true,
    reason: "Step executed successfully and output matches expectations",
  };
}

/**
 * Verify an entire plan completed successfully.
 */
export function verifyPlanCompletion(plan: LiTTActionPlan): {
  verified: boolean;
  completedSteps: number;
  failedSteps: number;
  pendingSteps: number;
  reason: string;
} {
  const completed = plan.steps.filter((s) => s.actualStatus === "success").length;
  const failed = plan.steps.filter((s) => s.actualStatus === "failed").length;
  const pending = plan.steps.filter((s) => !s.actualStatus || s.actualStatus === "pending").length;

  if (failed > 0) {
    return {
      verified: false,
      completedSteps: completed,
      failedSteps: failed,
      pendingSteps: pending,
      reason: `${failed} step(s) failed`,
    };
  }

  if (pending > 0) {
    return {
      verified: false,
      completedSteps: completed,
      failedSteps: failed,
      pendingSteps: pending,
      reason: `${pending} step(s) pending`,
    };
  }

  return {
    verified: true,
    completedSteps: completed,
    failedSteps: 0,
    pendingSteps: 0,
    reason: "All steps completed successfully",
  };
}
