import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getProject, verifyProjectWorkspace } from "@/lib/projects/project-repository";
import { listCheckpoints } from "@/lib/missions/mission-repository";
import { listPendingApprovals } from "@/lib/missions/mission-repository";
import { requireTerminalBaseUrl, terminalNotConfiguredResponse } from "@/lib/terminal-config";
import {
  getLatestProjectCheckRun,
  saveProjectCheckRun,
  type ProjectCheckResult,
} from "@/lib/projects/project-checks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CHECK_IDS = ["build", "typecheck", "lint", "test", "security", "accessibility", "performance"] as const;
type CheckId = (typeof CHECK_IDS)[number];
type CheckStatus = "not_run" | "running" | "passed" | "failed" | "unavailable";

interface CheckResult {
  id: CheckId;
  label: string;
  status: CheckStatus;
  source: string;
  timestamp: string | null;
  durationMs?: number | null;
  output?: string | null;
  error?: string | null;
}

/**
 * ACC-06a item 2: a not_run check must carry its reason, never a bare
 * "Not run" (production proof on 8cd7728c showed all seven checks
 * reasonless). ACC-07 Item 2 supersedes the on-demand-only world the
 * ACC-06a sentence described: a completed build now runs all seven
 * checks automatically and the results persist (project_check_runs),
 * so this reason remains only for a project no build or check run
 * has covered yet. StudioHealthPanel uses the same sentence for its
 * fallback shape.
 */
const NOT_RUN_REASON =
  "Not run yet — checks run automatically when a build completes, or on demand from the Checks panel.";

function emptyChecks(reason: string): CheckResult[] {
  return CHECK_IDS.map((id) => ({
    id,
    label: id === "typecheck" ? "TypeScript" : id[0].toUpperCase() + id.slice(1),
    status: "unavailable",
    source: "Active project workspace",
    timestamp: null,
    output: null,
    error: reason,
  }));
}

function packageManagerCommand(packageManager: string | null, action: CheckId): string | null {
  const manager = packageManager === "pnpm" || packageManager === "npm" || packageManager === "yarn" ? packageManager : null;
  if (!manager || ["security", "accessibility", "performance"].includes(action)) return null;
  if (action === "typecheck") return manager === "pnpm" ? "pnpm exec tsc --noEmit" : `${manager} exec tsc --noEmit`;
  if (action === "test") return `${manager} test -- --run`;
  return `${manager} run ${action}`;
}

function parseChangedFiles(output: string): string[] {
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.replace(/^..\s+/, "").trim())
    .filter(Boolean);
}

function workspaceCommandTimeoutMs(): number {
  const fromEnv = Number(process.env.CHECKS_COMMAND_TIMEOUT_MS);
  return Number.isFinite(fromEnv) && fromEnv > 0 ? fromEnv : 120_000;
}

async function runWorkspaceCommand(workspaceId: string, userId: string, command: string) {
  const terminalBase = requireTerminalBaseUrl();
  // ACC-06a item 2: bound every workspace command (the run-all route
  // already had this discipline; this route had none, so a hung
  // terminal left a check — and the panel — "running" forever). A
  // timeout surfaces as a failed/unavailable result with the reason
  // named, never as an endless wait.
  const timeoutMs = workspaceCommandTimeoutMs();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response: Response;
  try {
    response = await fetch(`${terminalBase}/internal/workspace/${workspaceId}/exec`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Internal-Service-Key": process.env.TERMINAL_INTERNAL_SERVICE_KEY ?? "",
      },
      body: JSON.stringify({ command, userId }),
      signal: controller.signal,
    });
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(`Workspace command timed out after ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
  const payload = await response.json().catch(() => null) as { exitCode?: number; stdout?: string; stderr?: string; durationMs?: number; error?: string } | null;
  if (!response.ok) throw new Error(payload?.error ?? `Workspace command failed (${response.status})`);
  return payload ?? {};
}

async function baseResponse(projectId: string, userId: string) {
  const project = await getProject(projectId, userId);
  if (!project) return null;

  const [approvals, checkpoints] = await Promise.all([
    listPendingApprovals(projectId, userId),
    listCheckpoints(projectId, userId),
  ]);

  let changedFiles: string[] = [];
  if (project.workspaceId && project.workspaceStatus === "ready") {
    try {
      const gitStatus = await runWorkspaceCommand(project.workspaceId, userId, "git status --short");
      changedFiles = parseChangedFiles(String(gitStatus.stdout ?? ""));
    } catch {
      changedFiles = [];
    }
  }

  return {
    project: {
      id: project.id,
      name: project.name,
      branch: project.githubBranch ?? project.githubDefaultBranch,
      workspaceStatus: project.workspaceStatus,
      runtimeStatus: project.runtimeStatus,
      previewUrl: project.previewUrl,
      runtimeError: project.runtimeError,
    },
    checks: project.workspaceId && project.workspaceStatus === "ready"
      ? CHECK_IDS.map((id) => ({
          id,
          label: id === "typecheck" ? "TypeScript" : id[0].toUpperCase() + id.slice(1),
          status: "not_run" as const,
          source: "Active project workspace",
          timestamp: null,
          output: null,
          error: NOT_RUN_REASON,
        }))
      : emptyChecks(project.workspaceError ?? "Project workspace is not ready"),
    changedFiles,
    pendingApprovals: approvals,
    checkpoints: checkpoints.slice(0, 20),
  };
}

// GET stays available without a terminal: baseResponse() reads the database and
// treats a failed/unconfigured workspace command as "no changed files".
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { userId } = await auth(request);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { projectId } = await params;
  const payload = await baseResponse(projectId, userId);
  if (!payload) return NextResponse.json({ error: "Project not found" }, { status: 404 });
  // ACC-07 Item 2: when a check run has been persisted for this
  // project (automatic at build completion, or on demand), the panel
  // shows THOSE results — tied to the run that produced them —
  // instead of the not_run placeholder set.
  if (payload.project.workspaceStatus === "ready") {
    const persisted = await getLatestProjectCheckRun(projectId, userId);
    if (persisted) {
      return NextResponse.json(
        {
          ...payload,
          checks: persisted.checks,
          summary: persisted.summary,
          checkRun: {
            conversationId: persisted.conversationId,
            createdAt: persisted.createdAt,
          },
        },
        { headers: { "Cache-Control": "no-store" } },
      );
    }
  }
  return NextResponse.json(payload, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { userId } = await auth(request);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const terminalUnavailable = terminalNotConfiguredResponse();
  if (terminalUnavailable) return terminalUnavailable;
  const { projectId } = await params;
  const project = await getProject(projectId, userId);
  if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

  const body = await request.json().catch(() => null) as { check?: unknown } | null;
  const check = body?.check;
  if (typeof check !== "string" || !CHECK_IDS.includes(check as CheckId)) {
    return NextResponse.json({ error: `check must be one of: ${CHECK_IDS.join(", ")}` }, { status: 400 });
  }

  const checkId = check as CheckId;
  const command = packageManagerCommand(project.packageManager, checkId);
  const timestamp = new Date().toISOString();
  if (!command) {
    return NextResponse.json({
      check: {
        id: checkId,
        label: check === "typecheck" ? "TypeScript" : check[0].toUpperCase() + check.slice(1),
        status: "unavailable",
        source: "Active project workspace",
        timestamp,
        output: null,
        error: project.packageManager ? "No supported production check is configured for this project." : "This project has no package manager configured.",
      } satisfies CheckResult,
    });
  }

  let workspaceId: string;
  try {
    ({ workspaceId } = await verifyProjectWorkspace(projectId, userId));
  } catch (error) {
    return NextResponse.json({
      check: {
        id: checkId,
        label: check === "typecheck" ? "TypeScript" : check[0].toUpperCase() + check.slice(1),
        status: "unavailable",
        source: "Active project workspace",
        timestamp,
        output: null,
        error: error instanceof Error ? error.message : "Project workspace is unavailable",
      } satisfies CheckResult,
    });
  }

  try {
    const result = await runWorkspaceCommand(workspaceId, userId, command);
    const output = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
    const checkResult = {
      id: checkId,
      label: check === "typecheck" ? "TypeScript" : check[0].toUpperCase() + check.slice(1),
      status: result.exitCode === 0 ? "passed" : "failed",
      source: `Active project workspace · ${command}`,
      timestamp,
      durationMs: result.durationMs ?? null,
      output: output.slice(0, 100000),
      error: result.exitCode === 0 ? null : `Command exited with code ${result.exitCode ?? 1}`,
    } satisfies CheckResult;
    await persistSingleCheck(projectId, userId, checkResult);
    return NextResponse.json({
      check: checkResult,
    }, { status: result.exitCode === 0 ? 200 : 422 });
  } catch (error) {
    const checkResult = {
      id: checkId,
      label: check === "typecheck" ? "TypeScript" : check[0].toUpperCase() + check.slice(1),
      status: "failed",
      source: `Active project workspace · ${command}`,
      timestamp,
      output: null,
      error: error instanceof Error ? error.message : "Check failed",
    } satisfies CheckResult;
    await persistSingleCheck(projectId, userId, checkResult);
    return NextResponse.json({
      check: checkResult,
    }, { status: 422 });
  }
}

/**
 * ACC-07 Item 2: an on-demand single check updates the persisted set
 * (merged over the latest run's results), so the panel's record stays
 * the whole seven — one fresh result never erases the other six.
 * Best-effort: persistence failure never changes the response.
 */
async function persistSingleCheck(
  projectId: string,
  userId: string,
  check: CheckResult,
): Promise<void> {
  const latest = await getLatestProjectCheckRun(projectId, userId);
  const base: ProjectCheckResult[] = latest?.checks ?? CHECK_IDS.map((id) => ({
    id,
    label: id === "typecheck" ? "TypeScript" : id[0].toUpperCase() + id.slice(1),
    status: "not_run" as const,
    source: "Active project workspace",
    timestamp: null,
    output: null,
    error: NOT_RUN_REASON,
  }));
  const merged = base.map((c) => (c.id === check.id ? (check as unknown as ProjectCheckResult) : c));
  await saveProjectCheckRun({
    projectId,
    userId,
    conversationId: latest?.conversationId ?? null,
    checks: merged,
    summary: {
      total: merged.length,
      passed: merged.filter((c) => c.status === "passed").length,
      failed: merged.filter((c) => c.status === "failed").length,
      notConfigured: merged.filter((c) => c.status === "not_configured").length,
      changedFileCount: latest?.summary.changedFileCount ?? 0,
    },
  });
}
