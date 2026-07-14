import type { NextRequest } from "next/server";
import { timingSafeEqual } from "crypto";
import { isAdmin } from "./roles";

function safeSecretEqual(candidate: string, expected: string): boolean {
  const candidateBuffer = Buffer.from(candidate);
  const expectedBuffer = Buffer.from(expected);
  return (
    candidateBuffer.length === expectedBuffer.length &&
    timingSafeEqual(candidateBuffer, expectedBuffer)
  );
}

/**
 * Returns true if the request is allowed to mutate wallet/credit balances.
 * Allowed callers:
 * - Admins (Clerk sessionClaims metadata role === "admin")
 * - Internal server-to-server requests with a valid X-Internal-Api-Key header
 */
export async function canMutateBalances(req: NextRequest): Promise<boolean> {
  const internalKey = req.headers.get("x-internal-api-key");
  if (
    internalKey &&
    process.env.INTERNAL_API_KEY &&
    safeSecretEqual(internalKey, process.env.INTERNAL_API_KEY)
  ) {
    return true;
  }
  return isAdmin();
}
