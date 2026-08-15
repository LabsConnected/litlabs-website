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
  ExecutionGateway,
  ToolRegistry,
  createShellExecutor,
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
   *
   * The gateway OWNS the full approval flow. The CLI does NOT do its own
   * approval check — it passes the interactive callback to the gateway,
   * which calls it via SEC-4's requestApproval() → decide() → verifyApproval().
   */
  private async executeStep(step: AgentStep): Promise<AgentStepResult> {
    const toolCallId = `tc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    // Risk classification for the step result (informational — the gateway
    // does its own classification internally)
    const risk = classifyCommand(step.command, step.args, this.session.getState().project?.root ?? process.cwd());

    // Execute through the ExecutionGateway (the ONE canonical authority)
    // This goes through: ExecutionGateway → CommandExecutor → runCommand() → ShellExecutor
    // No spawn/exec/execFile bypass — everything goes through this path.
    // The gateway enforces identity, grant, policy, approval, and credential
    // checks before dispatching to CommandExecutor.
    //
    // For shell commands, we use the "project.run" tool which the gateway
    // routes through CommandExecutor → runCommand() (the hardened boundary).
    //
    // Approval: the gateway calls onApprovalRequired() (passed in the
    // constructor) when policy requires it. No preApproved bypass.
    const gateway = this.getOrCreateGateway();
    const gwResult = await gateway.execute({
      toolId: "project.run",
      inputs: { command: step.command, args: step.args },
      cwd: this.session.getState().project?.root ?? process.cwd(),
      mode: this.mode,
      identity: {
        tenantId: this.tenantId,
        userId: this.userId,
        actorId: this.userId,
        trusted: false, // CLI agent loop is untrusted — must go through gateway
        interaction: "interactive",
      },
      runId: this.currentRunId!,
      toolCallId,
      timeoutMs: step.timeoutMs,
      onStream: this.onStream ?? undefined,
    });

    return {
      step,
      result: gwResult.result,
      runId: gwResult.runId,
      toolCallId: gwResult.toolCallId,
      status: gwResult.result.status,
      durationMs: gwResult.durationMs,
      risk,
      approved: gwResult.approved,
    };
  }

  // ─── Gateway management ─────────────────────────────────────────

  private _gateway: ExecutionGateway | null = null;

  private getOrCreateGateway(): ExecutionGateway {
    if (this._gateway) return this._gateway;
    // The gateway needs a ShellExecutor and ToolRegistry.
    // The session owns the CommandExecutor which internally has the shell.
    // We create a new shell for the gateway's ToolRegistry (for non-project.run
    // tools), but project.run goes through the session's CommandExecutor.
    const cwd = this.session.getState().project?.root ?? process.cwd();
    this._gateway = new ExecutionGateway({
      tools: new ToolRegistry(),
      shell: createShellExecutor(cwd),
      executor: this.session.getExecutor(),
      projectId: this.projectId,
      // Pass the CLI's interactive approval callback to the gateway.
      // The gateway OWNS the full SEC-4 approval flow:
      //   requestApproval() → onApprovalRequired() → decide() → verifyApproval() → VerifiedApproval
      // The CLI does NOT do its own approval check — the gateway is the sole authority.
      onApprovalRequired: this.onApprovalRequired
        ? async (request, risk) => {
            // Adapt the gateway's (ExecutionRequest, RiskAssessment) signature
            // to the CLI's (AgentStep, RiskAssessment) signature
            const step: AgentStep = {
              index: -1,
              toolCallId: request.toolCallId ?? "",
              command: typeof request.inputs.command === "string" ? request.inputs.command : "",
              args: Array.isArray(request.inputs.args)
                ? request.inputs.args.filter((a): a is string => typeof a === "string")
                : [],
            };
            return this.onApprovalRequired!(step, risk as RiskAssessment);
          }
        : null,
    });
    return this._gateway;
  }

  /**
   * Check if a step requires approval and handle it.
   *
   * REMOVED: checkApproval() — the gateway now OWNS the full SEC-4
   * approval flow. The CLI passes its interactive callback to the
   * gateway constructor, which calls it via:
   *   requestApproval() → onApprovalRequired() → decide() → verifyApproval()
   *   → VerifiedApproval → capsule.approval
   * No boolean bypass. No second approval path.
   */
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
