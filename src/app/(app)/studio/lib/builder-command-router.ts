/**
 * LiTT command types for Studio slash commands.
 *
 * Local commands (clear, new, terminal, etc.) are handled entirely in the browser.
 * Runtime commands (status, diff, check, test, build) are forwarded to the canonical
 * CommandRouter via the web command bridge → terminal-server → agent-core.
 *
 * Both `/status` in Studio and `litt status` in CLI hit the same CommandRouter.
 */

export type RuntimeCommandName =
  | "status"
  | "diff"
  | "check"
  | "test"
  | "build"
  | "debug"
  | "ship";

export type BuilderLocalCommand =
  | { type: "clear" }
  | { type: "new" }
  | { type: "terminal" }
  | { type: "sessions" }
  | { type: "delete" }
  | { type: "rename"; title: string }
  | { type: "help" }
  | { type: "runtime"; command: RuntimeCommandName; args?: string }
  | { type: "unknown"; command: string };

/** Commands that route through the canonical CommandRouter */
const RUNTIME_COMMANDS = new Set<RuntimeCommandName>(["status", "diff", "check", "test", "build", "debug", "ship"]);

export function parseBuilderLocalCommand(input: string): BuilderLocalCommand | null {
  const trimmed = input.trim();
  if (!trimmed.startsWith("/")) return null;
  const [rawCommand, ...args] = trimmed.slice(1).split(/\s+/);
  const command = rawCommand.toLowerCase();
  const argument = args.join(" ").trim();
  switch (command) {
    case "clear": return { type: "clear" };
    case "new": return { type: "new" };
    case "terminal": return { type: "terminal" };
    case "sessions": return { type: "sessions" };
    case "delete": return { type: "delete" };
    case "rename": return { type: "rename", title: argument };
    case "help": return { type: "help" };
    default:
      if (RUNTIME_COMMANDS.has(command as RuntimeCommandName)) {
        return { type: "runtime", command: command as RuntimeCommandName, args: argument || undefined };
      }
      return { type: "unknown", command };
  }
}
