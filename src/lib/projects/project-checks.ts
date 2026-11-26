/**
 * Project checks — the seven workspace health checks (Build,
 * TypeScript, Lint, Test, Security, Accessibility, Performance) and
 * their persisted results.
 *
 * Extracted from the checks routes (ACC-07 Item 2) so ONE
 * implementation serves every caller:
 *  - the on-demand routes (run-all / single check / panel GET),
 *  - the agent loop, which now runs all seven automatically when a
 *    build completes and settles the run honestly on the results.
 *
 * Results persist to project_check_runs (one row per run of the set),
 * so the Checks panel shows the last run's ACTUAL results — tied to
 * the project and, for automatic runs, the conversation that produced
 * them — instead of resetting to "Not run" on every load. Persistence
 * is best-effort: a missing table (migration not yet applied) degrades
 * to the pre-ACC-07 behavior, never to a failed build.
 */

import { supabaseAdmin } from "@/lib/supabase";
import { studioLog } from "@/lib/studio/logger";
import { getProject, verifyProjectWorkspace } from "@/lib/projects/project-repository";
import { listCheckpoints, listPendingApprovals } from "@/lib/missions/mission-repository";
import { requireTerminalBaseUrl } from "@/lib/terminal-config";

export const PROJECT_CHECK_IDS = [
  "build",
  "typecheck",
  "lint",
  "test",
  "security",
  "accessibility",
  "performance",
] as const;
export type ProjectCheckId = (typeof PROJECT_CHECK_IDS)[number];
export type ProjectCheckStatus =
  | "not_run"
  | "running"
  | "passed"
  | "failed"
  | "unavailable"
  | "not_configured";

export interface ProjectCheckResult {
  id: ProjectCheckId;
  label: string;
  status: ProjectCheckStatus;
  source: string;
  timestamp: string | null;
  durationMs?: number | null;
  output?: string | null;
  error?: string | null;
  exitCode?: number | null;
  suggestedFix?: string | null;
}

export interface ProjectCheckSummary {
  total: number;
  passed: number;
  failed: number;
  notConfigured: number;
  changedFileCount: number;
}

export function checkLabelFor(id: ProjectCheckId): string {
  return id === "typecheck" ? "TypeScript" : id[0].toUpperCase() + id.slice(1);
}

export function packageManagerCommand(packageManager: string | null, action: ProjectCheckId): string | null {
  const manager = packageManager === "pnpm" || packageManager === "npm" || packageManager === "yarn" ? packageManager : null;
  if (!manager) return null;
  if (action === "typecheck") return manager === "pnpm" ? "pnpm exec tsc --noEmit" : `${manager} exec tsc --noEmit`;
  if (action === "test") return `${manager} test -- --run`;
  if (action === "lint") return `${manager} run lint`;
  if (action === "build") return `${manager} run build`;
  if (action === "security") return manager === "pnpm" ? "pnpm audit --prod" : `${manager} audit`;
  return null; // accessibility, performance — not configured
}

function parseChangedFiles(output: string): string[] {
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.replace(/^..\s+/, "").trim())
    .filter(Boolean);
}

async function runWorkspaceCommand(workspaceId: string, userId: string, command: string, timeoutMs = 120_000) {
  const terminalBase = requireTerminalBaseUrl();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${terminalBase}/internal/workspace/${workspaceId}/exec`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Internal-Service-Key": process.env.TERMINAL_INTERNAL_SERVICE_KEY ?? "",
      },
      body: JSON.stringify({ command, userId }),
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => null) as { exitCode?: number; stdout?: string; stderr?: string; durationMs?: number; error?: string } | null;
    if (!response.ok) throw new Error(payload?.error ?? `Workspace command failed (${response.status})`);
    return payload ?? {};
  } finally {
    clearTimeout(timer);
  }
}

function suggestFix(checkId: ProjectCheckId, _output: string): string {
  switch (checkId) {
    case "typecheck":
      return "Review the TypeScript errors above and fix the type mismatches.";
    case "lint":
      return "Run `pnpm lint --fix` to auto-fix formatting issues, or manually resolve the reported errors.";
    case "test":
      return "Review the failing tests and fix the broken assertions or implementations.";
    case "build":
      return "Check the build output for import errors or missing dependencies.";
    case "security":
      return "Update the vulnerable dependencies with `pnpm update` or review the audit report.";
    default:
      return "Review the check output for details.";
  }
}

/** The checks could not run at all (project gone, workspace not
 *  ready). Carries the exact HTTP status + JSON body the routes have
 *  always returned for these cases, so route behavior is unchanged. */
export class ProjectChecksUnavailableError extends Error {
  readonly status: number;
  readonly body: Record<string, unknown>;
  constructor(status: number, body: Record<string, unknown>) {
    super(typeof body.error === "string" ? body.error : "Project checks unavailable");
    this.name = "ProjectChecksUnavailableError";
    this.status = status;
    this.body = body;
  }
}

export interface ProjectCheckRunOutcome {
  checks: ProjectCheckResult[];
  changedFiles: string[];
  pendingApprovals: Awaited<ReturnType<typeof listPendingApprovals>>;
  checkpoints: Awaited<ReturnType<typeof listCheckpoints>>;
  summary: ProjectCheckSummary;
  project: {
    id: string;
    name: string;
    branch: string | null;
    workspaceStatus: string;
  };
  /** Wall-clock time the whole set took — the verification overhead
   *  a completed build pays for its checks (ACC-07 measurement). */
  totalDurationMs: number;
}

/**
 * Run ALL seven checks sequentially against the project's active
 * workspace — the same behavior the run-all route has always had,
 * now shared. Per-check durationMs comes from the workspace exec
 * payload, falling back to the wall-clock time measured here.
 */
export async function runAllProjectChecks(input: {
  projectId: string;
  userId: string;
}): Promise<ProjectCheckRunOutcome> {
  const { projectId, userId } = input;
  const startedAt = Date.now();
  const project = await getProject(projectId, userId);
  if (!project) {
    throw new ProjectChecksUnavailableError(404, { error: "Project not found" });
  }

  let workspaceId: string;
  try {
    ({ workspaceId } = await verifyProjectWorkspace(projectId, userId));
  } catch (error) {
    const code = error instanceof Error && "code" in error ? String((error as { code: string }).code) : "WORKSPACE_ERROR";
    const message = error instanceof Error ? error.message : "Project workspace is unavailable";
    throw new ProjectChecksUnavailableError(422, {
      error: message,
      code,
      checks: PROJECT_CHECK_IDS.map((id) => ({
        id,
        label: checkLabelFor(id),
        status: "unavailable" as ProjectCheckStatus,
        source: "Active project workspace",
        timestamp: new Date().toISOString(),
        output: null,
        error: message,
      })),
    });
  }

  const results: ProjectCheckResult[] = [];
  const now = new Date().toISOString();

  let changedFiles: string[] = [];
  try {
    const gitStatus = await runWorkspaceCommand(workspaceId, userId, "git status --short --branch");
    changedFiles = parseChangedFiles(String(gitStatus.stdout ?? ""));
  } catch {
    changedFiles = [];
  }

  for (const checkId of PROJECT_CHECK_IDS) {
    const command = packageManagerCommand(project.packageManager, checkId);
    if (!command) {
      results.push({
        id: checkId,
        label: checkLabelFor(checkId),
        status: "not_configured",
        source: "No script configured",
        timestamp: now,
        output: null,
        error: null,
      });
      continue;
    }

    const checkStartedAt = Date.now();
    try {
      const result = await runWorkspaceCommand(workspaceId, userId, command);
      const output = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
      const exitCode = result.exitCode ?? 1;
      const passed = exitCode === 0;
      results.push({
        id: checkId,
        label: checkLabelFor(checkId),
        status: passed ? "passed" : "failed",
        source: `Workspace · ${command}`,
        timestamp: now,
        durationMs: result.durationMs ?? Date.now() - checkStartedAt,
        exitCode,
        output: output.slice(0, 100000),
        error: passed ? null : `Command exited with code ${exitCode}`,
        suggestedFix: passed ? null : suggestFix(checkId, output),
      });
    } catch (runError) {
      results.push({
        id: checkId,
        label: checkLabelFor(checkId),
        status: "failed",
        source: `Workspace · ${command}`,
        timestamp: now,
        durationMs: Date.now() - checkStartedAt,
        output: null,
        error: runError instanceof Error ? runError.message : "Check failed",
        suggestedFix: "Verify the terminal server is running and the workspace is mounted.",
      });
    }
  }

  // ACC-08 Defect 1: the approvals/checkpoints reads are garnish for
  // the panel — they must never be able to discard the seven completed
  // check results. Before this isolation, a throw from either missions
  // read (after every check had run) propagated out of
  // runAllProjectChecks and the caller's silent catch threw the whole
  // outcome away: the run settled as a clean success with "Not run"
  // everywhere (Acceptance Run 1 on ba16d435).
  let approvals: ProjectCheckRunOutcome["pendingApprovals"] = [];
  let checkpoints: ProjectCheckRunOutcome["checkpoints"] = [];
  try {
    const [pendingApprovals, projectCheckpoints] = await Promise.all([
      listPendingApprovals(projectId, userId),
      listCheckpoints(projectId, userId),
    ]);
    approvals = pendingApprovals;
    checkpoints = projectCheckpoints.slice(0, 20);
  } catch (garnishError) {
    studioLog("project-checks:garnish_failed", {
      projectId,
      errorClass: garnishError instanceof Error ? garnishError.message : "unknown",
    });
  }

  const passed = results.filter((r) => r.status === "passed").length;
  const failed = results.filter((r) => r.status === "failed").length;
  const notConfigured = results.filter((r) => r.status === "not_configured").length;

  return {
    checks: results,
    changedFiles,
    pendingApprovals: approvals,
    checkpoints,
    summary: {
      total: results.length,
      passed,
      failed,
      notConfigured,
      changedFileCount: changedFiles.length,
    },
    project: {
      id: project.id,
      name: project.name,
      branch: project.githubBranch ?? project.githubDefaultBranch,
      workspaceStatus: project.workspaceStatus,
    },
    totalDurationMs: Date.now() - startedAt,
  };
}

// ─── Persistence ─────────────────────────────────────────────────────

export interface PersistedProjectCheckRun {
  checks: ProjectCheckResult[];
  summary: ProjectCheckSummary;
  conversationId: string | null;
  createdAt: string;
}

/** Persist one completed check run. Best-effort: returns false (and
 *  logs) when storage is unavailable or the migration has not been
 *  applied — a checks result must never take the build down with it. */
export async function saveProjectCheckRun(input: {
  projectId: string;
  userId: string;
  conversationId?: string | null;
  checks: ProjectCheckResult[];
  summary: ProjectCheckSummary;
}): Promise<boolean> {
  if (!supabaseAdmin) return false;
  try {
    const { error } = await supabaseAdmin.from("project_check_runs").insert({
      project_id: input.projectId,
      user_id: input.userId,
      conversation_id: input.conversationId ?? null,
      results: input.checks,
      summary: input.summary,
    });
    if (error) {
      studioLog("project-checks:persist_failed", { projectId: input.projectId, errorClass: error.message });
      return false;
    }
    return true;
  } catch (err) {
    studioLog("project-checks:persist_failed", {
      projectId: input.projectId,
      errorClass: err instanceof Error ? err.message : "unknown",
    });
    return false;
  }
}

/** The most recent persisted check run for the project, or null when
 *  none exists (or storage is unavailable / unmigrated). */
export async function getLatestProjectCheckRun(
  projectId: string,
  userId: string,
): Promise<PersistedProjectCheckRun | null> {
  if (!supabaseAdmin) return null;
  try {
    const { data, error } = await supabaseAdmin
      .from("project_check_runs")
      .select("results, summary, conversation_id, created_at")
      .eq("project_id", projectId)
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error || !data) return null;
    const row = data as {
      results: ProjectCheckResult[];
      summary: ProjectCheckSummary;
      conversation_id: string | null;
      created_at: string;
    };
    if (!Array.isArray(row.results)) return null;
    return {
      checks: row.results,
      summary: row.summary,
      conversationId: row.conversation_id ?? null,
      createdAt: row.created_at,
    };
  } catch {
    return null;
  }
}

/** Plain-language settlement text when a completed build's automatic
 *  checks include failures (ACC-07 Item 2): the run must not report
 *  success while a required check failed. */
export function completionChecksFailureMessage(failed: ProjectCheckResult[]): string {
  const names = failed.map((c) => c.label).join(", ");
  return (
    `The build finished and the files are saved, but the automatic checks did not all pass — ` +
    `${names} failed. The full results are in the Checks panel. ` +
    `I can't call this build successful until those checks pass.`
  );
}

/**
 * ACC-08 Defect 1 — the full seven-check "unavailable" set for a run
 * whose checks could not run at all. When the failure is a
 * ProjectChecksUnavailableError whose body already carries the set
 * (the workspace-not-ready 422), those entries are used verbatim;
 * otherwise the set is synthesized from the reason, so EVERY
 * cannot-run path has a truthful, persistable result — the panel and
 * Jobs show "Unavailable" with the reason instead of a reasonless
 * "Not run" that is indistinguishable from checks never attempted.
 */
export function unavailableCheckSet(reason: string, carried?: unknown): {
  checks: ProjectCheckResult[];
  summary: ProjectCheckSummary;
} {
  const now = new Date().toISOString();
  const carriedById = new Map<string, Record<string, unknown>>();
  if (Array.isArray(carried)) {
    for (const entry of carried) {
      if (entry && typeof entry === "object" && typeof (entry as { id?: unknown }).id === "string") {
        carriedById.set((entry as { id: string }).id, entry as Record<string, unknown>);
      }
    }
  }
  const checks: ProjectCheckResult[] = PROJECT_CHECK_IDS.map((id) => {
    const entry = carriedById.get(id);
    return {
      id,
      label: checkLabelFor(id),
      status: "unavailable",
      source: typeof entry?.source === "string" ? entry.source : "Active project workspace",
      timestamp: typeof entry?.timestamp === "string" ? entry.timestamp : now,
      output: null,
      error: typeof entry?.error === "string" ? entry.error : reason,
    };
  });
  return {
    checks,
    summary: { total: checks.length, passed: 0, failed: 0, notConfigured: 0, changedFileCount: 0 },
  };
}

/** The unavailable set carried by a ProjectChecksUnavailableError. */
export function unavailableCheckSetFromError(error: ProjectChecksUnavailableError): {
  checks: ProjectCheckResult[];
  summary: ProjectCheckSummary;
} {
  return unavailableCheckSet(error.message, error.body?.checks);
}

/**
 * ACC-08 — Larry's ruling (2026-11-25): when the checks genuinely
 * cannot run, the build still counts, but the fact must be LOUD —
 * never the silent success Acceptance Run 1 on ba16d435 shipped.
 * This note rides the run's closing text on a completed settlement.
 */
export function completionChecksUnavailableNote(reason: string): string {
  return (
    `IMPORTANT — the automatic checks did NOT run for this build: ${reason}. ` +
    `Nothing verified the finished site, so treat this build as unchecked: the Checks panel ` +
    `shows the checks as unavailable rather than passed, and they can be run from there ` +
    `once the workspace is reachable.`
  );
}

/**
 * ACC-08 — the checks ran and were reported live, but persisting
 * their results failed, so the Checks panel cannot show them. The
 * run still counts; the gap is stated, never hidden.
 */
export function completionChecksNotSavedNote(): string {
  return (
    `Note: the automatic checks ran for this build and their results are in this run's ` +
    `Jobs tab, but the results could not be saved — the Checks panel may still show ` +
    `them as not run.`
  );
}
