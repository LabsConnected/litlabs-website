/**
 * ActiveProject — the canonical project identity contract.
 *
 * ONE object describes the active project across every LiTT surface
 * (CLI cockpit, ask, status, build, … and eventually Studio web,
 * terminal, preview, voice). Filesystem paths are runtime details;
 * the stable identity is repository + workspace IDs.
 *
 * Resolution pipeline (`resolveActiveProject`):
 *   1. cwd is a valid project        → open immediately, no prompt
 *   2. remembered recent project     → if exactly one obvious valid
 *                                       recent project, select it
 *   3. interactive project picker    → show recent + discovered
 *   4. bounded auto-discovery        → populates the picker (never
 *                                       crawls the whole filesystem)
 *   5. scaffold fallback             → "create a new project here?"
 *
 * This replaces the old hard-fail "No package.json found" path that
 * made `litt` die when launched from ~ (Termux, fresh shell, etc.).
 *
 * Pure data + readline picker — no React, no Ink. The cockpit calls
 * this BEFORE launching Ink, so the picker works in any TTY.
 */

import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import * as readline from "node:readline/promises";
import { stdin as rlInput, stdout as rlOutput } from "node:process";
import { getLittHome } from "./config.js";
import { detectProject, isLiTTInstallDir, type ProjectInfo } from "./utils.js";
import { getSelectedRemoteWorkspace, type RemoteWorkspaceSelection } from "./remote-workspace-store.js";

// ─── Canonical contract ────────────────────────────────────────────

/**
 * The canonical active-project identity. Every LiTT surface that needs
 * to know "which project am I operating on" resolves through this.
 *
 * Filesystem path is a runtime detail (`workspacePath`); the stable
 * identity is the repository + workspace IDs. Display strings are
 * derived, never used as the key.
 */
export interface ActiveProject {
  /** Absolute path to the project root on this machine. Runtime detail. */
  workspacePath: string;
  /** Basename of workspacePath (display convenience). */
  dirName: string;
  /** package.json `name` if present (display convenience). */
  packageName: string | null;

  // ── Git identity (parsed from the remote; null when not a git repo) ──
  /** Normalized git remote URL, or null. */
  repositoryId: string | null;
  /** Repository owner parsed from the remote (e.g. "LabsConnected"). */
  repositoryOwner: string | null;
  /** Repository name parsed from the remote (e.g. "litlabs-website"). */
  repositoryName: string | null;
  /** "owner/name" display form (e.g. "LabsConnected/litlabs-website"). */
  repositoryFullName: string | null;
  /** Current git branch (or detached-HEAD short SHA). */
  branch: string | null;

  // ── Remote workspace identity (terminal-server / Studio) ──
  /** Remote workspace ID when connected to terminal-server. */
  workspaceId: string | null;
  /** Remote project ID (terminal-server's project record). */
  projectId: string | null;
  /** RuntimeSession ID — filled by the runtime session later, null here. */
  runtimeSessionId: string | null;

  // ── Provenance ──
  /** How this project was resolved: cwd | recent | picker | discovered | scaffolded | remote. */
  source: ActiveProjectSource;
  /** Epoch ms when this resolution was captured. */
  selectedAt: number;
}

export type ActiveProjectSource =
  | "cwd"
  | "recent"
  | "picker"
  | "discovered"
  | "scaffolded"
  | "remote";

/** The full resolution result: canonical identity + the detected ProjectInfo. */
export interface ResolvedActiveProject {
  active: ActiveProject;
  project: ProjectInfo;
}

// ─── Recent-project memory ─────────────────────────────────────────

interface RecentProjectEntry {
  workspacePath: string;
  repositoryFullName: string | null;
  branch: string | null;
  lastUsed: number;
}

interface RecentProjectsFile {
  version: 1;
  projects: RecentProjectEntry[];
}

const MAX_RECENT = 10;

function recentProjectsFile(): string {
  const override = process.env.LITT_RECENT_PROJECTS_FILE;
  if (override) return override;
  return join(getLittHome(), "recent-projects.json");
}

/** Read the persisted recent-projects list (newest first). Never throws. */
export function readRecentProjects(): RecentProjectEntry[] {
  try {
    const raw = readFileSync(recentProjectsFile(), "utf8");
    const parsed: unknown = JSON.parse(raw);
    if (
      parsed &&
      typeof parsed === "object" &&
      Array.isArray((parsed as { projects?: unknown }).projects)
    ) {
      return (parsed as { projects: RecentProjectEntry[] }).projects
        .filter(
          (e): e is RecentProjectEntry =>
            !!e &&
            typeof e === "object" &&
            typeof (e as RecentProjectEntry).workspacePath === "string" &&
            typeof (e as RecentProjectEntry).lastUsed === "number",
        )
        .sort((a, b) => b.lastUsed - a.lastUsed)
        .slice(0, MAX_RECENT);
    }
  } catch {
    // missing or corrupt — treat as empty
  }
  return [];
}

/** Persist/update the recent-projects list with the given project as newest. */
export function recordRecentProject(active: ActiveProject): void {
  const entry: RecentProjectEntry = {
    workspacePath: active.workspacePath,
    repositoryFullName: active.repositoryFullName,
    branch: active.branch,
    lastUsed: active.selectedAt,
  };
  const existing = readRecentProjects().filter(
    (e) => e.workspacePath !== entry.workspacePath,
  );
  const next: RecentProjectsFile = {
    version: 1,
    projects: [entry, ...existing].slice(0, MAX_RECENT),
  };
  try {
    const file = recentProjectsFile();
    const dir = dirname(file);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(file, JSON.stringify(next, null, 2), "utf8");
  } catch {
    // best-effort — picker still works without persistence
  }
}

/** Clear the recent-projects list (e.g. on logout). Best-effort. */
export function clearRecentProjects(): void {
  try {
    rmSync(recentProjectsFile(), { force: true });
  } catch {
    // ignore
  }
}

// ─── Git identity parsing ──────────────────────────────────────────

/**
 * Parse a git remote URL into owner/name components.
 * Handles SSH (git@github.com:owner/name.git) and HTTPS
 * (https://github.com/owner/name.git) forms. Returns null for
 * unparseable remotes.
 */
export function parseGitRemote(remote: string): {
  owner: string;
  name: string;
  fullName: string;
} | null {
  const r = remote.trim();
  if (!r) return null;

  // SSH: git@host:owner/name.git  or  git@host:owner/name
  const sshMatch = r.match(/^[\w-]+@[\w.-]+:(.+?)(?:\.git)?$/);
  if (sshMatch) {
    const path = sshMatch[1];
    const parts = path.split("/");
    if (parts.length >= 2) {
      const name = parts[parts.length - 1].replace(/\.git$/, "");
      const owner = parts[parts.length - 2];
      if (owner && name) return { owner, name, fullName: `${owner}/${name}` };
    }
    return null;
  }

  // HTTPS: https://host/owner/name(.git)  or  http://host/owner/name
  const httpsMatch = r.match(/^https?:\/\/[\w.-]+\/(.+?)(?:\.git)?$/);
  if (httpsMatch) {
    const path = httpsMatch[1];
    const parts = path.split("/");
    if (parts.length >= 2) {
      const name = parts[parts.length - 1].replace(/\.git$/, "");
      const owner = parts[parts.length - 2];
      if (owner && name) return { owner, name, fullName: `${owner}/${name}` };
    }
    return null;
  }

  // git://host/owner/name.git
  const gitMatch = r.match(/^git:\/\/[\w.-]+\/(.+?)(?:\.git)?$/);
  if (gitMatch) {
    const path = gitMatch[1];
    const parts = path.split("/");
    if (parts.length >= 2) {
      const name = parts[parts.length - 1].replace(/\.git$/, "");
      const owner = parts[parts.length - 2];
      if (owner && name) return { owner, name, fullName: `${owner}/${name}` };
    }
  }
  return null;
}

function tryGit(args: string[], cwd: string): string | null {
  try {
    return (
      execFileSync("git", args, {
        cwd,
        encoding: "utf8",
        timeout: 4000,
        stdio: ["pipe", "pipe", "pipe"],
      }).trim() || null
    );
  } catch {
    return null;
  }
}

// ─── Build ActiveProject from a detected ProjectInfo ───────────────

/**
 * Build the canonical ActiveProject from a detected ProjectInfo and an
 * optional remote workspace selection. This is the single constructor —
 * every resolution path funnels through here so the identity shape is
 * always identical.
 */
export function buildActiveProject(
  project: ProjectInfo,
  source: ActiveProjectSource,
  remote?: RemoteWorkspaceSelection | null,
): ActiveProject {
  const remoteUrl = project.gitRemote;
  const parsed = remoteUrl ? parseGitRemote(remoteUrl) : null;

  return {
    workspacePath: project.rootDir,
    dirName: project.dirName,
    packageName:
      project.packageJson && typeof project.packageJson.name === "string"
        ? project.packageJson.name
        : null,
    repositoryId: remoteUrl ?? null,
    repositoryOwner: parsed?.owner ?? null,
    repositoryName: parsed?.name ?? null,
    repositoryFullName: parsed?.fullName ?? null,
    branch: project.gitBranch,
    workspaceId: remote?.workspaceId ?? null,
    projectId: remote?.projectId ?? null,
    runtimeSessionId: null,
    source,
    selectedAt: Date.now(),
  };
}

// ─── Bounded auto-discovery ────────────────────────────────────────

export interface DiscoveredProject {
  root: string;
  name: string;
  branch: string | null;
  source: "recent" | "cwd-scan" | "home" | "storage" | "sibling" | "configured";
}

/** Directories that are never projects. */
const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  ".next",
  "dist",
  "build",
  ".cache",
  ".turbo",
  "coverage",
  ".venv",
  "venv",
  "__pycache__",
  ".DS_Store",
]);

function looksLikeProject(dir: string): boolean {
  if (isLiTTInstallDir(dir)) return false;
  return (
    existsSync(join(dir, "package.json")) ||
    existsSync(join(dir, ".git")) ||
    existsSync(join(dir, "pyproject.toml")) ||
    existsSync(join(dir, "Cargo.toml")) ||
    existsSync(join(dir, "go.mod"))
  );
}

function safeReaddir(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

function scanDir(
  root: string,
  depth: number,
  maxDepth: number,
  source: DiscoveredProject["source"],
  seen: Set<string>,
  results: DiscoveredProject[],
  cap: number,
): void {
  if (results.length >= cap) return;
  const normalized = root.replace(/[\\/]+$/, "");
  if (seen.has(normalized)) return;
  seen.add(normalized);

  if (looksLikeProject(normalized)) {
    const branch = tryGit(["branch", "--show-current"], normalized);
    results.push({
      root: normalized,
      name: basename(normalized),
      branch,
      source,
    });
    if (results.length >= cap) return;
  }

  if (depth >= maxDepth) return;
  for (const name of safeReaddir(normalized)) {
    if (name.startsWith(".") || SKIP_DIRS.has(name)) continue;
    const child = join(normalized, name);
    try {
      if (!statSync(child).isDirectory()) continue;
    } catch {
      continue;
    }
    scanDir(child, depth + 1, maxDepth, source, seen, results, cap);
    if (results.length >= cap) return;
  }
}

/**
 * Bounded auto-discovery of projects. NEVER crawls the whole filesystem.
 * Searches only sensible locations with a small max depth and a hard
 * result cap. Sources (deduplicated):
 *   - recent-projects memory (validated: must still exist)
 *   - cwd subdirectories (depth 2)
 *   - home directory (depth 1, skip dotdirs)
 *   - Termux shared storage ~/storage/shared (depth 2, if it exists)
 *   - sibling directories of cwd (depth 1)
 *   - configured dirs from ~/.litt/workspaces.json
 */
export function discoverProjects(cwd: string): DiscoveredProject[] {
  const results: DiscoveredProject[] = [];
  const seen = new Set<string>();
  const CAP = 25;

  // 1. Recent projects (validated)
  for (const entry of readRecentProjects()) {
    if (!existsSync(entry.workspacePath)) continue;
    if (isLiTTInstallDir(entry.workspacePath)) continue;
    const normalized = entry.workspacePath.replace(/[\\/]+$/, "");
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    results.push({
      root: normalized,
      name: basename(normalized),
      branch: entry.branch,
      source: "recent",
    });
    if (results.length >= CAP) return results;
  }

  // 2. cwd subdirectories (depth 2)
  scanDir(resolve(cwd), 0, 2, "cwd-scan", seen, results, CAP);

  // 3. Home directory (depth 1)
  scanDir(homedir(), 0, 1, "home", seen, results, CAP);

  // 4. Termux shared storage (depth 2, if present)
  const storage = join(homedir(), "storage", "shared");
  if (existsSync(storage)) {
    scanDir(storage, 0, 2, "storage", seen, results, CAP);
  }

  // 5. Sibling directories of cwd (depth 1)
  const parent = dirname(resolve(cwd));
  for (const name of safeReaddir(parent)) {
    if (results.length >= CAP) break;
    if (name.startsWith(".") || SKIP_DIRS.has(name)) continue;
    const sibling = join(parent, name);
    try {
      if (!statSync(sibling).isDirectory()) continue;
    } catch {
      continue;
    }
    scanDir(sibling, 0, 1, "sibling", seen, results, CAP);
  }

  // 6. Configured dirs from ~/.litt/workspaces.json
  for (const dir of readConfiguredWorkspaceDirs()) {
    if (results.length >= CAP) break;
    if (!existsSync(dir)) continue;
    scanDir(dir, 0, 1, "configured", seen, results, CAP);
  }

  return results;
}

function readConfiguredWorkspaceDirs(): string[] {
  try {
    const file = join(getLittHome(), "workspaces.json");
    const raw = readFileSync(file, "utf8");
    const parsed: unknown = JSON.parse(raw);
    if (
      parsed &&
      typeof parsed === "object" &&
      Array.isArray((parsed as { dirs?: unknown }).dirs)
    ) {
      return (parsed as { dirs: unknown[] }).dirs.filter(
        (d): d is string => typeof d === "string",
      );
    }
  } catch {
    // missing/corrupt — fine
  }
  return [];
}

// ─── Scaffold fallback ─────────────────────────────────────────────

/**
 * Scaffold a minimal new Node project in `dir`. Creates package.json
 * with sensible defaults. Returns true on success.
 */
export function scaffoldProject(dir: string, name?: string): boolean {
  try {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const pkgName = name ?? basename(resolve(dir));
    const pkg = {
      name: pkgName,
      version: "0.1.0",
      private: true,
      type: "module",
      scripts: {
        dev: "node src/index.js",
        start: "node src/index.js",
      },
    };
    writeFileSync(join(dir, "package.json"), JSON.stringify(pkg, null, 2) + "\n", "utf8");
    return true;
  } catch {
    return false;
  }
}

// ─── Interactive picker ─────────────────────────────────────────────

export interface PickerChoice {
  label: string;
  detail: string;
  root: string;
  isCreateNew: boolean;
}

/**
 * Build the picker choice list from discovered projects + a create-new
 * option. Pure function — exported for testing.
 */
export function buildPickerChoices(
  discovered: DiscoveredProject[],
  cwd: string,
): PickerChoice[] {
  const choices: PickerChoice[] = discovered.map((p) => ({
    label: p.name,
    detail: `${p.branch ? `${p.branch} · ` : ""}${p.root}`,
    root: p.root,
    isCreateNew: false,
  }));
  choices.push({
    label: "Create a new LiTT project here",
    detail: resolve(cwd),
    root: resolve(cwd),
    isCreateNew: true,
  });
  return choices;
}

/** Default readline prompt — returns empty in non-TTY (CI/piped) so the
 *  caller treats it as "quit" instead of hanging. */
async function defaultPickerPrompt(question: string): Promise<string> {
  if (!process.stdin.isTTY) return "";
  const rl = readline.createInterface({ input: rlInput, output: rlOutput });
  try {
    return await rl.question(question);
  } finally {
    rl.close();
  }
}

export type PromptFn = (question: string) => Promise<string>;
export type OutputFn = (line: string) => void;

/**
 * Run the interactive project picker. Returns the chosen root path
 * (for an existing project) or a sentinel `{ createNew: true, root }`
 * for the scaffold option, or null if the user quit.
 */
export async function runProjectPicker(
  discovered: DiscoveredProject[],
  cwd: string,
  options?: { promptFn?: PromptFn; outputFn?: OutputFn },
): Promise<{ root: string; createNew: boolean } | null> {
  const choices = buildPickerChoices(discovered, cwd);
  const out = options?.outputFn ?? ((line: string) => console.log(line));
  const ask = options?.promptFn ?? defaultPickerPrompt;

  out("");
  out("No project found in the current directory.");
  out("");
  if (choices.length > 1) {
    out("Available projects:");
    choices.forEach((choice, i) => {
      const marker = choice.isCreateNew ? `${c_yellow}+${c_reset}` : ` ${c_dim}${i + 1}.${c_reset}`;
      out(`  ${marker} ${choice.label} ${c_dim}${choice.detail}${c_reset}`);
    });
  } else {
    out("No existing projects discovered.");
    out(`  ${c_yellow}+${c_reset} ${choices[0].label} ${c_dim}${choices[0].detail}${c_reset}`);
  }
  out("");

  const answer = await ask(
    `Select a project [1-${choices.length}] or 'q' to quit: `,
  );
  const trimmed = answer.trim().toLowerCase();

  if (trimmed === "q" || trimmed === "quit" || trimmed === "exit" || trimmed === "") {
    return null;
  }

  const idx = parseInt(trimmed, 10);
  if (isNaN(idx) || idx < 1 || idx > choices.length) {
    return null;
  }
  const choice = choices[idx - 1];
  return { root: choice.root, createNew: choice.isCreateNew };
}

// ─── ANSI colors (local — avoid circular import with utils.ts) ─────
const c_reset = "\x1b[0m";
const c_dim = "\x1b[2m";
const c_yellow = "\x1b[33m";

// ─── The canonical resolution pipeline ──────────────────────────────

export interface ResolveOptions {
  /** Starting directory (defaults to resolveProjectCwd result). */
  cwd?: string;
  /** Injected prompt fn for tests. */
  promptFn?: PromptFn;
  /** Injected output fn for tests. */
  outputFn?: OutputFn;
  /** When true, never prompt — return null instead of running the picker. */
  nonInteractive?: boolean;
  /** Skip recording to recent-projects (tests). */
  skipRecord?: boolean;
}

/**
 * Resolve the active project through the full pipeline:
 *   1. cwd is a valid project → open immediately
 *   2. exactly one valid recent project → select it (still confirm? no — auto)
 *   3. interactive picker (recent + discovered)
 *   4. scaffold fallback (create new in cwd)
 *
 * Returns the canonical ResolvedActiveProject, or null when the user
 * quit / non-interactive and nothing was found.
 */
export async function resolveActiveProject(
  options?: ResolveOptions,
): Promise<ResolvedActiveProject | null> {
  const startDir = resolve(options?.cwd ?? process.cwd());
  const remote = getSelectedRemoteWorkspace();

  // ── Step 1: cwd is a valid project ──
  const cwdProject = detectProject(startDir);
  if (cwdProject.hasPackageJson && !cwdProject.isSelfInstall) {
    const active = buildActiveProject(cwdProject, "cwd", remote);
    if (!options?.skipRecord) recordRecentProject(active);
    return { active, project: cwdProject };
  }

  // ── Step 2: exactly one valid recent project → auto-select ──
  const recent = readRecentProjects().filter(
    (e) => existsSync(e.workspacePath) && !isLiTTInstallDir(e.workspacePath),
  );
  if (recent.length === 1) {
    const recentProject = detectProject(recent[0].workspacePath);
    if (recentProject.hasPackageJson) {
      const active = buildActiveProject(recentProject, "recent", remote);
      if (!options?.skipRecord) recordRecentProject(active);
      return { active, project: recentProject };
    }
  }

  // ── Non-interactive: do not prompt ──
  if (options?.nonInteractive) {
    return null;
  }

  // ── Step 3 + 4: interactive picker (with discovery) + scaffold ──
  const discovered = discoverProjects(startDir);
  const choice = await runProjectPicker(discovered, startDir, {
    promptFn: options?.promptFn,
    outputFn: options?.outputFn,
  });
  if (!choice) return null;

  // Scaffold fallback
  if (choice.createNew) {
    if (!scaffoldProject(choice.root)) {
      return null;
    }
    const scaffolded = detectProject(choice.root);
    if (!scaffolded.hasPackageJson) return null;
    const active = buildActiveProject(scaffolded, "scaffolded", remote);
    if (!options?.skipRecord) recordRecentProject(active);
    return { active, project: scaffolded };
  }

  // Existing project selected from picker
  const picked = detectProject(choice.root);
  if (!picked.hasPackageJson) {
    // Stale entry — re-discover without it and retry once
    return null;
  }
  const source: ActiveProjectSource = discovered.find(
    (d) => d.root === choice.root,
  )?.source === "recent"
    ? "recent"
    : "discovered";
  const active = buildActiveProject(picked, source, remote);
  if (!options?.skipRecord) recordRecentProject(active);
  return { active, project: picked };
}

// ─── Display helper ────────────────────────────────────────────────

/**
 * The canonical display string for an ActiveProject.
 * Prefers "owner/name · branch"; falls back to dirName; then path.
 * This is the string Studio and the CLI header should both use —
 * derived from stable IDs, never used AS the identity.
 */
export function activeProjectDisplay(active: ActiveProject): string {
  const repo = active.repositoryFullName;
  const branch = active.branch;
  if (repo && branch) return `${repo} · ${branch}`;
  if (repo) return repo;
  if (active.packageName && branch) return `${active.packageName} · ${branch}`;
  if (branch) return `${active.dirName} · ${branch}`;
  return active.dirName || active.workspacePath;
}
