import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
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
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const projectId = request.nextUrl.searchParams.get("projectId");

  try {
    // If projectId is provided, bind the token to the project's workspace
    if (projectId) {
      try {
        const { workspaceId } = await verifyProjectWorkspace(projectId, userId);
        return NextResponse.json(
          createTerminalToken(userId, { workspaceId, projectId }),
          { headers: { "Cache-Control": "no-store" } },
        );
      } catch {
        // If workspace isn't ready, return a plain token without workspace binding
        // The client can still connect but won't get project-bound PTY
        return NextResponse.json(
          createTerminalToken(userId),
          { headers: { "Cache-Control": "no-store" } },
        );
      }
    }

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
