/**
 * litt logout — Clear local credentials and revoke the refresh token.
 *
 * Clears:
 *   - Cached terminal JWT (in-memory)
 *   - Local Clerk OAuth credentials (keychain or file)
 *   - Server-side refresh token (best-effort revocation via /oauth/revoke)
 *   - In-memory authenticated identity
 *
 * After logout, the CLI returns to the signed-out state. All protected
 * commands will require `litt login` again.
 *
 * Usage:  litt logout
 */

import { getAuthSession } from "../lib/auth/auth-session.js";
import { hasAuthConfig } from "../lib/auth/auth-config.js";
import { clearTerminalTokenCache } from "../lib/remote.js";
import { ok, fail, header, c } from "../lib/utils.js";

export async function logoutCommand(_args: string[]): Promise<number> {
  header("LiTT Logout");

  // Clear the cached terminal JWT (in-memory)
  clearTerminalTokenCache();

  // If using LITT_CLERK_TOKEN (temporary test path), just report
  if (process.env.LITT_CLERK_TOKEN) {
    ok("Cleared in-memory terminal token cache.");
    console.error(`${c.dim}  Note: LITT_CLERK_TOKEN is set in your environment.${c.reset}`);
    console.error(`${c.dim}  Unset it to fully sign out: unset LITT_CLERK_TOKEN${c.reset}`);
    return 0;
  }

  if (!hasAuthConfig()) {
    ok("Nothing to sign out from (auth not configured).");
    return 0;
  }

  const session = getAuthSession();
  const wasSignedIn = await session.isSignedIn();

  if (!wasSignedIn) {
    ok("Already signed out.");
    return 0;
  }

  try {
    await session.logout();
    ok("Signed out.");
    console.log(`${c.dim}  Local credentials cleared and refresh token revoked.${c.reset}`);
    console.log(`${c.dim}  Run 'litt login' to sign in again.${c.reset}`);
    return 0;
  } catch (error) {
    // Even if server-side revocation fails, local credentials should be cleared
    fail(`Logout encountered an error: ${error instanceof Error ? error.message : String(error)}`);
    console.error(`${c.dim}  Local credentials may still be partially cleared.${c.reset}`);
    console.error(`${c.dim}  Run 'litt login' to sign in again.${c.reset}`);
    return 1;
  }
}
