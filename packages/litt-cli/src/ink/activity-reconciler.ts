/**
 * Activity Reconciler — P0-3: Activity Feed Duplication.
 *
 * Observed real TUI output duplicated logical activities:
 *
 *   Inspecting
 *     Inspecting
 *   Assess analytics tracking capability
 *   Inspecting
 *     Inspecting
 *   Assess analytics tracking capability
 *   Verify production readiness
 *   Verify production readiness
 *
 * Root cause: every runtime event created a NEW ActivityEntry with a new
 * incrementing id, and addActivity() always appended. A logical activity
 * (e.g. "Inspecting" for stepId "inspect_1") that received multiple events
 * (step_started, then step_started again on reconnect/rerender) produced
 * duplicate rows instead of updating the existing one.
 *
 * Fix contract:
 *   - One logical activity = one row.
 *   - Updates mutate the existing activity instead of appending duplicates.
 *   - Reconciliation key: (runId, stepId) for mission step events,
 *     (runId, toolCallId) for tool events.
 *   - A step_started → step_passed for the same stepId UPDATES the row
 *     (changes type/text/semantic) rather than creating a new row.
 *   - Reconnect/resume replays events; the reconciler deduplicates by key.
 *
 * Pure functions — no React, no Ink. Testable in node.
 */

import type { ActivityEntry } from "./cockpit-store.js";

/**
 * Compute the reconciliation key for an activity entry.
 *
 * Mission step events: key = `${runId}::step::${stepId}`
 * Tool events: key = `${runId}::tool::${toolCallId}`
 * Run-level events: key = `${runId}::run` (one row per run)
 * Other events: key = entry.id (unique, never reconciled)
 */
export function activityKey(entry: ActivityEntry): string {
  const runId = entry.runId ?? "_";

  // Mission step events — reconcile by stepId
  if (entry.type.startsWith("mission.step_")) {
    // Extract stepId from the entry. The event-bridge stores it in the
    // fullText or we can look at the type + toolCallId as a fallback.
    // The stepId is typically in the toolCallId for mission step events,
    // or we can use the text as a secondary key.
    const stepId = entry.toolCallId ?? entry.text;
    return `${runId}::step::${stepId}`;
  }

  // Tool events — reconcile by toolCallId
  if (entry.type.startsWith("tool.")) {
    const toolCallId = entry.toolCallId ?? entry.id;
    return `${runId}::tool::${toolCallId}`;
  }

  // Run-level events — one row per run
  if (entry.type === "run.started" || entry.type === "run.completed" || entry.type === "run.failed") {
    return `${runId}::run`;
  }

  // Mission lifecycle (created/started/completed/failed) — one row per mission
  if (entry.type === "mission.created" || entry.type === "mission.started" ||
      entry.type === "mission.completed" || entry.type === "mission.failed" ||
      entry.type === "mission.restored" || entry.type === "mission.verifying") {
    return `${runId}::mission`;
  }

  // Default: unique per entry (stream chunks, etc.)
  return entry.id;
}

/**
 * Reconcile a new activity entry against the existing activity log.
 *
 * If the entry's reconciliation key matches an existing entry, the existing
 * entry is UPDATED (mutated in place) with the new entry's type/text/ts.
 * If no match, the new entry is appended.
 *
 * This is the ONE function that addActivity() should call instead of
 * blindly appending. It guarantees: one logical activity = one row.
 *
 * Returns the new activity log array (immutable update).
 */
export function reconcileActivity(
  log: ActivityEntry[],
  entry: ActivityEntry,
): ActivityEntry[] {
  const key = activityKey(entry);
  const existingIdx = log.findIndex((e) => activityKey(e) === key);

  if (existingIdx >= 0) {
    // UPDATE the existing row — mutate, don't append
    const updated = [...log];
    updated[existingIdx] = {
      ...updated[existingIdx],
      type: entry.type,
      text: entry.text,
      ts: entry.ts,
      fullText: entry.fullText ?? updated[existingIdx].fullText,
      stream: entry.stream ?? updated[existingIdx].stream,
      semantic: entry.semantic ?? updated[existingIdx].semantic,
    };
    return updated;
  }

  // No match — append
  return [...log, entry];
}

/**
 * Reconcile a batch of activity entries (e.g. on reconnect/resume).
 * Each entry is reconciled in order against the accumulating log.
 */
export function reconcileActivityBatch(
  log: ActivityEntry[],
  entries: ActivityEntry[],
): ActivityEntry[] {
  let result = log;
  for (const entry of entries) {
    result = reconcileActivity(result, entry);
  }
  return result;
}

/**
 * Count logical activities (unique reconciliation keys) in a log.
 * Used by tests to prove "one logical activity = one row".
 */
export function countLogicalActivities(log: ActivityEntry[]): number {
  const keys = new Set<string>();
  for (const entry of log) {
    keys.add(activityKey(entry));
  }
  return keys.size;
}

/**
 * Find the activity entry for a given key (or null if not found).
 */
export function findActivityByKey(log: ActivityEntry[], key: string): ActivityEntry | null {
  return log.find((e) => activityKey(e) === key) ?? null;
}
