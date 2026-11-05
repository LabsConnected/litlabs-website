/**
 * Workspace manifest — detects files changed by a repair that the approved
 * patch did not declare. Cheap fingerprint (size + mtime), taken before the
 * patch and compared after validation. It reports; it never deletes or
 * reverts files the repair did not snapshot.
 */
import { mkdir, readFile, readdir, rename, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

const IGNORED_DIRECTORIES = new Set([
  "node_modules", ".git", ".litt", "dist", "build", "coverage", ".turbo", ".next", ".cache",
]);
const IGNORED_FILE = /\.(tsbuildinfo|log)$/i;
const MAX_ENTRIES = 50_000;

export type WorkspaceManifest = Record<string, string>;

export async function captureWorkspaceManifest(root: string): Promise<WorkspaceManifest> {
  const manifest: WorkspaceManifest = {};
  let count = 0;
  const walk = async (dir: string, prefix: string): Promise<void> => {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (count >= MAX_ENTRIES) return;
      const relative = prefix ? prefix + "/" + entry.name : entry.name;
      if (entry.isDirectory()) {
        if (!IGNORED_DIRECTORIES.has(entry.name)) await walk(join(dir, entry.name), relative);
      } else if (entry.isFile() && !IGNORED_FILE.test(entry.name)) {
        try {
          const info = await stat(join(dir, entry.name));
          manifest[relative] = `${info.size}:${Math.trunc(info.mtimeMs)}`;
          count++;
        } catch {
          // vanished between readdir and stat — the diff will surface it
        }
      }
    }
  };
  await walk(root, "");
  return manifest;
}

export function findUnrelatedChanges(
  before: WorkspaceManifest,
  after: WorkspaceManifest,
  declaredPaths: readonly string[],
): string[] {
  const declared = new Set(declaredPaths.map((p) => p.replace(/\\/g, "/")));
  const touched = new Set<string>();
  for (const path of Object.keys(after)) if (before[path] !== after[path]) touched.add(path);
  for (const path of Object.keys(before)) if (!(path in after)) touched.add(path);
  return [...touched].filter((path) => !declared.has(path)).sort();
}

export function repairManifestPath(reportPath: string): string {
  return join(dirname(reportPath), "manifest.json");
}

export async function persistManifest(path: string, manifest: WorkspaceManifest): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = path + ".tmp-" + process.pid;
  await writeFile(temporaryPath, JSON.stringify({ version: 1, manifest }) + "\n", "utf8");
  await rename(temporaryPath, path);
}

export async function loadManifest(path: string): Promise<WorkspaceManifest | null> {
  try {
    const parsed = JSON.parse(await readFile(path, "utf8")) as { version?: number; manifest?: unknown };
    if (parsed.version !== 1 || typeof parsed.manifest !== "object" || parsed.manifest === null) return null;
    return parsed.manifest as WorkspaceManifest;
  } catch {
    return null;
  }
}
