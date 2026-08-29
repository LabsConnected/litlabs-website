/**
 * Slash-command parsing — separates the command token from arguments.
 *
 * The command palette should only filter on the command NAME, never on
 * the arguments. This module provides the pure parsing logic that
 * extracts the command token from a slash-command input string.
 *
 * Examples:
 *   "/"                  → { command: "", args: "", hasSpace: false }
 *   "/loc"               → { command: "loc", args: "", hasSpace: false }
 *   "/local"             → { command: "local", args: "", hasSpace: false }
 *   "/local "            → { command: "local", args: "", hasSpace: true }
 *   "/local where.exe"   → { command: "local", args: "where.exe", hasSpace: true }
 *   "/local where.exe adb" → { command: "local", args: "where.exe adb", hasSpace: true }
 *   "/run git status"    → { command: "run", args: "git status", hasSpace: true }
 *   "/remote"            → { command: "remote", args: "", hasSpace: false }
 *   "/notreal"           → { command: "notreal", args: "", hasSpace: false }
 *   "hello"              → null (not a slash command)
 */

export interface SlashCommandParse {
  /** The command name without the leading "/" (e.g. "local", "run"). */
  command: string;
  /** The arguments after the first space (empty if no space yet). */
  args: string;
  /** Whether a space has been typed after the command token. */
  hasSpace: boolean;
  /** The full original input (e.g. "/local where.exe adb"). */
  raw: string;
}

/**
 * Parse a slash-command input string into command token + arguments.
 *
 * Returns null if the input does not start with "/".
 * Returns the parsed result otherwise, with hasSpace indicating whether
 * the user has typed a space after the command token.
 *
 * The command palette should use `command` as its filter query.
 * Once hasSpace is true, the palette should close and the composer
 * should retain focus for free-form argument entry.
 */
export function parseSlashCommand(input: string): SlashCommandParse | null {
  if (!input.startsWith("/")) return null;

  const afterSlash = input.slice(1);
  const spaceIdx = afterSlash.indexOf(" ");

  if (spaceIdx === -1) {
    // No space yet — just the command token (possibly partial)
    return {
      command: afterSlash,
      args: "",
      hasSpace: false,
      raw: input,
    };
  }

  // Space found — split into command token and arguments
  const command = afterSlash.slice(0, spaceIdx);
  const args = afterSlash.slice(spaceIdx + 1);
  return {
    command,
    args,
    hasSpace: true,
    raw: input,
  };
}

/**
 * Whether the command palette should be open for the given input.
 *
 * The palette should be open when:
 *   - the input starts with "/"
 *   - AND no space has been typed yet (the user is still typing the command name)
 *
 * Once a space is typed, the palette should close and the composer
 * retains the full input for argument entry.
 */
export function shouldPaletteBeOpen(input: string): boolean {
  const parsed = parseSlashCommand(input);
  if (!parsed) return false;
  return !parsed.hasSpace;
}

/**
 * The query string the palette should use for filtering.
 *
 * This is just the command name (without "/" and without arguments).
 * The palette should NEVER search the arguments.
 */
export function paletteQuery(input: string): string {
  const parsed = parseSlashCommand(input);
  if (!parsed) return "";
  return parsed.command;
}
