import { auth as clerkAuth, verifyToken } from "@clerk/nextjs/server";
import type { NextRequest } from "next/server";
import { isAnonymousDevAllowed, isClerkConfigured, isDeployed } from "@/lib/env";

export interface AuthResult {
  userId: string | null;
  clerkId: string | null;
}

/**
 * Test-only auth bypass ΓÇö same conditions as middleware.
 * Only valid when CI=true, PLAYWRIGHT_TEST=true, and not in a deployed env.
 */
function isTestAuthDisabled(): boolean {
  return (
    process.env.PLAYWRIGHT_AUTH_DISABLED === "true" &&
    process.env.CI === "true" &&
    process.env.PLAYWRIGHT_TEST === "true" &&
    !isDeployed()
  );
}

/**
 * Extract and verify a Bearer token from the Authorization header.
 * Used as a fallback when Clerk's cookie-based auth (via clerkAuth())
 * returns null ΓÇö the session cookie may have expired (short TTL) while
 * the client-side session is still active. The client sends a fresh
 * JWT via getToken() in the Authorization header.
 */
async function authFromBearerToken(req: NextRequest): Promise<string | null> {
  const header = req.headers.get("authorization") || req.headers.get("Authorization");
  if (!header || !header.startsWith("Bearer ")) return null;
  const token = header.slice(7);
  if (!token || token.length < 10) return null;
  try {
    const payload = await verifyToken(token, {
      secretKey: process.env.CLERK_SECRET_KEY,
    });
    // Clerk JWTs store the user ID in the `sub` claim
    return payload.sub || null;
  } catch {
    return null;
  }
}

/**
 * Returns the authenticated Clerk user ID.
 *
 * When Clerk is not configured (missing keys) or test auth is disabled,
 * returns { userId: null } without calling clerkAuth() ΓÇö this prevents
 * 500 errors from Clerk throwing when middleware context is absent.
 * API routes will correctly return 401.
 *
 * In production/deployed environments this always requires a Clerk session.
 * In local dev you can set ALLOW_ANONYMOUS_DEV=true to test routes without
 * signing in; the returned userId will be "anonymous-dev" and callers must
 * decide whether to accept that.
 *
 * ALLOW_ANONYMOUS_DEV is hard-blocked in production via isAnonymousDevAllowed().
 *
 * If a NextRequest is passed, falls back to verifying a Bearer token from
 * the Authorization header when the Clerk session cookie is expired/missing.
 * This handles the case where the client-side session is active but the
 * short-lived session cookie has expired.
 */
export async function auth(req?: NextRequest): Promise<AuthResult> {
  if (!isClerkConfigured() || isTestAuthDisabled()) {
    if (isAnonymousDevAllowed()) {
      return { userId: "anonymous-dev", clerkId: null };
    }
    return { userId: null, clerkId: null };
  }

  // Try Clerk's cookie-based auth first (reads from middleware context).
  // Wrap in try-catch ΓÇö clerkAuth() can throw when the middleware context
  // is missing or the session is in an intermediate ("interstitial") state.
  let clerkId: string | null = null;
  try {
    const result = await clerkAuth();
    clerkId = result.userId;
  } catch {
    // Cookie auth failed ΓÇö try Bearer token fallback below
  }

  if (clerkId) {
    return { userId: clerkId, clerkId };
  }

  // Fallback: verify a Bearer token from the Authorization header.
  // The client sends this via getToken() ΓÇö it's a fresh JWT that's
  // valid even when the session cookie has expired.
  if (req) {
    const bearerUserId = await authFromBearerToken(req);
    if (bearerUserId) {
      return { userId: bearerUserId, clerkId: bearerUserId };
    }
  }

  if (isAnonymousDevAllowed()) {
    return { userId: "anonymous-dev", clerkId: null };
  }

  return { userId: null, clerkId: null };
}
