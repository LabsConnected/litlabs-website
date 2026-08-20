/**
 * Canonical mission projection — the cockpit's render cache of RuntimeStore
 * mission truth.
 *
 * RuntimeStore.mission is the single source of truth. These helpers project
 * the subset the cockpit renders and provide semantic-equality so the UI can
 * bail out of a state update when the incoming mission is unchanged. This is
 * what prevents an unchanged mission from triggering a render (and is required
 * for the functional setState bailout in the projection effect).
 */

import type { Mission } from "@litt/agent-core";
import type { CanonicalMissionProjection } from "./cockpit-store.js";

/**
 * Project a canonical RuntimeStore mission into the cockpit's render snapshot.
 * Returns null when there is no active mission.
 */
export function buildCanonicalMission(
  m: Mission | null,
): CanonicalMissionProjection | null {
  if (!m) return null;
  return {
    id: m.id,
    goal: m.goal,
    status: m.status,
    currentStepId: m.currentStepId,
    steps: m.steps.map((s) => ({
      id: s.id,
      title: s.title,
      status: s.status,
      sequence: s.sequence,
    })),
    verificationProven:
      m.evidence.some(
        (e) => e.type === "verification_result" && e.success === true,
      ) || null,
    restored: m.metadata?.restoredFrom !== undefined,
    completionReason: m.completionReason,
    failureReason: m.failureReason,
  };
}

/**
 * Semantic equality over the projected fields (id, status, currentStepId,
 * step ids/statuses/sequences, and the derived verification/restored/reason
 * flags). Two snapshots are "same" when their projected content is identical,
 * even if they are different object instances. Used with a functional
 * setState updater to keep the previous render-cache reference and skip the
 * update when nothing meaningful changed.
 */
export function sameCanonicalMission(
  a: CanonicalMissionProjection | null,
  b: CanonicalMissionProjection | null,
): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  if (a.id !== b.id || a.goal !== b.goal) return false;
  if (a.status !== b.status || a.currentStepId !== b.currentStepId) return false;
  if (a.verificationProven !== b.verificationProven) return false;
  if (a.restored !== b.restored) return false;
  if (a.completionReason !== b.completionReason) return false;
  if (a.failureReason !== b.failureReason) return false;
  if (a.steps.length !== b.steps.length) return false;
  for (let i = 0; i < a.steps.length; i++) {
    const s1 = a.steps[i];
    const s2 = b.steps[i];
    if (s1.id !== s2.id) return false;
    if (s1.title !== s2.title) return false;
    if (s1.status !== s2.status) return false;
    if (s1.sequence !== s2.sequence) return false;
  }
  return true;
}