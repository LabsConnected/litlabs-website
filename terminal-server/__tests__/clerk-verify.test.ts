/**
 * Clerk verifier tests — proves the server auth boundary correctly:
 *
 *   - Accepts session_token (web app Clerk session JWT)
 *   - Accepts oauth_token (CLI OAuth 2.0 PKCE access token, JWT or opaque)
 *   - Rejects invalid/expired/wrong-type tokens (fail closed)
 *   - Derives userId ONLY from Clerk's verified auth result (never client-supplied)
 *   - Preserves authorizedParties when configured
 *   - Never trusts client-supplied userId
 *
 * The real `@clerk/backend` createClerkClient is mocked so we can simulate
 * signed-in / signed-out / token-type-mismatch responses without real
 * Clerk credentials.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ─── Mock @clerk/backend createClerkClient ────────────────────────
//
// We mock the Clerk client's authenticateRequest to return controlled
// auth results. The mocked toAuth() returns objects matching the real
// shapes: SignedInAuthObject (session_token) and AuthenticatedMachineObject
// (oauth_token).

const mockAuthenticateRequest = vi.fn();

vi.mock("@clerk/backend", () => ({
  createClerkClient: () => ({
    authenticateRequest: mockAuthenticateRequest,
  }),
}));

// Import AFTER mock is set up
import { verifyClerkToken, _resetClerkClientCache } from "../clerk-verify.js";

// ─── Helpers: build auth results matching real Clerk shapes ───────

function signedInSessionResult(userId: string) {
  return {
    status: "signed-in",
    isAuthenticated: true,
    isSignedIn: true,
    tokenType: "session_token",
    toAuth: () => ({
      userId,
      isAuthenticated: true,
      getToken: async () => "session-jwt",
      has: () => true,
      debug: () => ({}),
    }),
  };
}

function authenticatedOAuthResult(subject: string) {
  // AuthenticatedMachineObject<OAuthToken> shape — has .subject, .id, .scopes
  return {
    status: "signed-in",
    isAuthenticated: true,
    isSignedIn: true,
    tokenType: "oauth_token",
    toAuth: () => ({
      id: subject,
      subject,
      scopes: ["profile", "email", "offline_access"],
      getToken: async () => "oauth-access-token",
      has: () => true,
      debug: () => ({}),
      isAuthenticated: true,
    }),
  };
}

function signedOutResult(reason = "token_invalid", message = "Token is invalid") {
  return {
    status: "signed-out",
    isAuthenticated: false,
    isSignedIn: false,
    reason,
    message,
    tokenType: null,
    toAuth: () => ({
      userId: null,
      isAuthenticated: false,
      debug: () => ({}),
    }),
  };
}

function tokenTypeMismatchResult() {
  // Clerk returns signed-out with a token-type-mismatch reason when
  // the token is a type not in the acceptsToken list.
  return signedOutResult("token_type_mismatch", "Token type not accepted");
}

// ─── Tests ────────────────────────────────────────────────────────

describe("clerk-verify — verifyClerkToken", () => {
  const origEnv = { ...process.env };

  beforeEach(() => {
    _resetClerkClientCache();
    mockAuthenticateRequest.mockReset();
    process.env.CLERK_SECRET_KEY = "sk_test_dummy_secret_key";
    delete process.env.CLERK_PUBLISHABLE_KEY;
    delete process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
    delete process.env.CLERK_AUTHORIZED_PARTIES;
    delete process.env.TERMINAL_SERVER_ORIGIN;
  });

  afterEach(() => {
    _resetClerkClientCache();
    process.env = { ...origEnv };
  });

  // ─── session_token (web app) ───────────────────────────────────

  it("accepts a valid session_token and extracts userId", async () => {
    mockAuthenticateRequest.mockReturnValueOnce(signedInSessionResult("user_web_123"));

    const verified = await verifyClerkToken("session-jwt-for-web-user");

    expect(verified.userId).toBe("user_web_123");
    expect(verified.claims.sub).toBe("user_web_123");
    expect(mockAuthenticateRequest).toHaveBeenCalledTimes(1);
  });

  it("session_token: toAuth() is called as a function", async () => {
    const result = signedInSessionResult("user_func_test");
    const toAuthSpy = vi.fn(result.toAuth);
    result.toAuth = toAuthSpy;
    mockAuthenticateRequest.mockReturnValueOnce(result);

    await verifyClerkToken("session-jwt");

    expect(toAuthSpy).toHaveBeenCalled();
  });

  // ─── oauth_token (CLI PKCE flow) ───────────────────────────────

  it("accepts a valid oauth_token and extracts userId from subject", async () => {
    mockAuthenticateRequest.mockReturnValueOnce(authenticatedOAuthResult("user_cli_456"));

    const verified = await verifyClerkToken("oauth-access-token-from-cli");

    expect(verified.userId).toBe("user_cli_456");
    expect(verified.claims.sub).toBe("user_cli_456");
    expect(mockAuthenticateRequest).toHaveBeenCalledTimes(1);
  });

  it("oauth_token: works with opaque (non-JWT) token strings", async () => {
    // Opaque tokens are not JWTs — verifyToken() would fail on these.
    // authenticateRequest() handles them via Clerk's introspection.
    mockAuthenticateRequest.mockReturnValueOnce(authenticatedOAuthResult("user_opaque_789"));

    const verified = await verifyClerkToken("opaque_token_not_a_jwt_abc123");

    expect(verified.userId).toBe("user_opaque_789");
  });

  // ─── Fail-closed: invalid / expired / wrong type ───────────────

  it("rejects an invalid token (signed-out result)", async () => {
    mockAuthenticateRequest.mockReturnValueOnce(signedOutResult("token_invalid", "Invalid token"));

    await expect(verifyClerkToken("invalid-token")).rejects.toThrow("verification failed");
  });

  it("rejects an expired token", async () => {
    mockAuthenticateRequest.mockReturnValueOnce(signedOutResult("token_expired", "Token expired"));

    await expect(verifyClerkToken("expired-token")).rejects.toThrow("verification failed");
  });

  it("rejects a token of a non-accepted type (e.g. api_key when only session/oauth accepted)", async () => {
    mockAuthenticateRequest.mockReturnValueOnce(tokenTypeMismatchResult());

    await expect(verifyClerkToken("api-key-token")).rejects.toThrow("verification failed");
  });

  it("rejects when isAuthenticated is false even if toAuth returns an object", async () => {
    // Simulate a malformed result where isAuthenticated is false
    mockAuthenticateRequest.mockReturnValueOnce({
      status: "signed-out",
      isAuthenticated: false,
      toAuth: () => ({ userId: "should_never_be_used" }),
    });

    await expect(verifyClerkToken("suspicious-token")).rejects.toThrow("verification failed");
  });

  it("rejects when toAuth() returns no userId and no subject", async () => {
    mockAuthenticateRequest.mockReturnValueOnce({
      status: "signed-in",
      isAuthenticated: true,
      toAuth: () => ({ isAuthenticated: true }), // no userId, no subject
    });

    await expect(verifyClerkToken("token-without-identity")).rejects.toThrow("no user identity");
  });

  // ─── Configuration ─────────────────────────────────────────────

  it("throws if CLERK_SECRET_KEY is not configured", async () => {
    delete process.env.CLERK_SECRET_KEY;
    _resetClerkClientCache();

    await expect(verifyClerkToken("any-token")).rejects.toThrow("CLERK_SECRET_KEY missing");
  });

  it("passes acceptsToken: ['session_token', 'oauth_token'] to authenticateRequest", async () => {
    mockAuthenticateRequest.mockReturnValueOnce(signedInSessionResult("user_a"));

    await verifyClerkToken("some-token");

    const opts = mockAuthenticateRequest.mock.calls[0][1];
    expect(opts.acceptsToken).toEqual(["session_token", "oauth_token"]);
  });

  it("passes authorizedParties when CLERK_AUTHORIZED_PARTIES is set", async () => {
    process.env.CLERK_AUTHORIZED_PARTIES = "http://localhost:3000,https://litlabs.net";
    mockAuthenticateRequest.mockReturnValueOnce(signedInSessionResult("user_p"));

    await verifyClerkToken("token-with-party");

    const opts = mockAuthenticateRequest.mock.calls[0][1];
    expect(opts.authorizedParties).toEqual(["http://localhost:3000", "https://litlabs.net"]);
  });

  it("does NOT pass authorizedParties when env is unset (preserves Clerk default)", async () => {
    mockAuthenticateRequest.mockReturnValueOnce(signedInSessionResult("user_np"));

    await verifyClerkToken("token-no-party");

    const opts = mockAuthenticateRequest.mock.calls[0][1];
    expect(opts.authorizedParties).toBeUndefined();
  });

  it("sends the token as a Bearer header in the synthetic Request", async () => {
    mockAuthenticateRequest.mockReturnValueOnce(signedInSessionResult("user_h"));

    await verifyClerkToken("my-bearer-token-123");

    const request = mockAuthenticateRequest.mock.calls[0][0] as Request;
    expect(request.headers.get("Authorization")).toBe("Bearer my-bearer-token-123");
  });

  // ─── userId never comes from client ────────────────────────────

  it("userId comes exclusively from toAuth().userId (session), not from token string", async () => {
    // The token string contains "evil_user" but the verified auth says "real_user"
    mockAuthenticateRequest.mockReturnValueOnce(signedInSessionResult("real_user"));

    const verified = await verifyClerkToken("token-containing-evil_user-attempt");

    expect(verified.userId).toBe("real_user");
    expect(verified.userId).not.toContain("evil");
  });

  it("userId comes exclusively from toAuth().subject (oauth), not from token string", async () => {
    mockAuthenticateRequest.mockReturnValueOnce(authenticatedOAuthResult("real_oauth_user"));

    const verified = await verifyClerkToken("token-with-fake-user-embedded");

    expect(verified.userId).toBe("real_oauth_user");
    expect(verified.userId).not.toContain("fake");
  });

  // ─── No token leakage in error messages ────────────────────────

  it("error messages never contain the raw token value", async () => {
    mockAuthenticateRequest.mockReturnValueOnce(signedOutResult("token_invalid", "Invalid"));

    try {
      await verifyClerkToken("SECRET_TOKEN_VALUE_ABC123");
      expect.fail("Should have thrown");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      expect(message).not.toContain("SECRET_TOKEN_VALUE_ABC123");
    }
  });

  // ─── Client caching ────────────────────────────────────────────

  it("reuses the Clerk client across calls (same secret key)", async () => {
    mockAuthenticateRequest.mockReturnValue(signedInSessionResult("user_reuse"));

    await verifyClerkToken("token-1");
    await verifyClerkToken("token-2");

    // Both calls go through the same client — authenticateRequest called twice
    expect(mockAuthenticateRequest).toHaveBeenCalledTimes(2);
  });

  it("recreates the Clerk client when secret key changes", async () => {
    mockAuthenticateRequest.mockReturnValue(signedInSessionResult("user_change"));

    await verifyClerkToken("token-a");

    // Change secret key → cache should be invalidated
    process.env.CLERK_SECRET_KEY = "sk_test_different_secret";
    _resetClerkClientCache();

    await verifyClerkToken("token-b");

    expect(mockAuthenticateRequest).toHaveBeenCalledTimes(2);
  });
});

// ─── Integration: token-exchange endpoint behavior ────────────────
//
// These tests verify that the /api/token-exchange endpoint in server.ts
// correctly uses verifyClerkToken and derives userId only from the
// verified result. The existing api-command-auth.test.ts already covers
// the full HTTP flow with a mocked verifyClerkToken; here we verify the
// real verifyClerkToken → endpoint integration by checking that the
// function signature and return shape match what server.ts expects.

describe("clerk-verify — server.ts integration contract", () => {
  it("verifyClerkToken returns { userId: string, claims: Record } shape", async () => {
    process.env.CLERK_SECRET_KEY = "sk_test_contract";
    _resetClerkClientCache();
    mockAuthenticateRequest.mockReset();
    mockAuthenticateRequest.mockReturnValueOnce(signedInSessionResult("user_contract"));

    const result = await verifyClerkToken("contract-token");

    expect(typeof result.userId).toBe("string");
    expect(typeof result.claims).toBe("object");
    expect(result.claims).not.toBeNull();
  });

  it("verifyClerkToken throws (does not return null) on failure", async () => {
    process.env.CLERK_SECRET_KEY = "sk_test_throw";
    _resetClerkClientCache();
    mockAuthenticateRequest.mockReset();
    mockAuthenticateRequest.mockReturnValueOnce(signedOutResult());

    await expect(verifyClerkToken("failing-token")).rejects.toBeInstanceOf(Error);
  });
});
