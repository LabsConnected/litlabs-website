import { resolve, sep } from "path";
import { tmpdir } from "os";
import { readFileSync } from "fs";

/**
 * Workspace-root durability enforcement.
 *
 * Managed source is only durable if the workspace root lives on a
 * persistent volume. The previous behaviour logged a warning when the
 * root was ephemeral and then served anyway — production could run for
 * weeks on container-local storage while every surface reported
 * workspaces as durable. In production this must fail, not warn.
 */

/** Path prefixes that are always ephemeral container/host scratch space. */
const EPHEMERAL_PREFIXES = ["/tmp", "/var/tmp", "/dev/shm", "/run/user"];

/** Whether a resolved absolute path lives under an ephemeral location. */
export function isEphemeralPath(resolvedRoot: string): boolean {
  const normalized = resolve(resolvedRoot);
  const tmp = resolve(tmpdir());
  if (normalized === tmp || normalized.startsWith(tmp + sep)) return true;
  return EPHEMERAL_PREFIXES.some(
    (prefix) => normalized === prefix || normalized.startsWith(prefix + sep),
  );
}

/**
 * Whether the path is its own filesystem mount — i.e. backed by an
 * attached volume rather than the container overlay.
 *
 * Reads /proc/mounts (Linux). Returns null when the platform cannot
 * answer (no /proc, unreadable file) so callers can decide how strict
 * to be instead of guessing.
 */
export function isSeparateMount(resolvedRoot: string): boolean | null {
  let mounts: string;
  try {
    mounts = readFileSync("/proc/mounts", "utf-8");
  } catch {
    return null;
  }
  const target = resolve(resolvedRoot);
  return mounts
    .split("\n")
    .some((line) => line.split(" ")[1] === target);
}

export interface WorkspaceRootVerdict {
  ok: boolean;
  reason: string | null;
}

/**
 * Evaluate whether a workspace root is acceptable for durable managed
 * source.
 *
 * Production requires BOTH:
 *   - TERMINAL_WORKSPACE_ROOT explicitly set to a non-ephemeral path
 *   - the path backed by its own mount when the platform can verify it
 *
 * The mount check exists because "env var set" is not proof of
 * persistence: this deployment previously ran with
 * TERMINAL_WORKSPACE_ROOT=/data/littree-workspaces pointed at plain
 * container storage — configured correctly, durable not at all.
 */
export function evaluateWorkspaceRoot(opts: {
  nodeEnv: string | undefined;
  configuredRoot: string | undefined;
  resolvedRoot: string;
}): WorkspaceRootVerdict {
  const { nodeEnv, configuredRoot, resolvedRoot } = opts;
  const ephemeral =
    !configuredRoot || !configuredRoot.trim() || isEphemeralPath(resolvedRoot);

  if (nodeEnv !== "production") {
    return ephemeral
      ? {
          ok: true,
          reason:
            "TERMINAL_WORKSPACE_ROOT is unset or ephemeral — workspaces will not survive restart (allowed outside production)",
        }
      : { ok: true, reason: null };
  }

  if (ephemeral) {
    return {
      ok: false,
      reason:
        `TERMINAL_WORKSPACE_ROOT resolves to ephemeral path "${resolvedRoot}". ` +
        "Managed source would be destroyed on every redeploy. Mount a persistent " +
        "volume and set TERMINAL_WORKSPACE_ROOT to the mount path.",
    };
  }

  const mounted = isSeparateMount(resolvedRoot);
  if (mounted === false) {
    return {
      ok: false,
      reason:
        `TERMINAL_WORKSPACE_ROOT="${resolvedRoot}" is not a mounted volume — ` +
        "it lives on ephemeral container storage. Managed source would be lost " +
        "on redeploy. Attach a Railway volume at this path.",
    };
  }

  return { ok: true, reason: null };
}
