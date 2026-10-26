/**
 * Dex SUPER Stage 1A — local state home.
 *
 * Dex writes ONLY under <LiTT home>/dex — outside any git worktree, so
 * screenshots and audit logs can never be committed accidentally.
 * Same convention as desktop.ts's getLiTTHome().
 */

import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export function dexHome(): string {
  const littHome = process.env.LITT_STATE_HOME ?? join(homedir(), ".litt");
  const dir = join(littHome, "dex");
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function dexShotsDir(): string {
  const dir = join(dexHome(), "shots");
  mkdirSync(dir, { recursive: true });
  return dir;
}
