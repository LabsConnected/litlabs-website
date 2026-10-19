/**
 * litt terminal-profile install — adds a persistent "LiTT" profile to
 * the user's real Windows Terminal settings.json. Opt-in only: this
 * never runs as part of normal `litt`/`litt shell` startup, only when
 * the user explicitly runs this command.
 *
 * See lib/terminal-profile.ts for the full safety contract (textual
 * JSONC-safe edit, timestamped backup, idempotent, never fabricates a
 * missing settings.json).
 */

import { ok, fail, warn, header, c, detectProject, resolveProjectCwd } from "../lib/utils.js";
import { currentCliCommand } from "../lib/window-launcher.js";
import { installTerminalProfile } from "../lib/terminal-profile.js";

export async function terminalProfileInstallCommand(): Promise<number> {
  header("LiTT Terminal Profile — Windows Terminal setup");

  if (process.platform !== "win32") {
    fail("This command only applies to Windows Terminal on Windows.");
    return 1;
  }

  const launch = currentCliCommand(["shell"]);
  const startingDirectory = detectProject(resolveProjectCwd()).rootDir;

  const result = installTerminalProfile(launch, startingDirectory);

  switch (result.reason) {
    case "installed":
      ok(`Added the "LiTT" profile to ${result.path}`);
      console.log(`${c.dim}  Backup saved: ${result.backupPath}${c.reset}`);
      console.log(`${c.dim}  Starting directory: ${startingDirectory}${c.reset}`);
      console.log(`${c.dim}  Open Windows Terminal's "+" dropdown (or Ctrl+Shift+Space) and pick "LiTT".${c.reset}`);
      return 0;
    case "already-installed":
      ok(`The "LiTT" profile is already installed in ${result.path}`);
      return 0;
    case "settings-not-found":
      fail("Could not find a Windows Terminal settings.json.");
      console.log(`${c.dim}  Open Windows Terminal at least once (it creates settings.json on first run), then re-run this command.${c.reset}`);
      return 1;
    case "profiles-list-not-found":
      fail(`Found ${result.path} but could not locate its "profiles" list.`);
      console.log(`${c.dim}  Your settings.json may be malformed or in an unexpected shape — no changes were made.${c.reset}`);
      return 1;
    case "unparseable":
      fail(`Found ${result.path} but could not parse it as JSON/JSONC.`);
      console.log(`${c.dim}  No changes were made. Fix or reset the file in Windows Terminal, then re-run this command.${c.reset}`);
      return 1;
    default: {
      warn("Unexpected result from the terminal profile installer.");
      return 1;
    }
  }
}
