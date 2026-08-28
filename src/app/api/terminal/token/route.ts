import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { createTerminalToken } from "@/lib/terminal-auth";
import { verifyProjectWorkspace, updateProjectWorkspace } from "@/lib/projects/project-repository";
import { getWorkspaceInternal } from "@/lib/terminal-internal-client";

export const runtime = "nodejs";

/**
 * GET /api/terminal/token
 * GET /api/terminal/token?projectId=xxx
 *
 * Issues a terminal token. If projectId is provided, verifies that the
 * user owns the project, that Supabase says the workspace is ready, AND
 * that the workspace still exists on the terminal server. If the terminal
 * server lost the workspace (restart, ephemeral storage), resets the
 * Supabase workspace status so the client can re-provision.
 */
export async function GET(request: NextRequest) {
  const { userId } = await auth(request);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const projectId = request.nextUrl.searchParams.get("projectId");
  // The baseUrl is used by the browser to connect the WebSocket.
  // TERMINAL_SERVER_URL is the internal Railway URL (not browser-reachable).
  // NEXT_PUBLIC_TERMINAL_WS_URL is the public WebSocket URL the browser needs.
  const baseUrl = process.env.NEXT_PUBLIC_TERMINAL_WS_URL || process.env.TERMINAL_SERVER_URL || "";

  try {
    // If projectId is provided, the token MUST be bound to the project's
    // workspace. We do NOT issue a fallback unbound token — that would let
    // the terminal server open a generic directory instead of the actual
    // repository, silently hiding the provisioning failure.
    if (projectId) {
      try {
        const { workspaceId } = await verifyProjectWorkspace(projectId, userId);

        // Supabase says the workspace is ready, but the terminal server is
        // the source of truth for whether the workspace actually exists.
        // Verify before issuing the token — if the terminal server lost the
        // workspace (restart, ephemeral /tmp storage), reset Supabase so the
        // client's self-heal flow can re-provision.
        try {
          const ws = await getWorkspaceInternal(workspaceId, userId);
          if (!ws) {
            await updateProjectWorkspace(projectId, userId, {
              workspaceStatus: "not_prepared",
              workspaceError: "Workspace lost on terminal server — needs re-provisioning",
            });
            return NextResponse.json(
              {
                code: "WORKSPACE_NOT_READY",
                error: "Workspace was lost on the terminal server. Re-preparing...",
                detail: "Workspace not found on terminal server",
              },
              { status: 409, headers: { "Cache-Control": "no-store" } },
            );
          }
        } catch {
          // Terminal server unreachable — fail soft with WORKSPACE_NOT_READY
          // so the client can retry. Don't issue a token we can't validate.
          return NextResponse.json(
            {
              code: "WORKSPACE_NOT_READY",
              error: "Terminal server unreachable. Retrying...",
              detail: "Could not verify workspace on terminal server",
            },
            { status: 409, headers: { "Cache-Control": "no-store" } },
          );
        }

        const tokenData = createTerminalToken(userId, { workspaceId, projectId });
        return NextResponse.json(
          { ...tokenData, baseUrl },
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
    const plainToken = createTerminalToken(userId);
    return NextResponse.json(
      { ...plainToken, baseUrl },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return NextResponse.json(
      { error: "Terminal authentication is unavailable" },
      { status: 503 },
    );
  }
}
