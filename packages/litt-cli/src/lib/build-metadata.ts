/**
 * Build Metadata — P0-9: Stale Build Detection.
 *
 * Provides reliable build metadata so the CLI can detect when the built
 * dist/ is stale relative to the source.
 *
 * Exposes:
 *   - SOURCE SHA (git HEAD of the source tree)
 *   - BUILT SHA (recorded at build time in dist/.build-meta.json)
 *   - LAUNCHER TARGET (the resolved path the global `litt` launcher points to)
 *
 * If built SHA != source SHA → "CLI BUILD STALE" + exact rebuild command.
 * Does NOT rely solely on file timestamps.
 *
 * Pure functions — no React, no Ink. Testable in node.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { join, resolve, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";

/** The build metadata record, written to dist/.build-meta.json at build time. */
export interface BuildMeta {
  /** Git HEAD SHA at build time (40 hex chars). */
  sourceSha: string;
  /** ISO timestamp when the build ran. */
  builtAt: string;
  /** The CLI version at build time. */
  version: string;
  /** Node version that produced the build. */
  nodeVersion: string;
  /** True when the build ran on a dirty tree (uncommitted changes) —
   *  the output matches no commit, so it must not report "fresh". */
  dirty?: boolean;
}

/** Result of a staleness check. */
export interface StaleBuildCheck {
  /** Whether the build is stale (sourceSha != builtSha). */
  stale: boolean;
  /** Git HEAD SHA of the current source tree. */
  sourceSha: string | null;
  /** SHA recorded in the build metadata file. */
  builtSha: string | null;
  /** The resolved launcher target path. */
  launcherTarget: string | null;
  /** Whether the build metadata file exists at all. */
  hasBuildMeta: boolean;
  /** Human-readable status. */
  status: "fresh" | "stale" | "dirty-build" | "unbundled" | "no-build-meta" | "no-source-sha" | "no-launcher";
  /** The exact rebuild command, when stale. */
  rebuildCommand: string | null;
  /** Human-readable message. */
  message: string;
}

/**
 * Get the git HEAD SHA of a directory (the source tree).
 * Returns null if not a git repo or git is unavailable.
 */
export function getSourceSha(cwd: string): string | null {
  try {
    const sha = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd,
      encoding: "utf8",
      timeout: 5000,
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
    return /^[0-9a-f]{40}$/.test(sha) ? sha : null;
  } catch {
    return null;
  }
}

/**
 * The on-disk location of THIS CLI package's dist directory.
 *
 * The module can resolve from several layouts depending on how the
 * entry was produced — a fixed "../.." overshoots whenever the file
 * sits one level shallower or deeper than expected:
 *   tsc emit     → dist/lib/build-metadata.js
 *   esbuild      → dist/index.js (inlined) or dist/chunks/*.js (split)
 *   vitest/tsx   → src/lib/build-metadata.ts (no dist at all)
 * Walk up to the directory actually named "dist", then take its parent.
 * If no "dist" exists (source-mode), fall back to the src/lib layout.
 */
let cliPackageDir: string | null | undefined;
export function getCliPackageDir(): string | null {
  if (cliPackageDir !== undefined) return cliPackageDir;
  try {
    const start = dirname(fileURLToPath(import.meta.url));
    let dir = start;
    while (basename(dir) !== "dist" && dirname(dir) !== dir) {
      dir = dirname(dir);
    }
    cliPackageDir = basename(dir) === "dist"
      ? dirname(dir)
      : resolve(start, "..", "..");
  } catch {
    cliPackageDir = null;
  }
  return cliPackageDir;
}

/**
 * Read the build metadata from dist/.build-meta.json.
 * Returns null if the file doesn't exist or is corrupt.
 */
export function readBuildMeta(distDir?: string): BuildMeta | null {
  const dir = distDir ?? join(getCliPackageDir() ?? "", "dist");
  const file = join(dir, ".build-meta.json");
  if (!existsSync(file)) return null;
  try {
    const raw = readFileSync(file, "utf8");
    const parsed = JSON.parse(raw) as BuildMeta;
    if (
      typeof parsed.sourceSha === "string" &&
      typeof parsed.builtAt === "string" &&
      typeof parsed.version === "string"
    ) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Write build metadata to dist/.build-meta.json.
 * Called by the build script after a successful build.
 */
export function writeBuildMeta(sourceSha: string, version: string, distDir?: string, dirty?: boolean): void {
  const dir = distDir ?? join(getCliPackageDir() ?? "", "dist");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const meta: BuildMeta = {
    sourceSha,
    builtAt: new Date().toISOString(),
    version,
    nodeVersion: process.version,
    ...(dirty ? { dirty } : {}),
  };
  writeFileSync(join(dir, ".build-meta.json"), JSON.stringify(meta, null, 2), "utf8");
}

/**
 * The dist/.bundled marker records sha256(dist/index.js) at bundle time.
 * Returns: "match" | "mismatch" | "no-marker" | "no-entry".
 */
export function checkBundledEntry(distDir?: string): "match" | "mismatch" | "no-marker" | "no-entry" {
  const dir = distDir ?? join(getCliPackageDir() ?? "", "dist");
  const marker = join(dir, ".bundled");
  if (!existsSync(marker)) return "no-marker";
  const entry = join(dir, "index.js");
  if (!existsSync(entry)) return "no-entry";
  try {
    const expected = readFileSync(marker, "utf8").trim();
    const actual = createHash("sha256").update(readFileSync(entry)).digest("hex");
    return expected === actual ? "match" : "mismatch";
  } catch {
    return "mismatch";
  }
}

/**
 * The on-disk path of the entry script this process is actually running
 * (argv[1] — e.g. .../packages/litt-cli/dist/index.js). Two installs can
 * report the same package version; the entrypoint tells them apart.
 */
export function getEntrypointPath(): string | null {
  try {
    const argv1 = process.argv[1];
    if (!argv1) return null;
    const p = resolve(argv1);
    return existsSync(p) ? p : null;
  } catch {
    return null;
  }
}

/** Which git checkout the running CLI came from. */
export interface WorktreeInfo {
  /** Worktree root (git rev-parse --show-toplevel). */
  root: string;
  /** The git dir for this checkout (linked worktrees live under .git/worktrees/<name>). */
  gitDir: string | null;
  /** True when this is a linked worktree, not the primary checkout. */
  linked: boolean;
  /** Branch name, or "HEAD" when detached. */
  branch: string | null;
}

/**
 * Identify the source checkout of a directory. Returns null when the
 * directory is not inside a git worktree (e.g. an npm-installed copy).
 */
export function getWorktreeInfo(cwd: string): WorktreeInfo | null {
  const run = (args: string[]): string | null => {
    try {
      const out = execFileSync("git", args, {
        cwd,
        encoding: "utf8",
        timeout: 5000,
        stdio: ["pipe", "pipe", "pipe"],
      }).trim();
      return out || null;
    } catch {
      return null;
    }
  };
  const root = run(["rev-parse", "--show-toplevel"]);
  if (!root) return null;
  const gitDir = run(["rev-parse", "--git-dir"]);
  const branch = run(["rev-parse", "--abbrev-ref", "HEAD"]);
  return { root, gitDir, linked: !!gitDir && /[\\/]worktrees[\\/]/.test(gitDir), branch };
}

/** Full build/source identity for `litt version --verbose`. */
export interface BuildIdentity {
  entrypoint: string | null;
  packageDir: string | null;
  build: BuildMeta | null;
  worktree: WorktreeInfo | null;
  check: StaleBuildCheck;
}

export function collectBuildIdentity(): BuildIdentity {
  const packageDir = getCliPackageDir();
  return {
    entrypoint: getEntrypointPath(),
    packageDir,
    build: readBuildMeta(),
    worktree: packageDir ? getWorktreeInfo(packageDir) : null,
    check: checkStaleBuild(),
  };
}

/**
 * Resolve the global `litt` launcher target.
 * On Windows, reads the .CMD shim. On Unix, reads the symlink.
 * Returns null if the launcher is not found.
 */
export function resolveLauncherTarget(): string | null {
  try {
    const which = execFileSync(
      process.platform === "win32" ? "where" : "which",
      ["litt"],
      { encoding: "utf8", timeout: 5000, stdio: ["pipe", "pipe", "pipe"] },
    ).trim().split(/\r?\n/)[0];

    if (!which || !existsSync(which)) return null;

    if (process.platform === "win32" && which.toLowerCase().endsWith(".cmd")) {
      // Read the .CMD shim to find the target path
      const content = readFileSync(which, "utf8");
      // Look for NODE_PATH or the dist/index.js path in the shim
      const match = content.match(/(?:NODE_PATH|node)\s+"?([A-Z]:\\[^"]+|\/[^\s"]+)/i);
      if (match) return resolve(match[1]);
      // Also try to find the package path
      const pkgMatch = content.match(/(@litlabs1?[\\/]litt-cli|litt-cli)/i);
      if (pkgMatch) return which;
      return which;
    }

    // Unix: check if it's a symlink
    try {
      const target = execFileSync("readlink", ["-f", which], {
        encoding: "utf8",
        timeout: 5000,
        stdio: ["pipe", "pipe", "pipe"],
      }).trim();
      return target || which;
    } catch {
      return which;
    }
  } catch {
    return null;
  }
}

/**
 * Check whether the CLI build is stale.
 *
 * Compares the source git SHA against the built SHA recorded in
 * dist/.build-meta.json. Also resolves the launcher target so the user
 * can verify the global `litt` points to the right place.
 */
export function checkStaleBuild(sourceDir?: string): StaleBuildCheck {
  const pkgDir = sourceDir ?? getCliPackageDir() ?? process.cwd();
  const sourceSha = getSourceSha(pkgDir);
  const buildMeta = readBuildMeta(join(pkgDir, "dist"));
  const launcherTarget = resolveLauncherTarget();

  if (!sourceSha) {
    // Deployed/standalone release: no git repo to resolve a source SHA
    // from. The build metadata recorded at build time IS the provenance —
    // trust it, but only when the bundled-entry marker still verifies so
    // an untracked overwrite can't pass as the recorded release.
    if (buildMeta) {
      const bundled = checkBundledEntry(join(pkgDir, "dist"));
      if (bundled === "match") {
        return {
          stale: false,
          sourceSha: buildMeta.sourceSha,
          builtSha: buildMeta.sourceSha,
          launcherTarget,
          hasBuildMeta: true,
          status: "fresh",
          rebuildCommand: null,
          message: `Deployed release verified (SHA ${buildMeta.sourceSha.slice(0, 8)}). Launcher: ${launcherTarget ?? "not found"}`,
        };
      }
      return {
        stale: true,
        sourceSha: null,
        builtSha: buildMeta.sourceSha,
        launcherTarget,
        hasBuildMeta: true,
        status: "unbundled",
        rebuildCommand: `cd "${pkgDir}" && pnpm build`,
        message: `Deployed release's dist/index.js does not match its bundle marker — rebuild from source at ${buildMeta.sourceSha.slice(0, 8)}.`,
      };
    }
    return {
      stale: false,
      sourceSha: null,
      builtSha: null,
      launcherTarget,
      hasBuildMeta: false,
      status: "no-source-sha",
      rebuildCommand: null,
      message: "Cannot determine source SHA (not a git repo or git unavailable)",
    };
  }

  if (!buildMeta) {
    return {
      stale: true,
      sourceSha,
      builtSha: null,
      launcherTarget,
      hasBuildMeta: false,
      status: "no-build-meta",
      rebuildCommand: `cd "${pkgDir}" && pnpm build`,
      message: `CLI BUILD STALE: no build metadata found in dist/.build-meta.json. Source SHA: ${sourceSha.slice(0, 8)}. Rebuild: cd "${pkgDir}" && pnpm build`,
    };
  }

  if (buildMeta.sourceSha !== sourceSha) {
    return {
      stale: true,
      sourceSha,
      builtSha: buildMeta.sourceSha,
      launcherTarget,
      hasBuildMeta: true,
      status: "stale",
      rebuildCommand: `cd "${pkgDir}" && pnpm build`,
      message: `CLI BUILD STALE: source SHA ${sourceSha.slice(0, 8)} ≠ built SHA ${buildMeta.sourceSha.slice(0, 8)}. Rebuild: cd "${pkgDir}" && pnpm build`,
    };
  }

  if (buildMeta.dirty) {
    return {
      stale: true,
      sourceSha,
      builtSha: buildMeta.sourceSha,
      launcherTarget,
      hasBuildMeta: true,
      status: "dirty-build",
      rebuildCommand: `cd "${pkgDir}" && pnpm build`,
      message: `CLI BUILD STALE: dist was built from uncommitted changes (SHA ${sourceSha.slice(0, 8)} + dirty tree) — it matches no commit. Rebuild: cd "${pkgDir}" && pnpm build`,
    };
  }

  // The build pipeline bundles dist/index.js (scripts/bundle.mjs) and
  // records its sha256 in dist/.bundled. A later `pnpm dev`/`tsc` run
  // overwrites index.js with the slower per-file graph — catch that
  // instead of reporting fresh. Missing marker = can't prove, don't flag.
  const bundled = checkBundledEntry(join(pkgDir, "dist"));
  if (bundled === "mismatch" || bundled === "no-entry") {
    return {
      stale: true,
      sourceSha,
      builtSha: buildMeta.sourceSha,
      launcherTarget,
      hasBuildMeta: true,
      status: "unbundled",
      rebuildCommand: `cd "${pkgDir}" && pnpm build`,
      message: `CLI BUILD STALE: dist/index.js was overwritten after bundling (e.g. tsc --watch). Rebuild: cd "${pkgDir}" && pnpm build`,
    };
  }

  if (!launcherTarget) {
    return {
      stale: false,
      sourceSha,
      builtSha: buildMeta.sourceSha,
      launcherTarget: null,
      hasBuildMeta: true,
      status: "no-launcher",
      rebuildCommand: null,
      message: `Build is fresh (SHA ${sourceSha.slice(0, 8)}) but global 'litt' launcher not found.`,
    };
  }

  return {
    stale: false,
    sourceSha,
    builtSha: buildMeta.sourceSha,
    launcherTarget,
    hasBuildMeta: true,
    status: "fresh",
    rebuildCommand: null,
    message: `Build is fresh (SHA ${sourceSha.slice(0, 8)}). Launcher: ${launcherTarget}`,
  };
}
