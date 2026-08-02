import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { getProject, verifyProjectWorkspace } from "@/lib/projects/project-repository";
import { getCheckpoint } from "@/lib/missions/mission-repository";
import { logFileOperation } from "@/lib/file-audit";

const TERMINAL_BASE = () =>
  process.env.TERMINAL_SERVER_INTERNAL_URL ??
  process.env.NEXT_PUBLIC_TERMINAL_WS_URL ??
  "http://localhost:4001";

const GIT_SHA_PATTERN = /^[0-9a-f]{7,40}$/i;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string; checkpointId: string }> },
) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { projectId, checkpointId } = await params;
  const project = await getProject(projectId, userId);
  if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

  const checkpoint = await getCheckpoint(checkpointId, userId);
  if (!checkpoint) return NextResponse.json({ error: "Checkpoint not found" }, { status: 404 });
  if (checkpoint.projectId !== projectId) return NextResponse.json({ error: "Checkpoint does not belong to this project" }, { status: 403 });
  if (checkpoint.userId !== userId) return NextResponse.json({ error: "Checkpoint does not belong to this user" }, { status: 403 });

  // Validate gitSha format — reject arbitrary commit values
  if (!GIT_SHA_PATTERN.test(checkpoint.gitSha)) {
    return NextResponse.json({ error: "Invalid checkpoint git SHA format" }, { status: 400 });
  }

  // Require explicit confirmation in the request body
  let body: { confirm?: boolean };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!body.confirm) {
    return NextResponse.json(
      { error: "Rollback requires explicit confirmation. Send { confirm: true } to proceed." },
      { status: 400 },
    );
  }

  try {
    const { workspaceId } = await verifyProjectWorkspace(projectId, userId);
    const internalKey = process.env.TERMINAL_INTERNAL_SERVICE_KEY ?? "";
    const terminalBase = TERMINAL_BASE();

    const execInWorkspace = async (command: string) => {
      const resp = await fetch(`${terminalBase}/internal/workspace/${workspaceId}/exec`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Internal-Service-Key": internalKey },
        body: JSON.stringify({ command, userId }),
      });
      if (!resp.ok) throw new Error(`Git command failed: ${resp.status}`);
      return (await resp.json()) as { exitCode: number; stdout: string; stderr: string };
    };

    // Capture list of files before rollback for summary
    const beforeResult = await execInWorkspace("git ls-files");
    const beforeFiles = beforeResult.stdout.trim().split("\n").filter(Boolean);

    // Audit before execution
    await logFileOperation({
      userId, projectId, workspaceId, action: "delete", path: "* (rollback initiated)", source: "system", ok: true, error: undefined,
    });

    // Execute rollback — use the checkpoint's validated gitSha
    await execInWorkspace(`git reset --hard ${checkpoint.gitSha}`);
    await execInWorkspace("git clean -fd");

    // Capture list of files after rollback for summary
    const afterResult = await execInWorkspace("git ls-files");
    const afterFiles = afterResult.stdout.trim().split("\n").filter(Boolean);

    const deletedFiles = beforeFiles.filter((f) => !afterFiles.includes(f));
    const addedFiles = afterFiles.filter((f) => !beforeFiles.includes(f));

    // Audit after execution
    await logFileOperation({
      userId, projectId, workspaceId, action: "delete", path: "* (rollback completed)", source: "system", ok: true, error: undefined,
    });

    return NextResponse.json({
      ok: true,
      checkpoint,
      message: `Rolled back to ${checkpoint.label} (${checkpoint.gitSha.slice(0, 8)})`,
      summary: {
        deletedFiles,
        addedFiles,
        beforeCount: beforeFiles.length,
        afterCount: afterFiles.length,
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Rollback failed";

    // Audit failed rollback
    await logFileOperation({
      userId, projectId, workspaceId: "unknown", action: "delete", path: "* (rollback failed)", source: "system", ok: false, error: msg,
    }).catch(() => {});

    return NextResponse.json({ error: msg }, { status: 500 });
  }
}