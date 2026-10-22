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
 *
 * Where git cannot run (host execution refused in production-like
 * environments), the baseline is a manifest checkpoint instead — a
 * path → sha256 map captured over the file services — and the comparison
 * re-enumerates those same services. On staging before Gate 1, "unknown"
 * was the only verdict this module could produce, for a run that wrote a
 * complete website and for a run that wrote nothing, identically.
 */

import type { CheckpointInfo, GitStatusResult } from "./workspace-transport";
import type { WorkspaceChangeEvidence } from "@/lib/studio/completion-evidence";
import {
  diffManifestPaths,
  enumerateWorkspaceManifest,
  manifestDigest,
} from "@/lib/missions/workspace-manifest";
import { studioLog } from "@/lib/studio/logger";

/** The slice of the transport this needs — keeps it trivially testable. */
export interface WorkspaceChangeProbe {
  gitStatus(): Promise<GitStatusResult>;
  gitDiff?(options?: { staged?: boolean; path?: string; untracked?: boolean }): Promise<{ diff: string }>;
  /** File services — the manifest comparison surface (Gate 1 Fix 1). These
   *  work where git-over-exec is refused (HOST_EXECUTION_DISABLED). */
  listFiles?(path: string): Promise<{ entries: Array<{ name: string; type: string }> }>;
  readFile?(path: string): Promise<{ content: string; size: number }>;
}

function diffLineCounts(diff: string): { additions: number; deletions: number } {
  let additions = 0;
  let deletions = 0;
  for (const line of diff.split("\n")) {
    if (line.startsWith("+++") || line.startsWith("---")) continue;
    if (line.startsWith("+")) additions++;
    else if (line.startsWith("-")) deletions++;
  }
  return { additions, deletions };
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
/**
 * Compare against a manifest checkpoint (Gate 1 Fix 1): re-enumerate the
 * workspace over the file services and diff path → sha256 against the
 * baseline. Used when the checkpoint was captured without git (host
 * execution refused) — calling gitStatus() here would 503 and collapse
 * the verdict to "unknown" even though the evidence exists. A manifest
 * checkpoint carries no git SHA, so no git rollback is offered.
 */
async function computeManifestWorkspaceChange(
  probe: WorkspaceChangeProbe,
  checkpoint: CheckpointInfo,
): Promise<WorkspaceChangeEvidence> {
  if (!probe.listFiles || !probe.readFile) {
    return {
      status: "unknown",
      unknownReason:
        "A manifest checkpoint was recorded, but the workspace file services were not reachable to compare against it.",
    };
  }

  let current: Record<string, string>;
  try {
    current = await enumerateWorkspaceManifest({
      listFiles: probe.listFiles.bind(probe),
      readFile: probe.readFile.bind(probe),
    });
  } catch (err) {
    return {
      status: "unknown",
      unknownReason:
        err instanceof Error
          ? `Could not enumerate the workspace files: ${err.message}`
          : "Could not enumerate the workspace files.",
    };
  }

  const files = diffManifestPaths(checkpoint.manifest ?? {}, current);
  if (files.length === 0) {
    return { status: "unchanged", files: [], rollbackAvailable: false };
  }
  return { status: "changed", files, rollbackAvailable: false };
}

async function computeWorkspaceChangeInternal(
  probe: WorkspaceChangeProbe | null | undefined,
  checkpoint: CheckpointInfo | null | undefined,
): Promise<WorkspaceChangeEvidence> {
  if (!probe) {
    return {
      status: "unknown",
      unknownReason: "The workspace was not reachable to compare.",
    };
  }

  // Manifest checkpoints compare by re-enumeration, never by gitStatus.
  if (checkpoint?.kind === "manifest" && checkpoint.manifest) {
    return computeManifestWorkspaceChange(probe, checkpoint);
  }

  // A manifest checkpoint whose baseline did not survive (missing or
  // undecodable evidence — e.g. the approvals route recovered the row but
  // its manifest payload was absent or malformed) fails closed: there is
  // no baseline to compare against, and falling through to the git path
  // would dress that absence up as a git verdict.
  if (checkpoint?.kind === "manifest") {
    return {
      status: "unknown",
      unknownReason:
        "A manifest checkpoint was recorded, but its baseline manifest could not be recovered to compare against.",
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
  let diff = "";
  if (probe.gitDiff) {
    try {
      diff = (await probe.gitDiff()).diff;
      // Git does not include untracked files in `git diff`; append a real
      // no-index diff for each newly-created path so the Mission never says
      // a new file changed without showing its contents.
      for (const path of status.untracked ?? []) {
        const untrackedDiff = await probe.gitDiff({ path, untracked: true });
        if (untrackedDiff.diff) diff = `${diff}${diff ? "\n" : ""}${untrackedDiff.diff}`;
      }
    } catch {
      // Status remains valid evidence even when diff retrieval fails. The
      // caller can show the changed-file list without pretending to have a
      // complete patch.
    }
  }
  const counts = diffLineCounts(diff);

  // `clean` is git's own verdict; the enumerated paths are the detail. They
  // should agree, and when they do not the presence of a path wins — a named
  // changed file is stronger evidence than a summary flag.
  if (files.length === 0 && status.clean !== false) {
    return {
      status: "unchanged",
      files: [],
      diff,
      ...counts,
      checkpointSha: checkpoint.gitSha,
      rollbackAvailable: true,
    };
  }

  return {
    status: "changed",
    files,
    diff,
    ...counts,
    checkpointSha: checkpoint.gitSha,
    rollbackAvailable: true,
  };
}

/**
 * Compute the verdict — and SAY so (R3 / E4-S7).
 *
 * This module previously contained zero log calls: a verdict could be
 * computed, or silently never computed, and deployment stdout could not
 * tell the difference (the Phase 3 acceptance run produced no verdict
 * and no line to audit). Every computation now emits exactly one
 * structured line — checkpoint id, verdict, changed-file count. Ids
 * and outcomes only: never file contents, never the diff.
 */
export async function computeWorkspaceChange(
  probe: WorkspaceChangeProbe | null | undefined,
  checkpoint: CheckpointInfo | null | undefined,
): Promise<WorkspaceChangeEvidence> {
  const evidence = await computeWorkspaceChangeInternal(probe, checkpoint);
  studioLog("workspace_change:computed", {
    checkpointId: checkpoint?.checkpointId,
    verdict: evidence.status,
    fileCount: evidence.files?.length ?? 0,
    ...(checkpoint?.kind ? { kind: checkpoint.kind } : {}),
  });
  return evidence;
}

/**
 * Canonical identity of the workspace's CURRENT content (Repair R5-B).
 *
 * A verification verdict is only meaningful for the exact content it
 * verified, so the publish gate needs a revision token that changes when
 * ANY workspace content changes and is reproducible by any reader of the
 * same workspace. The manifest digest is that token: sorted path →
 * sha256(content) pairs over the whole workspace (see
 * `enumerateWorkspaceManifest`), so editing an already-verified file,
 * adding a file, or deleting one all yield a different revision.
 *
 * Identity schemes:
 *   - `manifest:<digest>` — preferred; works for git and gitless
 *     workspaces alike and reflects the live file surface.
 *   - `git:<sha>` — fallback when the manifest cannot be enumerated but
 *     the caller knows the workspace's current git HEAD (a checkpoint
 *     sha). Weaker (it cannot see uncommitted changes), so it is only a
 *     fallback, and a gate comparing a manifest revision against a git
 *     revision will (correctly, fail-closed) not match.
 *
 * Returns null when neither can be established. Callers must treat null
 * as "revision unknown" and fail closed — never as "unchanged".
 */
export async function computeWorkspaceRevision(
  probe: WorkspaceChangeProbe | null | undefined,
  fallbackGitSha?: string | null,
): Promise<string | null> {
  if (probe?.listFiles && probe?.readFile) {
    try {
      const manifest = await enumerateWorkspaceManifest({
        listFiles: probe.listFiles.bind(probe),
        readFile: probe.readFile.bind(probe),
      });
      if (manifest) return `manifest:${manifestDigest(manifest)}`;
    } catch {
      // fall through to the git fallback
    }
  }
  if (fallbackGitSha) return `git:${fallbackGitSha}`;
  return null;
}
