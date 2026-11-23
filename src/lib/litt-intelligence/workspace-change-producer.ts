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
  gitDiff?(options?: { staged?: boolean; path?: string; untracked?: boolean; base?: string }): Promise<{ diff: string }>;
}

/**
 * Decode a git C-style quoted path (core.quotePath, the default).
 *
 * A tracked filename with non-ASCII or special bytes is emitted as a
 * double-quoted string with escapes: octal `\NNN` for raw UTF-8 bytes
 * (`caf\303\251.txt`) plus the C escapes `\\`, `\"`, `\n`, `\t`, `\r`,
 * `\a`, `\b`, `\f`, `\v`. Octal runs are bytes, so they must be decoded
 * as UTF-8 — treating each octal as a charCode mangles multibyte names.
 */
export function unquoteGitPath(path: string): string {
  if (path.length < 2 || !path.startsWith('"') || !path.endsWith('"')) {
    return path;
  }
  const inner = path.slice(1, -1);
  let out = "";
  let bytes: number[] = [];
  const flush = () => {
    if (bytes.length === 0) return;
    out += Buffer.from(bytes).toString("utf8");
    bytes = [];
  };
  const SIMPLE: Record<string, string> = {
    '"': '"', "\\": "\\", n: "\n", t: "\t", r: "\r",
    a: "\x07", b: "\b", f: "\f", v: "\v",
  };
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i];
    if (ch !== "\\") {
      flush();
      out += ch;
      continue;
    }
    const next = inner[++i];
    if (next >= "0" && next <= "7") {
      bytes.push(parseInt(inner.slice(i, i + 3), 8));
      i += 2;
      continue;
    }
    flush();
    out += SIMPLE[next] ?? next;
  }
  flush();
  return out;
}

/** Paths from a unified diff's `diff --git a/x b/y` headers (the b/ side). */
export function pathsFromDiff(diff: string): string[] {
  const paths = new Set<string>();
  for (const line of diff.split("\n")) {
    if (!line.startsWith("diff --git ")) continue;
    // core.quotePath quotes the WHOLE "a/<path>" spec, so a quoted header
    // looks like: diff --git "a/caf\303\251.txt" "b/caf\303\251.txt"
    const quoted = line.match(/^diff --git "a\/((?:[^"\\]|\\.)*)" "b\/((?:[^"\\]|\\.)*)"$/);
    if (quoted) {
      paths.add(unquoteGitPath(`"${quoted[2]}"`));
      continue;
    }
    const match = line.match(/^diff --git a\/(.+?) b\/(.+)$/);
    if (!match) continue;
    paths.add(unquoteGitPath(match[2]));
  }
  return [...paths];
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
export async function computeWorkspaceChange(
  probe: WorkspaceChangeProbe | null | undefined,
  checkpoint: CheckpointInfo | null | undefined,
  opts?: {
    /**
     * Round 11: why checkpoint creation failed, when it did (the
     * transport records it — see WorkspaceTransport.lastCheckpointError).
     * Surfaced in the unknown reason instead of the failure being
     * swallowed to a silent null upstream.
     */
    checkpointError?: string | null;
  },
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
      unknownReason: opts?.checkpointError
        ? `No pre-mutation checkpoint was recorded to compare against. Checkpoint creation failed: ${opts.checkpointError}`
        : "No pre-mutation checkpoint was recorded to compare against.",
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

  let diff = "";
  /**
   * Diff the working tree against the checkpoint SHA itself, not merely
   * HEAD. Pre-mutation checkpoints are taken before EVERY mutation and
   * each one commits the tree, so HEAD at run end is the checkpoint
   * immediately preceding the LAST mutation — work committed into it by
   * earlier mutations is invisible to a HEAD-only status. The baseline
   * diff covers the whole run: a legitimate overwrite that nets out
   * identical (or any later no-op mutation) can no longer make a real
   * build look "unchanged".
   */
  let baseFiles: string[] | null = null;
  if (probe.gitDiff && checkpoint.gitSha) {
    try {
      diff = (await probe.gitDiff({ base: checkpoint.gitSha })).diff;
      baseFiles = pathsFromDiff(diff);
    } catch {
      baseFiles = null;
    }
    // Git does not include untracked files in `git diff`; append a real
    // no-index diff for each newly-created path so the Mission never says
    // a new file changed without showing its contents.
    try {
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

  // When the baseline diff ran, it is authoritative for tracked changes —
  // `git status` only enumerates uncommitted work, so its staged/modified
  // lists would silently drop everything an intermediate checkpoint
  // committed. Untracked paths still come from status either way.
  const files =
    baseFiles !== null
      ? [...new Set([...baseFiles, ...(status.untracked ?? [])])].sort()
      : changedPathsFromStatus(status);

  // `clean` is git's own verdict; the enumerated paths are the detail. They
  // should agree, and when they do not the presence of a path wins — a named
  // changed file is stronger evidence than a summary flag.
  if (files.length === 0 && (baseFiles !== null || status.clean !== false)) {
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
 * Round 11 — volume-listing evidence fallback.
 *
 * When the exec-based probe path cannot produce a verdict (no
 * checkpoint, a 500-class exec failure — the proof's Q2 pattern), the
 * run used to report "Workspace unknown / 0 files" even though the
 * workspace volume itself was perfectly readable: the Files panel
 * reads the same tree through the /ws-files path without exec. This
 * fallback verifies the concrete claim the run actually made — the
 * paths its successful mutations declared — against a direct volume
 * listing. A candidate file that is present on the volume IS a real
 * workspace change; the fallback reports exactly those files, marked
 * evidenceSource "volume-listing" with no diff and no rollback (there
 * is no checkpoint to roll back to).
 *
 * Deliberately narrow: it only upgrades an "unknown" primary, only
 * verifies paths the run's own tool results declared, and returns the
 * primary untouched when nothing verifies. It never weakens the
 * terminal gate — it reads through the same file-ops path the Files
 * panel already uses, not through exec.
 */
export interface VolumeListingFallback {
  /** Workspace-relative paths the run's successful mutations declared. */
  candidatePaths: string[];
  /** List one directory of the workspace volume (Files-panel read path). */
  listDir: (dir: string) => Promise<Array<{ name: string; type: string }>>;
}

export async function workspaceChangeFromVolumeListing(
  primary: WorkspaceChangeEvidence,
  fallback: VolumeListingFallback,
): Promise<WorkspaceChangeEvidence> {
  if (primary.status !== "unknown") return primary;

  const byDir = new Map<string, Set<string>>();
  for (const raw of fallback.candidatePaths) {
    const clean = raw.replace(/\\/g, "/").replace(/^\/+/, "");
    const idx = clean.lastIndexOf("/");
    const dir = idx === -1 ? "." : clean.slice(0, idx) || ".";
    const base = idx === -1 ? clean : clean.slice(idx + 1);
    if (!base) continue;
    if (!byDir.has(dir)) byDir.set(dir, new Set());
    byDir.get(dir)!.add(base);
  }
  if (byDir.size === 0) return primary;

  const verified: string[] = [];
  for (const [dir, names] of byDir) {
    let entries: Array<{ name: string; type: string }>;
    try {
      entries = await fallback.listDir(dir);
    } catch {
      continue;
    }
    const present = new Set(
      entries.filter((e) => e.type === "file").map((e) => e.name),
    );
    for (const name of names) {
      if (present.has(name)) verified.push(dir === "." ? name : `${dir}/${name}`);
    }
  }
  if (verified.length === 0) return primary;

  return {
    status: "changed",
    files: [...new Set(verified)].sort(),
    rollbackAvailable: false,
    evidenceSource: "volume-listing",
  };
}

/**
 * ACC-01 F1 — direct-read evidence fallback, the last resort after the
 * git probe and the volume listing both fail to answer.
 *
 * The acceptance's first build verifiably wrote a correct index.html,
 * yet the run settled with workspaceChange "unknown" and was reported
 * FAILED ("could not verify whether files changed"): the static
 * workspace could produce no checkpoint diff, and the listing fallback
 * could not confirm the file either. But the file itself was readable
 * the whole time — the Files panel showed it. When every structural
 * probe fails, read the paths the run's successful mutations declared
 * directly: a declared path that reads back is real, persisted work.
 * Same epistemic standard as the volume-listing fallback (the claim
 * comes from the run's own successful mutations; presence corroborates
 * it), through the one channel that demonstrably reaches the volume.
 * Only upgrades an "unknown" primary; never manufactures a change for
 * a path that does not read back.
 */
export interface DirectReadFallback {
  /** Workspace-relative paths the run's successful mutations declared. */
  candidatePaths: string[];
  /** Read one workspace file (the Files-panel read path). */
  readFile: (path: string) => Promise<{ content: string }>;
}

export async function workspaceChangeFromDirectReads(
  primary: WorkspaceChangeEvidence,
  fallback: DirectReadFallback,
): Promise<WorkspaceChangeEvidence> {
  if (primary.status !== "unknown") return primary;

  const candidates = [
    ...new Set(
      fallback.candidatePaths
        .map((p) => p.replace(/\\/g, "/").replace(/^\/+/, ""))
        .filter((p) => p.length > 0),
    ),
  ];
  if (candidates.length === 0) return primary;

  const verified: string[] = [];
  for (const path of candidates) {
    try {
      const { content } = await fallback.readFile(path);
      if (typeof content === "string") verified.push(path);
    } catch {
      // Not readable — not verified. Other candidates may still answer.
    }
  }
  if (verified.length === 0) return primary;

  return {
    status: "changed",
    files: verified.sort(),
    rollbackAvailable: false,
    evidenceSource: "direct-read",
  };
}
