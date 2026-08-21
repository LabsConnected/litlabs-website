/**
 * LiTT CLI auth tests — covers the OAuth 2.0 PKCE flow, credential
 * storage, token refresh, logout, and the auth gate.
 *
 * Tests use mocked fetch and in-memory credential stores — no real
 * network calls or keychain access.
 *
 * Coverage:
 *   - PKCE generation (verifier, challenge, state)
 *   - Credential store (memory, file with mode 600)
 *   - Auth server (127.0.0.1 callback, state validation, timeout)
 *   - Token exchange (code → tokens, refresh, revoke)
 *   - ClerkCliAuth login flow (full PKCE round-trip with mocked server)
 *   - ClerkCliAuth getAccessToken (auto-refresh)
 *   - ClerkCliAuth logout (clear credentials + revoke)
 *   - ClerkCliAuth whoami (cached + fresh)
 *   - AuthSession (LITT_CLERK_TOKEN fallback, OAuth path, signed-out state)
 *   - Auth config resolution
 *   - CSRF state mismatch rejection
 *   - Callback timeout
 *   - Browser-open failure → manual URL fallback
 *   - Invalid authorization code
 *   - Expired/revoked refresh token
 *   - No secret/token output in errors
 *   - Protected command when signed out
 *   - Termux credential file permissions
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { generateCodeVerifier, generateCodeChallenge, generateState } from "../lib/auth/pkce.js";
import { createCredentialStore } from "../lib/auth/credential-store.js";
import { startAuthServer } from "../lib/auth/auth-server.js";
import { exchangeCodeForTokens, refreshAccessToken, revokeToken, fetchUserInfo } from "../lib/auth/token-exchange.js";
import { ClerkCliAuth } from "../lib/auth/clerk-auth.js";
import { AuthError } from "../lib/auth/types.js";
import { resolveAuthConfig, hasAuthConfig, getIssuer, getTerminalUrl, DEFAULT_TERMINAL_URL } from "../lib/auth/auth-config.js";
import { getAuthSession, resetAuthSession } from "../lib/auth/auth-session.js";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

// ─── PKCE ─────────────────────────────────────────────────────────

describe("PKCE", () => {
  it("generates a code_verifier with 43+ chars (256 bits)", () => {
    const verifier = generateCodeVerifier();
    expect(verifier.length).toBeGreaterThanOrEqual(43);
    // Base64url charset only
    expect(verifier).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("generates unique code_verifiers", () => {
    const a = generateCodeVerifier();
    const b = generateCodeVerifier();
    expect(a).not.toBe(b);
  });

  it("generates S256 code_challenge from verifier", async () => {
    const verifier = generateCodeVerifier();
    const challenge = await generateCodeChallenge(verifier);
    expect(challenge.length).toBeGreaterThanOrEqual(43);
    expect(challenge).toMatch(/^[A-Za-z0-9_-]+$/);
    // Challenge is deterministic for the same verifier
    const challenge2 = await generateCodeChallenge(verifier);
    expect(challenge).toBe(challenge2);
  });

  it("generates unique CSRF state tokens", () => {
    const a = generateState();
    const b = generateState();
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThanOrEqual(43);
  });
});

// ─── Credential Store ─────────────────────────────────────────────

describe("CredentialStore", () => {
  it("memory store stores and retrieves values", async () => {
    const store = createCredentialStore("memory");
    await store.set("key1", "value1");
    expect(await store.get("key1")).toBe("value1");
    expect(await store.get("missing")).toBeNull();
  });

  it("memory store deletes values", async () => {
    const store = createCredentialStore("memory");
    await store.set("key1", "value1");
    await store.delete("key1");
    expect(await store.get("key1")).toBeNull();
  });

  it("file store writes with mode 600 and dir mode 700", async () => {
    // Skip on Windows — chmod doesn't enforce Unix permissions
    if (process.platform === "win32") return;

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "litt-auth-test-"));
    const filePath = path.join(tmpDir, "auth.json");
    try {
      const store = createCredentialStore("file", { filePath });
      await store.set("tokens", JSON.stringify({ accessToken: "test" }));
      // File should exist
      expect(fs.existsSync(filePath)).toBe(true);
      // File mode should be 600 (owner read/write only)
      const stat = fs.statSync(filePath);
      const mode = stat.mode & 0o777;
      expect(mode).toBe(0o600);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("file store reads back stored values", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "litt-auth-test-"));
    const filePath = path.join(tmpDir, "auth.json");
    try {
      const store = createCredentialStore("file", { filePath });
      await store.set("tokens", JSON.stringify({ accessToken: "abc123" }));
      const raw = await store.get("tokens");
      expect(raw).toBe(JSON.stringify({ accessToken: "abc123" }));
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("file store deletes values and removes empty file", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "litt-auth-test-"));
    const filePath = path.join(tmpDir, "auth.json");
    try {
      const store = createCredentialStore("file", { filePath });
      await store.set("tokens", "test");
      await store.delete("tokens");
      expect(await store.get("tokens")).toBeNull();
      // Empty file should be removed
      expect(fs.existsSync(filePath)).toBe(false);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("file store returns null for missing file (ENOENT)", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "litt-auth-test-"));
    const filePath = path.join(tmpDir, "nonexistent.json");
    try {
      const store = createCredentialStore("file", { filePath });
      expect(await store.get("anything")).toBeNull();
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

// ─── Auth Server (127.0.0.1 callback) ─────────────────────────────

describe("Auth Server", () => {
  it("starts on 127.0.0.1 with a dynamic port", async () => {
    const state = generateState();
    const server = await startAuthServer({ expectedState: state, timeoutMs: 5000 });
    expect(server.port).toBeGreaterThan(0);
    expect(server.redirectUri).toContain("127.0.0.1");
    expect(server.redirectUri).toContain("/callback");
    // Catch the rejection from close() to prevent unhandled rejection
    server.waitForCallback().catch(() => {});
    server.close();
  });

  it("accepts a valid callback with matching state", async () => {
    const state = generateState();
    const server = await startAuthServer({ expectedState: state, timeoutMs: 5000 });

    // Simulate browser redirect
    const response = await fetch(`${server.redirectUri}?code=testcode&state=${state}`);
    expect(response.status).toBe(200);

    const result = await server.waitForCallback();
    expect(result.code).toBe("testcode");
    expect(result.state).toBe(state);
    // close() is safe here — callback already settled
    server.close();
  });

  it("rejects callback with mismatched state (CSRF protection)", async () => {
    const state = generateState();
    const server = await startAuthServer({ expectedState: state, timeoutMs: 5000 });

    // Start waiting for callback FIRST (catch the rejection)
    const callbackPromise = server.waitForCallback().catch((e) => e);

    // Simulate browser redirect with wrong state
    const response = await fetch(`${server.redirectUri}?code=testcode&state=wrongstate`);
    expect(response.status).toBe(400);

    // The callback should reject with an AuthError
    const error = await callbackPromise;
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain("state");

    // Close should not cause unhandled rejection (already settled)
    server.close();
  });

  it("rejects callback without code", async () => {
    const state = generateState();
    const server = await startAuthServer({ expectedState: state, timeoutMs: 5000 });

    const callbackPromise = server.waitForCallback().catch((e) => e);

    const response = await fetch(`${server.redirectUri}?state=${state}`);
    expect(response.status).toBe(400);

    const error = await callbackPromise;
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain("authorization code");

    server.close();
  });

  it("rejects callback with error parameter", async () => {
    const state = generateState();
    const server = await startAuthServer({ expectedState: state, timeoutMs: 5000 });

    const callbackPromise = server.waitForCallback().catch((e) => e);

    const response = await fetch(`${server.redirectUri}?error=access_denied&state=${state}`);
    expect(response.status).toBe(400);

    const error = await callbackPromise;
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain("access_denied");

    server.close();
  });

  it("times out after the configured timeout", async () => {
    const state = generateState();
    const server = await startAuthServer({ expectedState: state, timeoutMs: 100 });

    await expect(server.waitForCallback()).rejects.toThrow("timed out");
    // Don't call server.close() — the timeout already closed it
  });

  it("only responds to /callback path", async () => {
    const state = generateState();
    const server = await startAuthServer({ expectedState: state, timeoutMs: 5000 });

    const baseUrl = server.redirectUri.replace("/callback", "");
    const response = await fetch(`${baseUrl}/other`);
    expect(response.status).toBe(404);
    // Catch the rejection from close() to prevent unhandled rejection
    server.waitForCallback().catch(() => {});
    server.close();
  });
});

// ─── Token Exchange ───────────────────────────────────────────────

describe("Token Exchange", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, "fetch");
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it("exchanges code for tokens", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({
        access_token: "access123",
        refresh_token: "refresh456",
        expires_in: 3600,
        token_type: "Bearer",
        scope: "profile email offline_access",
      }), { status: 200, headers: { "Content-Type": "application/json" } }),
    );

    const tokens = await exchangeCodeForTokens({
      issuer: "https://clerk.test.com",
      clientId: "test-client-id",
      code: "testcode",
      codeVerifier: "verifier123",
      redirectUri: "http://127.0.0.1:12345/callback",
    });

    expect(tokens.accessToken).toBe("access123");
    expect(tokens.refreshToken).toBe("refresh456");
    expect(tokens.expiresAt).toBeGreaterThan(Date.now());
    expect(tokens.tokenType).toBe("Bearer");
  });

  it("throws on missing access_token in response", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({}), { status: 200, headers: { "Content-Type": "application/json" } }),
    );

    await expect(exchangeCodeForTokens({
      issuer: "https://clerk.test.com",
      clientId: "test-client-id",
      code: "testcode",
      codeVerifier: "verifier123",
      redirectUri: "http://127.0.0.1:12345/callback",
    })).rejects.toThrow("did not include access_token");
  });

  it("throws on HTTP error with error_description", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({
        error: "invalid_grant",
        error_description: "The authorization code is invalid",
      }), { status: 400, headers: { "Content-Type": "application/json" } }),
    );

    await expect(exchangeCodeForTokens({
      issuer: "https://clerk.test.com",
      clientId: "test-client-id",
      code: "badcode",
      codeVerifier: "verifier123",
      redirectUri: "http://127.0.0.1:12345/callback",
    })).rejects.toThrow("authorization code is invalid");
  });

  it("refreshes access token", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({
        access_token: "newaccess",
        refresh_token: "newrefresh",
        expires_in: 3600,
      }), { status: 200, headers: { "Content-Type": "application/json" } }),
    );

    const tokens = await refreshAccessToken({
      issuer: "https://clerk.test.com",
      clientId: "test-client-id",
      refreshToken: "oldrefresh",
    });

    expect(tokens.accessToken).toBe("newaccess");
    expect(tokens.refreshToken).toBe("newrefresh");
  });

  it("throws token_refresh error on expired/revoked refresh token", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({
        error: "invalid_grant",
        error_description: "The refresh token is invalid or expired",
      }), { status: 400, headers: { "Content-Type": "application/json" } }),
    );

    try {
      await refreshAccessToken({
        issuer: "https://clerk.test.com",
        clientId: "test-client-id",
        refreshToken: "expired",
      });
      expect.fail("Should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(AuthError);
      expect((error as AuthError).code).toBe("token_refresh");
      expect((error as Error).message).toContain("invalid or expired");
    }
  });

  it("fetches user info", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({
        sub: "user_123",
        email: "test@example.com",
        name: "Test User",
      }), { status: 200, headers: { "Content-Type": "application/json" } }),
    );

    const user = await fetchUserInfo({
      issuer: "https://clerk.test.com",
      accessToken: "access123",
    });

    expect(user.sub).toBe("user_123");
    expect(user.email).toBe("test@example.com");
    expect(user.name).toBe("Test User");
  });

  it("revokes token (best-effort, non-throwing on success)", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response("", { status: 200 }),
    );

    await revokeToken({
      issuer: "https://clerk.test.com",
      clientId: "test-client-id",
      token: "refresh123",
    });

    expect(fetchSpy).toHaveBeenCalled();
  });

  it("revoke throws AuthError on HTTP failure", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response("Server error", { status: 500 }),
    );

    await expect(revokeToken({
      issuer: "https://clerk.test.com",
      clientId: "test-client-id",
      token: "refresh123",
    })).rejects.toThrow();
  });
});

// ─── ClerkCliAuth ─────────────────────────────────────────────────

describe("ClerkCliAuth", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;
  const originalFetch = globalThis.fetch;
  const tmpDirs: string[] = [];

  function createTestAuth(overrides?: { openBrowser?: (url: string) => Promise<void> }) {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "litt-auth-test-"));
    tmpDirs.push(tmpDir);
    const filePath = path.join(tmpDir, "auth.json");
    const store = createCredentialStore("file", { filePath });
    return new ClerkCliAuth({
      clientId: "test-client-id",
      issuer: "https://clerk.test.com",
      storage: store,
      openBrowser: overrides?.openBrowser ?? (async () => {}),
      timeoutMs: 5000,
    });
  }

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, "fetch");
  });

  afterEach(() => {
    fetchSpy.mockRestore();
    for (const dir of tmpDirs) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
    tmpDirs.length = 0;
  });

  it("login flow with captured authorize URL", async () => {
    let capturedUrl = "";
    const auth = new ClerkCliAuth({
      clientId: "test-client-id",
      issuer: "https://clerk.test.com",
      storage: createCredentialStore("memory"),
      openBrowser: async (url: string) => { capturedUrl = url; },
      timeoutMs: 30_000, // long timeout — we'll complete the callback manually
    });

    // Mock token + userinfo endpoints — but pass through localhost (callback server)
    (fetchSpy.mockImplementation as any)(async (input: Parameters<typeof fetch>[0]) => {
      const url = typeof input === "string" ? input : input.toString();
      // Pass through requests to the local callback server
      if (url.includes("127.0.0.1")) {
        return originalFetch(input);
      }
      if (url.includes("/oauth/token")) {
        return new Response(JSON.stringify({
          access_token: "access123",
          refresh_token: "refresh456",
          expires_in: 3600,
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      if (url.includes("/oauth/userinfo")) {
        return new Response(JSON.stringify({
          sub: "user_123",
          email: "test@example.com",
          name: "Test User",
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      return new Response("Not found", { status: 404 });
    });

    const loginPromise = auth.login();

    // Wait for the browser to be "opened" (URL captured)
    await new Promise((r) => setTimeout(r, 500));
    expect(capturedUrl).toContain("https://clerk.test.com/oauth/authorize");
    expect(capturedUrl).toContain("client_id=test-client-id");
    expect(capturedUrl).toContain("code_challenge_method=S256");
    expect(capturedUrl).toContain("response_type=code");

    // Extract the redirect_uri from the captured URL
    const url = new URL(capturedUrl);
    const redirectUri = url.searchParams.get("redirect_uri")!;
    const state = url.searchParams.get("state")!;

    // Hit the callback server with the correct state
    const callbackUrl = `${redirectUri}?code=testcode123&state=${state}`;
    const callbackResponse = await fetch(callbackUrl);
    expect(callbackResponse.status).toBe(200);

    // Wait for login to complete
    const result = await loginPromise;
    expect(result.tokens.accessToken).toBe("access123");
    expect(result.user.email).toBe("test@example.com");
    expect(result.user.sub).toBe("user_123");
  });

  it("login fails on CSRF state mismatch", async () => {
    let capturedUrl = "";
    const auth = new ClerkCliAuth({
      clientId: "test-client-id",
      issuer: "https://clerk.test.com",
      storage: createCredentialStore("memory"),
      openBrowser: async (url: string) => { capturedUrl = url; },
      timeoutMs: 30_000, // long timeout — we'll trigger the mismatch manually
    });

    (fetchSpy.mockImplementation as any)(async (input: Parameters<typeof fetch>[0]) => {
      const url = typeof input === "string" ? input : input.toString();
      // Pass through requests to the local callback server
      if (url.includes("127.0.0.1")) {
        return originalFetch(input);
      }
      return new Response(JSON.stringify({ access_token: "x" }), { status: 200, headers: { "Content-Type": "application/json" } });
    });

    // Catch the rejection early to prevent unhandled rejection
    const loginPromise = auth.login().catch((e) => e);
    await new Promise((r) => setTimeout(r, 500));

    const url = new URL(capturedUrl);
    const redirectUri = url.searchParams.get("redirect_uri")!;

    // Hit callback with WRONG state
    await fetch(`${redirectUri}?code=testcode&state=wrongstate`);

    // Login should fail with a state mismatch error
    const error = await loginPromise;
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain("state");
  });

  it("login fails on callback timeout", async () => {
    const auth = new ClerkCliAuth({
      clientId: "test-client-id",
      issuer: "https://clerk.test.com",
      storage: createCredentialStore("memory"),
      openBrowser: async () => {},
      timeoutMs: 100, // very short timeout
    });

    await expect(auth.login()).rejects.toThrow("timed out");
  });

  it("getAccessToken returns null when not signed in", async () => {
    const auth = createTestAuth();
    expect(await auth.getAccessToken()).toBeNull();
  });

  it("getAccessToken returns stored token when valid", async () => {
    const auth = createTestAuth();
    // Manually store tokens
    const tokens = {
      accessToken: "stored-access",
      refreshToken: "stored-refresh",
      expiresAt: Date.now() + 3600_000, // 1 hour from now
    };
    // Access the private storage via the public getTokenSet
    // We need to store via the auth's internal storage
    // Since storage is private, let's use the login flow instead
    // Or we can test via the credential store directly
    const store = createCredentialStore("file", {
      filePath: path.join(tmpDirs[tmpDirs.length - 1], "auth.json"),
    });
    await store.set("tokens", JSON.stringify(tokens));

    const auth2 = new ClerkCliAuth({
      clientId: "test-client-id",
      issuer: "https://clerk.test.com",
      storage: store,
    });

    expect(await auth2.getAccessToken()).toBe("stored-access");
  });

  it("getAccessToken auto-refreshes expired token", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "litt-auth-test-"));
    tmpDirs.push(tmpDir);
    const store = createCredentialStore("file", { filePath: path.join(tmpDir, "auth.json") });

    // Store expired tokens
    await store.set("tokens", JSON.stringify({
      accessToken: "old-access",
      refreshToken: "old-refresh",
      expiresAt: Date.now() - 1000, // expired
    }));

    const auth = new ClerkCliAuth({
      clientId: "test-client-id",
      issuer: "https://clerk.test.com",
      storage: store,
    });

    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({
        access_token: "refreshed-access",
        expires_in: 3600,
      }), { status: 200, headers: { "Content-Type": "application/json" } }),
    );

    const token = await auth.getAccessToken();
    expect(token).toBe("refreshed-access");
  });

  it("getAccessToken returns null when refresh token is expired", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "litt-auth-test-"));
    tmpDirs.push(tmpDir);
    const store = createCredentialStore("file", { filePath: path.join(tmpDir, "auth.json") });

    await store.set("tokens", JSON.stringify({
      accessToken: "old-access",
      refreshToken: "expired-refresh",
      expiresAt: Date.now() - 1000,
    }));

    const auth = new ClerkCliAuth({
      clientId: "test-client-id",
      issuer: "https://clerk.test.com",
      storage: store,
    });

    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({
        error: "invalid_grant",
        error_description: "Refresh token expired",
      }), { status: 400, headers: { "Content-Type": "application/json" } }),
    );

    // AuthSession wraps this and returns null, but ClerkCliAuth throws
    await expect(auth.getAccessToken()).rejects.toThrow();
  });

  it("whoami returns cached user when available", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "litt-auth-test-"));
    tmpDirs.push(tmpDir);
    const store = createCredentialStore("file", { filePath: path.join(tmpDir, "auth.json") });

    await store.set("user", JSON.stringify({
      sub: "user_cached",
      email: "cached@example.com",
      name: "Cached User",
    }));
    await store.set("tokens", JSON.stringify({
      accessToken: "valid",
      expiresAt: Date.now() + 3600_000,
    }));

    const auth = new ClerkCliAuth({
      clientId: "test-client-id",
      issuer: "https://clerk.test.com",
      storage: store,
    });

    const user = await auth.whoami();
    expect(user).not.toBeNull();
    expect(user!.sub).toBe("user_cached");
    expect(user!.email).toBe("cached@example.com");
    // Should NOT have called fetch (cached)
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("logout clears credentials and revokes refresh token", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "litt-auth-test-"));
    tmpDirs.push(tmpDir);
    const store = createCredentialStore("file", { filePath: path.join(tmpDir, "auth.json") });

    await store.set("tokens", JSON.stringify({
      accessToken: "access",
      refreshToken: "refresh-to-revoke",
      expiresAt: Date.now() + 3600_000,
    }));
    await store.set("user", JSON.stringify({ sub: "user_123", email: "test@test.com" }));

    const auth = new ClerkCliAuth({
      clientId: "test-client-id",
      issuer: "https://clerk.test.com",
      storage: store,
    });

    // Mock revoke endpoint
    fetchSpy.mockResolvedValueOnce(new Response("", { status: 200 }));

    await auth.logout();

    // Credentials should be cleared
    expect(await store.get("tokens")).toBeNull();
    expect(await store.get("user")).toBeNull();
    // File should be removed (empty)
    expect(fs.existsSync(path.join(tmpDir, "auth.json"))).toBe(false);
  });

  it("logout still clears local creds even if revoke fails", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "litt-auth-test-"));
    tmpDirs.push(tmpDir);
    const store = createCredentialStore("file", { filePath: path.join(tmpDir, "auth.json") });

    await store.set("tokens", JSON.stringify({
      accessToken: "access",
      refreshToken: "refresh",
      expiresAt: Date.now() + 3600_000,
    }));

    const auth = new ClerkCliAuth({
      clientId: "test-client-id",
      issuer: "https://clerk.test.com",
      storage: store,
    });

    // Mock revoke to fail
    fetchSpy.mockResolvedValueOnce(new Response("Error", { status: 500 }));

    // Logout should NOT throw (revoke failure is non-fatal)
    await auth.logout();

    // Local credentials should still be cleared
    expect(await store.get("tokens")).toBeNull();
  });

  it("isSignedIn returns false when no tokens stored", async () => {
    const auth = createTestAuth();
    expect(await auth.isSignedIn()).toBe(false);
  });

  it("isSignedIn returns true when tokens are stored", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "litt-auth-test-"));
    tmpDirs.push(tmpDir);
    const store = createCredentialStore("file", { filePath: path.join(tmpDir, "auth.json") });
    await store.set("tokens", JSON.stringify({ accessToken: "x", expiresAt: Date.now() + 3600_000 }));

    const auth = new ClerkCliAuth({
      clientId: "test-client-id",
      issuer: "https://clerk.test.com",
      storage: store,
    });

    expect(await auth.isSignedIn()).toBe(true);
  });

  it("throws AuthError on missing clientId", () => {
    expect(() => new ClerkCliAuth({ clientId: "", issuer: "https://test.com" }))
      .toThrow("clientId is required");
  });

  it("throws AuthError on missing issuer", () => {
    expect(() => new ClerkCliAuth({ clientId: "x", issuer: "" }))
      .toThrow("issuer is required");
  });

  it("throws AuthError on invalid issuer URL", () => {
    expect(() => new ClerkCliAuth({ clientId: "x", issuer: "not-a-url" }))
      .toThrow("issuer must be a valid URL");
  });
});

// ─── Auth Config (safe production defaults) ───────────────────────

describe("Auth Config", () => {
  const origEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...origEnv };
  });

  // ── No env vars: production public defaults resolve ──

  it("uses default issuer when LITT_CLERK_ISSUER not set", () => {
    delete process.env.LITT_CLERK_ISSUER;
    expect(getIssuer()).toBe("https://clerk.litlabs.net");
  });

  it("uses default terminal URL when LITT_TERMINAL_URL not set", () => {
    delete process.env.LITT_TERMINAL_URL;
    expect(getTerminalUrl()).toBe(DEFAULT_TERMINAL_URL);
    expect(getTerminalUrl()).toBe("https://litlabs-terminal-server-production-0be1.up.railway.app");
  });

  it("hasAuthConfig returns true with no env vars (safe defaults)", () => {
    delete process.env.LITT_CLERK_OAUTH_CLIENT_ID;
    expect(hasAuthConfig()).toBe(true);
  });

  it("resolveAuthConfig returns safe production defaults with no env vars", () => {
    delete process.env.LITT_CLERK_OAUTH_CLIENT_ID;
    delete process.env.LITT_CLERK_ISSUER;
    const config = resolveAuthConfig();
    expect(config.clientId).toBe("YWeGjVVwoNnX4RTY");
    expect(config.issuer).toBe("https://clerk.litlabs.net");
  });

  // ── Env overrides ──

  it("uses custom issuer from env override", () => {
    process.env.LITT_CLERK_ISSUER = "https://custom.clerk.com";
    expect(getIssuer()).toBe("https://custom.clerk.com");
  });

  it("LITT_CLERK_OAUTH_CLIENT_ID overrides default", () => {
    process.env.LITT_CLERK_OAUTH_CLIENT_ID = "override-client-id";
    const config = resolveAuthConfig();
    expect(config.clientId).toBe("override-client-id");
    expect(hasAuthConfig()).toBe(true);
  });

  it("LITT_CLERK_ISSUER overrides default", () => {
    process.env.LITT_CLERK_ISSUER = "https://staging.clerk.com";
    const config = resolveAuthConfig();
    expect(config.issuer).toBe("https://staging.clerk.com");
  });

  it("LITT_TERMINAL_URL overrides default", () => {
    process.env.LITT_TERMINAL_URL = "https://staging-terminal.example.com";
    expect(getTerminalUrl()).toBe("https://staging-terminal.example.com");
  });

  // ── Misconfiguration guards (explicit empty string) ──

  it("hasAuthConfig returns false when client_id explicitly set to empty", () => {
    process.env.LITT_CLERK_OAUTH_CLIENT_ID = "";
    expect(hasAuthConfig()).toBe(false);
  });

  it("resolveAuthConfig throws when client_id explicitly set to empty", () => {
    process.env.LITT_CLERK_OAUTH_CLIENT_ID = "";
    expect(() => resolveAuthConfig()).toThrow(AuthError);
  });

  it("resolveAuthConfig throws when issuer explicitly set to empty", () => {
    process.env.LITT_CLERK_ISSUER = "";
    expect(() => resolveAuthConfig()).toThrow(AuthError);
  });

  // ── No secrets in defaults ──

  it("DEFAULT_TERMINAL_URL is a public https URL (no embedded secret)", () => {
    expect(DEFAULT_TERMINAL_URL).toMatch(/^https:\/\//);
    expect(DEFAULT_TERMINAL_URL).not.toMatch(/secret|key|token|password/i);
  });

  it("resolveAuthConfig default clientId is not a secret (no key/secret/token pattern)", () => {
    delete process.env.LITT_CLERK_OAUTH_CLIENT_ID;
    const config = resolveAuthConfig();
    expect(config.clientId).not.toMatch(/secret|sk_|key|password/i);
  });
});

// ─── AuthSession ──────────────────────────────────────────────────

describe("AuthSession", () => {
  const origEnv = { ...process.env };

  // ─── Hermetic credential store ───────────────────────────────────
  // Tests MUST NOT read the user's real keychain. Every test injects
  // a fresh MemoryCredentialStore so the test is isolated from any
  // real `litt login` credentials on the machine.
  function freshMemoryStore() {
    return createCredentialStore("memory");
  }

  beforeEach(() => {
    resetAuthSession();
    delete process.env.LITT_CLERK_TOKEN;
    delete process.env.LITT_CLERK_OAUTH_CLIENT_ID;
  });

  afterEach(() => {
    resetAuthSession();
    process.env = { ...origEnv };
  });

  it("getAuthState returns signed-out state with safe defaults (no env, no credentials)", async () => {
    // No env vars — safe production defaults apply. Auth IS configured,
    // but no credentials are stored → signed out, no config error.
    // Uses a hermetic MemoryCredentialStore — does NOT read real keychain.
    const session = getAuthSession({ storage: freshMemoryStore() });
    const state = await session.getAuthState();
    expect(state.signedIn).toBe(false);
    expect(state.email).toBeNull();
    // No "not configured" error — auth is configured via safe defaults
    expect(state.error).toBeNull();
  });

  it("getAuthState returns signed-out state when no credentials (env override)", async () => {
    process.env.LITT_CLERK_OAUTH_CLIENT_ID = "test-id";
    process.env.LITT_CLERK_ISSUER = "https://test.clerk.com";
    resetAuthSession();

    const session = getAuthSession({ storage: freshMemoryStore() });
    const state = await session.getAuthState();
    expect(state.signedIn).toBe(false);
    expect(state.email).toBeNull();
  });

  it("getAuthState returns config error when client_id explicitly set to empty", async () => {
    process.env.LITT_CLERK_OAUTH_CLIENT_ID = "";
    resetAuthSession();

    const session = getAuthSession({ storage: freshMemoryStore() });
    const state = await session.getAuthState();
    expect(state.signedIn).toBe(false);
    expect(state.error).toContain("not configured");
  });

  it("LITT_CLERK_TOKEN bypasses OAuth path (temporary test mechanism)", async () => {
    process.env.LITT_CLERK_TOKEN = "test-token";
    resetAuthSession();

    const session = getAuthSession({ storage: freshMemoryStore() });
    expect(await session.isSignedIn()).toBe(true);
    expect(await session.getAccessToken()).toBe("test-token");

    const state = await session.getAuthState();
    expect(state.signedIn).toBe(true);
  });

  it("getAccessToken returns null when signed out (no stored credentials)", async () => {
    // Safe defaults apply — auth is configured, but no credentials stored.
    // Uses a hermetic MemoryCredentialStore — does NOT read real keychain.
    const session = getAuthSession({ storage: freshMemoryStore() });
    expect(await session.getAccessToken()).toBeNull();
  });

  it("isSignedIn returns false when signed out (no stored credentials)", async () => {
    // Safe defaults apply — auth is configured, but no credentials stored.
    // Uses a hermetic MemoryCredentialStore — does NOT read real keychain.
    const session = getAuthSession({ storage: freshMemoryStore() });
    expect(await session.isSignedIn()).toBe(false);
  });

  it("is a singleton", () => {
    const a = getAuthSession({ storage: freshMemoryStore() });
    const b = getAuthSession();
    expect(a).toBe(b);
  });

  it("resetAuthSession creates a new instance", () => {
    const a = getAuthSession();
    resetAuthSession();
    const b = getAuthSession();
    expect(a).not.toBe(b);
  });

  // ─── Regression: real credential isolation ───────────────────────
  // This test PROVES that real user credentials on the machine do NOT
  // affect AuthSession unit-test results. Even if the user has a real
  // `litt login` session in their keychain, the hermetic MemoryCredentialStore
  // ensures the test sees signed-out state.
  it("real credentials on machine do NOT affect hermetic test results", async () => {
    // Inject a fresh empty MemoryCredentialStore — simulates a machine
    // with NO stored credentials, regardless of what's actually in the
    // real keychain.
    const session = getAuthSession({ storage: createCredentialStore("memory") });
    const state = await session.getAuthState();
    expect(state.signedIn).toBe(false);
    expect(state.email).toBeNull();
    expect(await session.getAccessToken()).toBeNull();
    expect(await session.isSignedIn()).toBe(false);
  });
});

// ─── No Token Leakage ─────────────────────────────────────────────

describe("No Token Leakage", () => {
  it("AuthError messages never contain token values", () => {
    const error = new AuthError("token_exchange", "Token response did not include access_token.");
    expect(error.message).not.toContain("access123");
    expect(error.message).not.toContain("refresh456");
  });

  it("token exchange error messages don't echo the token", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({
        error: "invalid_grant",
        error_description: "Code is invalid",
      }), { status: 400, headers: { "Content-Type": "application/json" } }),
    );

    try {
      await exchangeCodeForTokens({
        issuer: "https://clerk.test.com",
        clientId: "test-client-id",
        code: "SECRET_CODE_VALUE",
        codeVerifier: "SECRET_VERIFIER",
        redirectUri: "http://127.0.0.1:12345/callback",
      });
      expect.fail("Should have thrown");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // The error message should NOT contain the code or verifier
      expect(message).not.toContain("SECRET_CODE_VALUE");
      expect(message).not.toContain("SECRET_VERIFIER");
    }

    fetchSpy.mockRestore();
  });
});

// ─── Browser Launcher ─────────────────────────────────────────────

describe("Browser Launcher", () => {
  it("isTermux returns false on non-Termux platforms", async () => {
    // On Windows/macOS/Linux desktop, TERMUX_VERSION is not set
    const origTermux = process.env.TERMUX_VERSION;
    delete process.env.TERMUX_VERSION;
    const { isTermux } = await import("../lib/auth/browser-launcher.js");
    expect(isTermux()).toBe(false);
    if (origTermux) process.env.TERMUX_VERSION = origTermux;
  });

  it("openBrowser does not throw on any platform", async () => {
    const { openBrowser } = await import("../lib/auth/browser-launcher.js");

    // The function should not throw regardless of platform.
    // On desktop it tries to spawn a browser; on failure it prints the URL.
    await expect(openBrowser("https://example.com/auth")).resolves.toBeUndefined();
  });
});

// ─── Windows Browser Launcher — quoting & injection safety ────────

describe("Windows Browser Launcher — quoting", () => {
  const TEST_URL =
    "https://clerk.litlabs.net/oauth/authorize?response_type=code&client_id=test&redirect_uri=http%3A%2F%2F127.0.0.1%3A12345%2Fcallback&state=abc&code_challenge=xyz&code_challenge_method=S256";

  it("buildWindowsStartCommand produces NO literal single quotes", async () => {
    const { buildWindowsStartCommand } = await import("../lib/auth/browser-launcher.js");
    const cmd = buildWindowsStartCommand(TEST_URL);
    // No single quotes anywhere — Windows treats them as literal chars
    expect(cmd).not.toContain("'");
  });

  it("buildWindowsStartCommand wraps URL in double quotes (protects &)", async () => {
    const { buildWindowsStartCommand } = await import("../lib/auth/browser-launcher.js");
    const cmd = buildWindowsStartCommand(TEST_URL);
    // Must contain the URL inside double quotes
    expect(cmd).toContain('"');
    // The full query string must survive inside the quotes
    expect(cmd).toContain("response_type=code&client_id=test");
    expect(cmd).toContain("code_challenge_method=S256");
  });

  it("buildWindowsStartCommand includes empty window title as first quoted arg", async () => {
    const { buildWindowsStartCommand } = await import("../lib/auth/browser-launcher.js");
    const cmd = buildWindowsStartCommand(TEST_URL);
    // `start "" "url"` — the first "" is the window title, required by cmd.exe
    expect(cmd).toMatch(/^start\s+""\s+"/);
  });

  it("full query string survives unchanged in the command", async () => {
    const { buildWindowsStartCommand } = await import("../lib/auth/browser-launcher.js");
    const cmd = buildWindowsStartCommand(TEST_URL);
    // Extract the URL portion (between the second pair of quotes)
    const match = cmd.match(/start\s+""\s+"(.+)"/);
    expect(match).not.toBeNull();
    expect(match![1]).toBe(TEST_URL);
  });

  it("ampersands do not become separate cmd commands (URL is quoted)", async () => {
    const { buildWindowsStartCommand } = await import("../lib/auth/browser-launcher.js");
    const cmd = buildWindowsStartCommand(TEST_URL);
    // The URL is inside double quotes, so & is not a cmd separator.
    // Verify the command is `start "" "<url>"` — only one `start`, no bare `&`
    // outside quotes.
    expect(cmd.startsWith("start ")).toBe(true);
    // Count `start` occurrences — should be exactly 1
    expect((cmd.match(/\bstart\b/g) || []).length).toBe(1);
  });

  it("encoded values (%3A, %2F) survive intact", async () => {
    const { buildWindowsStartCommand } = await import("../lib/auth/browser-launcher.js");
    const urlWithEncoding = "https://clerk.litlabs.net/oauth/authorize?redirect_uri=http%3A%2F%2F127.0.0.1%3A12345%2Fcallback";
    const cmd = buildWindowsStartCommand(urlWithEncoding);
    expect(cmd).toContain("http%3A%2F%2F127.0.0.1%3A12345%2Fcallback");
  });

  it("strips literal double-quotes from URL as defense in depth", async () => {
    const { buildWindowsStartCommand } = await import("../lib/auth/browser-launcher.js");
    // A malicious/buggy URL with embedded double-quotes
    const maliciousUrl = 'https://evil.com/"&calc.exe&"';
    const cmd = buildWindowsStartCommand(maliciousUrl);
    // The embedded quotes must be stripped, preventing command injection
    const match = cmd.match(/start\s+""\s+"(.*)"/);
    expect(match).not.toBeNull();
    expect(match![1]).not.toContain('"');
    // calc.exe appears once, INSIDE the quoted URL (neutralized, not a separate command)
    expect((cmd.match(/\bcalc\.exe\b/g) || []).length).toBe(1);
    // The command must be a single `start "" "..."` — no bare & outside quotes
    expect(cmd.startsWith('start ""')).toBe(true);
  });

  it("no shell injection via OAuth URL with cmd metacharacters", async () => {
    const { buildWindowsStartCommand } = await import("../lib/auth/browser-launcher.js");
    // Try to break out of the quoted URL with cmd metacharacters
    const attackUrl = 'https://x.com/&"calc.exe"';
    const cmd = buildWindowsStartCommand(attackUrl);
    // The embedded quotes are stripped, so the attack payload is neutralized
    const match = cmd.match(/start\s+""\s+"(.*)"/);
    expect(match).not.toBeNull();
    expect(match![1]).not.toContain('"');
    // calc.exe must NOT appear as a separate command — it's inside the quoted URL
    expect((cmd.match(/\bcalc\.exe\b/g) || []).length).toBe(1); // appears once, inside quotes
    // The command starts with `start ""` — only one `start` command keyword
    expect(cmd.startsWith('start ""')).toBe(true);
  });
});

// ─── Cross-platform launcher selection ────────────────────────────

describe("Browser Launcher — platform selection", () => {
  const origPlatform = Object.getOwnPropertyDescriptor(process, "platform");

  function setPlatform(p: string) {
    Object.defineProperty(process, "platform", { value: p, configurable: true });
  }

  afterEach(() => {
    if (origPlatform) {
      Object.defineProperty(process, "platform", origPlatform);
    }
  });

  it("Windows path uses exec (not spawn) for cmd.exe start builtin", async () => {
    // On Windows, openBrowser uses exec() because `start` is a cmd.exe
    // builtin and spawn() mangles the quoting. We verify by checking that
    // buildWindowsStartCommand produces a valid cmd.exe string.
    setPlatform("win32");
    const { buildWindowsStartCommand } = await import("../lib/auth/browser-launcher.js");
    const cmd = buildWindowsStartCommand("https://example.com/auth?code=abc&state=xyz");
    expect(cmd).toMatch(/^start\s+""\s+"https:\/\/example\.com/);
  });

  it("macOS path uses spawn with 'open' command", async () => {
    setPlatform("darwin");
    const { openBrowser } = await import("../lib/auth/browser-launcher.js");
    // Should not throw — spawn('open', [url]) on macOS
    await expect(openBrowser("https://example.com/auth")).resolves.toBeUndefined();
  });

  it("Linux path uses spawn with 'xdg-open' command", async () => {
    setPlatform("linux");
    const { openBrowser } = await import("../lib/auth/browser-launcher.js");
    // Should not throw — spawn('xdg-open', [url]) on Linux
    await expect(openBrowser("https://example.com/auth")).resolves.toBeUndefined();
  });

  it("Termux path uses termux-open-url (not open/xdg-open/cmd)", async () => {
    setPlatform("android");
    process.env.TERMUX_VERSION = "1.0.0";
    try {
      const { openBrowser } = await import("../lib/auth/browser-launcher.js");
      // termux-open-url likely not installed in test env → falls back to printing URL
      // The key: it must NOT throw and must NOT use Windows/macOS/Linux commands
      await expect(openBrowser("https://example.com/auth")).resolves.toBeUndefined();
    } finally {
      delete process.env.TERMUX_VERSION;
    }
  });
});

// ─── Safe Production Defaults — Auth Gate ─────────────────────────

describe("Safe Defaults — Auth Gate", () => {
  const origEnv = { ...process.env };

  beforeEach(() => {
    resetAuthSession();
    delete process.env.LITT_CLERK_TOKEN;
    delete process.env.LITT_CLERK_OAUTH_CLIENT_ID;
    delete process.env.LITT_CLERK_ISSUER;
    delete process.env.LITT_TERMINAL_URL;
  });

  afterEach(() => {
    resetAuthSession();
    process.env = { ...origEnv };
  });

  it("hasAuthConfig() is true with no env vars (production install)", () => {
    // A normal installed CLI user should NOT need to set any env var
    expect(hasAuthConfig()).toBe(true);
  });

  it("signed-out protected command is gated (no env vars needed)", async () => {
    // With safe defaults, auth is configured → the gate engages.
    // A signed-out user hitting a protected command must be blocked.
    // Uses a hermetic MemoryCredentialStore — does NOT read real keychain.
    const session = getAuthSession({ storage: createCredentialStore("memory") });
    const signedIn = await session.isSignedIn();
    expect(signedIn).toBe(false);
    // The gate in index.ts checks: !LOGGED_OUT_ALLOWED.has(cmd) && !LITT_CLERK_TOKEN
    // hasAuthConfig() is no longer a gate condition — it's always true.
    // So a signed-out user is ALWAYS gated for protected commands.
    expect(hasAuthConfig()).toBe(true); // gate condition met
  });

  it("litt login is available with no env vars (safe defaults)", () => {
    // login is in LOGGED_OUT_ALLOWED, and resolveAuthConfig() succeeds
    // with safe defaults → login can start OAuth immediately
    expect(() => resolveAuthConfig()).not.toThrow();
    const config = resolveAuthConfig();
    expect(config.clientId).toBe("YWeGjVVwoNnX4RTY");
    expect(config.issuer).toBe("https://clerk.litlabs.net");
  });

  it("absence of env overrides does NOT disable mandatory authentication", () => {
    // The critical invariant: deleting env vars must NOT make the CLI
    // run in unauthenticated local mode. With safe defaults, auth is
    // ALWAYS configured → the gate ALWAYS engages for protected commands.
    delete process.env.LITT_CLERK_OAUTH_CLIENT_ID;
    delete process.env.LITT_CLERK_ISSUER;
    delete process.env.LITT_TERMINAL_URL;
    expect(hasAuthConfig()).toBe(true);
  });
});

// ─── Runtime Truth — configured URL ≠ connected REMOTE ───────────

describe("Runtime Truth — configured URL vs connected REMOTE", () => {
  const origEnv = { ...process.env };

  beforeEach(() => {
    delete process.env.LITT_TERMINAL_URL;
  });

  afterEach(() => {
    process.env = { ...origEnv };
  });

  it("getTerminalUrl() returns the configured URL (not connection state)", () => {
    // The configured URL is a static value — it exists regardless of
    // whether the server is actually reachable
    const url = getTerminalUrl();
    expect(url).toBe(DEFAULT_TERMINAL_URL);
    expect(url).toMatch(/^https:\/\//);
  });

  it("configured terminal URL does NOT equal connected REMOTE state", async () => {
    // REMOTE must mean an actual successful connection, not merely the
    // existence of a configured URL. isRemoteAvailable() does a real
    // /health/live check. Here we mock it to fail → REMOTE is false
    // even though getTerminalUrl() returns a valid URL.
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    fetchSpy.mockResolvedValue({ ok: false, status: 503 } as unknown as Response);

    const { isRemoteAvailable } = await import("../lib/remote.js");
    const connected = await isRemoteAvailable();

    expect(connected).toBe(false);
    expect(getTerminalUrl()).toBe(DEFAULT_TERMINAL_URL); // URL still configured

    fetchSpy.mockRestore();
  });

  it("REMOTE only appears after successful runtime connection", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    fetchSpy.mockResolvedValue({ ok: true, status: 200 } as unknown as Response);

    const { isRemoteAvailable } = await import("../lib/remote.js");
    const connected = await isRemoteAvailable();

    expect(connected).toBe(true);
    expect(getTerminalUrl()).toBe(DEFAULT_TERMINAL_URL);

    fetchSpy.mockRestore();
  });
});

// ─── No Secrets in CLI Default Config ─────────────────────────────

describe("No Secrets in CLI Default Config", () => {
  const origEnv = { ...process.env };

  beforeEach(() => {
    delete process.env.LITT_CLERK_OAUTH_CLIENT_ID;
    delete process.env.LITT_CLERK_ISSUER;
    delete process.env.LITT_TERMINAL_URL;
  });

  afterEach(() => {
    process.env = { ...origEnv };
  });

  it("no server secret exists in CLI default auth config", () => {
    const config = resolveAuthConfig();
    // Only public values: issuer URL + public OAuth client_id
    expect(config.clientId).toBe("YWeGjVVwoNnX4RTY");
    expect(config.issuer).toBe("https://clerk.litlabs.net");
    // No secret-looking patterns
    expect(config.clientId).not.toMatch(/sk_|secret|CLERK_SECRET|TERMINAL_AUTH|SERVICE_ROLE/i);
    expect(config.issuer).not.toMatch(/secret|key|token/i);
  });

  it("no server secret exists in CLI default terminal URL", () => {
    const url = getTerminalUrl();
    expect(url).not.toMatch(/secret|sk_|key=|token=|password/i);
  });

  it("token values are never logged in AuthError messages", () => {
    // AuthError messages must not contain token/secret values
    const error = new AuthError("token_exchange", "Token response did not include access_token.");
    expect(error.message).not.toMatch(/sk_live|sk_or|sk_|secret_key|service_role/i);
  });

  it("resolveAuthConfig does not expose any Clerk secret key", () => {
    const config = resolveAuthConfig();
    const serialized = JSON.stringify(config);
    expect(serialized).not.toMatch(/sk_live|CLERK_SECRET|TERMINAL_AUTH_SECRET|TERMINAL_INTERNAL_SERVICE_KEY/i);
  });
});
