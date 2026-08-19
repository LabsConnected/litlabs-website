/**
 * litt status — Show project + git status.
 *
 * Wired through RuntimeSession → CommandRouter → ToolRegistry → ShellExecutor.
 * The session owns the canonical RuntimeStore — single source of truth.
 */

import { RuntimeSession } from "../lib/runtime-session.js";
import { detectProject, ok, fail, warn, header, label, value, c } from "../lib/utils.js";
import { getGitState } from "../lib/git-state.js";

export async function statusCommand(_args: string[], session?: RuntimeSession): Promise<number> {
  const sess = session ?? new RuntimeSession({ cwd: process.cwd() });
  const router = sess.getRouter();

  const result = await router.status();

  if (!result.result.success) {
    fail(result.result.message);
    return 1;
  }

  // Use the CLI's canonical project detection for identity (package.json name),
  // not the router's path.basename fallback. This ensures status, cockpit,
  // and all CLI surfaces show the same project name.
  const detected = detectProject();
  const projectRoot = detected.rootDir;
  const projectName = String(detected.packageJson?.name ?? detected.dirName);

  header("Project Status");
  console.log(`${label("Root:")} ${value(projectRoot, c.bold)}`);
  console.log(`${label("Name:")} ${value(projectName, c.bold)}`);

  // Canonical git state — the SAME source as litt doctor, the cockpit
  // FILES counter, and the agent mission's project.status tool. All
  // surfaces always agree.
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
