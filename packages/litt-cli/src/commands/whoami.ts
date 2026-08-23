/**
 * litt whoami — Display the current authenticated identity.
 *
 * Shows ONLY safe identity information:
 *   - Signed in status
 *   - Email
 *   - User/display name
 *   - LiTT user ID (Clerk sub)
 *   - Authentication source
 *
 * NEVER displays access/refresh/JWT tokens.
 *
 * Usage:  litt whoami
 */

import { getAuthSession } from "../lib/auth/auth-session.js";
import { getIssuer } from "../lib/auth/auth-config.js";
import { ok, fail, warn, header, label, value, c } from "../lib/utils.js";

export async function whoamiCommand(_args: string[]): Promise<number> {
  header("LiTT Whoami");

  // LITT_CLERK_TOKEN path (temporary — automated tests)
  if (process.env.LITT_CLERK_TOKEN) {
    warn("Authenticated via LITT_CLERK_TOKEN (temporary test mechanism).");
    console.log(`${label("Signed in:")} ${value("yes", c.green)}`);
    console.log(`${label("Auth source:")} ${value("LITT_CLERK_TOKEN env var", c.dim)}`);
    console.log(`${label("Email:")} ${value("unknown (token not verified client-side)", c.dim)}`);
    console.log();
    console.error(`${c.dim}  This is a temporary acceptance-test auth mechanism.${c.reset}`);
    console.error(`${c.dim}  Run 'litt login' for the real OAuth flow.${c.reset}`);
    return 0;
  }

  // Auth is always configured (safe production defaults shipped in the CLI).
  const session = getAuthSession();
  const user = await session.whoami();

  if (!user) {
    fail("Not signed in.");
    console.error(`${c.dim}  Run 'litt login' to authenticate.${c.reset}`);
    return 1;
  }

  ok("Signed in.");
  console.log(`${label("Email:")} ${value(user.email ?? "—", c.green)}`);
  console.log(`${label("Name:")} ${value(user.name ?? user.givenName ?? "—")}`);
  console.log(`${label("User ID:")} ${value(user.sub, c.dim)}`);
  console.log(`${label("Auth source:")} ${value("Clerk OAuth", c.dim)}`);
  console.log(`${label("Issuer:")} ${value(getIssuer(), c.dim)}`);

  // Show username if available
  if (user.username) {
    console.log(`${label("Username:")} ${value(user.username)}`);
  }

  return 0;
}
