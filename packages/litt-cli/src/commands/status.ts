/**
 * litt status — Show project + git status.
 *
 * Wired through RuntimeSession → CommandRouter → ToolRegistry → ShellExecutor.
 * The session owns the canonical RuntimeStore — single source of truth.
 */

import { detectProject, ok, fail, warn, header, label, value, c, resolveProjectCwd } from "../lib/utils.js";
import { getGitState } from "../lib/git-state.js";
import type { RuntimeSession } from "../lib/runtime-session.js";

export async function statusCommand(_args: string[], _session?: RuntimeSession): Promise<number> {
  // Use the CLI's canonical project detection for identity (package.json name).
  // This is a filesystem read — no subprocess needed.
  const detected = detectProject(resolveProjectCwd());
  const projectRoot = detected.rootDir;
  const projectName = String(detected.packageJson?.name ?? detected.dirName);

  header("Project Status");
  console.log(`${label("Root:")} ${value(projectRoot, c.bold)}`);
  console.log(`${label("Name:")} ${value(projectName, c.bold)}`);

  // Canonical git state — SINGLE `git status --porcelain=v1 --branch` call
  // gets both branch and dirty state. This is the SAME source as litt doctor,
  // the cockpit FILES counter, and the agent mission's project.status tool.
  //
  // Performance: the previous code called router.status() which ran 4
  // sequential git subprocesses (resolveProjectContext: rev-parse + branch +
  // remote, then gitStatus), THEN called getGitState for 1 more. That's
  // 5 spawns × ~1.5s on Windows = ~7.5s. Now it's 1 spawn = ~1.5s.
  const gitState = getGitState(projectRoot);
  if (gitState.isGitRepo) {
    header("Git");
    ok(`Branch: ${gitState.branch ?? "detached"}`);
    if (detected.gitRemote) {
      console.log(`  ${c.gray}remote: ${detected.gitRemote}${c.reset}`);
    }

    if (gitState.clean) {
      ok("Working tree clean");
    } else {
      warn(
        `${gitState.changed} modified · ${gitState.untracked} untracked (${gitState.changed + gitState.untracked} total)`,
      );
      for (const change of gitState.files.slice(0, 10)) {
        console.log(`  ${c.gray}${change}${c.reset}`);
      }
      if (gitState.files.length > 10) {
        console.log(`  ${c.dim}... and ${gitState.files.length - 10} more${c.reset}`);
      }
    }
  } else {
    fail("Not a git repository");
  }

  return 0;
}
