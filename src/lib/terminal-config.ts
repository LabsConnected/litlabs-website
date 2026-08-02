/**
 * Terminal feature-flag configuration.
 *
 * When NEXT_PUBLIC_TERMINAL_ENABLED is "false" (or TERMINAL_ENABLED is "false"),
 * all terminal UI is hidden, TerminalPanel never mounts, no token requests are
 * made, and no Socket.IO connections are opened.
 *
 * Production values for Prod 1:
 *   NEXT_PUBLIC_TERMINAL_ENABLED=false
 *   TERMINAL_ENABLED=false
 *   TERMINAL_PROVIDER=disabled
 */

/** True when the terminal feature is enabled (client-safe). */
export function isTerminalEnabled(): boolean {
  const publicFlag = process.env.NEXT_PUBLIC_TERMINAL_ENABLED;
  if (publicFlag === "false") return false;
  if (publicFlag === "true") return true;

  const serverFlag = process.env.TERMINAL_ENABLED;
  if (serverFlag === "false") return false;

  return true;
}

/** True when the terminal feature is explicitly disabled. */
export function isTerminalDisabled(): boolean {
  return !isTerminalEnabled();
}

/** Returns the terminal provider, or "disabled" when the feature is off. */
export function getTerminalProvider(): string {
  if (isTerminalDisabled()) return "disabled";
  return process.env.TERMINAL_PROVIDER ?? "default";
}
