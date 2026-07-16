/**
 * /api/loops/[id]/approve
 *
 *   POST — record a human decision on a loop that's awaiting approval.
 *          Decisions: approve | iterate | edit_instructions | revert | ship
 *
 *          - `ship` triggers the ship flow (open PR / record PR URL).
 *          - `iterate` resets the loop into `executing` so the user can
 *            hit /iterate again.
 *          - everything else just records the decision so the UI can
 *            show what happened.
 */

import { NextResponse } from "next/server";
import {
  appendEvent,
  getLoop,
  recordApproval,
  updateLoop,
} from "@/lib/project-loops/store";
import { openPullRequest } from "@/lib/project-loops/github";
import type { LoopApproval } from "@/types/project-loops";

export const dynamic = "force-dynamic";

const VALID = new Set<LoopApproval["decision"]>([
  "approve",
  "iterate",
  "edit_instructions",
  "revert",
  "ship",
]);

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const loop = await getLoop(id);
  if (!loop) {
    return NextResponse.json({ error: "Loop not found" }, { status: 404 });
  }

  let body: { decision?: string; note?: string } = {};
  try {
    body = (await request.json()) as { decision?: string; note?: string };
  } catch {
    body = {};
  }
  const decision = String(body.decision ?? "");
  if (!VALID.has(decision as LoopApproval["decision"])) {
    return NextResponse.json(
      { error: `decision must be one of: ${[...VALID].join(", ")}` },
      { status: 400 },
    );
  }

  const approval: LoopApproval = {
    iteration: loop.iteration,
    decision: decision as LoopApproval["decision"],
    note: body.note,
    at: new Date().toISOString(),
  };

  await appendEvent({
    id: `evt_appr_${Date.now().toString(36)}`,
    loopId: id,
    iteration: loop.iteration,
    role: "ship",
    phase: "shipping",
    level: "phase",
    message: `Human ${decision}${body.note ? `: ${body.note}` : ""}`,
    at: approval.at,
  });

  // "ship" actually opens the PR; everything else just records.
  if (decision === "ship") {
    try {
      const diff = loop.lastDiff?.files ?? [];
      const title = `Loop ${loop.id}: ${loop.goal.slice(0, 60)}`;
      const bodyText =
        `## Project Loop\n\n` +
        `**Goal:** ${loop.goal}\n\n` +
        `**Acceptance criteria:**\n` +
        `${loop.acceptanceCriteria.map((c) => `- ${c}`).join("\n") || "_(none)_"}\n\n` +
        `**Iteration:** ${loop.iteration}\n` +
        `**Files changed:** ${loop.fileChanges}\n\n` +
        `_Shipped via LiTT Project Loops._`;
      const pr = await openPullRequest(loop, diff, title, bodyText);
      const updated = await recordApproval(id, {
        ...approval,
        decision: "ship",
      });
      await updateLoop(id, { pullRequestUrl: pr.url });
      return NextResponse.json({ ok: true, approval, pr, loop: updated });
    } catch (err) {
      return NextResponse.json(
        {
          error:
            err instanceof Error ? err.message : "Failed to open pull request",
        },
        { status: 500 },
      );
    }
  }

  const updated = await recordApproval(id, approval);
  return NextResponse.json({ ok: true, approval, loop: updated });
}
