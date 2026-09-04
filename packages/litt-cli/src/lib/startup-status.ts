/**
 * Startup Status — P0-7: Make important state obvious on startup.
 *
 * On startup, display:
 *   Project, Worktree, Branch, Git status, Execution target,
 *   Provider, Model, Auth, Tools, Concurrent-session status
 *
 * Expected normal state:
 *   Project: litlabs-website
 *   Worktree: E:\LiTT\Worktrees\main
 *   Branch: main
 *   Git: clean
 *   Execution: LOCAL
 *   Provider: Ollama
 *   Model: qwen3:4b-instruct
 *   Auth: signed out
 *   Tools: ready
 *   Worktree: available
 *
 * Pure functions — no React, no Ink. Testable in node.
 */

import { detectProject, resolveProjectCwd, c, label, value } from "./utils.js";
import { getGitState } from "./git-state.js";
import { resolveExecutionTarget, resolveLocalOnly } from "./execution-target.js";
import { checkCanonicalMain } from "./canonical-main.js";
import { checkLease } from "./worktree-lease.js";
import { loadModelPrefs, getDefaultPrefsPath } from "./provider-registry.js";
import { getAuthSession } from "./auth/auth-session.js";
import { checkStaleBuild } from "./build-metadata.js";

/** The structured startup status. */
export interface StartupStatus {
  project: string;
  worktree: string;
  branch: string;
  gitClean: boolean;
  gitChanged: number;
  gitUntracked: number;
  execution: "LOCAL" | "REMOTE";
  localOnly: boolean;
  provider: string;
  model: string;
  authSignedIn: boolean | null;
  toolsReady: boolean;
  worktreeAvailable: boolean;
  worktreeLeaseStatus: "available" | "in-use" | "stale";
  canonicalMainWarning: string | null;
  staleBuildWarning: string | null;
}

/** Resolve the provider name from env/config. */
function resolveProviderName(): string {
  if (process.env.OLLAMA_BASE_URL || process.env.OLLAMA_HOST_PC) return "Ollama";
  if (process.env.OPENAI_API_KEY) return "OpenAI";
  if (process.env.GROQ_API_KEY) return "Groq";
  if (process.env.OPENROUTER_API_KEY) return "OpenRouter";
  if (process.env.ANTHROPIC_API_KEY) return "Anthropic";
  if (process.env.DEEPSEEK_API_KEY) return "DeepSeek";
  if (process.env.MISTRAL_API_KEY) return "Mistral";
  return "none";
}

/**
 * Collect the startup status (synchronous parts only).
 * Auth check is async — use collectStartupStatusAsync for the full picture.
 */
export function collectStartupStatus(cwd?: string): StartupStatus {
  const startCwd = cwd ?? resolveProjectCwd();
  const project = detectProject(startCwd);
  const projectName = String(project.packageJson?.name ?? project.dirName);
  const gitState = getGitState(project.rootDir);
  const execution = resolveExecutionTarget();
  const localOnly = resolveLocalOnly();
  const provider = resolveProviderName();
  const prefs = loadModelPrefs(getDefaultPrefsPath());
  const model = prefs.selectedModel ?? "qwen3:4b-instruct";

  const canonicalCheck = checkCanonicalMain(project.rootDir);
  const leaseCheck = checkLease(project.rootDir);

  // Stale build check (non-fatal)
  let staleBuildWarning: string | null = null;
  try {
    const buildCheck = checkStaleBuild();
    if (buildCheck.stale) {
      staleBuildWarning = buildCheck.message;
    }
  } catch {
    // ignore — don't block startup
  }

  return {
    project: projectName,
    worktree: project.rootDir,
    branch: gitState.branch ?? "detached",
    gitClean: gitState.clean,
    gitChanged: gitState.changed,
    gitUntracked: gitState.untracked,
    execution: execution === "local" ? "LOCAL" : "REMOTE",
    localOnly,
    provider,
    model,
    authSignedIn: null, // set by async variant
    toolsReady: true,
    worktreeAvailable: leaseCheck.available,
    worktreeLeaseStatus: leaseCheck.status,
    canonicalMainWarning: canonicalCheck.warning,
    staleBuildWarning,
  };
}

/**
 * Collect the full startup status including async auth check.
 */
export async function collectStartupStatusAsync(cwd?: string): Promise<StartupStatus> {
  const status = collectStartupStatus(cwd);
  try {
    const authSession = getAuthSession();
    status.authSignedIn = await authSession.isSignedIn();
  } catch {
    status.authSignedIn = false;
  }
  return status;
}

/**
 * Format the startup status for display.
 * Matches the expected format from P0-7.
 */
export function formatStartupStatus(status: StartupStatus): string {
  const lines: string[] = [];

  lines.push(`${label("Project:")} ${value(status.project, c.bold)}`);
  lines.push(`${label("Worktree:")} ${value(status.worktree, c.dim)}`);
  lines.push(`${label("Branch:")} ${status.branch === "main" ? value(status.branch, c.green) : value(status.branch, c.yellow)}`);
  lines.push(`${label("Git:")} ${status.gitClean ? value("clean", c.green) : value(`${status.gitChanged} modified · ${status.gitUntracked} untracked`, c.yellow)}`);
  lines.push(`${label("Execution:")} ${value(status.execution, status.execution === "LOCAL" ? c.green : c.cyan)}`);
  if (status.localOnly) {
    lines.push(`${label("LocalOnly:")} ${value("ON (emergency/offline mode)", c.yellow)}`);
  }
  lines.push(`${label("Provider:")} ${status.provider === "none" ? value("none", c.yellow) : value(status.provider, c.green)}`);
  lines.push(`${label("Model:")} ${value(status.model, c.dim)}`);
  lines.push(`${label("Auth:")} ${status.authSignedIn === null ? value("unknown", c.dim) : status.authSignedIn ? value("signed in", c.green) : value("signed out", c.yellow)}`);
  lines.push(`${label("Tools:")} ${status.toolsReady ? value("ready", c.green) : value("not ready", c.red)}`);
  lines.push(`${label("Worktree:")} ${status.worktreeAvailable ? value("available", c.green) : value("in use", c.red)}`);

  if (status.canonicalMainWarning) {
    lines.push("");
    lines.push(`${c.red}${c.bold}⚠ ${status.canonicalMainWarning}${c.reset}`);
  }

  if (status.staleBuildWarning) {
    lines.push("");
    lines.push(`${c.yellow}${c.bold}⚠ ${status.staleBuildWarning}${c.reset}`);
  }

  return lines.join("\n");
}
