/**
 * Starter-scaffolding flag (brief §7 — deterministic complement).
 *
 * A new project's welcome screen ("Welcome to LiTT") is temporary
 * scaffolding, not the user's site. The prompt-text rule (PR #380) tells
 * the agent to replace it on build; THIS module is the machine-readable
 * authority that makes the replacement deterministic:
 *
 * - `writeScaffoldManifest` records, at workspace creation, exactly which
 *   files are system-generated scaffolding, with a sha256 of the seeded
 *   bytes per file. The manifest lives at `.litt/scaffold.json` inside
 *   the workspace so it survives terminal-server restarts (the workspace
 *   directory is the durable volume) and travels with the project.
 * - The manifest — never a "Welcome to LiTT" text match — decides whether
 *   the workspace is still on untouched starter scaffolding.
 * - `replaceScaffoldingForWrite` runs before every workspace file write:
 *   a write that targets a scaffold file is a wholesale overwrite of the
 *   scaffolding (a build starting): checkpoint first, then remove the
 *   untouched scaffold files wholesale, then clear the flag. Any other
 *   write (assets, CSS, JS, images, fonts, folders) is a no-op — the
 *   scaffold flag stays active until the scaffold page itself is replaced.
 * - Files whose current bytes no longer match the seeded hash are
 *   user-edited and are NEVER deleted by this module.
 * - The in-file `WELCOME_SCREEN_MARKER` comment (welcome-screen.ts) is the
 *   in-band counterpart of the manifest: the manifest records it, and a
 *   manifest whose marker doesn't match is treated as not-scaffolding
 *   (safe default — never delete on a stale or foreign manifest).
 */

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "fs";
import { dirname, join } from "path";
import { createHash } from "crypto";
import { simpleGit } from "simple-git";
import { WELCOME_SCREEN_MARKER } from "./welcome-screen";

export const SCAFFOLD_DIR_NAME = ".litt";
export const SCAFFOLD_MANIFEST_NAME = "scaffold.json";
export const SCAFFOLD_MANIFEST_VERSION = 1;

/** Git commit message for the pre-replacement undo checkpoint. */
export const SCAFFOLD_CHECKPOINT_MESSAGE =
  "checkpoint: LiTT starter scaffolding (pre-build state)";

export interface ScaffoldManifest {
  version: number;
  scaffolded: true;
  /** In-file marker counterpart — must match WELCOME_SCREEN_MARKER. */
  marker: string;
  templateId: string;
  /** Workspace-relative posix paths seeded as scaffolding. */
  scaffoldFiles: string[];
  /** sha256 hex of the seeded bytes, per scaffold file. */
  hashes: Record<string, string>;
  createdAt: string;
}

export interface ScaffoldCheckpoint {
  kind: "git" | "files";
  /**
   * Undo target: a git SHA (kind "git", restorable via
   * `restore_checkpoint` / `git reset --hard <sha>`) or a
   * `.litt/checkpoints/<id>` path relative to the workspace root
   * (kind "files", git-unavailable fallback).
   */
  ref: string;
}

export interface ScaffoldWriteResult {
  /** True when untouched scaffolding was replaced wholesale before the write. */
  acted: boolean;
  /** True when the flag was consumed (by replacement or by first user edit). */
  flagCleared: boolean;
  /** Pre-replacement undo checkpoint. Null when nothing was replaced. */
  checkpoint: ScaffoldCheckpoint | null;
  /** Scaffold files removed (only untouched ones — hash-verified). */
  removedFiles: string[];
  /** Scaffold files that were user-edited and therefore preserved. */
  preservedEditedFiles: string[];
  reason: string;
}

const NOT_SCAFFOLDED: ScaffoldWriteResult = {
  acted: false,
  flagCleared: false,
  checkpoint: null,
  removedFiles: [],
  preservedEditedFiles: [],
  reason: "not-scaffolded",
};

export function scaffoldManifestPath(root: string): string {
  return join(root, SCAFFOLD_DIR_NAME, SCAFFOLD_MANIFEST_NAME);
}

export function sha256Hex(data: string | Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

/** Normalize a workspace-relative path for manifest comparison. */
export function normalizeScaffoldPath(p: string): string {
  return p.replace(/\\/g, "/").replace(/^\.\//, "").replace(/^\/+/, "");
}

function manifestFileAbs(root: string, rel: string): string {
  return join(root, ...normalizeScaffoldPath(rel).split("/"));
}

/**
 * Record the scaffolding flag at workspace creation. Call after the
 * template files have been written; hashes are taken from disk.
 * Returns the manifest, or null when none of the files exist.
 */
export function writeScaffoldManifest(
  root: string,
  templateId: string,
  scaffoldFiles: string[],
): ScaffoldManifest | null {
  const hashes: Record<string, string> = {};
  for (const f of scaffoldFiles) {
    const rel = normalizeScaffoldPath(f);
    const abs = manifestFileAbs(root, rel);
    if (!existsSync(abs)) continue; // seed failed — don't claim it
    hashes[rel] = sha256Hex(readFileSync(abs));
  }
  const names = Object.keys(hashes);
  if (names.length === 0) return null;

  const manifest: ScaffoldManifest = {
    version: SCAFFOLD_MANIFEST_VERSION,
    scaffolded: true,
    marker: WELCOME_SCREEN_MARKER,
    templateId,
    scaffoldFiles: names,
    hashes,
    createdAt: new Date().toISOString(),
  };
  mkdirSync(dirname(scaffoldManifestPath(root)), { recursive: true });
  writeFileSync(scaffoldManifestPath(root), JSON.stringify(manifest, null, 2), "utf-8");
  return manifest;
}

/**
 * Read and validate the manifest. Returns null when there is no flag,
 * when it is corrupt, version-skewed, or when its marker doesn't match —
 * every one of those is a safe "not scaffolding" default: this module
 * never deletes on a manifest it doesn't fully trust.
 */
export function readScaffoldManifest(root: string): ScaffoldManifest | null {
  const p = scaffoldManifestPath(root);
  if (!existsSync(p)) return null;
  try {
    const m = JSON.parse(readFileSync(p, "utf-8")) as ScaffoldManifest;
    if (!m || m.version !== SCAFFOLD_MANIFEST_VERSION || m.scaffolded !== true) return null;
    if (m.marker !== WELCOME_SCREEN_MARKER) return null;
    if (!Array.isArray(m.scaffoldFiles) || typeof m.hashes !== "object" || !m.hashes) return null;
    return m;
  } catch {
    return null;
  }
}

export function isScaffolded(root: string): boolean {
  return readScaffoldManifest(root) !== null;
}

/** Consume the flag. Idempotent; tidies the dir when it becomes empty. */
export function clearScaffoldManifest(root: string): void {
  try {
    rmSync(scaffoldManifestPath(root), { force: true });
  } catch {
    // Idempotent — already gone is fine.
  }
  try {
    const dir = join(root, SCAFFOLD_DIR_NAME);
    if (existsSync(dir) && readdirSync(dir).length === 0) {
      rmSync(dir, { recursive: true });
    }
  } catch {
    // Best-effort tidy only.
  }
}

/**
 * Capture the pre-replacement state for Undo.
 *
 * Preferred: a git commit — the workspace is always a git repository, so
 * `restore_checkpoint` / `git reset --hard <sha>` brings the scaffolding
 * (manifest included) back. When the tree is clean the existing HEAD
 * already holds the scaffolding and no new commit is made.
 *
 * Fallback (git unavailable): file copies under
 * `.litt/checkpoints/<id>/`, manifest included.
 */
export async function checkpointScaffolding(root: string): Promise<ScaffoldCheckpoint | null> {
  try {
    const git = simpleGit(root);
    await git.add("-A");
    const status = await git.status();
    if (!status.isClean()) {
      await git.commit(SCAFFOLD_CHECKPOINT_MESSAGE);
    }
    const sha = (await git.revparse("HEAD")).trim();
    if (!/^[0-9a-f]{7,40}$/.test(sha)) return checkpointScaffoldingToFiles(root);
    return { kind: "git", ref: sha };
  } catch {
    return checkpointScaffoldingToFiles(root);
  }
}

function checkpointScaffoldingToFiles(root: string): ScaffoldCheckpoint | null {
  try {
    const manifest = readScaffoldManifest(root);
    const id = `scaffold-${Date.now()}`;
    const dir = join(root, SCAFFOLD_DIR_NAME, "checkpoints", id);
    mkdirSync(dir, { recursive: true });
    if (manifest) {
      for (const f of manifest.scaffoldFiles) {
        const abs = manifestFileAbs(root, f);
        if (!existsSync(abs)) continue;
        const dest = join(dir, ...f.split("/"));
        mkdirSync(dirname(dest), { recursive: true });
        copyFileSync(abs, dest);
      }
      copyFileSync(scaffoldManifestPath(root), join(dir, SCAFFOLD_MANIFEST_NAME));
    }
    return { kind: "files", ref: `${SCAFFOLD_DIR_NAME}/checkpoints/${id}` };
  } catch {
    return null;
  }
}

/**
 * Deterministic build-lane step. Call BEFORE performing a workspace file
 * write with the workspace root and the workspace-relative write path.
 *
 * - Workspace not scaffolded (no/invalid manifest) → no-op.
 * - Write targets a path outside the manifest (assets, CSS, JS, images,
 *   fonts, folders, supporting files) → no-op. The scaffold flag stays
 *   active so the later scaffold-page write still knows to replace it.
 * - Write targets a scaffold file → wholesale overwrite of the
 *   scaffolding, i.e. a build starting: write the undo checkpoint first,
 *   remove every scaffold file still byte-identical to the seeded
 *   scaffolding, then clear the flag. Files the user edited (hash
 *   mismatch) are preserved — never deleted.
 *
 * The flag — not text matching — is the authority throughout.
 */
export async function replaceScaffoldingForWrite(
  root: string,
  writePath: string,
): Promise<ScaffoldWriteResult> {
  const manifest = readScaffoldManifest(root);
  if (!manifest) return NOT_SCAFFOLDED;

  const target = normalizeScaffoldPath(writePath);

  if (!manifest.scaffoldFiles.includes(target)) {
    return {
      acted: false,
      flagCleared: false,
      checkpoint: null,
      removedFiles: [],
      preservedEditedFiles: [],
      reason: "non-scaffold-write",
    };
  }

  // The write overwrites a scaffold file wholesale: a build is starting
  // (or the scaffold file is being explicitly replaced). Partition the
  // scaffold files into untouched (safe to remove) vs user-edited
  // (must be preserved).
  const untouched: string[] = [];
  const edited: string[] = [];
  for (const f of manifest.scaffoldFiles) {
    const abs = manifestFileAbs(root, f);
    if (!existsSync(abs)) continue;
    const current = sha256Hex(readFileSync(abs));
    if (current === manifest.hashes[f]) untouched.push(f);
    else edited.push(f);
  }

  const checkpoint = await checkpointScaffolding(root);

  for (const f of untouched) {
    try {
      rmSync(manifestFileAbs(root, f), { force: true });
    } catch {
      // Keep going — a failed remove must not block the write or the flag.
    }
  }
  clearScaffoldManifest(root);

  return {
    acted: true,
    flagCleared: true,
    checkpoint,
    removedFiles: untouched,
    preservedEditedFiles: edited,
    reason: "scaffold-file-overwrite",
  };
}
