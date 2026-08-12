import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { updateProjectWorkspaceType } from "@/lib/projects/project-repository";

/**
 * PATCH /api/studio-projects/[projectId]/workspace-type
 *
 * Persists the LiTT Creation Workspace project type (website, html,
 * game2d, game3d, app, component) to the server so it survives
 * logout/login and is shared across devices.
 *
 * Body: { workspaceType: "website" | "html" | "game2d" | "game3d" | "app" | "component" }
 */

const VALID_TYPES = ["website", "html", "game2d", "game3d", "app", "component"];

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { userId } = await auth(request);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { projectId } = await params;

  let body: { workspaceType?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const workspaceType = body.workspaceType;
  if (!workspaceType || !VALID_TYPES.includes(workspaceType)) {
    return NextResponse.json(
      { error: `Invalid workspaceType. Valid: ${VALID_TYPES.join(", ")}` },
      { status: 400 },
    );
  }

  try {
    const project = await updateProjectWorkspaceType(projectId, userId, workspaceType);
    if (!project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }
    return NextResponse.json({ project });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to update workspace type";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
