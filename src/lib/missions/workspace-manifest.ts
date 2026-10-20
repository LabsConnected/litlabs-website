/**
 * Workspace manifest — a path → sha256 baseline of a workspace, captured
 * and compared entirely over the terminal server's file services
 * (/ws-files list/read), which work in production-like environments where
 * host execution (git, preview, commands) is refused with
 * 503 HOST_EXECUTION_DISABLED.
 *
 * This is the evidence path for checkpoints and change verification when
 * git cannot run (Gate 1 Fix 1, diagnosis ART-20261020-007). It mirrors
 * the terminal server scaffold module's `kind: "files"` fallback
 * precedent: when git is unavailable, file hashes are the honest
 * baseline — never a guess.
 *
 * Pure helpers only (node crypto + a structural file surface), so both
 * the checkpoint creator (missions) and the change producer
 * (litt-intelligence) can share them without an import cycle.
 */

import { createHash } from "crypto";

/** The slice of the file services manifest capture/compare needs. */
export interface ManifestFileSurface {
  listFiles(path: string): Promise<{ entries: Array<{ name: string; type: string }> }>;
  readFile(path: string): Promise<{ content: string; size: number }>;
}

/** Directories never part of a project's authored content: VCS internals,
 *  LiTT's own checkpoint copies (a write creates one — counting it would
 *  report every write as changed for the wrong reason), and dependencies. */
export const MANIFEST_EXCLUDED_DIRS = new Set([".git", ".litt", "node_modules"]);

const MAX_MANIFEST_DEPTH = 8;
const MAX_MANIFEST_FILES = 1000;

export function sha256Hex(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

function isDirectoryEntry(type: string): boolean {
  return type === "directory" || type === "folder" || type === "dir";
}

/**
 * Enumerate the workspace from `root` ("." for the workspace root) and
 * hash every file's current content. Throws on any list/read failure or
 * when the caps are exceeded — a partial manifest presented as complete
 * would be a false baseline, so the caller fails closed instead.
 */
export async function enumerateWorkspaceManifest(
  surface: ManifestFileSurface,
  root = ".",
): Promise<Record<string, string>> {
  const manifest: Record<string, string> = {};

  async function walk(dir: string, depth: number): Promise<void> {
    if (depth > MAX_MANIFEST_DEPTH) {
      throw new Error(`Workspace manifest enumeration exceeded depth ${MAX_MANIFEST_DEPTH} at ${dir}`);
    }
    const { entries } = await surface.listFiles(dir);
    for (const entry of [...entries].sort((a, b) => a.name.localeCompare(b.name))) {
      const path = dir === "." || dir === "" ? entry.name : `${dir}/${entry.name}`;
      if (isDirectoryEntry(entry.type)) {
        if (!MANIFEST_EXCLUDED_DIRS.has(entry.name)) await walk(path, depth + 1);
        continue;
      }
      if (Object.keys(manifest).length >= MAX_MANIFEST_FILES) {
        throw new Error(`Workspace manifest enumeration exceeded ${MAX_MANIFEST_FILES} files`);
      }
      const { content } = await surface.readFile(path);
      manifest[path] = sha256Hex(content);
    }
  }

  await walk(root, 0);
  return manifest;
}

/** Paths added, removed, or content-changed between two manifests, sorted. */
export function diffManifestPaths(
  baseline: Record<string, string>,
  current: Record<string, string>,
): string[] {
  const paths = new Set<string>();
  for (const [path, hash] of Object.entries(baseline)) {
    if (current[path] !== hash) paths.add(path);
  }
  for (const path of Object.keys(current)) {
    if (!(path in baseline)) paths.add(path);
  }
  return [...paths].sort();
}

/** Stable digest of a whole manifest (sorted path → hash pairs). */
export function manifestDigest(manifest: Record<string, string>): string {
  const pairs = Object.keys(manifest)
    .sort()
    .map((path) => `${path}\0${manifest[path]}`);
  return sha256Hex(pairs.join("\n"));
}

/**
 * How a manifest checkpoint rides the existing project_checkpoints row
 * without a schema migration: the manifest JSON is the row's description
 * under this prefix, and git_sha is empty (the row is not a git
 * checkpoint and must never be fed to git restore).
 */
export const MANIFEST_CHECKPOINT_DESCRIPTION_PREFIX = "manifest-checkpoint:v1:";

export function encodeManifestCheckpointDescription(
  manifest: Record<string, string>,
): string {
  return `${MANIFEST_CHECKPOINT_DESCRIPTION_PREFIX}${JSON.stringify(manifest)}`;
}

export function decodeManifestCheckpointDescription(
  description: string | null | undefined,
): Record<string, string> | null {
  if (!description?.startsWith(MANIFEST_CHECKPOINT_DESCRIPTION_PREFIX)) return null;
  try {
    const parsed = JSON.parse(
      description.slice(MANIFEST_CHECKPOINT_DESCRIPTION_PREFIX.length),
    ) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const manifest: Record<string, string> = {};
    for (const [path, hash] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof hash !== "string") return null;
      manifest[path] = hash;
    }
    return manifest;
  } catch {
    return null;
  }
}
