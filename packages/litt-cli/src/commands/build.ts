/**
 * litt build — Run build.
 *
 * Wired through @litt/agent-core CommandRouter → ToolRegistry → ShellExecutor.
 * Runs the project's build script via the detected package manager.
 */

import { createShellExecutor, CommandRouter } from "@litt/agent-core";
import { ok, fail, header, c } from "../lib/utils.js";

export async function buildCommand(_args: string[]): Promise<number> {
  const shell = createShellExecutor(process.cwd());
  const router = new CommandRouter(shell, { cwd: process.cwd() });

  header("Build");
  const result = await router.build();

  if (!result.result.success) {
    fail(result.result.message);
    const stderr = result.result.data?.stderr as string | undefined;
    if (stderr) {
      console.log(`${c.gray}${stderr}${c.reset}`);
    }
    return 1;
  }

  ok(result.result.message);
  const stdout = result.result.data?.stdout as string | undefined;
  if (stdout) {
    console.log(`${c.gray}${stdout}${c.reset}`);
  }
  return 0;
}
