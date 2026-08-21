/**
 * ClerkCliAuth — the main auth class for LiTT CLI.
 *
 * Implements the OAuth 2.0 Authorization Code + PKCE flow:
 *   1. Generate PKCE verifier/challenge + CSRF state
 *   2. Start one-shot HTTP listener on 127.0.0.1:{ephemeralPort}
 *   3. Open browser to Clerk's /oauth/authorize
 *   4. User signs in → browser redirects to 127.0.0.1:{port}/callback
 *   5. Validate state, exchange code for tokens via /oauth/token
 *   6. Store tokens + user info in CredentialStore
 *
 * Token refresh:
 *   getAccessToken() auto-refreshes if the access token is within 30s
 *   of expiry and a refresh_token is available.
 *
 * Logout:
 *   Clears local credentials AND revokes the refresh_token server-side
 *   via Clerk's /oauth/revoke endpoint (best-effort).
 *
 * The CLI NEVER holds CLERK_SECRET_KEY. Token verification happens
 * server-side in terminal-server's /api/token-exchange endpoint.
 */

import { createCredentialStore } from "./credential-store.js";
import { openBrowser } from "./browser-launcher.js";
import { generateCodeChallenge, generateCodeVerifier, generateState } from "./pkce.js";
import {
  exchangeCodeForTokens,
  fetchUserInfo,
  refreshAccessToken,
  revokeToken,
} from "./token-exchange.js";
import type {
  ClerkCliAuthConfig,
  CredentialStore,
  LoginResult,
  StorageKind,
  TokenSet,
  UserInfo,
} from "./types.js";
import { AuthError } from "./types.js";

const DEFAULT_SCOPES = ["profile", "email", "offline_access"];
const REFRESH_SKEW_MS = 30_000; // refresh if token expires within 30s

function normalizeIssuer(issuer: string): string {
  const normalized = issuer.trim().replace(/\/+$/, "");
  try {
    const url = new URL(normalized);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new Error("issuer must use http or https");
    }
    return normalized;
  } catch (error) {
    throw new AuthError(
      "config",
      `issuer must be a valid URL: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function storageError(operation: string, error: unknown): AuthError {
  if (error instanceof AuthError) return error;
  const detail = error instanceof Error ? error.message : String(error);
  return new AuthError("storage", `Failed to ${operation}: ${detail}`);
}

export class ClerkCliAuth {
  private readonly config: Required<Omit<ClerkCliAuthConfig, "openBrowser" | "storage">> & {
    storage: CredentialStore;
    openBrowser?: (url: string) => Promise<void>;
  };

  constructor(config: ClerkCliAuthConfig) {
    if (!config.clientId) throw new AuthError("config", "clientId is required");
    if (!config.issuer) throw new AuthError("config", "issuer is required");

    const environment = config.environment ?? "default";
    const storage =
      typeof config.storage === "object" && config.storage !== null
        ? config.storage
        : createCredentialStore((config.storage as StorageKind) ?? "keychain", {
            environment,
            keychainService: config.keychainService,
          });

    this.config = {
      clientId: config.clientId,
      issuer: normalizeIssuer(config.issuer),
      scopes: config.scopes ?? DEFAULT_SCOPES,
      storage,
      keychainService: config.keychainService ?? "litt-cli-auth",
      environment,
      callbackPort: config.callbackPort ?? 0,
      timeoutMs: config.timeoutMs ?? 120_000,
      openBrowser: config.openBrowser,
    };
  }

  // ─── Login ──────────────────────────────────────────────────────

  async login(options?: { prompt?: string }): Promise<LoginResult> {
    const codeVerifier = generateCodeVerifier();
    const codeChallenge = await generateCodeChallenge(codeVerifier);
    const state = generateState();

    // Dynamic import to avoid loading http module for non-login commands
    const { startAuthServer } = await import("./auth-server.js");
    const server = await startAuthServer({
      expectedState: state,
      port: this.config.callbackPort,
      timeoutMs: this.config.timeoutMs,
    });

    try {
      const authorizeUrl = new URL(`${this.config.issuer}/oauth/authorize`);
      authorizeUrl.searchParams.set("response_type", "code");
      authorizeUrl.searchParams.set("client_id", this.config.clientId);
      authorizeUrl.searchParams.set("redirect_uri", server.redirectUri);
      authorizeUrl.searchParams.set("scope", this.config.scopes.join(" "));
      authorizeUrl.searchParams.set("state", state);
      authorizeUrl.searchParams.set("code_challenge", codeChallenge);
      authorizeUrl.searchParams.set("code_challenge_method", "S256");
      if (options?.prompt) {
        authorizeUrl.searchParams.set("prompt", options.prompt);
      }

      // Open the browser (or print URL for manual open)
      await (this.config.openBrowser ?? openBrowser)(authorizeUrl.toString());

      // Wait for the callback (browser redirect → 127.0.0.1:{port}/callback)
      const { code } = await server.waitForCallback();

      // Exchange the authorization code for tokens
      const tokens = await exchangeCodeForTokens({
        issuer: this.config.issuer,
        clientId: this.config.clientId,
        code,
        codeVerifier,
        redirectUri: server.redirectUri,
      });

      // Store tokens
      await this.setJson("tokens", tokens);

      // Fetch and store user info
      const user = await fetchUserInfo({
        issuer: this.config.issuer,
        accessToken: tokens.accessToken,
      });
      await this.setJson("user", user);

      return { tokens, user };
    } finally {
      server.close();
    }
  }

  // ─── Get access token (with auto-refresh) ───────────────────────

  /**
   * Get a valid access token. Auto-refreshes if the token is within
   * 30s of expiry and a refresh_token is available.
   *
   * Returns null if no credentials are stored.
   * Throws AuthError if refresh fails (expired/revoked refresh token).
   */
  async getAccessToken(): Promise<string | null> {
    const tokens = await this.getTokenSet();
    if (!tokens) return null;

    const expiresAt = tokens.expiresAt ?? Number.POSITIVE_INFINITY;
    if (expiresAt >= Date.now() + REFRESH_SKEW_MS) return tokens.accessToken;

    // Token is expired or about to expire — try to refresh
    if (!tokens.refreshToken) return null;

    const refreshed = await refreshAccessToken({
      issuer: this.config.issuer,
      clientId: this.config.clientId,
      refreshToken: tokens.refreshToken,
      scopes: this.config.scopes,
    });

    // Merge: keep the original refresh_token if the response didn't include one
    const nextTokens: TokenSet = {
      ...tokens,
      ...refreshed,
      refreshToken: refreshed.refreshToken ?? tokens.refreshToken,
    };
    await this.setJson("tokens", nextTokens);
    return nextTokens.accessToken;
  }

  // ─── Whoami ─────────────────────────────────────────────────────

  /**
   * Get the current user's info. Uses cached user info if available,
   * otherwise fetches from /oauth/userinfo.
   */
  async whoami(): Promise<UserInfo | null> {
    const cachedUser = await this.getJson<UserInfo>("user");
    if (cachedUser) return cachedUser;

    const accessToken = await this.getAccessToken();
    if (!accessToken) return null;

    const user = await fetchUserInfo({
      issuer: this.config.issuer,
      accessToken,
    });
    await this.setJson("user", user);
    return user;
  }

  // ─── Logout ─────────────────────────────────────────────────────

  /**
   * Log out: clear local credentials AND revoke the refresh token
   * server-side (best-effort — local credentials are cleared regardless).
   */
  async logout(): Promise<void> {
    // Best-effort server-side revocation
    const tokens = await this.getTokenSet();
    if (tokens?.refreshToken) {
      try {
        await revokeToken({
          issuer: this.config.issuer,
          clientId: this.config.clientId,
          token: tokens.refreshToken,
        });
      } catch {
        // Non-fatal — local credentials are cleared regardless.
        // The refresh token becomes useless once we stop using it.
      }
    }

    // Clear local credentials
    try {
      await Promise.all([
        this.config.storage.delete("tokens"),
        this.config.storage.delete("user"),
      ]);
    } catch (error) {
      throw storageError("clear stored credentials", error);
    }
  }

  // ─── Token set access ───────────────────────────────────────────

  async getTokenSet(): Promise<TokenSet | null> {
    return this.getJson<TokenSet>("tokens");
  }

  /** Check if the user is signed in (has stored tokens). */
  async isSignedIn(): Promise<boolean> {
    const tokens = await this.getTokenSet();
    return tokens !== null;
  }

  // ─── Internal JSON storage helpers ──────────────────────────────

  private async getJson<T>(key: string): Promise<T | null> {
    let raw: string | null;
    try {
      raw = await this.config.storage.get(key);
    } catch (error) {
      throw storageError(`read ${key}`, error);
    }
    if (!raw) return null;

    try {
      return JSON.parse(raw) as T;
    } catch {
      // Corrupt stored data — treat as absent
      return null;
    }
  }

  private async setJson(key: string, value: unknown): Promise<void> {
    try {
      await this.config.storage.set(key, JSON.stringify(value));
    } catch (error) {
      throw storageError(`write ${key}`, error);
    }
  }
}
