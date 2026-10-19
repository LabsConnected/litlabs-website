/**
 * Workstream mission lifecycle — pure rules shared by the event bridge
 * (which applies them) and the shell (which decides who owns the centre).
 *
 * The WorkstreamDock replaces the transcript while LiTT is working. It must
 * hand the centre back the moment the work ends, or the finished answer is
 * rendered into a transcript nobody can see. Agent-loop missions end with
 * mission.completed / mission.failed (not run.completed), so those events
 * have to terminate the workstream, and the next mission must start from a
 * clean workstream rather than inheriting the previous terminal state.
 */

import type { WorkstreamStore, WorkstreamSnapshot } from "./workstream-store.js";

/**
 * Apply a mission lifecycle event to the workstream. Returns true when the
 * event was a mission lifecycle event (handled), false otherwise.
 */
export function applyMissionLifecycle(
  ws: WorkstreamStore,
  type: string,
  data: Record<string, unknown>,
): boolean {
  switch (type) {
    case "run.started": {
      // A new run after a finished one starts clean; the bridge then sets
      // its objective. Not handled here otherwise (returns false).
      const status = ws.snapshot().overallStatus;
      if (status === "complete" || status === "failed") ws.clear();
      return false;
    }
    case "mission.created": {
      ws.clear();
      const goal = typeof data.goal === "string" ? data.goal.trim() : "";
      if (goal) ws.setObjective(goal);
      ws.setWorkstreamPhase("understanding");
      return true;
    }
    case "mission.completed":
      ws.setComplete();
      return true;
    case "mission.failed":
      ws.setFailed();
      return true;
    default:
      return false;
  }
}

/**
 * True while the workstream should own the centre of the shell: work is
 * running, or paused on an approval. Terminal states (complete / failed)
 * return the centre to the transcript, where the answer or error lives.
 */
export function isWorkstreamLive(snapshot: WorkstreamSnapshot | null | undefined): boolean {
  if (!snapshot) return false;
  if (snapshot.activities.length === 0 && !snapshot.objective) return false;
  return snapshot.overallStatus === "running" || snapshot.overallStatus === "blocked";
}
