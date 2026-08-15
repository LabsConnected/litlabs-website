/**
 * litt test — Run tests.
 *
 * Wired through RuntimeSession → CommandRouter → ToolRegistry → ShellExecutor.
 * The session owns the canonical RuntimeStore — single source of truth.
 */

import { RuntimeSession } from "../lib/runtime-session.js";
import { ok, fail, header, c } from "../lib/utils.js";

export async function testCommand(_args: string[], session?: RuntimeSession): Promise<number> {
  const sess = session ?? new RuntimeSession({ cwd: process.cwd() });
  const router = sess.getRouter();

  header("Test");
  const result = await router.test();

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
