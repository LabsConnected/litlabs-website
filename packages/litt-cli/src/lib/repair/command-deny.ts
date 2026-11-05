/**
 * Static deny rules for repair-job commands.
 *
 * A repair job is argv-only by contract, but three things quietly defeat that:
 *  - an interpreter as the executable (`sh -c "..."`, `cmd /c ...`) turns args
 *    back into a shell script;
 *  - on Windows, pnpm/npm/yarn resolve to .cmd shims and run through cmd.exe,
 *    so `&`, `|`, `%VAR%` in an arg is interpreted rather than passed through;
 *  - destructive or outward-facing tools (rm, git push, publish, deploys)
 *    need explicit operator approval and have no place in an automated repair.
 *
 * The rules are platform-independent on purpose so a job validated on Linux
 * behaves the same when it later runs on Windows or Termux.
 */
import type { RepairCommand } from "./contracts.js";

const INTERPRETERS = new Set([
  "cmd", "powershell", "pwsh", "bash", "sh", "zsh", "fish", "dash", "ash",
  "wscript", "cscript", "mshta", "wsl",
]);

const DESTRUCTIVE = new Set([
  "rm", "del", "erase", "rd", "rmdir", "format", "dd", "mkfs", "shred",
  "shutdown", "reboot", "taskkill", "kill", "pkill", "reg", "diskpart", "sudo",
]);

const OUTWARD_FACING = new Set([
  "vercel", "railway", "flyctl", "netlify", "wrangler", "firebase", "heroku", "supabase",
]);

const SHIM_COMMANDS = new Set(["pnpm", "npm", "npx", "yarn", "pnpx", "litt"]);
const CMD_METACHARACTERS = /[&|<>^%!"\r\n]/;

function baseName(command: string): string {
  return command.toLowerCase().replace(/\.(exe|cmd|bat)$/, "");
}

export function repairCommandDenyReason(command: RepairCommand): string | null {
  const name = baseName(command.command);
  if (INTERPRETERS.has(name)) {
    return `Interpreter "${command.command}" is not allowed; run the program directly with argv`;
  }
  if (DESTRUCTIVE.has(name)) {
    return `Destructive command "${command.command}" requires explicit approval and cannot run in a repair job`;
  }
  if (OUTWARD_FACING.has(name)) {
    return `Deploy tool "${command.command}" requires explicit approval and cannot run in a repair job`;
  }
  const args = command.args.map((arg) => arg.toLowerCase());
  if (name === "git" && args.some((arg) => ["push", "remote", "credential"].includes(arg))) {
    return "git push/remote/credential operations require explicit approval";
  }
  if (SHIM_COMMANDS.has(name) && args.some((arg) => arg === "publish" || arg === "deploy")) {
    return "Package publishing and deployment require explicit approval";
  }
  if (SHIM_COMMANDS.has(name) && command.args.some((arg) => CMD_METACHARACTERS.test(arg))) {
    return `Arguments for "${command.command}" must not contain shell metacharacters (& | < > ^ % ! " or newlines)`;
  }
  return null;
}
