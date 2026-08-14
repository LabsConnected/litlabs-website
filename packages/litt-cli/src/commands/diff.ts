/**
 * litt diff — Show git diff.
 *
 * Wired through @litt/agent-core CommandRouter → ToolRegistry → ShellExecutor.
 * This is the canonical diff path. No duplicate implementation.
 */

import { createShellExecutor, CommandRouter } from "@litt/agent-core";
import { fail, header, c } from "../lib/utils.js";

export async function diffCommand(args: string[]): Promise<number> {
  const staged = args.includes("--staged") || args.includes("--cached");

  const shell = createShellExecutor(process.cwd());
  const router = new CommandRouter(shell, { cwd: process.cwd() });

  const result = await router.diff(staged);

  if (!result.result.success) {
    fail(result.result.message);
    return 1;
  }

  const diff = (result.result.data?.diff as string) ?? "";

  if (!diff) {
    console.log(staged ? "No staged changes" : "No unstaged changes");
    return 0;
  }

  header(staged ? "Staged Diff" : "Unstaged Diff");
  // Print diff with basic syntax highlighting
  for (const line of diff.split("\n")) {
    if (line.startsWith("+++") || line.startsWith("---")) {
      console.log(`${c.bold}${line}${c.reset}`);
    } else if (line.startsWith("+")) {
      console.log(`${c.green}${line}${c.reset}`);
    } else if (line.startsWith("-")) {
      console.log(`${c.red}${line}${c.reset}`);
    } else if (line.startsWith("@@")) {
      console.log(`${c.cyan}${line}${c.reset}`);
    } else {
      console.log(`${c.gray}${line}${c.reset}`);
    }
  }

  return 0;
}
