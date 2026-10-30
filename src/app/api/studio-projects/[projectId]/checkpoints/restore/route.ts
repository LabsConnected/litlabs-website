import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { verifyProjectWorkspace, getProject } from "@/lib/projects/project-repository";
import { getCheckpoint } from "@/lib/missions/mission-repository";
import { requireTerminalBaseUrl, terminalNotConfiguredResponse } from "@/lib/terminal-config";

/**
 * POST /api/studio-projects/[projectId]/checkpoints/restore
 * Body: { checkpointId: string } | { gitSha: string }
 *
 * Restores the workspace to an arbitrary checkpoint by performing
 * git reset --hard <sha> && git clean -fd in the workspace.
 * This provides full revision history restoration beyond undo-latest.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { userId } = await auth(request);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const terminalUnavailable = terminalNotConfiguredResponse();
  if (terminalUnavailable) return terminalUnavailable;

  const { projectId } = await params;
  let body: { checkpointId?: string; gitSha?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  let targetSha: string | null = null;
  if (body.checkpointId) {
    const cp = await getCheckpoint(body.checkpointId, userId);
    if (!cp || cp.projectId !== projectId) {
      return NextResponse.json({ error: "Checkpoint not found" }, { status: 404 });
    }
    targetSha = cp.gitSha;
  } else if (body.gitSha) {
    if (!/^[0-9a-f]{7,40}$/i.test(body.gitSha)) {
      return NextResponse.json({ error: "Invalid gitSha" }, { status: 400 });
    }
    targetSha = body.gitSha;
  } else {
    return NextResponse.json({ error: "Provide checkpointId or gitSha" }, { status: 400 });
  }

  try {
    const { workspaceId } = await verifyProjectWorkspace(projectId, userId);
    const terminalBase = requireTerminalBaseUrl();
    const internalKey = process.env.TERMINAL_INTERNAL_SERVICE_KEY ?? "";

    const exec = async (command: string) => {
      const resp = await fetch(`${terminalBase}/internal/workspace/${workspaceId}/exec`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Internal-Service-Key": internalKey,
        },
        body: JSON.stringify({ command, userId }),
      });
      if (!resp.ok) throw new Error(`exec failed ${resp.status}`);
      const data = (await resp.json()) as { exitCode: number; stdout: string; stderr?: string };
      if (data.exitCode !== 0) throw new Error(`Command failed (${data.exitCode}): ${command} — ${data.stderr?.slice(0, 300) ?? ""}`);
      return data;
    };

    // Verify the sha exists
    await exec(`git cat-file -e ${targetSha}^{commit}`);

    // Restore: hard reset + clean untracked files (parity with git clean -fd)
    await exec(`git reset --hard ${targetSha}`);
    await exec(`git clean -fd`);

    const shaResult = await exec(`git rev-parse HEAD`);
    const currentSha = shaResult.stdout.trim();

    return NextResponse.json({
      restored: true,
      requestedSha: targetSha,
      currentSha,
      checkpointId: body.checkpointId ?? null,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Restore failed";
    // Map git errors to appropriate status
    const status = msg.includes("not found") || msg.includes("cat-file") ? 404 : 502;
    return NextResponse.json({ error: msg }, { status });
  }
}
