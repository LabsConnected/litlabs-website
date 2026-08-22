/**
 * GET /api/studio/evidence?runId=xxx&projectId=yyy
 *
 * Returns mutation evidence + run events for the Changes and Activity panels.
 * One API, two data sets — the panels filter client-side.
 *
 * Phase 7 — Studio Control Plane V1
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getEvidenceStore } from "@/lib/litt-intelligence/evidence-store";
import { getRunEventStore } from "@/lib/litt-intelligence/run-event-store";

export async function GET(request: NextRequest) {
  const { userId } = await auth(request);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const runId = searchParams.get("runId");
  const projectId = searchParams.get("projectId");

  if (!projectId) {
    return NextResponse.json({ error: "Missing projectId" }, { status: 400 });
  }

  const evidenceStore = getEvidenceStore();
  const runEventStore = getRunEventStore();

  // Fetch evidence (mutations)
  const evidence = runId
    ? await evidenceStore.listByRun(runId)
    : await evidenceStore.listByProject(projectId);

  // Fetch run events (activity)
  const events = runId
    ? await runEventStore.listByRun(runId)
    : await runEventStore.listByProject(projectId);

  return NextResponse.json({
    evidence,
    events,
  });
}
