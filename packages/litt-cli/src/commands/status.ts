/**
 * litt status — Show project + git status.
 *
 * Wired through @litt/agent-core CommandRouter → ToolRegistry → ShellExecutor.
 * This is the canonical status path. No duplicate implementation.
 */

import { createShellExecutor, CommandRouter } from "@litt/agent-core";
import { ok, fail, warn, header, label, value, c } from "../lib/utils.js";

export async function statusCommand(_args: string[]): Promise<number> {
  const shell = createShellExecutor(process.cwd());
  const router = new CommandRouter(shell, { cwd: process.cwd() });

  const result = await router.status();

  if (!result.result.success) {
    fail(result.result.message);
    return 1;
  }

  const project = result.project;
  if (!project) {
    fail("No project detected");
    return 1;
  }

  header("Project Status");
  console.log(`${label("Root:")} ${value(project.root, c.bold)}`);
  console.log(`${label("Name:")} ${value(project.name, c.bold)}`);

  if (project.isGitRepo) {
    header("Git");
    ok(`Branch: ${project.branch ?? "detached"}`);
    if (project.remote) {
      console.log(`  ${c.gray}remote: ${project.remote}${c.reset}`);
    }

    const gitStatus = result.result.data?.gitStatus as
      | { changeCount: number; files: string[] }
      | undefined;

    if (gitStatus) {
      if (gitStatus.changeCount === 0) {
        ok("Working tree clean");
      } else {
        warn(`${gitStatus.changeCount} uncommitted change(s):`);
        for (const change of gitStatus.files.slice(0, 10)) {
          console.log(`  ${c.gray}${change}${c.reset}`);
        }
        if (gitStatus.files.length > 10) {
          console.log(`  ${c.dim}... and ${gitStatus.files.length - 10} more${c.reset}`);
        }
      }
    }
  } else {
    fail("Not a git repository");
  }

  return 0;
}
