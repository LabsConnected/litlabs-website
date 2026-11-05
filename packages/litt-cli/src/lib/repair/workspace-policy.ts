import { realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";

/** Matched against every path segment, not just the first — `src/.env` is as sensitive as `.env`. */
const PROTECTED_SEGMENTS = new Set([".git", ".env", "credentials", "backups"]);
const PROTECTED_PREFIXES = [".litt/repairs"];
const WINDOWS_DEVICE_NAMES = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i;

export async function resolveExistingWorkspacePath(
  root: string,
  requestedPath: string,
): Promise<string> {
  if (isAbsolute(requestedPath)) {
    throw new Error("Absolute paths are not allowed");
  }
  const canonicalRoot = await realpath(root);
  const candidate = await realpath(resolve(canonicalRoot, requestedPath));
  assertInside(canonicalRoot, candidate);
  return candidate;
}

export function isProtectedRepairPath(relativePath: string): boolean {
  const normalized = relativePath.replace(/\\/g, "/").toLowerCase();
  if (PROTECTED_PREFIXES.some((prefix) => normalized === prefix || normalized.startsWith(prefix + "/"))) {
    return true;
  }
  return normalized.split("/").some(
    (segment) => PROTECTED_SEGMENTS.has(segment) || segment.startsWith(".env."),
  );
}

/**
 * Names that mean something different on Windows than they look: alternate
 * data streams (`file:stream`), device names (`nul`, `con`), and trailing
 * dots/spaces that the Win32 layer silently strips. Rejected on every
 * platform so a patch validated on Linux cannot misbehave on Windows.
 */
export function hasUnsafePathSyntax(relativePath: string): boolean {
  const segments = relativePath.replace(/\\/g, "/").split("/");
  return segments.some((segment) => {
    if (segment.includes(":") || WINDOWS_DEVICE_NAMES.test(segment)) return true;
    const hasTrailingDotOrSpace = /[. ]$/.test(segment);
    return hasTrailingDotOrSpace && segment !== "." && segment !== "..";
  });
}

export function assertInside(root: string, candidate: string): void {
  const pathFromRoot = relative(root, candidate);
  if (!pathFromRoot || pathFromRoot === ".") return;
  if (pathFromRoot === ".." || pathFromRoot.startsWith("../")
    || pathFromRoot.startsWith("..\\")) {
    throw new Error("Path resolves outside the authorized workspace");
  }
}
