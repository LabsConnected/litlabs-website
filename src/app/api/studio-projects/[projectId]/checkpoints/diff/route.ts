import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getProject, verifyProjectWorkspace } from "@/lib/projects/project-repository";
import { diffWorkspaceCheckpoints } from "@/lib/missions/workspace-checkpoint";

/**
 * GET /api/studio-projects/[projectId]/checkpoints/diff?from=<sha>&to=<sha>
 *
 * File list + readable unified diff between two checkpoints — powers the
 * inspector's Changes tab (Accept / Revert) and survives a refresh because
 * both SHAs are persisted checkpoint rows.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { userId } = await auth(request);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { projectId } = await params;
  const project = await getProject(projectId, userId);
  if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

  const from = request.nextUrl.searchParams.get("from") ?? "";
  const to = request.nextUrl.searchParams.get("to") ?? "";
  if (!/^[0-9a-f]{7,40}$/i.test(from) || !/^[0-9a-f]{7,40}$/i.test(to)) {
    return NextResponse.json({ error: "from and to must be 7-40 hex commit SHAs" }, { status: 400 });
  }

  try {
    const { workspaceId } = await verifyProjectWorkspace(projectId, userId);
    const diff = await diffWorkspaceCheckpoints(workspaceId, userId, from, to);
    return NextResponse.json(diff);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Diff failed" },
      { status: 502 },
    );
  }
}
