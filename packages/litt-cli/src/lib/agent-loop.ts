/**
 * AgentLoop — the canonical agent execution loop for the LiTT CLI.
 *
 * Chains through the existing hardened pipeline:
 *
 *   AgentLoop
 *     ↓
 *   RuntimeSession (owns RuntimeStore, CommandExecutor, CommandRouter)
 *     ↓
 *   CommandExecutor (hardened execution boundary)
 *     ↓
 *   runCommand() security boundary (capability classification, approval)
 *     ↓
 *   ShellExecutor (structured argv, no shell string)
 *
 * Rules enforced:
 *   - No spawn/exec/execFile bypass inside the agent loop
 *   - Every tool call goes through CommandExecutor → runCommand()
 *   - runId stays constant across the entire agent run
 *   - Each tool call gets its own toolCallId
 *   - Streaming reaches the runtime event bus (tool_stream events)
 *   - Cancellation propagates: CLI/runtime → agent loop → CommandExecutor → shell
 *   - failed/cancelled/timeout are distinct outcomes
 *   - A failed tool call does NOT corrupt the next agent step
 *   - Security/approval checks cannot be bypassed because execution
 *     originated from an agent
 *   - AUTO/ACT/PLAN mode semantics are enforced by runCommand()
 *   - No secrets leak into lifecycle events (redactSecrets in runCommand)
 */

import type { RuntimeSession } from "./runtime-session.js";
import type {
  ToolResult,
  RuntimeEvent,
  StreamChunk,
  ToolStatus,
} from "@litt/agent-core";
import {
  redactSecrets,
  classifyCommand,
  type RiskAssessment,
  type MissionMode,
  RuntimeApprovalProvider,
  type ApprovalContext,
  type ApprovalRequestInput,
  type VerifiedApproval,
  toVerifiedApproval,
  type ApprovalDecision,
} from "@litt/agent-core";

// ─── Types ────────────────────────────────────────────────────────

/** A single step in the agent loop — one tool call. */
export interface AgentStep {
  /** Step number (0-based) */
  index: number;
  /** Tool call ID — unique per step within a run */
  toolCallId: string;
  /** Command to execute */
  command: string;
  /** Arguments for the command */
  args: string[];
  /** Human-readable label */
  label?: string;
  /** Timeout in milliseconds */
  timeoutMs?: number;
}

/** The result of a single agent step. */
export interface AgentStepResult {
  step: AgentStep;
  result: ToolResult;
  runId: string;
  toolCallId: string;
  status: ToolStatus;
  durationMs: number;
  /** Risk assessment for this step */
  risk: RiskAssessment;
  /** Whether this step was approved (if approval was required) */
  approved: boolean;
}

/** The final result of an agent run. */
export interface AgentRunResult {
  runId: string;
  steps: AgentStepResult[];
  /** The step that failed/cancelled/timed out, if any */
  failureStep: AgentStepResult | null;
  /** Overall status: success if all steps succeeded, otherwise the failing status */
  status: ToolStatus;
  /** Total duration in milliseconds */
  totalDurationMs: number;
}

/** Callback for streaming events from the agent loop. */
export type AgentStreamHandler = (chunk: StreamChunk) => void;

/** Callback for lifecycle events from the agent loop. */
export type AgentEventHandler = (event: RuntimeEvent) => void;

/** Callback for approval requests — must return true to approve, false to deny. */
export type AgentApprovalHandler = (
  step: AgentStep,
  risk: RiskAssessment,
) => Promise<boolean>;

/** Options for running the agent loop. */
export interface AgentLoopOptions {
  /** The RuntimeSession to use (owns CommandExecutor, RuntimeStore, etc.) */
  session: RuntimeSession;
  /** Mission mode (PLAN/ACT/AUTO) — enforced by runCommand() */
  mode?: MissionMode;
  /** Stream handler for live stdout/stderr */
  onStream?: AgentStreamHandler;
  /** Event handler for lifecycle events */
  onEvent?: AgentEventHandler;
  /** Approval handler — if not provided, dangerous commands are denied */
  onApprovalRequired?: AgentApprovalHandler;
  /** Tenant ID for approval context */
  tenantId?: string;
  /** User ID for approval context */
  userId?: string;
  /** Project ID for approval context */
  projectId?: string;
}

// ─── AgentLoop ────────────────────────────────────────────────────

export class CliAgentLoop {
  private readonly session: RuntimeSession;
  private readonly mode: MissionMode;
  private readonly onStream: AgentStreamHandler | null;
  private readonly onEvent: AgentEventHandler | null;
  private readonly onApprovalRequired: AgentApprovalHandler | null;
  private readonly approvalProvider: RuntimeApprovalProvider;
  private readonly tenantId: string;
  private readonly userId: string;
  private readonly projectId: string;

  /** The current run ID — stays constant across all steps */
  private currentRunId: string | null = null;
  /** Whether the loop has been cancelled */
  private cancelled = false;
  /** All step results from the current run */
  private stepResults: AgentStepResult[] = [];

  constructor(options: AgentLoopOptions) {
    this.session = options.session;
    this.mode = options.mode ?? "act";
    this.onStream = options.onStream ?? null;
    this.onEvent = options.onEvent ?? null;
    this.onApprovalRequired = options.onApprovalRequired ?? null;
    this.approvalProvider = new RuntimeApprovalProvider();
    this.tenantId = options.tenantId ?? "cli-tenant";
    this.userId = options.userId ?? "cli-user";
    this.projectId = options.projectId ?? "cli-project";
  }

  // ─── Public API ──────────────────────────────────────────────────

  /**
   * Run a sequence of steps through the agent loop.
   *
   * Each step goes through:
   *   1. Risk classification (classifyCommand)
   *   2. Approval check (if elevated/dangerous and mode requires it)
   *   3. CommandExecutor.execute() (hardened boundary)
   *   4. Streaming + lifecycle events
   *
   * The runId is generated once and stays constant across all steps.
   * Each step gets its own toolCallId.
   *
   * If a step fails, is cancelled, or times out, the loop stops and
   * returns the result. A failed step does NOT corrupt subsequent steps
   * — the loop simply stops and reports the failure.
   */
  async run(steps: AgentStep[]): Promise<AgentRunResult> {
    if (steps.length === 0) {
      return {
        runId: this.currentRunId ?? "run_empty",
        steps: [],
        failureStep: null,
        status: "success",
        totalDurationMs: 0,
      };
    }

    const t0 = Date.now();
    this.cancelled = false;
    this.stepResults = [];

    // Generate a single runId for the entire agent run
    this.currentRunId = `run_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    let failureStep: AgentStepResult | null = null;

    for (let i = 0; i < steps.length; i++) {
      if (this.cancelled) {
        // Loop was cancelled — stop immediately
        break;
      }

      const step = { ...steps[i], index: i };
      const stepResult = await this.executeStep(step);

      this.stepResults.push(stepResult);

      if (stepResult.status !== "success") {
        failureStep = stepResult;
        break; // Stop on first failure — but don't corrupt state
      }
    }

    const totalDurationMs = Date.now() - t0;
    const status: ToolStatus = failureStep?.status ?? (this.cancelled ? "cancelled" : "success");

    return {
      runId: this.currentRunId,
      steps: this.stepResults,
      failureStep,
      status,
      totalDurationMs,
    };
  }

  /**
   * Cancel the current agent run.
   * Propagates to CommandExecutor → ShellExecutor → process tree kill.
   */
  async cancel(): Promise<number[]> {
    this.cancelled = true;
    // Cancel the active tool execution
    const killedPids = await this.session.cancel(this.currentRunId ?? undefined);
    return killedPids;
  }

  /**
   * Get the current run ID (constant across all steps).
   */
  getRunId(): string | null {
    return this.currentRunId;
  }

  /**
   * Check if the loop is currently running.
   */
  isRunning(): boolean {
    return this.session.isRunning();
  }

  // ─── Internal ────────────────────────────────────────────────────

  /**
   * Execute a single step through the hardened pipeline.
   */
  private async executeStep(step: AgentStep): Promise<AgentStepResult> {
    const toolCallId = `tc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    // 1. Risk classification — no bypass for agent-originated execution
    const risk = classifyCommand(step.command, step.args, this.session.getState().project?.root ?? process.cwd());

    // 2. Approval check — if the command is elevated/dangerous and mode requires it
    const approved = await this.checkApproval(step, risk);
    if (!approved) {
      return {
        step,
        result: {
          status: "failed",
          success: false,
          message: `Approval denied for ${risk.level} command: ${step.command} ${step.args.join(" ")}`,
          data: { risk, reason: "approval_denied" },
        },
        runId: this.currentRunId!,
        toolCallId,
        status: "failed",
        durationMs: 0,
        risk,
        approved: false,
      };
    }

    // 3. Execute through CommandExecutor (the hardened boundary)
    //    This goes through: CommandExecutor → runCommand() → ShellExecutor
    //    No spawn/exec/execFile bypass — everything goes through this path.
    //    We use session.getExecutor() directly to pass the agent run's
    //    runId (constant across all steps) and per-step toolCallId.
    const executor = this.session.getExecutor();
    const execResult = await executor.execute(step.command, step.args, {
      cwd: this.session.getState().project?.root ?? process.cwd(),
      mode: this.mode,
      runId: this.currentRunId!,
      toolCallId,
      label: step.label ?? step.command,
      timeoutMs: step.timeoutMs,
      onStream: this.onStream ?? undefined,
    });

    return {
      step,
      result: execResult.result,
      runId: execResult.runId,
      toolCallId: execResult.toolCallId,
      status: execResult.status,
      durationMs: execResult.durationMs,
      risk,
      approved: true,
    };
  }

  /**
   * Check if a step requires approval and handle it.
   *
   * This integrates with the RuntimeApprovalProvider from SEC-4.
   * In AUTO mode, dangerous commands are denied (no bypass).
   * In PLAN mode, all mutations are rejected by runCommand() already.
   * In ACT mode, elevated commands require approval.
   */
  private async checkApproval(step: AgentStep, risk: RiskAssessment): Promise<boolean> {
    // Safe commands never need approval
    if (risk.level === "safe") {
      return true;
    }

    // PLAN mode: mutations are rejected by runCommand() — but we also
    // reject here to avoid even attempting the execution.
    if (this.mode === "plan" && risk.mutating) {
      return false;
    }

    // AUTO mode: dangerous commands are always denied (no bypass)
    if (this.mode === "auto" && risk.level === "dangerous") {
      return false;
    }

    // ACT mode: elevated commands need approval
    // AUTO mode: elevated commands are allowed (auto-approve)
    if (this.mode === "auto" && risk.level === "elevated") {
      return true; // auto-approve elevated in AUTO mode
    }

    // ACT mode with elevated/dangerous: need explicit approval
    if (this.onApprovalRequired) {
      // Use the RuntimeApprovalProvider for cryptographic binding
      const approvalInput: ApprovalRequestInput = {
        tenantId: this.tenantId,
        userId: this.userId,
        runId: this.currentRunId!,
        projectId: this.projectId,
        toolId: step.command,
        operation: {
          tenantId: this.tenantId,
          userId: this.userId,
          actorId: this.userId,
          runId: this.currentRunId!,
          toolId: step.command,
          action: `${step.command} ${step.args.join(" ")}`,
          resourceScope: [`workspace:${this.projectId}`],
          environment: "development",
          normalizedInput: { command: step.command, args: step.args, cwd: process.cwd() },
        },
        risk: risk.level === "dangerous" ? "critical" : "high",
        scope: "once",
      };

      const approvalContext: ApprovalContext = {
        executionMode: this.mode,
        interaction: "interactive",
        tenantId: this.tenantId,
      };

      const record = await this.approvalProvider.requestApproval(approvalInput, approvalContext);

      if (record.status === "denied") {
        return false;
      }

      if (record.status === "pending") {
        // Ask the human via the callback
        const humanApproved = await this.onApprovalRequired(step, risk);
        const decision: ApprovalDecision = {
          approvalId: record.approvalId,
          decision: humanApproved ? "approve" : "deny",
          approverActorId: this.userId,
          approverUserId: this.userId,
        };

        const decided = this.approvalProvider.decide(decision);

        if (decided.status !== "approved") {
          return false;
        }

        // Verify the approval cryptographically
        const verification = this.approvalProvider.verifyApproval(
          decided,
          {
            tenantId: this.tenantId,
            userId: this.userId,
            actorId: this.userId,
            runId: this.currentRunId!,
            toolId: step.command,
            action: `${step.command} ${step.args.join(" ")}`,
            resourceScope: [`workspace:${this.projectId}`],
            environment: "development",
            normalizedInput: { command: step.command, args: step.args, cwd: process.cwd() },
          },
          {
            tenantId: this.tenantId,
            userId: this.userId,
            runId: this.currentRunId!,
          },
        );

        if (verification.status !== "valid") {
          return false;
        }

        // Promote to VerifiedApproval (the only way to get one)
        try {
          const verified: VerifiedApproval = toVerifiedApproval(verification);
          // verified is now the cryptographic proof — but we don't need
          // to pass it to CommandExecutor because runCommand() does its
          // own approval check via the approvalProvider option.
          // The important thing is that we went through the full
          // approval chain here.
          void verified; // verified approval confirmed
        } catch {
          return false;
        }
      }

      return true;
    }

    // No approval handler provided:
    // - dangerous → deny (fail closed)
    // - elevated in ACT mode → deny (fail closed)
    if (risk.level === "dangerous") {
      return false;
    }
    if (this.mode === "act" && risk.level === "elevated") {
      return false;
    }

    // Default: allow (shouldn't reach here for dangerous/elevated in ACT)
    return true;
  }
}

// ─── Helper: create an agent loop from a RuntimeSession ───────────

export function createCliAgentLoop(options: AgentLoopOptions): CliAgentLoop {
  return new CliAgentLoop(options);
}

// ─── Helper: redact secrets from step results (defense-in-depth) ──

/**
 * Redact secrets from a step result's output.
 * This is in addition to the redaction in runCommand() — defense in depth.
 */
export function redactStepResult(result: AgentStepResult): AgentStepResult {
  const data = result.result.data ?? {};
  return {
    ...result,
    result: {
      ...result.result,
      message: redactSecrets(result.result.message),
      data: {
        ...data,
        stdout: data.stdout ? redactSecrets(data.stdout as string) : undefined,
        stderr: data.stderr ? redactSecrets(data.stderr as string) : undefined,
      },
    },
  };
}
