/**
 * litt login — Authenticate via Clerk OAuth 2.0 Authorization Code + PKCE.
 *
 * Opens the system browser to the Clerk sign-in page. After the user
 * signs in, the browser redirects to a one-shot localhost callback
 * listener, which exchanges the authorization code for access + refresh
 * tokens. Tokens are stored in the OS keychain (or file fallback on
 * Termux).
 *
 * Usage:  litt login
 */

import { getAuthSession } from "../lib/auth/auth-session.js";
import { getIssuer } from "../lib/auth/auth-config.js";
import { ok, fail, header, c } from "../lib/utils.js";
import { AuthError } from "../lib/auth/types.js";

export async function loginCommand(args: string[]): Promise<number> {
  header("LiTT Login");

  // --force: skip the already-signed-in guard and pass prompt=login to Clerk
  // so the user is forced through the sign-in screen even with an active session.
  const force = args.includes("--force");

  // Auth is always configured — the CLI ships safe production defaults
  // for the Clerk issuer, OAuth client_id, and terminal-server URL.
  // Env overrides (LITT_CLERK_ISSUER, LITT_CLERK_OAUTH_CLIENT_ID) are
  // for development/staging/testing only.
  const issuer = getIssuer();
  const session = getAuthSession();

  // Check if already signed in (skip when --force is requested)
  if (!force) {
    const alreadySignedIn = await session.isSignedIn();
    if (alreadySignedIn) {
      const user = await session.whoami();
      if (user) {
        ok(`Already signed in as ${user.email ?? user.name ?? user.sub}`);
        console.log(`${c.dim}  Run 'litt login --force' to re-authenticate, or 'litt logout' to sign out.${c.reset}`);
        return 0;
      }
    }
  }

  console.log(`  Opening ${issuer} in your browser...`);
  console.log();

  try {
    const result = await session.login(force ? { prompt: "login" } : undefined);
    const email = result.user.email ?? result.user.name ?? result.user.sub;
    ok(`Signed in as ${email}`);
    console.log();
    console.log(`${c.dim}  You can now use LiTT. Run 'litt' to launch the cockpit.${c.reset}`);
    return 0;
  } catch (error) {
    if (error instanceof AuthError) {
      fail(`Login failed (${error.code}): ${error.message}`);
    } else {
      fail(`Login failed: ${error instanceof Error ? error.message : String(error)}`);
    }

    // Helpful hints for common failures
    const msg = error instanceof Error ? error.message : "";
    if (msg.includes("timeout") || (error instanceof AuthError && error.code === "timeout")) {
      console.error(`${c.dim}  The browser callback timed out. Make sure you complete sign-in within 2 minutes.${c.reset}`);
      console.error(`${c.dim}  If the browser didn't open, check that you can reach ${issuer}${c.reset}`);
    } else if (error instanceof AuthError && error.code === "state_mismatch") {
      console.error(`${c.dim}  CSRF state mismatch — this can happen if the callback URL was tampered with.${c.reset}`);
      console.error(`${c.dim}  Try again. If the problem persists, clear your browser cache.${c.reset}`);
    } else if (error instanceof AuthError && error.code === "token_exchange") {
      console.error(`${c.dim}  Token exchange failed — the authorization code may be invalid or expired.${c.reset}`);
      console.error(`${c.dim}  Try again. If the problem persists, verify the OAuth client_id and redirect URI.${c.reset}`);
    }

    return 1;
  }
}
