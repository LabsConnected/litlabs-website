/**
 * Repair snapshots — the recovery path the mission requires.
 *
 * Before any approved patch is applied, every authorized target's prior bytes
 * are captured AND persisted to .litt/repairs/<run>/snapshots.json. If
 * validation fails — or the process dies mid-validation and the run is
 * resumed — restoreSnapshots() puts the workspace back exactly: a created
 * file is removed, a replaced file is rewritten to its previous content.
 *
 * Only paths that pass the patch authorization rules are captured, so a
 * rejected proposal aimed at `.env` is never copied into the snapshot file.
 * Snapshots stay inside the workspace; they are never transmitted.
 */
import { access, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { ContextPatch } from "./patch.js";
import { hasUnsafePathSyntax, isProtectedRepairPath } from "./workspace-policy.js";

export interface FileSnapshot {
  path: string;
  previous: string | null;
}

export interface RestoreOutcome {
  restored: string[];
  failed: { path: string; error: string }[];
}

function isCapturable(normalized: string): boolean {
  return !normalized.startsWith("/")
    && !/^[a-z]:\//i.test(normalized)
    && !normalized.split("/").includes("..")
    && !hasUnsafePathSyntax(normalized)
    && !isProtectedRepairPath(normalized);
}

export async function snapshotPatchTargets(
  root: string,
  patches: ContextPatch[],
): Promise<FileSnapshot[]> {
  const snapshots: FileSnapshot[] = [];
  const seen = new Set<string>();
  for (const patch of patches) {
    const normalized = patch.path.replace(/\\/g, "/");
    if (!isCapturable(normalized) || seen.has(normalized)) continue;
    seen.add(normalized);
    const target = join(root, normalized);
    let previous: string | null = null;
    try {
      await access(target);
      previous = await readFile(target, "utf8");
    } catch {
      previous = null;
    }
    snapshots.push({ path: normalized, previous });
  }
  return snapshots;
}

/** Best-effort: one unrestorable file never stops the rest from being restored. */
export async function restoreSnapshots(
  root: string,
  snapshots: FileSnapshot[],
): Promise<RestoreOutcome> {
  const outcome: RestoreOutcome = { restored: [], failed: [] };
  for (const snapshot of [...snapshots].reverse()) {
    if (!isCapturable(snapshot.path)) {
      outcome.failed.push({ path: snapshot.path, error: "Refusing to restore an unauthorized path" });
      continue;
    }
    const target = join(root, snapshot.path);
    try {
      if (snapshot.previous === null) await rm(target, { force: true });
      else await writeFile(target, snapshot.previous, "utf8");
      outcome.restored.push(snapshot.path);
    } catch (error) {
      outcome.failed.push({ path: snapshot.path, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return outcome;
}

export function repairSnapshotPath(reportPath: string): string {
  return join(dirname(reportPath), "snapshots.json");
}

export async function persistSnapshots(path: string, snapshots: FileSnapshot[]): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = path + ".tmp-" + process.pid;
  await writeFile(temporaryPath, JSON.stringify({ version: 1, snapshots }) + "\n", { encoding: "utf8", flag: "w" });
  await rename(temporaryPath, path);
}

export async function loadSnapshots(path: string): Promise<FileSnapshot[] | null> {
  try {
    const parsed = JSON.parse(await readFile(path, "utf8")) as { version?: number; snapshots?: unknown };
    if (parsed.version !== 1 || !Array.isArray(parsed.snapshots)) return null;
    const valid = parsed.snapshots.filter((entry): entry is FileSnapshot =>
      typeof entry === "object" && entry !== null
      && typeof (entry as FileSnapshot).path === "string"
      && (typeof (entry as FileSnapshot).previous === "string" || (entry as FileSnapshot).previous === null),
    );
    return valid.length === parsed.snapshots.length ? valid : null;
  } catch {
    return null;
  }
}
