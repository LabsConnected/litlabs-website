/**
 * MissionProjection — a pure derivation of the canonical RuntimeStore.mission
 * for Ink rendering.
 *
 * RuntimeStore.mission is the ONLY mission authority. CockpitStore may
 * cache/project values for Ink rendering, but it must derive them entirely
 * from canonical mission state/events. This module is the single function
 * that performs that derivation.
 *
 * The projection includes:
 *   goal, status, currentStepId, semantic steps, pending/working/passed/
 *   blocked/failed counts, verification, restored/recovered, evidence count.
 *
 * The CockpitStore holds a MissionProjection as a cache. It is repopulated
 * whenever mission:* events arrive or when the controller explicitly
 * refreshes it from the store. The projection NEVER mutates mission truth —
 * it is a read-only view.
 */

import type { Mission, MissionStep } from "@litt/agent-core";

export interface ProjectedStep {
  id: string;
  sequence: number;
  title: string;
  description: string;
  status: MissionStep["status"];
  scope: string[];
  toolCount: number;
  actionCount: number;
  filesReadCount: number;
  filesChangedCount: number;
  startedAt: string | null;
  finishedAt: string | null;
  failureReason: string | null;
  blockingReason: string | null;
}

export interface MissionProjection {
  /** Mission id — canonical, from RuntimeStore.mission.id */
  id: string;
  /** The user goal — canonical, from RuntimeStore.mission.goal */
  goal: string;
  /** Mission status — canonical, from RuntimeStore.mission.status */
  status: Mission["status"];
  /** Current step id — canonical, from RuntimeStore.mission.currentStepId */
  currentStepId: string | null;
  /** Semantic steps — canonical, derived from RuntimeStore.mission.steps */
  steps: ProjectedStep[];
  /** Counts derived from steps — not independently mutated */
  pending: number;
  working: number;
  passed: number;
  blocked: number;
  failed: number;
  skipped: number;
  /** Verification evidence — canonical, from mission.evidence */
  verificationProven: boolean | null;
  /** Total evidence records on the mission */
  evidenceCount: number;
  /** True if the mission was restored/recovered from disk on startup */
  restored: boolean;
  /** Mission mode (plan/act/auto) — canonical */
  mode: Mission["mode"];
  /** Timestamps — canonical */
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  /** Failure/completion reasons — canonical */
  failureReason: string | null;
  completionReason: string | null;
}

/**
 * Build a MissionProjection from the canonical RuntimeStore.mission.
 *
 * Returns null when there is no active mission. The projection is a pure
 * function of the mission — same mission in, same projection out. It
 * contains NO independently-mutated lifecycle truth.
 *
 * @param mission The canonical mission from RuntimeStore.getMission()
 * @param restored True if the mission was restored from disk (recovery)
 */
export function projectMission(
  mission: Mission | null,
  restored: boolean = false,
): MissionProjection | null {
  if (!mission) return null;

  const steps: ProjectedStep[] = mission.steps.map((s: MissionStep) => ({
    id: s.id,
    sequence: s.sequence,
    title: s.title,
    description: s.description,
    status: s.status,
    scope: s.allowedActionScope,
    toolCount: s.toolHistory.length,
    actionCount: s.actionHistory.length,
    filesReadCount: s.filesRead.length,
    filesChangedCount: s.filesChanged.length,
    startedAt: s.startedAt,
    finishedAt: s.finishedAt,
    failureReason: s.failureReason,
    blockingReason: s.blockingReason,
  }));

  const pending = steps.filter((s) => s.status === "pending").length;
  const working = steps.filter((s) => s.status === "working").length;
  const passed = steps.filter((s) => s.status === "passed").length;
  const blocked = steps.filter((s) => s.status === "blocked").length;
  const failed = steps.filter((s) => s.status === "failed").length;
  const skipped = steps.filter((s) => s.status === "skipped").length;

  // Verification truth comes from the canonical evidence records.
  const verifyEvidence = mission.evidence.find((e) => e.type === "verification_result");
  const verificationProven = verifyEvidence ? Boolean(verifyEvidence.success) : null;

  return {
    id: mission.id,
    goal: mission.goal,
    status: mission.status,
    currentStepId: mission.currentStepId,
    steps,
    pending,
    working,
    passed,
    blocked,
    failed,
    skipped,
    verificationProven,
    evidenceCount: mission.evidence.length,
    restored,
    mode: mission.mode,
    createdAt: mission.createdAt,
    startedAt: mission.startedAt,
    completedAt: mission.completedAt,
    failureReason: mission.failureReason,
    completionReason: mission.completionReason,
  };
}
