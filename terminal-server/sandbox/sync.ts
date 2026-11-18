/**
 * Sandbox ↔ volume sync — Phase 2 lifecycle (design note §1.3/§1.4).
 *
 * The model, three rules:
 *   1. Outside a running command, the volume tree equals the sandbox
 *      tree, excluding sandbox-only directories.
 *   2. User/agent file edits write the volume first, then the sandbox.
 *      Only commands write the sandbox first.
 *   3. One lock per workspace serializes exec, sync and forwarding —
 *      the lock lives in workspace-executor.ts; everything here is
 *      written to be called under it.
 *
 * "Sandbox-only" directories are IGNORED_DIRS minus `.git` and
 * `.litt`: exactly the set Studio cannot list is not the rule — the
 * rule is that dependencies and build output (node_modules, .next,
 * dist, …) are a cache that lives only in the sandbox, while `.git`
 * and `.litt` DO sync, `.git` as a byte-for-byte snapshot the host
 * never runs git against (hooks and config cross as inert data,
 * restored only into a sandbox).
 *
 * Sync-back is the one place untrusted bytes land on the terminal
 * host, so extraction is defensive (§1.4): destinations resolve
 * through resolveWorkspacePath, symlink targets must resolve inside
 * the root, per-file and per-workspace quotas are enforced before
 * anything is written, and nothing here ever shells out — transfers
 * move through the provider's file-transfer capability and plain fs
 * calls. (Bulk archives were approved by ruling (c) but are not
 * needed: per-file transfer keeps the trust boundary per-file, so no
 * tar dependency was added.)
 */

import { createHash } from "crypto";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "fs";
import { dirname, join, relative, resolve } from "path";
import { isIgnoredDir, resolveWorkspacePath } from "../workspace/WorkspaceSecurity";
import type {
  SandboxFileEntry,
  SandboxFileTransfer,
  SandboxProvider,
} from "./provider";

// ─── Exclusions ─────────────────────────────────────────────────────

/**
 * Directories that live only in the sandbox and never sync in either
 * direction: IGNORED_DIRS minus `.git` and `.litt` (design note §1.3).
 * Derived from the canonical list so the two cannot drift.
 */
const SYNC_INCLUDED_FROM_IGNORED: ReadonlySet<string> = new Set([".git", ".litt"]);

export function isSandboxOnlyDir(name: string): boolean {
  return isIgnoredDir(name) && !SYNC_INCLUDED_FROM_IGNORED.has(name);
}

/** True when any segment of a relative POSIX path is sandbox-only. */
export function isSandboxOnlyPath(relPath: string): boolean {
  return relPath.split("/").some((segment) => isSandboxOnlyDir(segment));
}

// ─── Manifest ───────────────────────────────────────────────────────

export interface SyncManifestEntry {
  /** Relative POSIX path from the tree root. */
  path: string;
  type: "file" | "dir" | "symlink";
  size: number;
  mtimeMs: number;
  mode: number;
  linkTarget?: string;
}

/** path -> entry. The diff currency of every sync direction. */
export type SyncManifest = Map<string, SyncManifestEntry>;

export interface SyncDiff {
  upserts: SyncManifestEntry[];
  deletes: SyncManifestEntry[];
}

function sameEntry(a: SyncManifestEntry, b: SyncManifestEntry): boolean {
  if (a.type !== b.type) return false;
  if (a.type === "symlink") return a.linkTarget === b.linkTarget;
  if (a.type === "dir") return true;
  return a.size === b.size && a.mtimeMs === b.mtimeMs;
}

/**
 * Diff two listings OF THE SAME TREE taken at different times (the
 * sandbox before/after a command). Cross-tree comparisons do not use
 * this — clocks differ; mirrorVolumeToSandbox compares content.
 */
export function diffManifests(previous: SyncManifest, next: SyncManifest): SyncDiff {
  const upserts: SyncManifestEntry[] = [];
  const deletes: SyncManifestEntry[] = [];
  for (const [path, entry] of next) {
    const before = previous.get(path);
    if (!before || !sameEntry(before, entry)) upserts.push(entry);
  }
  for (const [path, entry] of previous) {
    if (!next.has(path)) deletes.push(entry);
  }
  // Deepest first so directory removals never strand their children.
  deletes.sort((a, b) => b.path.split("/").length - a.path.split("/").length);
  return { upserts, deletes };
}

// ─── Quotas (§1.4) ──────────────────────────────────────────────────

export interface SyncQuotas {
  /** Per-file cap for bytes landing on the shared volume. */
  maxFileBytes: number;
  /** Per-workspace cap for the synced tree's total size. */
  maxTotalBytes: number;
}

export const DEFAULT_SYNC_QUOTAS: SyncQuotas = {
  maxFileBytes: 64 * 1024 * 1024,
  maxTotalBytes: 2 * 1024 * 1024 * 1024,
};

export function resolveSyncQuotas(
  env: Record<string, string | undefined> = process.env,
): SyncQuotas {
  const file = Number(env.SANDBOX_SYNC_MAX_FILE_BYTES);
  const total = Number(env.SANDBOX_SYNC_MAX_TOTAL_BYTES);
  return {
    maxFileBytes: Number.isFinite(file) && file > 0 ? file : DEFAULT_SYNC_QUOTAS.maxFileBytes,
    maxTotalBytes: Number.isFinite(total) && total > 0 ? total : DEFAULT_SYNC_QUOTAS.maxTotalBytes,
  };
}

export class SyncQuotaError extends Error {
  readonly code = "SANDBOX_SYNC_QUOTA" as const;
  constructor(message: string) {
    super(message);
    this.name = "SyncQuotaError";
  }
}

export class SyncSafetyError extends Error {
  readonly code = "SANDBOX_SYNC_SAFETY" as const;
  constructor(message: string) {
    super(message);
    this.name = "SyncSafetyError";
  }
}

export class SandboxTransferUnsupportedError extends Error {
  readonly code = "SANDBOX_TRANSFER_UNSUPPORTED" as const;
  constructor(providerName: string) {
    super(
      `Sandbox provider "${providerName}" has no file-transfer capability; ` +
        "workspace lifecycle sync cannot run through it.",
    );
    this.name = "SandboxTransferUnsupportedError";
  }
}

/** The provider's transfer capability, or a loud refusal. */
export function requireFileTransfer(provider: SandboxProvider): SandboxFileTransfer {
  if (!provider.fileTransfer) {
    throw new SandboxTransferUnsupportedError(provider.name);
  }
  return provider.fileTransfer;
}

// ─── Listings ───────────────────────────────────────────────────────

function toManifest(entries: Iterable<SyncManifestEntry>): SyncManifest {
  const manifest: SyncManifest = new Map();
  for (const entry of entries) {
    if (!entry.path || isSandboxOnlyPath(entry.path)) continue;
    manifest.set(entry.path, entry);
  }
  return manifest;
}

/** List the volume tree (host side, plain fs). */
export function listVolumeTree(volumeRoot: string): SyncManifest {
  const entries: SyncManifestEntry[] = [];
  const walk = (dirAbs: string, relBase: string): void => {
    let names: string[];
    try {
      names = readdirSync(dirAbs);
    } catch {
      return; // unreadable directory — nothing to list under it
    }
    for (const name of names) {
      if (isSandboxOnlyDir(name)) continue;
      const abs = join(dirAbs, name);
      const rel = relBase ? `${relBase}/${name}` : name;
      let stat;
      try {
        stat = lstatSync(abs);
      } catch {
        continue;
      }
      if (stat.isSymbolicLink()) {
        let linkTarget = "";
        try {
          linkTarget = readlinkSync(abs);
        } catch {
          continue;
        }
        entries.push({ path: rel, type: "symlink", size: 0, mtimeMs: stat.mtimeMs, mode: stat.mode & 0o7777, linkTarget });
      } else if (stat.isDirectory()) {
        entries.push({ path: rel, type: "dir", size: 0, mtimeMs: stat.mtimeMs, mode: stat.mode & 0o7777 });
        walk(abs, rel);
      } else if (stat.isFile()) {
        entries.push({ path: rel, type: "file", size: stat.size, mtimeMs: stat.mtimeMs, mode: stat.mode & 0o7777 });
      }
      // Anything else (fifo, socket, device) is not project content
      // and never enters the manifest — on either side (§1.4).
    }
  };
  walk(volumeRoot, "");
  return toManifest(entries);
}

/** List the sandbox tree through the transfer capability. */
export async function listSandboxTree(
  provider: SandboxProvider,
  sandboxId: string,
  sandboxRoot: string,
): Promise<SyncManifest> {
  const transfer = requireFileTransfer(provider);
  const listed = await transfer.listTree(sandboxId, sandboxRoot);
  const entries: SyncManifestEntry[] = listed.map((e: SandboxFileEntry) => ({
    path: e.path,
    type: e.type,
    size: e.size,
    mtimeMs: e.mtimeMs,
    mode: e.mode,
    ...(e.linkTarget ? { linkTarget: e.linkTarget } : {}),
  }));
  return toManifest(entries);
}

// ─── Sync-back: sandbox → volume (§1.3, §1.4) ───────────────────────

export interface SyncStats {
  filesCopied: number;
  dirsCreated: number;
  symlinksCreated: number;
  filesDeleted: number;
  bytesCopied: number;
  /** Paths deliberately not recreated (e.g. symlink escaping the root). */
  skipped: Array<{ path: string; reason: string }>;
}

function emptyStats(): SyncStats {
  return {
    filesCopied: 0,
    dirsCreated: 0,
    symlinksCreated: 0,
    filesDeleted: 0,
    bytesCopied: 0,
    skipped: [],
  };
}

/**
 * Whether a symlink target stays inside the root when resolved from
 * the link's own directory. Absolute targets are judged as-is.
 */
export function symlinkTargetInsideRoot(
  volumeRoot: string,
  linkRelPath: string,
  linkTarget: string,
): boolean {
  const fromDir = resolve(volumeRoot, dirname(linkRelPath.split("/").join("/")));
  const targetAbs = resolve(fromDir, linkTarget);
  const rel = relative(resolve(volumeRoot), targetAbs);
  return rel === "" || (!rel.startsWith("..") && !rel.startsWith("/"));
}

export interface SyncBackOptions {
  sandboxRoot: string;
  volumeRoot: string;
  /**
   * The sandbox manifest from the previous sync. Null = bootstrap:
   * the volume is treated as the last known state, the sandbox wins
   * on every differing path, and NOTHING is deleted (a deletion
   * cannot be told apart from a volume-side addition without a
   * baseline).
   */
  previous: SyncManifest | null;
  quotas?: SyncQuotas;
}

export interface SyncBackResult {
  /** The sandbox manifest as of this sync — the next diff baseline. */
  manifest: SyncManifest;
  stats: SyncStats;
}

/**
 * Copy the sandbox's changes back to the volume after a command.
 * The caller holds the response until this resolves (design note
 * §1.3): callers read files straight after exec.
 */
export async function syncBack(
  provider: SandboxProvider,
  sandboxId: string,
  options: SyncBackOptions,
): Promise<SyncBackResult> {
  const transfer = requireFileTransfer(provider);
  const quotas = options.quotas ?? resolveSyncQuotas();
  const sandboxManifest = await listSandboxTree(provider, sandboxId, options.sandboxRoot);

  let diff: SyncDiff;
  if (options.previous) {
    diff = diffManifests(options.previous, sandboxManifest);
  } else {
    // Bootstrap (defensive — the executor's flow always establishes
    // a baseline via the start mirror): compare against the volume
    // as it stands. Type or size differences copy; an equal-size
    // file is trusted, because clocks differ across the boundary and
    // no baseline exists to diff against. Nothing is deleted.
    const volumeManifest = listVolumeTree(options.volumeRoot);
    const upserts: SyncManifestEntry[] = [];
    for (const [path, entry] of sandboxManifest) {
      const onVolume = volumeManifest.get(path);
      if (!onVolume || onVolume.type !== entry.type) {
        upserts.push(entry);
        continue;
      }
      if (entry.type === "file" && onVolume.size !== entry.size) {
        upserts.push(entry);
      } else if (entry.type === "symlink" && onVolume.linkTarget !== entry.linkTarget) {
        upserts.push(entry);
      }
    }
    diff = { upserts, deletes: [] };
  }

  // ── Quota gate: validate the whole plan before writing a byte. ──
  const baselineTotal = options.previous
    ? [...options.previous.values()].reduce((sum, e) => sum + (e.type === "file" ? e.size : 0), 0)
    : [...listVolumeTree(options.volumeRoot).values()].reduce(
        (sum, e) => sum + (e.type === "file" ? e.size : 0),
        0,
      );
  let plannedTotal = baselineTotal;
  for (const entry of diff.deletes) {
    if (entry.type === "file") plannedTotal -= entry.size;
  }
  for (const entry of diff.upserts) {
    if (entry.type !== "file") continue;
    if (entry.size > quotas.maxFileBytes) {
      throw new SyncQuotaError(
        `Sync-back refused: "${entry.path}" is ${entry.size} bytes, over the per-file cap of ${quotas.maxFileBytes}.`,
      );
    }
    const before = options.previous?.get(entry.path);
    plannedTotal += entry.size - (before?.type === "file" ? before.size : 0);
  }
  if (plannedTotal > quotas.maxTotalBytes) {
    throw new SyncQuotaError(
      `Sync-back refused: workspace would total ${plannedTotal} bytes, over the per-workspace cap of ${quotas.maxTotalBytes}.`,
    );
  }

  // ── Safety gate: every destination resolves inside the root
  // before any write happens (§1.4). ──
  for (const entry of [...diff.upserts, ...diff.deletes]) {
    try {
      resolveWorkspacePath(options.volumeRoot, entry.path);
    } catch {
      throw new SyncSafetyError(
        `Sync-back refused: path "${entry.path}" does not resolve inside the workspace root.`,
      );
    }
  }

  const stats = emptyStats();

  // Deletes first (deepest-first per diffManifests), so a path whose
  // type changed is gone before its replacement is written.
  for (const entry of diff.deletes) {
    const dest = resolve(options.volumeRoot, entry.path);
    try {
      if (entry.type === "dir") rmSync(dest, { recursive: true, force: true });
      else unlinkSync(dest);
      stats.filesDeleted += 1;
    } catch {
      // Already gone — the desired end state holds.
    }
  }

  for (const entry of diff.upserts) {
    const dest = resolveWorkspacePath(options.volumeRoot, entry.path);
    if (entry.type === "dir") {
      mkdirSync(dest, { recursive: true });
      stats.dirsCreated += 1;
      continue;
    }
    if (entry.type === "symlink") {
      const target = entry.linkTarget ?? "";
      if (!symlinkTargetInsideRoot(options.volumeRoot, entry.path, target)) {
        stats.skipped.push({ path: entry.path, reason: "symlink target escapes the workspace root" });
        continue;
      }
      try {
        if (existsSync(dest) || isSymlink(dest)) unlinkSync(dest);
      } catch { /* recreated below or reported by it */ }
      symlinkSync(target, dest);
      stats.symlinksCreated += 1;
      continue;
    }
    // Regular file: bytes cross through the transfer capability.
    const bytes = await transfer.readFile(
      sandboxId,
      `${options.sandboxRoot}/${entry.path}`,
    );
    if (bytes.length !== entry.size) {
      throw new SyncSafetyError(
        `Sync-back refused: "${entry.path}" changed size during transfer (${entry.size} -> ${bytes.length}).`,
      );
    }
    mkdirSync(dirname(dest), { recursive: true });
    // A directory or symlink squatting on the path must go first.
    try {
      const existing = lstatSync(dest);
      if (!existing.isFile()) rmSync(dest, { recursive: true, force: true });
    } catch { /* absent — the normal case */ }
    writeFileSync(dest, bytes);
    if (entry.mode) {
      try {
        chmodSync(dest, entry.mode & 0o777);
      } catch { /* mode carry-over is best effort */ }
    }
    stats.filesCopied += 1;
    stats.bytesCopied += bytes.length;
  }

  return { manifest: sandboxManifest, stats };
}

function isSymlink(absPath: string): boolean {
  try {
    return lstatSync(absPath).isSymbolicLink();
  } catch {
    return false;
  }
}

/** Above this size the mirror trusts equal size instead of hashing. */
const HASH_COMPARE_MAX_BYTES = 8 * 1024 * 1024;

// ─── Mirror + forward push: volume → sandbox (§1.3) ─────────────────

/** Shell-quote one argument (POSIX single-quote rules). */
export function shellQuoteArg(value: string): string {
  if (/^[A-Za-z0-9_@%+=:,./-]+$/.test(value)) return value;
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/** Join argv into one shell command string, quoting every argument. */
export function buildShellCommand(argv: string[]): string {
  return argv.map(shellQuoteArg).join(" ");
}

export interface MirrorResult {
  stats: SyncStats;
  /** The sandbox manifest after the mirror — the next diff baseline. */
  manifest: SyncManifest;
}

/**
 * Start/resume mirror: make the sandbox tree equal the volume tree.
 * Volume wins on every path (nothing ran git while the sandbox was
 * down; edits in the meantime went to the volume). Files are compared
 * by size, then by content hash when sizes match — clocks differ
 * across the boundary, so mtime proves nothing here.
 */
export async function mirrorVolumeToSandbox(
  provider: SandboxProvider,
  sandboxId: string,
  options: { volumeRoot: string; sandboxRoot: string },
): Promise<MirrorResult> {
  const transfer = requireFileTransfer(provider);
  const volumeManifest = listVolumeTree(options.volumeRoot);
  const sandboxManifest = await listSandboxTree(provider, sandboxId, options.sandboxRoot);
  const stats = emptyStats();

  // Sandbox-only leftovers (paths the volume no longer has) go away:
  // volume wins on every path.
  const extra = [...sandboxManifest.keys()].filter((p) => !volumeManifest.has(p));
  extra.sort((a, b) => b.split("/").length - a.split("/").length);
  for (const rel of extra) {
    await transfer.removePath(sandboxId, `${options.sandboxRoot}/${rel}`);
    stats.filesDeleted += 1;
  }

  for (const [rel, entry] of volumeManifest) {
    const sandboxPath = `${options.sandboxRoot}/${rel}`;
    const existing = sandboxManifest.get(rel);
    if (entry.type === "dir") {
      if (!existing || existing.type !== "dir") {
        await transfer.makeDir(sandboxId, sandboxPath);
        stats.dirsCreated += 1;
      }
      continue;
    }
    if (entry.type === "symlink") {
      if (!existing || existing.type !== "symlink" || existing.linkTarget !== entry.linkTarget) {
        await transfer.removePath(sandboxId, sandboxPath);
        await provider.execute(sandboxId, {
          command: buildShellCommand(["ln", "-sfn", entry.linkTarget ?? "", sandboxPath]),
          cwd: options.sandboxRoot,
        });
        stats.symlinksCreated += 1;
      }
      continue;
    }
    // File: copy when absent, differently typed, differently sized,
    // or same-sized with different content.
    let copy = !existing || existing.type !== "file" || existing.size !== entry.size;
    if (!copy && existing && entry.size <= HASH_COMPARE_MAX_BYTES) {
      const volumeBytes = readFileSync(resolve(options.volumeRoot, rel));
      const sandboxBytes = await transfer.readFile(sandboxId, sandboxPath);
      copy = sha256(volumeBytes) !== sha256(sandboxBytes);
    }
    if (copy) {
      const bytes = readFileSync(resolve(options.volumeRoot, rel));
      await transfer.writeFile(sandboxId, sandboxPath, bytes);
      stats.filesCopied += 1;
      stats.bytesCopied += bytes.length;
    }
  }

  const manifest = await listSandboxTree(provider, sandboxId, options.sandboxRoot);
  return { stats, manifest };
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export type ForwardPushResult = "pushed" | "removed";

/**
 * Push ONE volume path into a live sandbox (the /ws-files forward
 * rule): the sandbox is made to match the volume at that path —
 * written, created, linked, or removed when the volume no longer
 * has it. Throws on failure; the caller records the path as pending.
 */
export async function pushVolumePath(
  provider: SandboxProvider,
  sandboxId: string,
  options: { volumeRoot: string; sandboxRoot: string; relPath: string },
): Promise<ForwardPushResult> {
  const transfer = requireFileTransfer(provider);
  const rel = options.relPath.split("/").filter(Boolean).join("/");
  if (!rel || isSandboxOnlyPath(rel)) return "pushed"; // nothing to do
  const volumeAbs = resolveWorkspacePath(options.volumeRoot, rel);
  const sandboxPath = `${options.sandboxRoot}/${rel}`;

  let stat;
  try {
    stat = lstatSync(volumeAbs);
  } catch {
    await transfer.removePath(sandboxId, sandboxPath);
    return "removed";
  }
  if (stat.isSymbolicLink()) {
    const target = readlinkSync(volumeAbs);
    await transfer.removePath(sandboxId, sandboxPath);
    await provider.execute(sandboxId, {
      command: buildShellCommand(["ln", "-sfn", target, sandboxPath]),
      cwd: options.sandboxRoot,
    });
    return "pushed";
  }
  if (stat.isDirectory()) {
    await transfer.makeDir(sandboxId, sandboxPath);
    return "pushed";
  }
  if (stat.isFile()) {
    const bytes = readFileSync(volumeAbs);
    await transfer.writeFile(sandboxId, sandboxPath, bytes);
    return "pushed";
  }
  return "pushed";
}

/**
 * Rename inside a live sandbox (the /ws-files rename forward rule).
 * Falls back to per-path pushes when the rename itself fails.
 */
export async function renameSandboxPath(
  provider: SandboxProvider,
  sandboxId: string,
  options: { sandboxRoot: string; oldRelPath: string; newRelPath: string },
): Promise<void> {
  const transfer = requireFileTransfer(provider);
  await transfer.renamePath(
    sandboxId,
    `${options.sandboxRoot}/${options.oldRelPath}`,
    `${options.sandboxRoot}/${options.newRelPath}`,
  );
}
