/**
 * /api/loops/[id]/iterate
 *
 *   POST — kick off one full run of the loop (until it lands in
 *          `awaiting_approval` or trips a limit). The runner runs
 *          asynchronously; the client polls `/events` to follow along.
 */

import { NextResponse } from "next/server";
import { runLoop } from "@/lib/project-loops/runner";
import {
  appendEvent,
  getLoop,
  updateLoop,
} from "@/lib/project-loops/store";

export const dynamic = "force-dynamic";
// The runner is long-lived; don't let Next.js try to pre-render.
export const maxDuration = 300; // 5 min cap per call

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const loop = await getLoop(id);
  if (!loop) {
    return NextResponse.json({ error: "Loop not found" }, { status: 404 });
  }

  // Reset transient state before re-running
  await updateLoop(id, {
    status: "executing",
    phase: "inspecting",
    tokensUsed: 0,
    costCents: 0,
    fileChanges: 0,
  });

  // Fire-and-forget the runner. Events are streamed via the /events
  // endpoint; the client polls it every 1.5s to render the live feed.
  void (async () => {
    try {
      const live = await getLoop(id);
      if (!live) return;
      const result = await runLoop(live, {
        emit: async (event) => {
          try {
            await appendEvent(event);
            await updateLoop(id, {
              phase: event.phase,
              tokensUsed: live.tokensUsed,
              costCents: live.costCents,
              fileChanges: live.fileChanges,
              iteration: event.iteration,
            });
          } catch {
            /* swallow event-store errors so the runner keeps going */
          }
        },
      });

      const finalLoop = await getLoop(id);
      if (finalLoop) {
        await updateLoop(id, {
          status: result.status,
          phase: result.phase,
          lastDiff: result.diff ?? finalLoop.lastDiff,
          lastReview: result.review ?? finalLoop.lastReview,
        });
      }
    } catch (err) {
      await updateLoop(id, {
        status: "failed",
        phase: "done",
      });
      await appendEvent({
        id: `evt_err_${Date.now().toString(36)}`,
        loopId: id,
        iteration: 0,
        phase: "done",
        level: "error",
        message: `Runner crashed: ${err instanceof Error ? err.message : "unknown"}`,
        at: new Date().toISOString(),
      });
    }
  })();

  return NextResponse.json({ ok: true, id, started: true });
}
