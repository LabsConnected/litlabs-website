import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getProject, verifyProjectWorkspace } from "@/lib/projects/project-repository";
import { listCheckpoints, listPendingApprovals } from "@/lib/missions/mission-repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CHECK_IDS = ["build", "typecheck", "lint", "test", "security", "accessibility", "performance"] as const;
type CheckId = (typeof CHECK_IDS)[number];
type CheckStatus = "not_run" | "running" | "passed" | "failed" | "unavailable" | "not_configured";

interface CheckResult {
  id: CheckId;
  label: string;
  status: CheckStatus;
  source: string;
  timestamp: string | null;
  durationMs?: number | null;
  output?: string | null;
  error?: string | null;
  exitCode?: number | null;
  suggestedFix?: string | null;
}

function packageManagerCommand(packageManager: string | null, action: CheckId): string | null {
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

async function runWorkspaceCommand(workspaceId: string, userId: string, command: string) {
  const terminalBase = process.env.TERMINAL_SERVER_INTERNAL_URL ?? process.env.NEXT_PUBLIC_TERMINAL_WS_URL ?? "https://litlabs-terminal-server-production-0be1.up.railway.app";
  const response = await fetch(`${terminalBase}/internal/workspace/${workspaceId}/exec`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Internal-Service-Key": process.env.TERMINAL_INTERNAL_SERVICE_KEY ?? "",
    },
    body: JSON.stringify({ command, userId }),
  });
  const payload = await response.json().catch(() => null) as { exitCode?: number; stdout?: string; stderr?: string; durationMs?: number; error?: string } | null;
  if (!response.ok) throw new Error(payload?.error ?? `Workspace command failed (${response.status})`);
  return payload ?? {};
}

function labelFor(id: CheckId): string {
  return id === "typecheck" ? "TypeScript" : id[0].toUpperCase() + id.slice(1);
}

/**
 * POST /api/studio-projects/[projectId]/checks/run-all
 *
 * Runs ALL applicable health checks sequentially against the active workspace.
 * Returns the complete results array.
 *
 * This is the endpoint LiTT calls when the user says
 * "Run a complete project health check and summarize what matters."
 *
 * Safe read-only checks — no write approval required.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { userId } = await auth(request);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { projectId } = await params;
  const project = await getProject(projectId, userId);
  if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

  // Verify workspace is ready
  let workspaceId: string;
  try {
    ({ workspaceId } = await verifyProjectWorkspace(projectId, userId));
  } catch (error) {
    const code = error instanceof Error && "code" in error ? String((error as { code: string }).code) : "WORKSPACE_ERROR";
    const message = error instanceof Error ? error.message : "Project workspace is unavailable";
    return NextResponse.json(
      {
        error: message,
        code,
        checks: CHECK_IDS.map((id) => ({
          id,
          label: labelFor(id),
          status: "unavailable" as CheckStatus,
          source: "Active project workspace",
          timestamp: new Date().toISOString(),
          output: null,
          error: message,
        })),
      },
      { status: 422 },
    );
  }

  const results: CheckResult[] = [];
  const now = new Date().toISOString();

  // Run git status first (safe read-only)
  let changedFiles: string[] = [];
  try {
    const gitStatus = await runWorkspaceCommand(workspaceId, userId, "git status --short --branch");
    changedFiles = parseChangedFiles(String(gitStatus.stdout ?? ""));
  } catch {
    changedFiles = [];
  }

  // Run each check sequentially
  for (const checkId of CHECK_IDS) {
    const command = packageManagerCommand(project.packageManager, checkId);
    if (!command) {
      results.push({
        id: checkId,
        label: labelFor(checkId),
        status: "not_configured",
        source: "No script configured",
        timestamp: now,
        output: null,
        error: null,
      });
      continue;
    }

    try {
      const result = await runWorkspaceCommand(workspaceId, userId, command);
      const output = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
      const exitCode = result.exitCode ?? 1;
      const passed = exitCode === 0;
      results.push({
        id: checkId,
        label: labelFor(checkId),
        status: passed ? "passed" : "failed",
        source: `Workspace · ${command}`,
        timestamp: now,
        durationMs: result.durationMs ?? null,
        exitCode,
        output: output.slice(0, 100000),
        error: passed ? null : `Command exited with code ${exitCode}`,
        suggestedFix: passed ? null : suggestFix(checkId, output),
      });
    } catch (runError) {
      results.push({
        id: checkId,
        label: labelFor(checkId),
        status: "failed",
        source: `Workspace · ${command}`,
        timestamp: now,
        output: null,
        error: runError instanceof Error ? runError.message : "Check failed",
        suggestedFix: "Verify the terminal server is running and the workspace is mounted.",
      });
    }
  }

  // Fetch approvals + checkpoints in parallel
  const [approvals, checkpoints] = await Promise.all([
    listPendingApprovals(projectId, userId),
    listCheckpoints(projectId, userId),
  ]);

  // Summarize
  const passed = results.filter((r) => r.status === "passed").length;
  const failed = results.filter((r) => r.status === "failed").length;
  const notConfigured = results.filter((r) => r.status === "not_configured").length;

  return NextResponse.json({
    checks: results,
    changedFiles,
    pendingApprovals: approvals,
    checkpoints: checkpoints.slice(0, 20),
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
  });
}

function suggestFix(checkId: CheckId, _output: string): string {
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
