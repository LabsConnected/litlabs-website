/**
 * Path & Launcher Integrity — `litt doctor --paths`.
 *
 * LiTT runs across multiple repos, worktrees, and launchers (canonical
 * checkout, linked worktrees, npm global link, pnpm global link, Termux).
 * If the wrong one wins, LiTT can run stale code, inspect the wrong
 * repository, or write session state into the wrong place.
 *
 * This module is the SINGLE place that answers "what path is LiTT
 * actually using, and why" — it composes the existing authoritative
 * resolvers (resolveProjectCwd, detectProject, build-metadata,
 * config.getLittHome, local-lane's Ollama endpoint resolver) into one
 * report instead of introducing a new path-resolution mechanism.
 *
 * Pure/synchronous and side-effect-free (aside from the resolvers it
 * calls, which are themselves read-only) — safe to call from `doctor`,
 * tests, or any future surface.
 */

import { existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolveProjectCwd, detectProject, type ProjectInfo } from "./utils.js";
import { collectBuildIdentity, type BuildIdentity } from "./build-metadata.js";
import { getLittHome, getConfigPath } from "./config.js";
import { resolveLocalLaneEndpoint, localLaneEndpointSource } from "./local-lane.js";

export type CheckStatus = "pass" | "warn" | "fail" | "n/a";

export interface PathCheck {
  name: string;
  status: CheckStatus;
  message: string;
}

export interface PathIntegrityReport {
  /** The on-disk entry script this process is actually running (argv[1]). */
  entrypoint: string | null;
  /** This CLI package's own directory (computed from import.meta.url). */
  packageDir: string | null;
  /** The resolved global `litt` launcher target (where / readlink). */
  launcherTarget: string | null;
  /** Build/source identity — SHAs, worktree, staleness. */
  build: BuildIdentity;
  /** The resolved project workspace (what detectProject actually picked). */
  project: ProjectInfo;
  /** The starting cwd BEFORE walking up to find the project root. */
  startingCwd: string;
  /** ~/.litt (or $LITT_STATE_HOME) — session/config/runtime storage. */
  stateHome: string;
  /** ~/.litt/config.json */
  configPath: string;
  /** The Ollama endpoint LiTT would use for local inference (static resolver). */
  modelEndpoint: string;
  /** Which env var (or "default") supplied modelEndpoint. */
  modelEndpointSource: string;
  /** Whether the current process holds elevated (Administrator) privileges. */
  elevated: boolean | null;
  /** Pass/warn/fail rollup for a `litt doctor --paths` summary. */
  checks: PathCheck[];
}

/**
 * Best-effort Windows elevation check. `net session` only succeeds when
 * the calling process is already elevated — no native bindings needed.
 * Returns null (unknown) on non-Windows platforms rather than guessing.
 */
export function isElevated(): boolean | null {
  if (process.platform !== "win32") return null;
  try {
    execFileSync("net", ["session"], {
      stdio: ["ignore", "ignore", "ignore"],
      timeout: 3000,
      shell: false,
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Collect the full path-integrity report. `cwdFlag`/`projectDir` let
 * callers (tests, `--cwd` dispatch) override what would otherwise come
 * from process.cwd() — mirrors resolveProjectCwd's own override chain.
 */
export function collectPathIntegrity(cwdFlag?: string): PathIntegrityReport {
  const startingCwd = resolveProjectCwd(cwdFlag);
  const project = detectProject(startingCwd);
  const build = collectBuildIdentity();
  const stateHome = getLittHome();
  const configPath = getConfigPath();
  const modelEndpoint = resolveLocalLaneEndpoint();
  const modelEndpointSource = localLaneEndpointSource();
  const elevated = isElevated();

  const checks: PathCheck[] = [];

  // Launcher: does the global `litt` on PATH exist and point somewhere real?
  if (!build.check.launcherTarget) {
    checks.push({ name: "Launcher", status: "warn", message: "Global 'litt' launcher not found on PATH" });
  } else if (!existsSync(build.check.launcherTarget)) {
    checks.push({ name: "Launcher", status: "fail", message: `Launcher target does not exist: ${build.check.launcherTarget}` });
  } else {
    checks.push({ name: "Launcher", status: "pass", message: build.check.launcherTarget });
  }

  // Build freshness: source SHA must match what dist/ was built from.
  if (build.check.status === "fresh") {
    checks.push({ name: "Build", status: "pass", message: `fresh @ ${build.check.sourceSha?.slice(0, 8) ?? "—"}` });
  } else if (build.check.status === "stale") {
    checks.push({ name: "Build", status: "fail", message: build.check.message });
  } else {
    checks.push({ name: "Build", status: "warn", message: build.check.message });
  }

  // Workspace: did we land on the user's repo, or accidentally on LiTT's
  // own install/runtime copy (the self-install guard tripped)?
  if (project.isSelfInstall) {
    checks.push({
      name: "Workspace",
      status: "warn",
      message: `Self-install detected — inspecting launch dir instead of LiTT's runtime copy: ${project.rootDir}`,
    });
  } else if (!project.hasPackageJson && !project.hasGit) {
    checks.push({ name: "Workspace", status: "warn", message: `No package.json or .git found above ${startingCwd}` });
  } else {
    checks.push({ name: "Workspace", status: "pass", message: project.rootDir });
  }

  // Worktree identity: only meaningful when the CLI itself runs from a
  // git checkout (dev/worktree installs); a packaged npm install has none.
  if (build.worktree) {
    checks.push({
      name: "Source worktree",
      status: "pass",
      message: `${build.worktree.linked ? "linked worktree" : "primary checkout"} @ ${build.worktree.root} (${build.worktree.branch ?? "detached"})`,
    });
  }

  // Permissions: ordinary operation must not require Administrator.
  if (elevated === true) {
    checks.push({
      name: "Permissions",
      status: "warn",
      message: "Running elevated (Administrator) — LiTT does not require this for normal use",
    });
  } else if (elevated === false) {
    checks.push({ name: "Permissions", status: "pass", message: "Not elevated (standard user)" });
  } else {
    checks.push({ name: "Permissions", status: "n/a", message: "Elevation check not applicable on this platform" });
  }

  return {
    entrypoint: build.entrypoint,
    packageDir: build.packageDir,
    launcherTarget: build.check.launcherTarget,
    build,
    project,
    startingCwd,
    stateHome,
    configPath,
    modelEndpoint,
    modelEndpointSource,
    elevated,
    checks,
  };
}
