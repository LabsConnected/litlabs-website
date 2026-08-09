/**
 * Build-Fix Loop — discovers package manager + scripts, runs applicable
 * checks, and if checks fail, feeds errors back to the agent loop for
 * repair attempts.
 *
 * Discovery: reads package.json via workspace transport to find the
 * package manager and available scripts. Only runs checks that exist.
 */

import "server-only";

import type { WorkspaceTransport } from "./workspace-transport";
import type { ProgressEmitter } from "./progress-events";
import type { ProjectPackageInfo } from "./workspace-transport";

export interface CheckResult {
  check: string;
  passed: boolean;
  exitCode: number;
  stdout: string;
  stderr: string;
  errorCount?: number;
}

export interface BuildFixLoopResult {
  allPassed: boolean;
  results: CheckResult[];
  repairAttempts: number;
  finalState: "passed" | "failed" | "skipped";
}

const MAX_REPAIR_ATTEMPTS = 3;

/**
 * Run build/test/typecheck/lint checks using the workspace transport.
 * Discovers package manager and scripts from package.json first.
 */
export async function runBuildFixLoop(
  transport: WorkspaceTransport,
  progress?: ProgressEmitter,
  options?: {
    checks?: Array<"build" | "typecheck" | "lint" | "test">;
    onRepair?: (attempt: number, errors: string) => Promise<boolean>;
  },
): Promise<BuildFixLoopResult> {
  const requestedChecks = options?.checks ?? ["typecheck", "lint", "test", "build"];
  const packageInfo = await transport.discoverPackageInfo();

  const results: CheckResult[] = [];

  for (const checkId of requestedChecks) {
    if (progress) progress.emit({ type: "build_start", check: checkId });

    const result = await runSingleCheck(transport, checkId, packageInfo);
    results.push(result);

    if (progress) {
      progress.emit({
        type: "build_result",
        check: checkId,
        passed: result.passed,
        errorCount: result.errorCount,
      });
    }
  }

  const allPassed = results.every((r) => r.passed);

  // If all passed, no repair needed
  if (allPassed) {
    return { allPassed: true, results, repairAttempts: 0, finalState: "passed" };
  }

  // If no repair callback, just report failures
  if (!options?.onRepair) {
    return { allPassed: false, results, repairAttempts: 0, finalState: "failed" };
  }

  // Attempt repair
  let repairAttempts = 0;
  let currentResults = results;

  while (repairAttempts < MAX_REPAIR_ATTEMPTS) {
    repairAttempts++;
    if (progress) {
      progress.emit({
        type: "repair_attempt",
        attempt: repairAttempts,
        maxAttempts: MAX_REPAIR_ATTEMPTS,
      });
    }

    // Collect error output from failed checks
    const errorOutput = currentResults
      .filter((r) => !r.passed)
      .map((r) => `--- ${r.check} (exit ${r.exitCode}) ---\n${r.stderr || r.stdout}`)
      .join("\n\n");

    // Call repair callback — returns true if it made changes
    const repaired = await options.onRepair(repairAttempts, errorOutput);
    if (!repaired) break;

    // Re-run failed checks only
    const failedChecks = currentResults
      .filter((r) => !r.passed)
      .map((r) => r.check as "build" | "typecheck" | "lint" | "test");

    const recheckResults: CheckResult[] = [];
    for (const checkId of failedChecks) {
      if (progress) progress.emit({ type: "build_start", check: checkId });
      const result = await runSingleCheck(transport, checkId, packageInfo);
      recheckResults.push(result);
      if (progress) {
        progress.emit({
          type: "build_result",
          check: checkId,
          passed: result.passed,
          errorCount: result.errorCount,
        });
      }
    }

    // Merge: keep passed results from before, update with rechecked ones
    const recheckedMap = new Map(recheckResults.map((r) => [r.check, r]));
    currentResults = currentResults.map((r) => recheckedMap.get(r.check) ?? r);

    if (currentResults.every((r) => r.passed)) {
      return {
        allPassed: true,
        results: currentResults,
        repairAttempts,
        finalState: "passed",
      };
    }
  }

  return {
    allPassed: false,
    results: currentResults,
    repairAttempts,
    finalState: "failed",
  };
}

async function runSingleCheck(
  transport: WorkspaceTransport,
  checkId: "build" | "typecheck" | "lint" | "test",
  packageInfo: ProjectPackageInfo,
): Promise<CheckResult> {
  const result = await transport.runCheck(checkId, packageInfo);

  // Count errors from output
  let errorCount: number | undefined;
  if (result.exitCode !== 0) {
    const errorMatches = result.stderr.match(/error/gi);
    errorCount = errorMatches ? errorMatches.length : undefined;
  }

  return {
    check: checkId,
    passed: result.exitCode === 0,
    exitCode: result.exitCode,
    stdout: result.stdout.slice(0, 5000),
    stderr: result.stderr.slice(0, 5000),
    errorCount,
  };
}
