/**
 * Mobile command dispatch for the LiTT terminal.
 *
 * When a user types `litt mobile:check` (etc.) in the terminal, the
 * terminal server intercepts it here and writes real shell commands to
 * the PTY — instead of sending the prompt through the LLM like other
 * `litt` commands. This gives instant, deterministic execution.
 *
 * The mobile package path is configurable via the LITT_MOBILE_PACKAGE_PATH
 * env var (defaults to `packages/litt-companion`).
 */

const MOBILE_PACKAGE_PATH =
  process.env.LITT_MOBILE_PACKAGE_PATH || "packages/litt-companion";

export interface MobileCommand {
  /** The subcommand the user types after `litt ` (e.g. `mobile:check`). */
  name: string;
  /** Human-readable label shown in the terminal before execution. */
  label: string;
  /** The shell command written to the PTY. */
  shellCommand: string;
}

const MOBILE_COMMANDS: Record<string, MobileCommand> = {
  "mobile:check": {
    name: "mobile:check",
    label: "Mobile check — typecheck + Expo export",
    shellCommand: `cd ${MOBILE_PACKAGE_PATH} && npx tsc --noEmit && npx expo export --platform android`,
  },
  "mobile:start": {
    name: "mobile:start",
    label: "Mobile dev server — Expo start",
    shellCommand: `cd ${MOBILE_PACKAGE_PATH} && npx expo start`,
  },
  "mobile:build": {
    name: "mobile:build",
    label: "Mobile Android build — EAS",
    shellCommand: `cd ${MOBILE_PACKAGE_PATH} && npx eas build --platform android --profile preview`,
  },
  "mobile:doctor": {
    name: "mobile:doctor",
    label: "Mobile doctor — expo doctor",
    shellCommand: `cd ${MOBILE_PACKAGE_PATH} && npx expo doctor`,
  },
};

/**
 * Parse a `litt-code:command` input and return the matching mobile command,
 * or null if the input is not a mobile command.
 *
 * @example
 * dispatchMobileCommand("litt mobile:check") // → MobileCommand
 * dispatchMobileCommand("litt scan")          // → null
 */
export function dispatchMobileCommand(input: string): MobileCommand | null {
  const args = input.trim().split(/\s+/).slice(1); // drop the leading "litt"
  const subcommand = args[0]?.toLowerCase();

  if (!subcommand) return null;

  return MOBILE_COMMANDS[subcommand] ?? null;
}

/** List of mobile command names (for help/autocomplete). */
export const MOBILE_COMMAND_NAMES = Object.keys(MOBILE_COMMANDS);
