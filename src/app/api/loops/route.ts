/**
 * /api/loops
 *
 *   GET  — list the current user's loops (most-recent first)
 *   POST — create a new loop from a goal + repo + acceptance criteria
 */

import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import {
  createLoop,
  listLoops,
  newWorkingBranch,
  type CreateLoopInput,
} from "@/lib/project-loops/store";
import { DEFAULT_LIMITS, type ProjectLoop } from "@/types/project-loops";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const loops = await listLoops({ limit: 50 });
    return NextResponse.json({ loops });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to list loops" },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  let userId: string | null = null;
  try {
    const authResult = await auth();
    userId = authResult?.userId ?? null;
  } catch {
    userId = null;
  }

  let body: Partial<CreateLoopInput> = {};
  try {
    body = (await request.json()) as Partial<CreateLoopInput>;
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400 },
    );
  }

  const repo = (body.repo ?? "").trim();
  const goal = (body.goal ?? "").trim();
  if (!repo || !goal) {
    return NextResponse.json(
      { error: "repo and goal are required" },
      { status: 400 },
    );
  }
  if (!/^[^/\s]+\/[^/\s]+$/.test(repo)) {
    return NextResponse.json(
      { error: "repo must look like 'owner/name'" },
      { status: 400 },
    );
  }

  const criteria = Array.isArray(body.acceptanceCriteria)
    ? body.acceptanceCriteria.filter((c): c is string => typeof c === "string")
    : [];

  const input: CreateLoopInput = {
    repo,
    baseBranch: (body.baseBranch ?? "main").trim() || "main",
    workingBranch:
      (body.workingBranch ?? "").trim() ||
      newWorkingBranch(repo, goal),
    goal,
    acceptanceCriteria: criteria,
    status: "draft",
    phase: "queued",
    maxIterations:
      typeof body.maxIterations === "number" && body.maxIterations > 0
        ? Math.min(20, body.maxIterations)
        : DEFAULT_LIMITS.maxIterations,
    limits: { ...DEFAULT_LIMITS, ...(body.limits ?? {}) },
    projectId: body.projectId,
    createdBy: userId ?? body.createdBy ?? undefined,
  };

  try {
    const loop: ProjectLoop = await createLoop(input);
    return NextResponse.json({ loop }, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to create loop" },
      { status: 500 },
    );
  }
}
