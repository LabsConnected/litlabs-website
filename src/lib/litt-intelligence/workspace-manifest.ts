/**
 * Checkpoint-free workspace verification for static workspaces.
 *
 * Git-backed workspaces prove change via the pre-mutation checkpoint and a
 * real diff. Static workspaces (no package.json, no toolchain — and in
 * production-like environments no host exec at all) cannot run git, so the
 * checkpoint path returns null and every run there reported
 * workspaceChange "unknown" — completion rested entirely on tool
 * self-report, the exact false success this evidence exists to prevent.
 *
 * A manifest is the static-workspace equivalent of a checkpoint: a snapshot
 * of every file's content hash taken through the ordinary /ws-files API
 * (listFiles + readFile — the same endpoints the tools use, no exec, no
 * git). Comparing before/after manifests answers the same question the diff
 * does: which files differ on disk.
 */

import { createHash } from "node:crypto";
import type { WorkspaceChangeEvidence } from "@/lib/studio/completion-evidence";

/** The slice of the transport this needs — keeps it trivially testable. */
export interface WorkspaceManifestProbe {
  listFiles(path: string): Promise<{ entries: Array<{ name: string; type: string }> }>;
  readFile(path: string): Promise<{ content: string; size: number }>;
}

/**
 * Bound on manifest size. Static workspaces are small by design; beyond the
 * cap the manifest is truncated and the comparison marks itself partial —
 * still truthful evidence for the captured portion, never silent.
 */
export const MANIFEST_MAX_FILES = 500;
const MANIFEST_MAX_DEPTH = 12;

/** path → content hash. */
export type WorkspaceManifest = Map<string, string>;

function hashContent(content: string): string {
  return createHash("sha256").update(content).digest("hex").slice(0, 16);
}

function joinPath(dir: string, name: string): string {
  return dir === "." || dir === "" ? name : `${dir.replace(/\/+$/, "")}/${name}`;
}

/**
 * Snapshot every readable file under root as path → sha256 prefix.
 * Unreadable entries (deleted mid-scan, binary-only, permission errors) are
 * skipped rather than failing the whole manifest — a missing entry simply
 * appears as a change on the next comparison, which is the truthful side.
 */
export async function captureWorkspaceManifest(
  probe: WorkspaceManifestProbe,
  root = ".",
): Promise<{ manifest: WorkspaceManifest; truncated: boolean }> {
  const manifest: WorkspaceManifest = new Map();
  let truncated = false;

  async function walk(dir: string, depth: number): Promise<void> {
    if (depth > MANIFEST_MAX_DEPTH || manifest.size >= MANIFEST_MAX_FILES) {
      if (manifest.size >= MANIFEST_MAX_FILES) truncated = true;
      return;
    }
    let entries: Array<{ name: string; type: string }>;
    try {
      entries = (await probe.listFiles(dir)).entries;
    } catch {
      return;
    }
    for (const entry of entries) {
      if (manifest.size >= MANIFEST_MAX_FILES) {
        truncated = true;
        return;
      }
      const path = joinPath(dir, entry.name);
      if (entry.type === "directory") {
        await walk(path, depth + 1);
      } else {
        try {
          const { content } = await probe.readFile(path);
          manifest.set(path, hashContent(content));
        } catch {
          // Skip unreadable files; absence shows as a change next time.
        }
      }
    }
  }

  await walk(root, 0);
  return { manifest, truncated };
}

/**
 * Compare two manifests. There is no unified diff available without git —
 * the evidence carries the changed-file list, which is the same verdict
 * (`changed`/`unchanged`) the checkpoint path produces.
 */
export function manifestChangeEvidence(
  before: WorkspaceManifest,
  after: WorkspaceManifest,
  truncated: boolean,
): WorkspaceChangeEvidence {
  const files: string[] = [];
  for (const [path, hash] of after) {
    if (before.get(path) !== hash) files.push(path);
  }
  for (const path of before.keys()) {
    if (!after.has(path)) files.push(path);
  }
  files.sort();

  return {
    status: files.length === 0 ? "unchanged" : "changed",
    files,
    unknownReason: truncated
      ? "Manifest truncated — comparison covers the first captured files only."
      : undefined,
    rollbackAvailable: false,
  };
}
