import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { getProject, verifyProjectWorkspace } from "@/lib/projects/project-repository";
import { listCheckpoints, createCheckpoint, getCheckpoint } from "@/lib/missions/mission-repository";
import { createTerminalToken } from "@/lib/terminal-auth";

const TERMINAL_BASE = () =>
  process.env.TERMINAL_SERVER_INTERNAL_URL ??
  process.env.NEXT_PUBLIC_TERMINAL_WS_URL ??
  "http://localhost:4001";

/**
 * GET /api/studio-projects/[projectId]/checkpoints
 * List all checkpoints for a project.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { projectId } = await params;
  const project = await getProject(projectId, userId);
  if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

  const checkpoints = await listCheckpoints(projectId, userId);
  return NextResponse.json({ checkpoints });
}

/**
 * POST /api/studio-projects/[projectId]/checkpoints
 * Create a manual checkpoint (Git commit in the workspace).
 * Body: { label: string, description?: string }
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { projectId } = await params;
  let body: { label?: string; description?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body.label || body.label.trim().length < 2) {
    return NextResponse.json({ error: "Label must be at least 2 characters" }, { status: 400 });
  }

  try {
    const { workspaceId } = await verifyProjectWorkspace(projectId, userId);

    // Create a Git commit via terminal-server's exec endpoint
    const internalKey = process.env.TERMINAL_INTERNAL_SERVICE_KEY ?? "";
    const terminalBase = process.env.TERMINAL_SERVER_INTERNAL_URL ??
      process.env.NEXT_PUBLIC_TERMINAL_WS_URL ?? "http://localhost:4001";

    const execInWorkspace = async (command: string, stdin?: string) => {
      const resp = await fetch(`${terminalBase}/internal/workspace/${workspaceId}/exec`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Internal-Service-Key": internalKey,
        },
        body: JSON.stringify({ command, userId, stdin }),
      });
      if (!resp.ok) throw new Error(`Git command failed: ${resp.status}`);
      return (await resp.json()) as { exitCode: number; stdout: string };
    };

    await execInWorkspace("git add .");
    // Pass the commit message via stdin (--file=-) so the label never touches
    // the shell parser. This prevents command injection via backticks, $(),
    // newlines, or any other shell metacharacters in the user-supplied label.
    const commitMessage = body.description
      ? `${body.label}\n\n${body.description}`
      : body.label;
    await execInWorkspace("git commit --file=-", commitMessage);
    const shaResult = await execInWorkspace("git rev-parse HEAD");
    const gitSha = shaResult.stdout.trim();

    const checkpoint = await createCheckpoint({
      projectId,
      userId,
      gitSha,
      label: body.label,
      description: body.description,
    });

    return NextResponse.json({ checkpoint }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to create checkpoint";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
