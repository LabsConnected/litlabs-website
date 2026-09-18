import { resolve, relative, isAbsolute, join, normalize, sep, dirname } from "path";
import { existsSync, realpathSync, statSync } from "fs";

const MAX_PATH_LENGTH = 4096;
const MAX_READ_SIZE = 2 * 1024 * 1024;
const MAX_WRITE_SIZE = 1 * 1024 * 1024;
// Binary (base64) asset writes — generated images, audio, video — are
// advertised at 50MB by the web app's asset-insert API and the
// project.insert_asset tool. The cap is enforced on DECODED bytes so the
// advertised limit is actually reachable (base64 inflates ~33%); measuring
// the base64 string instead would silently reject every image over ~750KB.
const MAX_BINARY_WRITE_SIZE = 50 * 1024 * 1024;

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
  // LiTT platform state (scaffolding manifest, checkpoints) — not project
  // content. Kept out of file listings and code search.
  ".litt",
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

  // Symlink check: canonicalize the nearest existing ancestor of the target
  // and verify it stays within the workspace root. The target itself may not
  // exist yet (e.g. writing a new file), so checking only an existing target
  // would miss a symlinked parent directory pointing outside the root —
  // `ln -s /etc link` + write `link/evil` must not escape. The root itself
  // is canonicalized first so a symlinked root can't smuggle an outside
  // path past the comparison. The walk never goes above the workspace root:
  // if the root doesn't exist yet there is nothing to symlink-check against.
  const realRoot = existsSync(root) ? realpathSync(root) : root;
  let probe: string = target;
  for (;;) {
    if (existsSync(probe)) break;
    const relProbe = relative(root, probe);
    if (relProbe === "" || relProbe.startsWith("..") || isAbsolute(relProbe)) break;
    const parent = dirname(probe);
    if (parent === probe) break;
    probe = parent;
  }
  if (existsSync(probe)) {
    const real = realpathSync(probe);
    const realRel = relative(realRoot, real);
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

export type WritePayloadCheck =
  | { ok: true; binary: Buffer | null }
  | { ok: false; status: number; error: string };

/**
 * Validate a ws-files/write payload before touching the filesystem.
 *
 * Text writes keep the 1MB cap; base64 (binary) writes are decoded first
 * and measured against MAX_BINARY_WRITE_SIZE. Returns the decoded buffer
 * for binary writes so the route doesn't decode twice.
 */
export function validateWritePayload(encoding: string, content: string): WritePayloadCheck {
  if (encoding === "base64") {
    const binary = Buffer.from(content, "base64");
    if (binary.length === 0) {
      return { ok: false, status: 400, error: "Decoded binary content is empty" };
    }
    if (binary.length > MAX_BINARY_WRITE_SIZE) {
      return {
        ok: false,
        status: 413,
        error: `Decoded binary exceeds max write size (${MAX_BINARY_WRITE_SIZE} bytes)`,
      };
    }
    return { ok: true, binary };
  }
  if (Buffer.byteLength(content, "utf8") > MAX_WRITE_SIZE) {
    return {
      ok: false,
      status: 413,
      error: `Content exceeds max write size (${MAX_WRITE_SIZE} bytes)`,
    };
  }
  return { ok: true, binary: null };
}

export { MAX_READ_SIZE, MAX_WRITE_SIZE, MAX_BINARY_WRITE_SIZE };
