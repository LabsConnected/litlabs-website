import { auth as clerkAuth } from "@clerk/nextjs/server";
import { isAnonymousDevAllowed, isClerkConfigured } from "@/lib/env";

export interface AuthResult {
  userId: string | null;
  clerkId: string | null;
}

/**
 * Test-only auth bypass — same conditions as middleware.
 * Only valid when CI=true, PLAYWRIGHT_TEST=true, and VERCEL is absent.
 */
function isTestAuthDisabled(): boolean {
  return (
    process.env.PLAYWRIGHT_AUTH_DISABLED === "true" &&
    process.env.CI === "true" &&
    process.env.PLAYWRIGHT_TEST === "true" &&
    !process.env.VERCEL
  );
}

/**
 * Returns the authenticated Clerk user ID.
 *
 * When Clerk is not configured (missing keys) or test auth is disabled,
 * returns { userId: null } without calling clerkAuth() — this prevents
 * 500 errors from Clerk throwing when middleware context is absent.
 * API routes will correctly return 401.
 *
 * In production/deployed environments this always requires a Clerk session.
 * In local dev you can set ALLOW_ANONYMOUS_DEV=true to test routes without
 * signing in; the returned userId will be "anonymous-dev" and callers must
 * decide whether to accept that.
 *
 * ALLOW_ANONYMOUS_DEV is hard-blocked in production via isAnonymousDevAllowed().
 */
export async function auth(): Promise<AuthResult> {
  if (!isClerkConfigured() || isTestAuthDisabled()) {
    if (isAnonymousDevAllowed()) {
      return { userId: "anonymous-dev", clerkId: null };
    }
    return { userId: null, clerkId: null };
  }

  const { userId: clerkId } = await clerkAuth();

  if (clerkId) {
    return { userId: clerkId, clerkId };
  }

  if (isAnonymousDevAllowed()) {
    return { userId: "anonymous-dev", clerkId: null };
  }

  return { userId: null, clerkId: null };
}
