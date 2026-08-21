/**
 * LiTT CLI auth — public types and contracts.
 *
 * Adapted from Clerk's official CLI auth pattern (OAuth 2.0 Authorization
 * Code + PKCE + localhost callback). See:
 *   https://clerk.com/blog/adding-clerk-auth-to-your-cli
 *
 * The CLI NEVER holds CLERK_SECRET_KEY or TERMINAL_AUTH_SECRET. It only
 * needs the issuer URL and the public OAuth client_id. Token verification
 * happens server-side in terminal-server.
 */

/** Credential storage strategy. */
export type StorageKind = "keychain" | "file" | "memory";

/** Abstract credential storage — keychain on desktop, file on Termux. */
export interface CredentialStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
}

/** OAuth token set returned by Clerk's /oauth/token endpoint. */
export interface TokenSet {
  accessToken: string;
  refreshToken?: string;
  /** Epoch ms when the access token expires. */
  expiresAt?: number;
  scope?: string;
  tokenType?: string;
}

/** User info from Clerk's /oauth/userinfo endpoint. */
export interface UserInfo {
  /** Clerk user ID (sub claim). */
  sub: string;
  email?: string;
  name?: string;
  givenName?: string;
  familyName?: string;
  picture?: string;
  username?: string;
  [key: string]: unknown;
}

/** Result of a successful login. */
export interface LoginResult {
  tokens: TokenSet;
  user: UserInfo;
}

/** Configuration for ClerkCliAuth. */
export interface ClerkCliAuthConfig {
  /** OAuth Application client_id from Clerk Dashboard (public client, PKCE required). */
  clientId: string;
  /** Clerk Frontend API / issuer URL, e.g. https://clerk.litlabs.net (no trailing slash). */
  issuer: string;
  /** OAuth scopes. Default: ["profile", "email", "offline_access"]. */
  scopes?: string[];
  /** Credential storage strategy. Default: "keychain" (with file fallback). */
  storage?: StorageKind | CredentialStore;
  /** Keychain service name. Default: "litt-cli-auth". */
  keychainService?: string;
  /** Environment label to namespace stored tokens. Default: "default". */
  environment?: string;
  /** Override callback port. Default: 0 (OS picks a random ephemeral port). */
  callbackPort?: number;
  /** Callback server timeout in ms. Default: 120000 (2 min). */
  timeoutMs?: number;
  /** Injected browser opener (for testing). Default: auto-detect platform. */
  openBrowser?: (url: string) => Promise<void>;
}

/** Auth session state — what the rest of the CLI reads. */
export interface AuthState {
  signedIn: boolean;
  user: UserInfo | null;
  /** Email for header display (null when signed out). */
  email: string | null;
  /** Error message if auth failed (e.g. expired refresh token). */
  error: string | null;
}

/** Error codes used throughout the auth module. */
export type AuthErrorCode =
  | "config"
  | "storage"
  | "state_mismatch"
  | "timeout"
  | "token_exchange"
  | "token_refresh"
  | "userinfo"
  | "revoke"
  | "browser_open";

/** Typed auth error with a code for branching. */
export class AuthError extends Error {
  code: AuthErrorCode;
  constructor(code: AuthErrorCode, message: string) {
    super(message);
    this.name = "AuthError";
    this.code = code;
  }
}
