/**
 * RunStore — P0-5: Final Result Recovery.
 *
 * Persists agent run results so a long Plan/audit never finishes with its
 * answer effectively lost. Supports recovery after TUI rerender and after
 * restart.
 *
 * Stored at ~/.litt/runs/<runId>.json (one file per run, bounded to last 50).
 *
 * CLI surface:
 *   litt runs                  — list recent runs
 *   litt run <id>              — show run summary
 *   litt run result <id>       — show the final result text
 *   litt run logs <id>         — show the run logs (activity entries)
 *
 * Pure functions — no React, no Ink. Testable in node with temp dirs.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, unlinkSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** A persisted activity log entry from a run. */
export interface RunActivityEntry {
  id: string;
  ts: number;
  type: string;
  text: string;
  semantic?: string;
}

/** A persisted run record. */
export interface RunRecord {
  /** Unique run ID. */
  runId: string;
  /** The task/mission text. */
  task: string;
  /** When the run started (epoch ms). */
  startedAt: number;
  /** When the run ended (epoch ms, null if still running). */
  endedAt: number | null;
  /** Run status: running, success, failed, cancelled, timeout. */
  status: "running" | "success" | "failed" | "cancelled" | "timeout";
  /** The final assistant result text (null until the run completes). */
  result: string | null;
  /** The failure reason (when status is failed/cancelled/timeout). */
  failureReason: string | null;
  /** The last successful step before failure (if any). */
  lastSuccessfulStep: string | null;
  /** Recommended next action (when failed). */
  recommendedNextAction: string | null;
  /** The project/workspace path. */
  cwd: string;
  /** The branch at run time. */
  branch: string;
  /** The mode (plan/act). */
  mode: string;
  /** The model that served the run. */
  model: string | null;
  /** Activity log entries (bounded). */
  activities: RunActivityEntry[];
  /** Total duration in ms. */
  durationMs: number | null;
}

const MAX_RUNS = 50;
const MAX_ACTIVITIES = 200;
const MAX_RESULT_CHARS = 100_000;

function runsDir(): string {
  const override = process.env.LITT_RUNS_DIR;
  if (override) return override;
  return join(homedir(), ".litt", "runs");
}

function runFile(runId: string): string {
  return join(runsDir(), `${runId}.json`);
}

/** Generate a new run ID. */
export function newRunId(): string {
  return `run_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Persist a run record to disk.
 * Creates the runs directory if it doesn't exist.
 * Bounds the result text and activities to prevent unbounded growth.
 */
export function saveRun(record: RunRecord): void {
  const dir = runsDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  const bounded: RunRecord = {
    ...record,
    result: record.result
      ? record.result.length > MAX_RESULT_CHARS
        ? record.result.slice(0, MAX_RESULT_CHARS) + "\n…[truncated]"
        : record.result
      : null,
    activities: record.activities.slice(-MAX_ACTIVITIES),
  };

  writeFileSync(runFile(record.runId), JSON.stringify(bounded, null, 2), "utf8");

  // Prune old runs
  pruneOldRuns();
}

/**
 * Load a run record by ID.
 * Returns null if the run file doesn't exist or is corrupt.
 */
export function loadRun(runId: string): RunRecord | null {
  const file = runFile(runId);
  if (!existsSync(file)) return null;
  try {
    const raw = readFileSync(file, "utf8");
    const parsed = JSON.parse(raw) as RunRecord;
    if (typeof parsed.runId === "string" && typeof parsed.task === "string") {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * List all persisted runs, most recent first.
 */
export function listRuns(): RunRecord[] {
  const dir = runsDir();
  if (!existsSync(dir)) return [];

  const records: RunRecord[] = [];
  try {
    const files = readdirSync(dir).filter((f) => f.endsWith(".json"));
    for (const f of files) {
      try {
        const raw = readFileSync(join(dir, f), "utf8");
        const parsed = JSON.parse(raw) as RunRecord;
        if (typeof parsed.runId === "string") {
          records.push(parsed);
        }
      } catch {
        // skip corrupt files
      }
    }
  } catch {
    return [];
  }

  return records.sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0));
}

/**
 * Delete a run record.
 */
export function deleteRun(runId: string): boolean {
  const file = runFile(runId);
  if (!existsSync(file)) return false;
  try {
    unlinkSync(file);
    return true;
  } catch {
    return false;
  }
}

/**
 * Update a run record (partial patch).
 * Reads the existing record, merges the patch, and saves.
 * Returns the updated record, or null if the run doesn't exist.
 */
export function updateRun(runId: string, patch: Partial<RunRecord>): RunRecord | null {
  const existing = loadRun(runId);
  if (!existing) return null;
  const updated = { ...existing, ...patch };
  saveRun(updated);
  return updated;
}

/**
 * Append an activity entry to a run's activity log.
 * Returns the updated record, or null if the run doesn't exist.
 */
export function appendRunActivity(runId: string, entry: RunActivityEntry): RunRecord | null {
  const existing = loadRun(runId);
  if (!existing) return null;
  const updated: RunRecord = {
    ...existing,
    activities: [...existing.activities, entry].slice(-MAX_ACTIVITIES),
  };
  saveRun(updated);
  return updated;
}

/**
 * Finalize a run with its result and terminal status.
 */
export function finalizeRun(
  runId: string,
  options: {
    status: RunRecord["status"];
    result?: string | null;
    failureReason?: string | null;
    lastSuccessfulStep?: string | null;
    recommendedNextAction?: string | null;
    durationMs?: number | null;
  },
): RunRecord | null {
  const existing = loadRun(runId);
  if (!existing) return null;
  const updated: RunRecord = {
    ...existing,
    endedAt: Date.now(),
    status: options.status,
    result: options.result ?? existing.result,
    failureReason: options.failureReason ?? null,
    lastSuccessfulStep: options.lastSuccessfulStep ?? existing.lastSuccessfulStep,
    recommendedNextAction: options.recommendedNextAction ?? null,
    durationMs: options.durationMs ?? existing.durationMs,
  };
  saveRun(updated);
  return updated;
}

/** Prune old run files to stay within MAX_RUNS. */
function pruneOldRuns(): void {
  const runs = listRuns();
  if (runs.length <= MAX_RUNS) return;
  const toRemove = runs.slice(MAX_RUNS);
  for (const r of toRemove) {
    deleteRun(r.runId);
  }
}

/**
 * Format a run record for the `litt runs` list display.
 * Returns a compact one-liner per run.
 */
export function formatRunListEntry(run: RunRecord): string {
  const status = run.status;
  const age = timeAgo(run.startedAt);
  const task = run.task.length > 60 ? run.task.slice(0, 59) + "…" : run.task;
  const dur = run.durationMs ? `${(run.durationMs / 1000).toFixed(1)}s` : "—";
  return `${run.runId}  ${status.padEnd(10)}  ${age.padEnd(6)}  ${dur.padEnd(7)}  ${task}`;
}

/** Relative "time ago" label. */
export function timeAgo(ts: number): string {
  const diff = Math.max(0, Date.now() - ts);
  const min = Math.floor(diff / 60_000);
  if (min < 1) return "now";
  if (min < 60) return `${min}m`;
  const hours = Math.floor(min / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  return `${Math.floor(days / 7)}w`;
}
