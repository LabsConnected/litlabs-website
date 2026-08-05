import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { createTerminalToken } from "@/lib/terminal-auth";
import { verifyProjectWorkspace } from "@/lib/projects/project-repository";

export const runtime = "nodejs";

/**
 * GET /api/terminal/token
 * GET /api/terminal/token?projectId=xxx
 *
 * Issues a terminal token. If projectId is provided, verifies that the
 * user owns the project and that the workspace is ready, then includes
 * workspaceId and projectId in the token claims.
 */
export async function GET(request: NextRequest) {
  const { userId } = await auth(request);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const projectId = request.nextUrl.searchParams.get("projectId");

  try {
    // If projectId is provided, the token MUST be bound to the project's
    // workspace. We do NOT issue a fallback unbound token — that would let
    // the terminal server open a generic directory instead of the actual
    // repository, silently hiding the provisioning failure.
    if (projectId) {
      try {
        const { workspaceId } = await verifyProjectWorkspace(projectId, userId);
        return NextResponse.json(
          createTerminalToken(userId, { workspaceId, projectId }),
          { headers: { "Cache-Control": "no-store" } },
        );
      } catch (err) {
        // Workspace is not ready — tell the client to prepare it first.
        // The UI should call POST /api/studio-projects/[projectId]/workspace/prepare,
        // wait until workspaceStatus === "ready", then retry this endpoint.
        return NextResponse.json(
          {
            code: "WORKSPACE_NOT_READY",
            error: "Prepare the project workspace before opening the terminal.",
            detail: err instanceof Error ? err.message : undefined,
          },
          { status: 409, headers: { "Cache-Control": "no-store" } },
        );
      }
    }

    // No projectId — issue a plain token (for non-project terminals)
    return NextResponse.json(createTerminalToken(userId), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return NextResponse.json(
      { error: "Terminal authentication is unavailable" },
      { status: 503 },
    );
  }
}
