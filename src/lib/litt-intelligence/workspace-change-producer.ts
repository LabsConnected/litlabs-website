/**
 * Determine what a run actually did to the workspace.
 *
 * Tool success flags describe what the model was TOLD happened. When a run
 * fails, is cancelled, or is aborted, those flags cannot answer the only
 * question that matters to the user: are my files different now?
 *
 * The agent loop takes a checkpoint commit before the first mutation, so
 * anything a run wrote afterwards shows up as working-tree change against
 * that commit. This module turns that into evidence.
 *
 * The three outcomes are deliberately distinct:
 *
 *   changed   — the diff ran and found differences
 *   unchanged — the diff ran and found none
 *   unknown   — the comparison could not be made
 *
 * "unknown" is never collapsed into "unchanged". Reporting a workspace as
 * untouched because we failed to look is the precise false negative this
 * exists to prevent: a run that wrote bytes and then died would otherwise
 * be labelled "no work completed" while the user's file was rewritten.
 */

import type { CheckpointInfo, GitStatusResult } from "./workspace-transport";
import type { WorkspaceChangeEvidence } from "@/lib/studio/completion-evidence";

/** The slice of the transport this needs — keeps it trivially testable. */
export interface WorkspaceChangeProbe {
  gitStatus(): Promise<GitStatusResult>;
}

/** Collect every path git reports as differing, deduped and sorted. */
export function changedPathsFromStatus(status: GitStatusResult): string[] {
  const paths = new Set<string>();
  for (const entry of status.staged ?? []) paths.add(entry.path);
  for (const entry of status.modified ?? []) paths.add(entry.path);
  for (const path of status.untracked ?? []) paths.add(path);
  return [...paths].sort();
}

/**
 * Compare the workspace against the checkpoint taken before the run's first
 * mutation.
 *
 * `checkpoint` is null when the run never reached a mutation — but that is
 * not proof of an untouched workspace either, because a run can be aborted
 * between taking the checkpoint and recording it. Absent a checkpoint the
 * honest answer is "unknown".
 */
export async function computeWorkspaceChange(
  probe: WorkspaceChangeProbe | null | undefined,
  checkpoint: CheckpointInfo | null | undefined,
): Promise<WorkspaceChangeEvidence> {
  if (!probe) {
    return {
      status: "unknown",
      unknownReason: "The workspace was not reachable to compare.",
    };
  }

  if (!checkpoint?.gitSha) {
    return {
      status: "unknown",
      unknownReason: "No pre-mutation checkpoint was recorded to compare against.",
    };
  }

  let status: GitStatusResult;
  try {
    status = await probe.gitStatus();
  } catch (err) {
    // A failed diff tells us nothing about the files. Say so.
    return {
      status: "unknown",
      checkpointSha: checkpoint.gitSha,
      rollbackAvailable: true,
      unknownReason:
        err instanceof Error
          ? `Could not inspect the workspace: ${err.message}`
          : "Could not inspect the workspace.",
    };
  }

  if (!status || typeof status !== "object") {
    return {
      status: "unknown",
      checkpointSha: checkpoint.gitSha,
      rollbackAvailable: true,
      unknownReason: "The workspace status could not be read.",
    };
  }

  const files = changedPathsFromStatus(status);

  // `clean` is git's own verdict; the enumerated paths are the detail. They
  // should agree, and when they do not the presence of a path wins — a named
  // changed file is stronger evidence than a summary flag.
  if (files.length === 0 && status.clean !== false) {
    return {
      status: "unchanged",
      files: [],
      checkpointSha: checkpoint.gitSha,
      rollbackAvailable: true,
    };
  }

  return {
    status: "changed",
    files,
    checkpointSha: checkpoint.gitSha,
    rollbackAvailable: true,
  };
}
