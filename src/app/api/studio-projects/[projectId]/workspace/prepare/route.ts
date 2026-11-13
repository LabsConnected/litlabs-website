import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getProject } from "@/lib/projects/project-repository";
import { resolveSourceKind } from "@/lib/projects/project-source";
import { provisionWorkspaceForProject } from "@/lib/studio/workspace-recovery";
import {
  errorCarriesHostExecutionDisabled,
  hostExecutionDisabledResponse,
  isHostExecutionPermitted,
} from "@/lib/host-execution-guard";

/**
 * POST /api/studio-projects/[projectId]/workspace/prepare
 *
 * The shared provisioning service owns the database lock and all terminal
 * preparation. This route is intentionally only an authenticated adapter;
 * it must not maintain a second prepare implementation.
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { userId } = await auth(_request);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { projectId } = await params;
  const project = await getProject(projectId, userId);
  if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });
  if (project.userId !== userId) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  // Repo gate (B2): a GitHub-backed project whose workspace is not ready
  // can only be refused by the terminal server's fail-closed isolation
  // policy in an environment where host execution is not permitted —
  // that outcome is knowable from project facts alone. Answer with the
  // standard coded gate response WITHOUT running the doomed attempt:
  // no terminal round-trip, and the project row is never stamped
  // "failed" for a deliberate product decision. Callers already map
  // this exact body to the "not available yet" gate presentation.
  // A ready workspace falls through (GitHub mirror refresh still runs),
  // and trusted local environments are unaffected.
  if (
    project.workspaceStatus !== "ready" &&
    resolveSourceKind(project) === "github" &&
    !isHostExecutionPermitted()
  ) {
    return NextResponse.json(
      hostExecutionDisabledResponse("workspace.prepare"),
      { status: 503 },
    );
  }

  try {
    const workspaceId = await provisionWorkspaceForProject(projectId, userId);
    const refreshed = await getProject(projectId, userId);
    return NextResponse.json({
      workspaceId,
      workspaceStatus: "ready",
      workspaceRoot: refreshed?.workspaceRoot ?? null,
      branch: refreshed?.workspaceBranch ?? null,
    });
  } catch (err) {
    // The terminal-server's fail-closed refusal carries the
    // HOST_EXECUTION_DISABLED code all the way up (attached by the
    // terminal client, preserved by the provisioning service) — this
    // catch used to drop it and return an unmapped 500 whose body was
    // the raw message with the JSON code string embedded, which is
    // what callers then rendered verbatim. Map it to the standard
    // 503 + coded body (same shape as /api/agents/commits); genuinely
    // unexpected errors keep the 500.
    if (errorCarriesHostExecutionDisabled(err)) {
      return NextResponse.json(
        hostExecutionDisabledResponse("workspace.prepare"),
        { status: 503 },
      );
    }
    const message = err instanceof Error ? err.message : "Workspace provisioning failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
