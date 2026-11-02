/**
 * terminal-owner-gate.ts — P0 owner gate for terminal shell access.
 *
 * Only Clerk user IDs in the allowlist may exchange a Clerk token for a
 * terminal JWT (POST /api/token-exchange) or open an authenticated PTY
 * socket (Socket.IO auth). Everything else is rejected BEFORE any
 * workspace authorization or token minting.
 *
 * The allowlist comes ONLY from TERMINAL_OWNER_CLERK_IDS (comma-separated).
 * When it is unset the allowlist is EMPTY and every owner check fails
 * closed — no user is granted terminal shell access until an operator
 * explicitly configures the list. There is no hardcoded default owner.
 */

/**
 * Parse the owner allowlist.
 * Semantics: (TERMINAL_OWNER_CLERK_IDS ?? "").split(",").map(trim).filter(Boolean)
 */
export function getTerminalOwnerIds(): string[] {
  return (process.env.TERMINAL_OWNER_CLERK_IDS ?? "")
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
        "is DENIED for all users. Set TERMINAL_OWNER_CLERK_IDS to a comma-separated " +
        "list of Clerk user IDs to grant owner access."
    );
  }
}
