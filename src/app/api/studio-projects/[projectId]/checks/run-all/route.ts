import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { terminalNotConfiguredResponse } from "@/lib/terminal-config";
import {
  ProjectChecksUnavailableError,
  runAllProjectChecks,
  saveProjectCheckRun,
} from "@/lib/projects/project-checks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/studio-projects/[projectId]/checks/run-all
 *
 * Runs ALL applicable health checks sequentially against the active workspace.
 * Returns the complete results array.
 *
 * This is the endpoint LiTT calls when the user says
 * "Run a complete project health check and summarize what matters."
 *
 * Safe read-only checks — no write approval required.
 *
 * ACC-07: the run itself lives in lib/projects/project-checks (shared
 * with the agent loop's automatic completion checks), and the results
 * are persisted so the Checks panel keeps showing them after a reload
 * instead of resetting to "Not run".
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

  let outcome;
  try {
    outcome = await runAllProjectChecks({ projectId, userId });
  } catch (error) {
    if (error instanceof ProjectChecksUnavailableError) {
      return NextResponse.json(error.body, { status: error.status });
    }
    throw error;
  }

  await saveProjectCheckRun({
    projectId,
    userId,
    checks: outcome.checks,
    summary: outcome.summary,
  });

  return NextResponse.json({
    checks: outcome.checks,
    changedFiles: outcome.changedFiles,
    pendingApprovals: outcome.pendingApprovals,
    checkpoints: outcome.checkpoints,
    summary: outcome.summary,
    project: outcome.project,
  });
}
