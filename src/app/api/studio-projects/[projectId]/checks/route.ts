import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getProject, verifyProjectWorkspace } from "@/lib/projects/project-repository";
import { listCheckpoints } from "@/lib/missions/mission-repository";
import { listPendingApprovals } from "@/lib/missions/mission-repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

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

async function runWorkspaceCommand(workspaceId: string, userId: string, command: string) {
  const terminalBase = process.env.TERMINAL_SERVER_INTERNAL_URL ?? process.env.NEXT_PUBLIC_TERMINAL_WS_URL ?? "http://localhost:4001";
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
          error: null,
        }))
      : emptyChecks(project.workspaceError ?? "Project workspace is not ready"),
    changedFiles,
    pendingApprovals: approvals,
    checkpoints: checkpoints.slice(0, 20),
  };
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { userId } = await auth(request);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { projectId } = await params;
  const payload = await baseResponse(projectId, userId);
  if (!payload) return NextResponse.json({ error: "Project not found" }, { status: 404 });
  return NextResponse.json(payload, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { userId } = await auth(request);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
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
    return NextResponse.json({
      check: {
        id: checkId,
        label: check === "typecheck" ? "TypeScript" : check[0].toUpperCase() + check.slice(1),
        status: result.exitCode === 0 ? "passed" : "failed",
        source: `Active project workspace · ${command}`,
        timestamp,
        durationMs: result.durationMs ?? null,
        output: output.slice(0, 100000),
        error: result.exitCode === 0 ? null : `Command exited with code ${result.exitCode ?? 1}`,
      } satisfies CheckResult,
    }, { status: result.exitCode === 0 ? 200 : 422 });
  } catch (error) {
    return NextResponse.json({
      check: {
        id: checkId,
        label: check === "typecheck" ? "TypeScript" : check[0].toUpperCase() + check.slice(1),
        status: "failed",
        source: `Active project workspace · ${command}`,
        timestamp,
        output: null,
        error: error instanceof Error ? error.message : "Check failed",
      } satisfies CheckResult,
    }, { status: 422 });
  }
}
