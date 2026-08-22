/**
 * GET /api/studio/evidence?runId=xxx&projectId=yyy
 *
 * Returns mutation evidence + run events + check evidence for the
 * Changes, Activity, and Checks panels. One API, three data sets.
 *
 * Phase 7-8 — Studio Control Plane V1
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getEvidenceStore } from "@/lib/litt-intelligence/evidence-store";
import { getRunEventStore } from "@/lib/litt-intelligence/run-event-store";
import { getCheckEvidenceStore } from "@/lib/litt-intelligence/check-evidence-store";
import { getAcceptanceEvidenceStore } from "@/lib/litt-intelligence/acceptance-evidence-store";

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
  const checkStore = getCheckEvidenceStore();
  const acceptanceStore = getAcceptanceEvidenceStore();

  // Fetch evidence (mutations)
  const evidence = runId
    ? await evidenceStore.listByRun(runId)
    : await evidenceStore.listByProject(projectId);

  // Fetch run events (activity)
  const events = runId
    ? await runEventStore.listByRun(runId)
    : await runEventStore.listByProject(projectId);

  // Fetch check evidence (checks)
  const checks = runId
    ? await checkStore.listByRun(runId)
    : await checkStore.listByProject(projectId);

  // Fetch acceptance evidence
  const acceptance = runId
    ? await acceptanceStore.listByRun(runId)
    : await acceptanceStore.listByProject(projectId);

  return NextResponse.json({
    evidence,
    events,
    checks,
    acceptance,
  });
}
