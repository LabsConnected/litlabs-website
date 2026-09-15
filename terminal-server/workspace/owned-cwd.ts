/**
 * Containment for a caller-supplied working directory.
 *
 * A command request may name the directory it wants to run in. That value
 * arrives from the network, so it is never trusted as a path: it is
 * resolved against the caller's OWN workspace root and rejected unless it
 * stays inside it.
 *
 * Two escapes are closed here:
 *   - traversal, e.g. "../../other-user/project"
 *   - an absolute path, e.g. "/data/littree-workspaces/<someone-else>",
 *     which path.resolve() would otherwise honour verbatim
 *
 * Symlinks are resolved before the comparison, so a link planted inside a
 * workspace cannot point the command at a directory outside it. When the
 * target does not exist yet there is nothing to dereference, and the
 * lexically resolved path is checked instead — a path that does not exist
 * cannot be a symlink to somewhere else.
 */

import { isAbsolute, relative, resolve } from "path";
import { realpathSync } from "fs";

export type OwnedCwdResult =
  | { ok: true; cwd: string }
  | { ok: false; reason: "outside_workspace" };

/**
 * Dereference symlinks where possible.
 *
 * Falls back to the given path when it does not exist, so callers can name
 * a directory a command is about to create.
 */
function realpathOrSelf(candidate: string): string {
  try {
    return realpathSync(candidate);
  } catch {
    return candidate;
  }
}

/** Whether `candidate` is `root` itself or lies beneath it. */
function isInside(root: string, candidate: string): boolean {
  const rel = relative(root, candidate);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

/**
 * Resolve the directory a command may run in.
 *
 * `workspaceRoot` must already be an OWNED root — this function enforces
 * containment, not ownership. Ownership is established by
 * getWorkspaceRoot(workspaceId, userId) before this is called.
 */
export function resolveOwnedCwd(
  workspaceRoot: string,
  requestedCwd: string | null | undefined,
): OwnedCwdResult {
  const root = realpathOrSelf(resolve(workspaceRoot));

  const requested = typeof requestedCwd === "string" ? requestedCwd.trim() : "";
  if (!requested) {
    return { ok: true, cwd: root };
  }

  // An absolute `requested` replaces the root here — that is exactly why the
  // containment check below is not optional.
  const candidate = realpathOrSelf(resolve(root, requested));

  if (!isInside(root, candidate)) {
    return { ok: false, reason: "outside_workspace" };
  }

  return { ok: true, cwd: candidate };
}
