/**
 * Failure Report — P0-4: Useful Failure Reporting.
 *
 * Observed real UX:
 *   × Failed
 *   v View
 *   with no useful failure reason.
 *
 * A failed run must immediately show:
 *   FAILED
 *   Task: <task>
 *   Reason: <actual error>
 *   Last successful step: <step>
 *   Recommended next action: <action>
 *
 * Pure functions — no React, no Ink. Testable in node.
 */

/** A structured failure report. */
export interface FailureReport {
  /** The task that was being attempted. */
  task: string;
  /** The actual error message. */
  reason: string;
  /** The last step that succeeded before the failure. */
  lastSuccessfulStep: string | null;
  /** A recommended next action. */
  recommendedNextAction: string;
  /** The run ID (for reference). */
  runId: string | null;
  /** When the failure occurred (epoch ms). */
  failedAt: number;
  /** The step or command that failed (e.g. the test suite, a file edit). */
  failedStep?: string | null;
  /** The command that was running when the failure occurred, if known. */
  commandExcerpt?: string | null;
  /** A short excerpt of the actual output (stdout/stderr) that proves the failure. */
  outputExcerpt?: string | null;
}

/**
 * Build a human-readable failure report string.
 *
 * Format:
 *   FAILED
 *
 *   Task:
 *     <task>
 *
 *   Failed step:
 *     <step> (or "none")
 *
 *   Reason:
 *     <reason>
 *
 *   Command/output excerpt:
 *     <excerpt> (or "none")
 *
 *   Last successful step:
 *     <step>  (or "none")
 *
 *   Recommended next action:
 *     <action>
 */
export function formatFailureReport(report: FailureReport): string {
  const lines: string[] = [
    "FAILED",
    "",
    `Task:`,
    `  ${report.task}`,
    "",
    `Failed step:`,
    `  ${report.failedStep ?? "none"}`,
    "",
    `Reason:`,
    `  ${report.reason}`,
  ];

  // Command and output are distinct, complementary evidence — a failure
  // can carry both (the command that ran AND the stdout/stderr that
  // proves it failed), so both render under the shared heading.
  const excerptParts = [report.commandExcerpt, report.outputExcerpt].filter(
    (part): part is string => !!part,
  );
  lines.push("", `Command/output excerpt:`);
  if (excerptParts.length > 0) {
    for (const part of excerptParts) lines.push(`  ${part}`);
  } else {
    lines.push(`  none`);
  }

  lines.push(
    "",
    `Last successful step:`,
    `  ${report.lastSuccessfulStep ?? "none"}`,
    "",
    `Recommended next action:`,
    `  ${report.recommendedNextAction}`,
  );

  if (report.runId) {
    lines.push("", `Run ID: ${report.runId}`);
  }

  return lines.join("\n");
}

/**
 * Derive a recommended next action from the failure reason.
 *
 * Maps common failure patterns to actionable suggestions.
 */
export function deriveNextAction(reason: string): string {
  const lower = reason.toLowerCase();

  if (lower.includes("plan_mode_rejected") || lower.includes("plan mode")) {
    return "Switch to ACT mode (Tab) to perform mutations, or revise the plan to be read-only.";
  }
  if (lower.includes("approval") && lower.includes("denied")) {
    return "Re-run with approval, or adjust the approval policy in settings.";
  }
  if (lower.includes("timeout") || lower.includes("timed out")) {
    return "Increase the timeout or break the task into smaller steps.";
  }
  if (lower.includes("not found") || lower.includes("enoent")) {
    return "Check that the file or command exists and the path is correct.";
  }
  if (lower.includes("permission") || lower.includes("eacces") || lower.includes("403")) {
    return "Check file permissions or authentication credentials.";
  }
  if (lower.includes("network") || lower.includes("econnrefused") || lower.includes("fetch")) {
    return "Check network connectivity and endpoint availability. Try: litt doctor";
  }
  if (lower.includes("type") && lower.includes("error")) {
    return "Fix the type error, then rebuild: pnpm build";
  }
  if (lower.includes("build") && lower.includes("fail")) {
    return "Fix the build error, then retry. Run: pnpm build";
  }
  if (lower.includes("test") && lower.includes("fail")) {
    return "Fix the failing test, then retry. Run: pnpm exec vitest run";
  }
  if (lower.includes("git") && lower.includes("conflict")) {
    return "Resolve the merge conflict, then retry.";
  }
  if (lower.includes("out of memory") || lower.includes("oom")) {
    return "Reduce the task scope or increase available memory.";
  }
  if (lower.includes("cancelled")) {
    return "Re-run the task if needed. The previous run was cancelled.";
  }

  return "Review the error above and the run logs (litt run logs <id>) for details.";
}

/**
 * Build a FailureReport from a run's terminal state.
 *
 * @param task The task text
 * @param reason The error message from the runtime
 * @param lastSuccessfulStep The last step that succeeded (or null)
 * @param runId The run ID (or null)
 * @param failedStep The step/command that failed (or null)
 * @param commandExcerpt The command that produced the failure (or null)
 * @param outputExcerpt A short output excerpt that proves the failure (or null)
 */
export function buildFailureReport(
  task: string,
  reason: string,
  lastSuccessfulStep: string | null,
  runId: string | null,
  failedStep: string | null = null,
  commandExcerpt: string | null = null,
  outputExcerpt: string | null = null,
): FailureReport {
  return {
    task,
    failedStep,
    reason: reason || "Unknown error",
    commandExcerpt,
    outputExcerpt,
    lastSuccessfulStep,
    recommendedNextAction: deriveNextAction(reason),
    runId,
    failedAt: Date.now(),
  };
}
