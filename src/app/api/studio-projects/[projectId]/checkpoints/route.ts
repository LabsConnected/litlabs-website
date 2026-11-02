import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getProject, verifyProjectWorkspace } from "@/lib/projects/project-repository";
import { listCheckpoints, createCheckpoint } from "@/lib/missions/mission-repository";
import { requireTerminalBaseUrl, terminalNotConfiguredResponse } from "@/lib/terminal-config";

/**
 * GET /api/studio-projects/[projectId]/checkpoints
 * List all checkpoints for a project.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { userId } = await auth(_request);
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
  const { userId } = await auth(request);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const terminalUnavailable = terminalNotConfiguredResponse();
  if (terminalUnavailable) return terminalUnavailable;

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
    const terminalBase = requireTerminalBaseUrl();

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
      const data = (await resp.json()) as { exitCode: number; stdout: string; stderr?: string };
      // The endpoint returns HTTP 200 even when the command itself fails —
      // check the exit code, otherwise a failed `git commit` would silently
      // record a checkpoint pointing at the previous (stale) SHA.
      if (data.exitCode !== 0) {
        const err = new Error(`Git command failed (exit ${data.exitCode}): ${command}${data.stderr ? ` — ${data.stderr.slice(0, 200)}` : ""}`) as Error & { gitless?: boolean };
        if (/not a git repository/i.test(data.stderr ?? "")) err.gitless = true;
        throw err;
      }
      return data;
    };

    // A workspace without a git repository cannot take checkpoints — report
    // that truthfully (409) instead of a misleading 500 "git failed".
    // The workspace must be the ROOT of its own repo: a workspace nested
    // inside an outer checkout (e.g. TERMINAL_WORKSPACE_ROOT inside a repo)
    // still answers "inside work tree = true", but `git add/commit` would
    // then mutate the OUTER repository's index and history — corrupting it.
    // `--git-dir` is ".git" exactly when cwd is the repo toplevel; a nested
    // workspace resolves to the OUTER repo's gitdir (absolute/relative path).
    const probe = await execInWorkspace("git rev-parse --is-inside-work-tree --git-dir");
    const [inside, gitDir] = probe.stdout.split(/\r?\n/).map((l) => l.trim());
    if (inside !== "true" || gitDir !== ".git") {
      const err = new Error("Workspace has no git repository of its own") as Error & { gitless?: boolean };
      err.gitless = true;
      throw err;
    }
    await execInWorkspace("git add .");
    // Pass the commit message via stdin (--file=-) so the label never touches
    // the shell parser. This prevents command injection via backticks, $(),
    // newlines, or any other shell metacharacters in the user-supplied label.
    // (stdin is piped through the ExecutionGateway → ShellExecutor; the
    // gateway refactor briefly dropped it, which hung checkpoint creation.)
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
    if ((err as { gitless?: boolean }).gitless) {
      return NextResponse.json(
        { error: "Checkpoints unavailable — this workspace has no git repository", code: "WORKSPACE_GITLESS" },
        { status: 409 },
      );
    }
    const message = err instanceof Error ? err.message : "Failed to create checkpoint";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
