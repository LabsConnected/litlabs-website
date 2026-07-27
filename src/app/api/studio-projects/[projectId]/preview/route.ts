import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { getProject, verifyProjectWorkspace, updateProjectRuntime } from "@/lib/projects/project-repository";

const TERMINAL_BASE = () =>
  process.env.TERMINAL_SERVER_INTERNAL_URL ??
  process.env.NEXT_PUBLIC_TERMINAL_WS_URL ??
  "http://localhost:4001";

/**
 * GET /api/studio-projects/[projectId]/preview
 * Get the preview URL for a project. Returns the preview status and URL
 * if the preview server is running.
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

  return NextResponse.json({
    runtimeStatus: project.runtimeStatus,
    previewUrl: project.previewUrl,
    runtimeError: project.runtimeError,
  });
}

/**
 * POST /api/studio-projects/[projectId]/preview
 * Start or refresh the preview server for a project.
 * For static sites: serves files from the workspace root.
 * For Next.js/Vite: starts the dev server in the workspace.
 *
 * Body: { action: "start" | "stop" | "refresh" }
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { projectId } = await params;
  let body: { action?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const action = body.action ?? "start";

  try {
    const { workspaceId, project } = await verifyProjectWorkspace(projectId, userId);

    if (action === "stop") {
      // Stop the preview via terminal-server
      await fetch(`${TERMINAL_BASE()}/internal/workspace/${workspaceId}/preview/stop`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Internal-Service-Key": process.env.TERMINAL_INTERNAL_SERVICE_KEY ?? "",
        },
        body: JSON.stringify({ userId }),
      }).catch(() => {});

      await updateProjectRuntime(projectId, userId, {
        runtimeStatus: "stopped",
        previewUrl: null,
      });
      return NextResponse.json({ runtimeStatus: "stopped", previewUrl: null });
    }

    // Start the preview
    await updateProjectRuntime(projectId, userId, {
      runtimeStatus: "starting",
      runtimeError: null,
    });

    const { token } = createTerminalToken(userId);
    const resp = await fetch(`${TERMINAL_BASE()}/internal/workspace/${workspaceId}/preview/start`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Internal-Service-Key": process.env.TERMINAL_INTERNAL_SERVICE_KEY ?? "",
      },
      body: JSON.stringify({
        userId,
        framework: project.framework,
        packageManager: project.packageManager,
        developmentCommand: project.developmentCommand,
      }),
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => "Unknown error");
      await updateProjectRuntime(projectId, userId, {
        runtimeStatus: "failed",
        runtimeError: text,
      });
      return NextResponse.json({ error: text }, { status: 502 });
    }

    const data = (await resp.json()) as { previewUrl: string; port: number };

    // Construct the preview URL — proxy through Next.js to avoid exposing terminal-server
    const proxyUrl = `/api/studio-projects/${projectId}/preview/proxy`;

    await updateProjectRuntime(projectId, userId, {
      runtimeStatus: "ready",
      previewUrl: proxyUrl,
    });

    return NextResponse.json({
      runtimeStatus: "ready",
      previewUrl: proxyUrl,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Preview failed";
    await updateProjectRuntime(projectId, userId, {
      runtimeStatus: "failed",
      runtimeError: message,
    });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
