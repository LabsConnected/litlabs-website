/**
 * Clerk token verification (server-side only).
 *
 * Verifies Clerk-issued tokens using @clerk/backend's
 * `authenticateRequest()` — the canonical Clerk verification path that
 * supports BOTH:
 *   - session_token — from the web app's Clerk session (Studio Web)
 *   - oauth_token   — from the CLI's OAuth 2.0 PKCE flow (litt login)
 *
 * Why not verifyToken()?
 *   Clerk OAuth access tokens MAY be opaque (non-JWT) depending on the
 *   instance configuration. verifyToken() only handles JWTs.
 *   authenticateRequest() with `acceptsToken: ['session_token','oauth_token']`
 *   handles both JWT and opaque OAuth tokens, plus session JWTs, and
 *   performs the full Clerk verification chain (issuer, audience,
 *   authorizedParties, expiry, signature).
 *
 * The client NEVER has access to CLERK_SECRET_KEY — only the server
 * verifies Clerk tokens. userId is derived EXCLUSIVELY from Clerk's
 * verified authentication result (`toAuth().userId` for session tokens,
 * `toAuth().subject` for OAuth tokens), never from the request body.
 */

import { createClerkClient } from "@clerk/backend";

export interface VerifiedClerkUser {
  userId: string;
  /**
   * Best-effort claims snapshot for downstream logging/introspection.
   * Never used for identity decisions — `userId` is the authority.
   */
  claims: Record<string, unknown>;
}

/**
 * Lazily-built Clerk client. Re-created if env changes (mainly for tests).
 * The client is safe to reuse across requests — it only holds keys/config.
 */
let cachedClient: ReturnType<typeof createClerkClient> | null = null;
let cachedSecretKey = "";

function getClerkClient(): ReturnType<typeof createClerkClient> {
  const secretKey = process.env.CLERK_SECRET_KEY ?? "";
  if (!secretKey) {
    throw new Error("Clerk authentication is not configured (CLERK_SECRET_KEY missing)");
  }
  if (cachedClient && cachedSecretKey === secretKey) {
    return cachedClient;
  }
  const publishableKey = process.env.CLERK_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ?? undefined;
  cachedClient = createClerkClient({ secretKey, publishableKey });
  cachedSecretKey = secretKey;
  return cachedClient;
}

/**
 * Optional authorized-parties list from env.
 * Comma-separated URLs that are allowed to originate Clerk tokens.
 * Example: CLERK_AUTHORIZED_PARTIES=http://localhost:3000,https://litlabs.net
 *
 * When set, Clerk verifies the token's `azp`/`aud` claim matches one of
 * these parties. When unset, Clerk uses its default party validation.
 */
function getAuthorizedParties(): string[] | undefined {
  const raw = process.env.CLERK_AUTHORIZED_PARTIES;
  if (!raw) return undefined;
  const parties = raw.split(",").map((s) => s.trim()).filter(Boolean);
  return parties.length > 0 ? parties : undefined;
}

/**
 * Verify a Clerk-issued token and extract the user ID.
 *
 * Uses `authenticateRequest()` with `acceptsToken: ['session_token','oauth_token']`
 * so both the CLI OAuth flow and the web app session flow work through
 * the same verified path. Opaque (non-JWT) OAuth tokens are supported.
 *
 * @param token  The Clerk token (OAuth access token from litt login,
 *               or session JWT from the web app)
 * @returns The verified Clerk user ID and a claims snapshot
 * @throws if CLERK_SECRET_KEY is not configured or the token is invalid,
 *         expired, from the wrong issuer/audience, or not a supported type.
 */
export async function verifyClerkToken(token: string): Promise<VerifiedClerkUser> {
  const clerk = getClerkClient();

  // Build a synthetic Request carrying the bearer token.
  // The URL is the terminal-server's canonical origin — Clerk uses it
  // for authorizedParties matching when configured.
  const origin = process.env.TERMINAL_SERVER_ORIGIN ?? "https://terminal.litlabs.net";
  const request = new Request(`${origin}/api/token-exchange`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  const authorizedParties = getAuthorizedParties();

  const authResult = await clerk.authenticateRequest(request, {
    acceptsToken: ["session_token", "oauth_token"],
    ...(authorizedParties ? { authorizedParties } : {}),
  });

  if (!authResult.isAuthenticated) {
    const reason = "reason" in authResult ? (authResult as { reason: string }).reason : "unknown";
    const message = "message" in authResult ? (authResult as { message: string }).message : "";
    throw new Error(
      `Clerk token verification failed (status: ${authResult.status}${reason ? `, reason: ${reason}` : ""}${message ? ` — ${message}` : ""})`,
    );
  }

  // toAuth() is a FUNCTION, not a property. It returns the auth object
  // whose shape depends on the accepted token type:
  //   - session_token → SignedInAuthObject  (has .userId)
  //   - oauth_token   → AuthenticatedMachineObject<OAuthToken> (has .subject)
  const auth = authResult.toAuth() as {
    userId?: string;
    subject?: string;
    id?: string;
    isAuthenticated?: boolean;
  };

  // Derive userId exclusively from the verified Clerk auth result.
  // For session tokens: auth.userId
  // For OAuth tokens: auth.subject (the OAuth token's `sub` claim)
  const userId = auth.userId ?? auth.subject;
  if (!userId) {
    throw new Error("Clerk token verified but no user identity (userId/subject) present");
  }

  // Build a minimal claims snapshot from the auth object's public fields.
  // This is for downstream logging only — never used for identity.
  const claims: Record<string, unknown> = {
    sub: userId,
    ...(auth.id ? { id: auth.id } : {}),
  };

  return { userId, claims };
}

/**
 * Reset cached client (for tests).
 * @internal
 */
export function _resetClerkClientCache(): void {
  cachedClient = null;
  cachedSecretKey = "";
}
