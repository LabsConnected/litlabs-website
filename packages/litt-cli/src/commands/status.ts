/**
 * litt status — Show project + git status.
 *
 * Wired through RuntimeSession → CommandRouter → ToolRegistry → ShellExecutor.
 * The session owns the canonical RuntimeStore — single source of truth.
 */

import { RuntimeSession } from "../lib/runtime-session.js";
import { detectProject, ok, fail, warn, header, label, value, c } from "../lib/utils.js";

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

  if (detected.hasGit) {
    header("Git");
    ok(`Branch: ${detected.gitBranch ?? "detached"}`);
    if (detected.gitRemote) {
      console.log(`  ${c.gray}remote: ${detected.gitRemote}${c.reset}`);
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
