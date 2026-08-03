import { auth as clerkAuth } from "@clerk/nextjs/server";
import type { NextRequest } from "next/server";
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
 *
 * @param req — Optional NextRequest. When provided, the helper first tries
 *   the standard Clerk session (which works for browser cookie auth). If that
 *   fails, it falls back to extracting a Bearer token from the Authorization
 *   header. This fixes the "signed in on frontend but 401 on API" failure that
 *   occurs when marketplace fetch calls don't send cookies.
 */
export async function auth(req?: NextRequest): Promise<AuthResult> {
  if (!isClerkConfigured() || isTestAuthDisabled()) {
    if (isAnonymousDevAllowed()) {
      return { userId: "anonymous-dev", clerkId: null };
    }
    return { userId: null, clerkId: null };
  }

  // Try standard Clerk session auth (uses AsyncLocalStorage, no req needed).
  const session = await clerkAuth();
  const clerkId = (session as { userId?: string | null }).userId ?? null;

  if (clerkId) {
    return { userId: clerkId, clerkId };
  }

  // Bearer-token fallback for fetch calls that don't send cookies.
  if (req) {
    const authHeader = req.headers.get("authorization");
    if (authHeader?.startsWith("Bearer ")) {
      const token = authHeader.slice(7);
      try {
        const { verifyToken } = await import("@clerk/nextjs/server");
        const claims = await verifyToken(token, {
          secretKey: process.env.CLERK_SECRET_KEY,
        });
        if (claims.sub) {
          return { userId: claims.sub, clerkId: claims.sub };
        }
      } catch {
        // Invalid token — fall through to anonymous/dev check.
      }
    }
  }

  if (isAnonymousDevAllowed()) {
    return { userId: "anonymous-dev", clerkId: null };
  }

  return { userId: null, clerkId: null };
}

