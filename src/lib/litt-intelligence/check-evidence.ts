/**
 * Check Evidence Model
 *
 * Structured evidence for every validation check (lint, typecheck,
 * test, build, browser). Same evidence pattern as mutations —
 * the Checks tab renders from this data, not from chat transcripts.
 *
 * Critical rules:
 * - Missing scripts → SKIPPED with reason, never PASSING
 * - Required vs optional is explicit
 * - Every check has a timeout
 * - headSha + workingTreeDiffHash prove what code state was tested
 * - Stale checks (code changed after check ran) are invalidated
 *
 * Phase 8 — Studio Control Plane V1
 */

export type CheckKind =
  | "targeted-test"
  | "lint"
  | "typecheck"
  | "test"
  | "build"
  | "browser";

export type CheckStatus =
  | "queued"
  | "running"
  | "passed"
  | "failed"
  | "skipped";

export interface CheckEvidence {
  /** Unique check record ID */
  id: string;
  /** The run this check belongs to */
  runId: string;
  /** Project ID */
  projectId: string;

  /** What kind of check */
  kind: CheckKind;
  /** The command that was executed (or would have been) */
  command: string;
  /** Working directory where the command ran */
  cwd: string;

  /** Whether this check is required for ready-for-review */
  required: boolean;
  /** Status of the check */
  status: CheckStatus;

  /** Process exit code (null if not yet run or skipped) */
  exitCode: number | null;
  /** When the check started */
  startedAt: string;
  /** When the check completed */
  completedAt?: string;
  /** Duration in milliseconds */
  durationMs?: number;

  /** Reference to stdout log (not inline — logs can be large) */
  stdoutRef?: string;
  /** Reference to stderr log */
  stderrRef?: string;

  /** Why the check was skipped (e.g. "package.json has no lint script") */
  skipReason?: string;
  /** Why the check failed (e.g. "Exit code 1", "Timeout after 60000ms") */
  failureReason?: string;

  /** HEAD SHA when the check ran — proves what code was tested */
  headSha: string;
  /** Working tree diff hash when the check ran */
  workingTreeDiffHash: string;
  /** Whether this check is stale (code changed after check ran) */
  stale?: boolean;
}

// ─── Script Detection ────────────────────────────────────────────

export interface DetectedScripts {
  lint?: string;
  typecheck?: string;
  test?: string;
  build?: string;
  /** Package manager detected (npm, pnpm, yarn) */
  packageManager: string;
}

// ─── Check Configuration ─────────────────────────────────────────

export interface CheckConfig {
  kind: CheckKind;
  command: string;
  required: boolean;
  /** Timeout in milliseconds */
  timeoutMs: number;
}

// ─── Helpers ─────────────────────────────────────────────────────

/**
 * Determine which checks to run based on detected scripts.
 * Missing scripts become skipped checks with explicit reasons.
 */
export function planChecks(
  scripts: DetectedScripts,
  options?: { hasBrowserChecks?: boolean },
): Array<{ kind: CheckKind; command: string; required: boolean; timeoutMs: number; skipIfMissing?: boolean }> {
  const checks: Array<{ kind: CheckKind; command: string; required: boolean; timeoutMs: number; skipIfMissing?: boolean }> = [];

  // Targeted tests first (fastest feedback)
  // These are always optional — they're a quick pre-gate
  checks.push({
    kind: "targeted-test",
    command: scripts.test ?? "npm test",
    required: false,
    timeoutMs: 30_000,
    skipIfMissing: !scripts.test,
  });

  // Lint — required if configured
  checks.push({
    kind: "lint",
    command: scripts.lint ?? "npm run lint",
    required: Boolean(scripts.lint),
    timeoutMs: 60_000,
    skipIfMissing: !scripts.lint,
  });

  // Typecheck — always required
  checks.push({
    kind: "typecheck",
    command: scripts.typecheck ?? "npm run type-check",
    required: true,
    timeoutMs: 120_000,
    skipIfMissing: !scripts.typecheck,
  });

  // Full tests — always required
  checks.push({
    kind: "test",
    command: scripts.test ?? "npm test",
    required: true,
    timeoutMs: 180_000,
    skipIfMissing: !scripts.test,
  });

  // Build — always required
  checks.push({
    kind: "build",
    command: scripts.build ?? "npm run build",
    required: true,
    timeoutMs: 300_000,
    skipIfMissing: !scripts.build,
  });

  // Browser checks — required for UI acceptance criteria
  if (options?.hasBrowserChecks) {
    checks.push({
      kind: "browser",
      command: "browser-check",
      required: true,
      timeoutMs: 120_000,
    });
  }

  return checks;
}
