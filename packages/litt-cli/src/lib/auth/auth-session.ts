/**
 * AuthSession — the singleton auth context for the CLI process.
 *
 * This is the ONE place the rest of the CLI reads auth state from.
 * It wraps ClerkCliAuth and provides:
 *   - getAccessToken()  — for remote.ts / runtime-client.ts token exchange
 *   - getAuthState()    — for the header UX (signed out / email / error)
 *   - login() / logout() / whoami() — for the litt login/logout/whoami commands
 *
 * LITT_CLERK_TOKEN (the temporary acceptance-test mechanism) is still
 * honored as a fallback for automated tests, but the primary path is
 * the OAuth credential store. This keeps existing acceptance tests
 * working while the real `litt login` flow becomes the user-facing path.
 */

import { ClerkCliAuth } from "./clerk-auth.js";
import { resolveAuthConfig, hasAuthConfig } from "./auth-config.js";
import type { AuthState, CredentialStore, LoginResult, UserInfo } from "./types.js";
import { AuthError } from "./types.js";

/** The signed-out state (used when no credentials exist). */
const SIGNED_OUT: AuthState = {
  signedIn: false,
  user: null,
  email: null,
  error: null,
};

let _instance: AuthSession | null = null;

/**
 * AuthSession — process-wide singleton.
 *
 * Use getAuthSession() to get the shared instance. The session is
 * created once and reused across all commands in the process.
 */
export class AuthSession {
  private _auth: ClerkCliAuth | null = null;
  private _cachedState: AuthState | null = null;
  private _stateResolveTime = 0;
  private readonly _stateCacheMs = 5_000; // cache state for 5s
  private readonly _storageOverride?: CredentialStore;

  constructor(options?: { storage?: CredentialStore }) {
    this._storageOverride = options?.storage;
  }

  /** Get the ClerkCliAuth instance (lazy — created on first use). */
  get auth(): ClerkCliAuth {
    if (!this._auth) {
      const { issuer, clientId } = resolveAuthConfig();
      this._auth = new ClerkCliAuth({
        issuer,
        clientId,
        ...(this._storageOverride ? { storage: this._storageOverride } : {}),
      });
    }
    return this._auth;
  }

  /**
   * Get a valid access token for the token-exchange flow.
   *
   * Priority:
   *   1. LITT_CLERK_TOKEN env var (temporary — automated tests only)
   *   2. OAuth credential store (the real `litt login` path)
   *
   * Returns null if not authenticated.
   * Throws AuthError if refresh fails.
   */
  async getAccessToken(): Promise<string | null> {
    // ─── Temporary: LITT_CLERK_TOKEN for automated acceptance tests ──
    // This is kept ONLY so existing automated tests don't break.
    // The real user path is the OAuth credential store below.
    const envToken = process.env.LITT_CLERK_TOKEN;
    if (envToken) return envToken;

    // ─── Real path: OAuth credential store ────────────────────────
    if (!hasAuthConfig()) return null;

    try {
      return await this.auth.getAccessToken();
    } catch (error) {
      // Refresh failed (expired/revoked refresh token) — return null
      // so the caller can show the sign-in-required screen.
      if (error instanceof AuthError && (error.code === "token_refresh" || error.code === "token_exchange")) {
        return null;
      }
      throw error;
    }
  }

  /**
   * Get the current auth state for UI display.
   *
   * Cached for 5s to avoid hitting the credential store on every render.
   */
  async getAuthState(): Promise<AuthState> {
    // Check cache
    if (this._cachedState && Date.now() - this._stateResolveTime < this._stateCacheMs) {
      return this._cachedState;
    }

    // LITT_CLERK_TOKEN path — considered signed in but we don't know the email
    if (process.env.LITT_CLERK_TOKEN) {
      const state: AuthState = {
        signedIn: true,
        user: null,
        email: null,
        error: null,
      };
      this._cachedState = state;
      this._stateResolveTime = Date.now();
      return state;
    }

    if (!hasAuthConfig()) {
      // Should not happen with safe defaults, but guard against an
      // explicit empty-string override (deliberate misconfiguration).
      const state: AuthState = {
        ...SIGNED_OUT,
        error: "Auth not configured (LITT_CLERK_OAUTH_CLIENT_ID set to empty)",
      };
      this._cachedState = state;
      this._stateResolveTime = Date.now();
      return state;
    }

    try {
      const user = await this.auth.whoami();
      if (user) {
        const state: AuthState = {
          signedIn: true,
          user,
          email: user.email ?? user.name ?? null,
          error: null,
        };
        this._cachedState = state;
        this._stateResolveTime = Date.now();
        return state;
      }
    } catch (error) {
      // whoami failed — could be expired refresh token or network error
      const message = error instanceof Error ? error.message : String(error);
      const state: AuthState = {
        ...SIGNED_OUT,
        error: message,
      };
      this._cachedState = state;
      this._stateResolveTime = Date.now();
      return state;
    }

    this._cachedState = SIGNED_OUT;
    this._stateResolveTime = Date.now();
    return SIGNED_OUT;
  }

  /** Login via OAuth PKCE flow. */
  async login(options?: { prompt?: string }): Promise<LoginResult> {
    const result = await this.auth.login(options);
    // Invalidate cache
    this._cachedState = null;
    return result;
  }

  /** Logout — clear credentials + revoke refresh token. */
  async logout(): Promise<void> {
    if (hasAuthConfig()) {
      await this.auth.logout();
    }
    // Invalidate cache
    this._cachedState = null;
  }

  /** Get user info (for `litt whoami`). */
  async whoami(): Promise<UserInfo | null> {
    if (!hasAuthConfig()) return null;
    return this.auth.whoami();
  }

  /** Check if signed in (has stored credentials or LITT_CLERK_TOKEN). */
  async isSignedIn(): Promise<boolean> {
    if (process.env.LITT_CLERK_TOKEN) return true;
    if (!hasAuthConfig()) return false;
    return this.auth.isSignedIn();
  }

  /** Invalidate the cached auth state (forces re-read on next getAuthState). */
  invalidateCache(): void {
    this._cachedState = null;
  }
}

/** Get the shared AuthSession instance (process-wide singleton). */
export function getAuthSession(options?: { storage?: CredentialStore }): AuthSession {
  if (!_instance) {
    _instance = new AuthSession(options);
  }
  return _instance;
}

/** Reset the singleton (for testing). */
export function resetAuthSession(): void {
  _instance = null;
}
