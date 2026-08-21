/**
 * PKCE (Proof Key for Code Exchange) utilities — pure node:crypto.
 *
 *   code_verifier  = base64url(randomBytes(32))   → 43 chars, 256 bits
 *   code_challenge = base64url(sha256(verifier))  → S256 method
 *   state          = base64url(randomBytes(32))   → CSRF token
 *
 * No external dependencies. Works on desktop and Termux.
 */

import { createHash, randomBytes } from "node:crypto";

function base64Url(buffer: Buffer): string {
  return buffer.toString("base64url");
}

/** Generate a cryptographically random PKCE code_verifier (43+ chars). */
export function generateCodeVerifier(): string {
  return base64Url(randomBytes(32));
}

/** Generate the S256 code_challenge from a code_verifier. */
export async function generateCodeChallenge(verifier: string): Promise<string> {
  return base64Url(createHash("sha256").update(verifier).digest());
}

/** Generate a random CSRF state token. */
export function generateState(): string {
  return base64Url(randomBytes(32));
}
