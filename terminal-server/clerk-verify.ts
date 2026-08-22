/**
 * Clerk token verification (server-side only).
 *
 * Verifies Clerk-issued JWTs using @clerk/backend. The terminal-server
 * uses this to verify the identity token sent by CLI/Desktop/Mobile
 * clients during the token exchange flow.
 *
 * The client NEVER has access to CLERK_SECRET_KEY — only the server
 * verifies Clerk tokens.
 */

import { verifyToken } from "@clerk/backend";

export interface VerifiedClerkUser {
  userId: string;
  /** Raw JWT payload for debugging/introspection */
  claims: Record<string, unknown>;
}

/**
 * Verify a Clerk-issued JWT and extract the user ID.
 *
 * @param token  The Clerk session JWT (from clerk.getToken() or the
 *               Authorization: Bearer header)
 * @returns The verified Clerk user ID and claims
 * @throws if CLERK_SECRET_KEY is not configured or the token is invalid
 */
export async function verifyClerkToken(token: string): Promise<VerifiedClerkUser> {
  const secretKey = process.env.CLERK_SECRET_KEY ?? "";
  if (!secretKey) {
    throw new Error("Clerk authentication is not configured (CLERK_SECRET_KEY missing)");
  }

  const payload = await verifyToken(token, { secretKey });

  if (!payload.sub) {
    throw new Error("Clerk token has no subject (sub claim)");
  }

  return {
    userId: payload.sub,
    claims: payload as unknown as Record<string, unknown>,
  };
}
