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
import { join, resolve, dirname } from "node:path";
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
  status: "fresh" | "stale" | "no-build-meta" | "no-source-sha" | "no-launcher";
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
 * dist/lib/build-metadata.js → dist → package root (packages/litt-cli)
 */
let cliPackageDir: string | null | undefined;
function getCliPackageDir(): string | null {
  if (cliPackageDir !== undefined) return cliPackageDir;
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    // dist/lib/build-metadata.js → dist → packages/litt-cli
    cliPackageDir = resolve(here, "..", "..");
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
export function writeBuildMeta(sourceSha: string, version: string, distDir?: string): void {
  const dir = distDir ?? join(getCliPackageDir() ?? "", "dist");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const meta: BuildMeta = {
    sourceSha,
    builtAt: new Date().toISOString(),
    version,
    nodeVersion: process.version,
  };
  writeFileSync(join(dir, ".build-meta.json"), JSON.stringify(meta, null, 2), "utf8");
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
      const pkgMatch = content.match(/(@litlabs[\\/]litt-cli|litt-cli)/i);
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
    return {
      stale: false,
      sourceSha: null,
      builtSha: buildMeta?.sourceSha ?? null,
      launcherTarget,
      hasBuildMeta: buildMeta !== null,
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
