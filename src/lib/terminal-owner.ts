import "server-only";

/**
 * Web-app view of the terminal owner allowlist.
 *
 * Mirrors terminal-server/terminal-owner-gate.ts semantics: the terminal
 * server's gate is AUTHORITATIVE (it returns Forbidden for non-owners),
 * but the web app needs the same allowlist to truthfully report terminal
 * tool health (Part F) — don't advertise terminal.execute to a user the
 * terminal server will reject.
 *
 * Both sides prioritize TERMINAL_ALLOWED_CLERK_IDS, falling back to the
 * legacy TERMINAL_OWNER_CLERK_IDS and then the same owner default. If the
 * services have different env values, the terminal server still wins; this
 * is health reporting only and never grants shell authorization.
 */

// Must match terminal-server/terminal-owner-gate.ts DEFAULT_OWNER_CLERK_ID.
const DEFAULT_OWNER_CLERK_ID = "user_3GsAlPRx3ihYhftgAQ8Owr1uxzF";

export function getTerminalOwnerIds(): string[] {
  return (process.env.TERMINAL_ALLOWED_CLERK_IDS ?? process.env.TERMINAL_OWNER_CLERK_IDS ?? DEFAULT_OWNER_CLERK_ID)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/** True when the Clerk user ID is in the terminal owner allowlist. */
export function isTerminalOwnerUser(userId: string | null | undefined): boolean {
  if (!userId) return false;
  return getTerminalOwnerIds().includes(userId);
}
