import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { executeProjectTool } from "@/lib/project-tools/registry";
import { studioLog } from "@/lib/studio/logger";

/**
 * POST /api/studio/rollback
 *
 * Rollback the workspace to a checkpoint SHA by calling the
 * restore_checkpoint project tool (git reset --hard <sha>).
 *
 * This is a destructive operation — it requires:
 *   1. Authenticated Clerk session
 *   2. A valid project_id owned by the user
 *   3. A checkpoint SHA (7-40 hex chars)
 *
 * The tool handler re-verifies ownership via getProject(projectId, userId).
 */
export async function POST(req: Request) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const projectId = typeof body.projectId === "string" ? body.projectId : null;
    const sha = typeof body.sha === "string" ? body.sha : null;

    if (!projectId) {
      return NextResponse.json({ error: "projectId is required" }, { status: 400 });
    }
    if (!sha) {
      return NextResponse.json({ error: "sha is required" }, { status: 400 });
    }
    if (!/^[0-9a-f]{7,40}$/i.test(sha)) {
      return NextResponse.json({ error: "Invalid commit hash (7-40 hex chars)" }, { status: 400 });
    }

    const result = await executeProjectTool("restore_checkpoint", userId, {
      project_id: projectId,
      sha,
    });

    if (!result.success) {
      return NextResponse.json({ error: result.message }, { status: 400 });
    }

    studioLog("rollback:succeeded", { userId, projectId, tool: "restore_checkpoint" });

    return NextResponse.json({
      success: true,
      message: result.message,
      sha,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Rollback failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
