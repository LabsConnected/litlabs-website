/**
 * terminal-owner-gate.ts — P0 owner gate for terminal shell access.
 *
 * Only Clerk user IDs in the allowlist may exchange a Clerk token for a
 * terminal JWT (POST /api/token-exchange) or open an authenticated PTY
 * socket (Socket.IO auth). Everything else is rejected BEFORE any
 * workspace authorization or token minting.
 *
 * Clerk user IDs are NOT secrets — hardcoding the owner's ID as the
 * default is safe and makes the gate effective on deploy with zero
 * manual steps. Set TERMINAL_OWNER_CLERK_IDS (comma-separated) to
 * change the allowlist without a code deploy.
 */

// Larry — workspace owner. The default allowlist.
const DEFAULT_OWNER_CLERK_ID = "user_3GsAlPRx3ihYhftgAQ8Owr1uxzF";

/**
 * Parse the owner allowlist.
 * Semantics: (TERMINAL_OWNER_CLERK_IDS ?? default).split(",").map(trim).filter(Boolean)
 */
export function getTerminalOwnerIds(): string[] {
  return (process.env.TERMINAL_OWNER_CLERK_IDS ?? DEFAULT_OWNER_CLERK_ID)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/** True when the given Clerk user ID is allowed terminal shell access. */
export function isTerminalOwner(userId: string | null | undefined): boolean {
  if (!userId) return false;
  return getTerminalOwnerIds().includes(userId);
}

/**
 * Call once at startup. Warns when running on the implicit default
 * allowlist so an unset env var is a conscious choice, not an accident.
 */
export function warnIfOwnerAllowlistUnset(): void {
  if (!process.env.TERMINAL_OWNER_CLERK_IDS) {
    console.warn(
      "[terminal-owner-gate] TERMINAL_OWNER_CLERK_IDS is unset — terminal shell access " +
        "is restricted to the default workspace owner only. Set TERMINAL_OWNER_CLERK_IDS " +
        "to a comma-separated list of Clerk user IDs to change this."
    );
  }
}
