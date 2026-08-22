/**
 * Check Executor
 *
 * Runs validation checks (lint, typecheck, test, build, browser) with:
 * - Timeout enforcement
 * - Process-tree cleanup (kills child processes, not just the shell)
 * - Output capture to log references (not inline)
 * - Evidence persistence (CheckEvidence records)
 * - Stale check invalidation (headSha + workingTreeDiffHash)
 *
 * Phase 8 — Studio Control Plane V1
 */

import { randomUUID } from "crypto";
import { createHash } from "crypto";
import { spawn, type ChildProcess } from "child_process";
import type { WorkspaceTransport } from "./workspace-transport";
import type { CheckEvidence, CheckKind, DetectedScripts } from "./check-evidence";
import { planChecks } from "./check-evidence";
import { detectScripts } from "./script-detection";
import { getCheckEvidenceStore } from "./check-evidence-store";
import { getRunEventStore } from "./run-event-store";
import { createRunEvent } from "./run-events";

// ─── Types ───────────────────────────────────────────────────────

export interface CheckExecutionResult {
  check: CheckEvidence;
  stdout: string;
  stderr: string;
}

export interface RunChecksOptions {
  runId: string;
  projectId: string;
  transport: WorkspaceTransport;
  /** Detected scripts (auto-detected if not provided) */
  scripts?: DetectedScripts;
  /** Whether browser checks are required */
  hasBrowserChecks?: boolean;
  /** Files that were mutated (for targeted test detection) */
  mutatedFiles?: string[];
  /** Override timeout for all checks */
  defaultTimeoutMs?: number;
}

// ─── Process-Tree Cleanup ────────────────────────────────────────

/**
 * Kill a process tree — on Windows uses taskkill /T, on Unix
 * sends SIGKILL to the process group.
 */
function killProcessTree(child: ChildProcess): void {
  if (!child.pid) return;
  try {
    if (process.platform === "win32") {
      // /T kills the process tree, /F forces
      spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
        stdio: "ignore",
        shell: true,
      });
    } else {
      // Kill the entire process group
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch {
        process.kill(child.pid, "SIGKILL");
      }
    }
  } catch {
    // Process may have already exited
  }
}

// ─── Stale Check Invalidation ────────────────────────────────────

/**
 * Check if a CheckEvidence record is stale — i.e., the code state
 * has changed since the check ran.
 *
 * A check is stale if:
 * - headSha doesn't match current HEAD, OR
 * - workingTreeDiffHash doesn't match current worktree diff hash
 *
 * This is the non-negotiable requirement: if LiTT edits a file
 * after build passes, the build result is invalidated.
 */
export function isCheckStale(
  check: CheckEvidence,
  currentHeadSha: string,
  currentWorkingTreeDiffHash: string,
): boolean {
  if (check.stale) return true; // already marked stale
  if (check.headSha !== currentHeadSha) return true;
  if (check.workingTreeDiffHash !== currentWorkingTreeDiffHash) return true;
  return false;
}

// ─── Capture Code State ──────────────────────────────────────────

async function captureCodeState(transport: WorkspaceTransport): Promise<{
  headSha: string;
  workingTreeDiffHash: string;
}> {
  let headSha = "unknown";
  try {
    const log = await transport.gitLog({ maxCount: 1 });
    headSha = log.commits[0]?.sha ?? "unknown";
  } catch { /* ok */ }

  let workingTreeDiffHash = "empty";
  try {
    const { diff } = await transport.gitDiff();
    workingTreeDiffHash = diff
      ? createHash("sha256").update(diff, "utf-8").digest("hex")
      : "empty";
  } catch { /* ok */ }

  return { headSha, workingTreeDiffHash };
}

// ─── Run Single Check ────────────────────────────────────────────

async function runSingleCheck(
  checkId: string,
  runId: string,
  projectId: string,
  kind: CheckKind,
  command: string,
  cwd: string,
  required: boolean,
  timeoutMs: number,
  codeState: { headSha: string; workingTreeDiffHash: string },
  skipIfMissing: boolean | undefined,
  transport: WorkspaceTransport,
): Promise<CheckExecutionResult> {
  const store = getCheckEvidenceStore();
  const startedAt = new Date().toISOString();
  const startTime = Date.now();

  // If script is missing, skip with explicit reason
  if (skipIfMissing) {
    const skipReason = `No ${kind} script detected in package.json`;
    const check: CheckEvidence = {
      id: checkId,
      runId,
      projectId,
      kind,
      command,
      cwd,
      required,
      status: "skipped",
      exitCode: null,
      startedAt,
      completedAt: new Date().toISOString(),
      durationMs: 0,
      skipReason,
      headSha: codeState.headSha,
      workingTreeDiffHash: codeState.workingTreeDiffHash,
    };
    await store.insert(check);
    return { check, stdout: "", stderr: skipReason };
  }

  // Insert running record
  const check: CheckEvidence = {
    id: checkId,
    runId,
    projectId,
    kind,
    command,
    cwd,
    required,
    status: "running",
    exitCode: null,
    startedAt,
    headSha: codeState.headSha,
    workingTreeDiffHash: codeState.workingTreeDiffHash,
  };
  await store.insert(check);

  // Emit event
  const runEventStore = getRunEventStore();
  await runEventStore.insert(createRunEvent(runId, projectId, "tool_started", {
    toolId: `check:${kind}`,
    command,
  }));

  // Execute the command with timeout
  return new Promise<CheckExecutionResult>((resolve) => {
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let child: ChildProcess | null = null;

    try {
      child = spawn(command, [], {
        cwd,
        shell: true,
        stdio: ["ignore", "pipe", "pipe"],
        // On Unix, create a new process group so we can kill the tree
        detached: process.platform !== "win32",
      });
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      const failedCheck: CheckEvidence = {
        ...check,
        status: "failed",
        exitCode: -1,
        completedAt: new Date().toISOString(),
        durationMs: Date.now() - startTime,
        failureReason: `Spawn failed: ${errorMsg}`,
      };
      store.update(checkId, failedCheck).then(() => {
        resolve({ check: failedCheck, stdout, stderr });
      });
      return;
    }

    const timeoutHandle = setTimeout(() => {
      timedOut = true;
      if (child) killProcessTree(child);
    }, timeoutMs);

    child.stdout?.on("data", (data: Buffer) => {
      stdout += data.toString("utf-8");
    });

    child.stderr?.on("data", (data: Buffer) => {
      stderr += data.toString("utf-8");
    });

    child.on("close", (exitCode) => {
      clearTimeout(timeoutHandle);
      const durationMs = Date.now() - startTime;
      const completedAt = new Date().toISOString();

      let status: CheckEvidence["status"];
      let failureReason: string | undefined;

      if (timedOut) {
        status = "failed";
        failureReason = `Timeout after ${timeoutMs}ms`;
        exitCode = -1;
      } else if (exitCode === 0) {
        status = "passed";
      } else {
        status = "failed";
        failureReason = `Exit code ${exitCode}`;
      }

      const finalCheck: CheckEvidence = {
        ...check,
        status,
        exitCode,
        completedAt,
        durationMs,
        failureReason,
        // Store log references (truncated inline for V1; production
        // would write to R2/S3 and store a ref)
        stdoutRef: `inline:${stdout.slice(0, 5000)}`,
        stderrRef: `inline:${stderr.slice(0, 5000)}`,
      };

      store.update(checkId, finalCheck).then(async () => {
        // Emit result event
        await runEventStore.insert(createRunEvent(
          runId,
          projectId,
          status === "passed" ? "check_passed" : "check_failed",
          { checkId: kind, exitCode, durationMs },
          { evidenceId: checkId },
        ));
        resolve({ check: finalCheck, stdout, stderr });
      });
    });

    child.on("error", (err) => {
      clearTimeout(timeoutHandle);
      const durationMs = Date.now() - startTime;
      const failedCheck: CheckEvidence = {
        ...check,
        status: "failed",
        exitCode: -1,
        completedAt: new Date().toISOString(),
        durationMs,
        failureReason: `Process error: ${err.message}`,
      };
      store.update(checkId, failedCheck).then(async () => {
        await runEventStore.insert(createRunEvent(
          runId,
          projectId,
          "check_failed",
          { checkId: kind, error: err.message },
          { evidenceId: checkId },
        ));
        resolve({ check: failedCheck, stdout, stderr });
      });
    });
  });
}

// ─── Run All Checks ──────────────────────────────────────────────

/**
 * Run the full validation pipeline:
 *   detect scripts → targeted tests → lint → typecheck → tests → build → browser
 *
 * Returns all check evidence records.
 */
export async function runChecks(options: RunChecksOptions): Promise<CheckEvidence[]> {
  const { runId, projectId, transport, hasBrowserChecks, mutatedFiles } = options;
  const store = getCheckEvidenceStore();

  // 1. Capture current code state
  const codeState = await captureCodeState(transport);

  // 2. Detect scripts (use provided or auto-detect via transport)
  let scripts = options.scripts;
  if (!scripts) {
    try {
      const info = await transport.discoverPackageInfo();
      // Build a pseudo package.json from the discovered info
      scripts = detectScripts(
        {
          scripts: {
            ...(info.hasLint ? { lint: "lint" } : {}),
            ...(info.hasTypecheck ? { "type-check": "type-check" } : {}),
            ...(info.hasTest ? { test: "test" } : {}),
            ...(info.hasBuild ? { build: "build" } : {}),
          },
        },
        info.packageManager,
      );
    } catch {
      scripts = { packageManager: "npm" };
    }
  }

  // 3. Plan checks
  const planned = planChecks(scripts, { hasBrowserChecks });
  const cwd = transport.workspaceRoot;

  // 4. Run checks sequentially
  const results: CheckEvidence[] = [];

  for (const planned_check of planned) {
    // For targeted tests, adjust the command if we have mutated files
    let command = planned_check.command;
    if (planned_check.kind === "targeted-test" && mutatedFiles && mutatedFiles.length > 0) {
      // Run only tests related to the mutated files
      // This is a heuristic — the actual test runner handles filtering
      const testFiles = detectRelatedTests(mutatedFiles);
      if (testFiles.length > 0) {
        command = `${scripts.test ?? "npm test"} ${testFiles.join(" ")}`;
      } else {
        // No related tests found — skip targeted tests
        const checkId = randomUUID();
        const skipCheck: CheckEvidence = {
          id: checkId,
          runId,
          projectId,
          kind: "targeted-test",
          command,
          cwd,
          required: false,
          status: "skipped",
          exitCode: null,
          startedAt: new Date().toISOString(),
          completedAt: new Date().toISOString(),
          durationMs: 0,
          skipReason: "No test files found related to mutated files",
          headSha: codeState.headSha,
          workingTreeDiffHash: codeState.workingTreeDiffHash,
        };
        await store.insert(skipCheck);
        results.push(skipCheck);
        continue;
      }
    }

    const checkId = randomUUID();
    const result = await runSingleCheck(
      checkId,
      runId,
      projectId,
      planned_check.kind,
      command,
      cwd,
      planned_check.required,
      planned_check.timeoutMs,
      codeState,
      planned_check.skipIfMissing,
      transport,
    );
    results.push(result.check);

    // If a required check fails, we can optionally stop early
    // But for evidence completeness, we continue running all checks
    // so the developer sees the full picture
  }

  return results;
}

// ─── Targeted Test Detection ─────────────────────────────────────

/**
 * Detect which test files are related to the mutated source files.
 * Heuristic:
 * - foo.ts → foo.test.ts, foo.spec.ts
 * - foo.ts → __tests__/foo.test.ts
 * - Component.tsx → Component.test.tsx
 */
export function detectRelatedTests(mutatedFiles: string[]): string[] {
  const testFiles: string[] = [];

  for (const file of mutatedFiles) {
    // Skip test files themselves
    if (file.includes(".test.") || file.includes(".spec.") || file.includes("__tests__")) {
      continue;
    }

    const baseName = file.replace(/\.[^.]+$/, ""); // remove extension
    const ext = file.match(/\.[^.]+$/)?.[0] ?? "";

    // Common test file patterns
    const candidates = [
      `${baseName}.test${ext}`,
      `${baseName}.spec${ext}`,
      `${baseName}.test.ts`,
      `${baseName}.spec.ts`,
      baseName.replace(/\/src\//, "/src/__tests__/") + ".test.ts",
      baseName.replace(/\/src\//, "/__tests__/") + ".test.ts",
    ];

    for (const candidate of candidates) {
      if (!testFiles.includes(candidate)) {
        testFiles.push(candidate);
      }
    }
  }

  return testFiles;
}

// ─── Invalidate Stale Checks ─────────────────────────────────────

/**
 * Mark all checks for a run as stale if the code state has changed.
 * Called after a new mutation occurs.
 */
export async function invalidateStaleChecks(
  runId: string,
  currentHeadSha: string,
  currentWorkingTreeDiffHash: string,
): Promise<void> {
  const store = getCheckEvidenceStore();
  const checks = await store.listByRun(runId);

  for (const check of checks) {
    if (isCheckStale(check, currentHeadSha, currentWorkingTreeDiffHash)) {
      await store.update(check.id, { stale: true });
    }
  }
}
