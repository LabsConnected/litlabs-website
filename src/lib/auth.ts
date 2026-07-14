import { auth as clerkAuth } from "@clerk/nextjs/server";

export interface AuthResult {
  userId: string | null;
  clerkId: string | null;
}

/**
 * Returns the authenticated Clerk user ID.
 *
 * In production this always requires a Clerk session.
 * In local dev you can set ALLOW_ANONYMOUS_DEV=true to test routes without
 * signing in; the returned userId will be "anonymous-dev" and callers must
 * decide whether to accept that.
 */
export async function auth(): Promise<AuthResult> {
  const { userId: clerkId } = await clerkAuth();

  if (clerkId) {
    return { userId: clerkId, clerkId };
  }

  if (process.env.ALLOW_ANONYMOUS_DEV === "true") {
    return { userId: "anonymous-dev", clerkId: null };
  }

  return { userId: null, clerkId: null };
}
