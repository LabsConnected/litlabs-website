import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { getProject, verifyProjectWorkspace } from "@/lib/projects/project-repository";
import { getCheckpoint } from "@/lib/missions/mission-repository";
import { logFileOperation } from "@/lib/file-audit";

const TERMINAL_BASE = () =>
  process.env.TERMINAL_SERVER_INTERNAL_URL ??
  process.env.NEXT_PUBLIC_TERMINAL_WS_URL ??
  "http://localhost:4001";

export async function POST(
  _request: NextRequest,
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

    await execInWorkspace(`git reset --hard ${checkpoint.gitSha}`);
    await execInWorkspace("git clean -fd");

    await logFileOperation({
      userId, projectId, workspaceId, action: "delete", path: "* (rollback)", source: "system", ok: true, error: undefined,
    });

    return NextResponse.json({ ok: true, checkpoint, message: `Rolled back to ${checkpoint.label} (${checkpoint.gitSha.slice(0, 8)})` });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Rollback failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}