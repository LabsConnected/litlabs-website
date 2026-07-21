import { resolve, relative, isAbsolute, join, normalize, sep } from "path";
import { existsSync, realpathSync, statSync } from "fs";

const MAX_PATH_LENGTH = 4096;
const MAX_READ_SIZE = 2 * 1024 * 1024;
const MAX_WRITE_SIZE = 1 * 1024 * 1024;

const IGNORED_DIRS = new Set([
  "node_modules",
  ".git",
  ".next",
  "dist",
  "build",
  ".cache",
  ".turbo",
  "coverage",
  ".nuxt",
  ".output",
]);

export interface WorkspaceRoot {
  root: string;
  workspaceId: string;
}

export function resolveWorkspacePath(
  root: string,
  filePath: string,
): string {
  if (!filePath || filePath.length > MAX_PATH_LENGTH) {
    throw new Error("Invalid path");
  }

  const normalized = normalize(filePath);
  if (isAbsolute(normalized) || normalized.startsWith("..")) {
    throw new Error("Absolute or parent paths are not allowed");
  }

  const target = resolve(root, normalized);
  const rel = relative(root, target);
  if (rel.startsWith("..") || isAbsolute(rel)) {
    throw new Error("Path escapes workspace root");
  }

  if (existsSync(target)) {
    const real = realpathSync(target);
    const realRel = relative(root, real);
    if (realRel.startsWith("..") || isAbsolute(realRel)) {
      throw new Error("Symlink escapes workspace root");
    }
  }

  return target;
}

export function isIgnoredDir(name: string): boolean {
  return IGNORED_DIRS.has(name);
}

export function isWithinSizeLimit(filePath: string, isWrite: boolean): void {
  try {
    const stats = statSync(filePath);
    const limit = isWrite ? MAX_WRITE_SIZE : MAX_READ_SIZE;
    if (stats.size > limit) {
      throw new Error(`File exceeds ${limit} bytes`);
    }
  } catch {
    // File may not exist yet for writes
  }
}

export { MAX_READ_SIZE, MAX_WRITE_SIZE };
