/**
 * Dependency-install freshness stamp — preview start fix (2026-11-14).
 *
 * The problem: node_modules is sandbox-only (sync.ts — it never
 * crosses to the volume in either direction), so the volume's file
 * list showing node_modules says nothing about the sandbox. Every
 * fresh sandbox starts without dependencies, and the only signals
 * the install paths had were "node_modules dir exists in the
 * sandbox" — no notion of whether those dependencies match the
 * lockfile the tree currently carries. A sandbox whose tree moved
 * (new lockfile mirrored in) kept stale dependencies, and a sandbox
 * whose background prepare-install silently failed looked identical
 * to one that never tried.
 *
 * The stamp: after a successful install inside the sandbox, the
 * installer writes a small file INTO the sandbox's node_modules
 * (`.litt-install-stamp`) holding the SHA-256 of the volume's
 * lockfile + package.json — the exact inputs the install resolved.
 * Because the stamp lives inside node_modules, it is sandbox-only
 * too: it never syncs to the volume, and it dies with the sandbox,
 * which is exactly its lifetime.
 *
 * Fresh = node_modules exists AND the stamp inside it equals the
 * stamp computed from the volume's current lockfile + package.json.
 * Anything else (no node_modules, no stamp, mismatched stamp) means
 * "install" — and pnpm's own incremental machinery (existing
 * node_modules + store) makes that re-install cheap when only the
 * lockfile drifted.
 */

import { createHash } from "crypto";
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import type { SandboxProvider } from "./provider";
import { requireFileTransfer } from "./sync";

/** Stamp file path inside the sandbox workspace (sandbox-only tree). */
export const INSTALL_STAMP_PATH = "node_modules/.litt-install-stamp";

/** Lockfiles an install resolves, in preference order. */
const LOCKFILE_NAMES = ["pnpm-lock.yaml", "package-lock.json", "yarn.lock"] as const;

/** SHA-256 over the install's input files, in order. */
export function computeInstallStamp(parts: readonly string[]): string {
  const hash = createHash("sha256");
  for (const part of parts) {
    hash.update(part, "utf-8");
    hash.update("\n");
  }
  return hash.digest("hex");
}

/**
 * The stamp for the tree the VOLUME currently holds (the mirror
 * source — the sandbox tree is made equal to it before any install
 * decision). Null when the volume has no package.json (nothing to
 * install for) or the inputs cannot be read: callers then fall back
 * to the pre-stamp behavior (node_modules presence decides).
 */
export function readVolumeInstallStamp(volumeRoot: string): string | null {
  try {
    const pkgPath = join(volumeRoot, "package.json");
    if (!existsSync(pkgPath)) return null;
    const parts: string[] = [];
    for (const name of LOCKFILE_NAMES) {
      const lockPath = join(volumeRoot, name);
      if (existsSync(lockPath)) {
        parts.push(readFileSync(lockPath, "utf-8"));
        break;
      }
    }
    parts.push(readFileSync(pkgPath, "utf-8"));
    return computeInstallStamp(parts);
  } catch {
    return null;
  }
}

/**
 * True when the sandbox's installed dependencies carry a stamp equal
 * to `stamp`. A missing node_modules, a missing stamp file (every
 * pre-stamp install), or any transfer error reads as NOT fresh — the
 * caller installs, which is always safe.
 */
export async function sandboxInstallIsFresh(
  provider: SandboxProvider,
  sandboxId: string,
  stamp: string | null,
): Promise<boolean> {
  if (!stamp) return false;
  try {
    const transfer = requireFileTransfer(provider);
    const bytes = await transfer.readFile(sandboxId, INSTALL_STAMP_PATH);
    return new TextDecoder().decode(bytes).trim() === stamp;
  } catch {
    return false;
  }
}

/**
 * Record a successful install's stamp inside the sandbox. Best
 * effort: a failed write only means the next start re-checks by
 * installing again — it must never fail the install it follows.
 */
export async function writeSandboxInstallStamp(
  provider: SandboxProvider,
  sandboxId: string,
  stamp: string | null,
): Promise<void> {
  if (!stamp) return;
  try {
    const transfer = requireFileTransfer(provider);
    await transfer.writeFile(
      sandboxId,
      INSTALL_STAMP_PATH,
      new TextEncoder().encode(`${stamp}\n`),
    );
  } catch {
    // Best effort — see docstring.
  }
}
