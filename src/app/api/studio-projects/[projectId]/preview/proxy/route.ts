import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getProject } from "@/lib/projects/project-repository";
import { getPreviewStatusInternal, buildPreviewProxyUrl } from "@/lib/terminal-internal-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/studio-projects/[projectId]/preview/proxy
 *
 * DEPRECATED: This route previously tried to read workspace files from
 * the Vercel filesystem using readFileSync — which doesn't work because
 * workspaces live on the Railway terminal server.
 *
 * This route now redirects to the real Railway preview proxy URL,
 * which proxies to the actual running dev server.
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  const { userId } = await auth(_request);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { projectId } = await params;
  const project = await getProject(projectId, userId);
  if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });
  if (!project.workspaceId) return NextResponse.json({ error: "Workspace not provisioned" }, { status: 409 });

  // Check that the preview is actually ready on the terminal server
  try {
    const status = await getPreviewStatusInternal(project.workspaceId, userId);
    if (!status || status.status !== "ready") {
      return NextResponse.json({
        error: "Preview not ready",
        runtimeStatus: status?.status ?? "stopped",
      }, { status: 503 });
    }

    // Redirect to the real Railway preview proxy
    const realUrl = buildPreviewProxyUrl(project.workspaceId);
    return NextResponse.redirect(realUrl, { status: 302 });
  } catch (err) {
    return NextResponse.json({
      error: err instanceof Error ? err.message : "Preview proxy unavailable",
    }, { status: 502 });
  }
}
