/**
 * OAuth token exchange — talks to Clerk's /oauth/token and /oauth/userinfo.
 *
 *   exchangeCodeForTokens  — Authorization Code → access + refresh tokens
 *   refreshAccessToken     — refresh_token → new access_token
 *   fetchUserInfo          — access_token → user profile (sub, email, name)
 *   revokeToken            — revoke a refresh_token server-side (logout)
 *
 * All requests go to the Clerk issuer (NOT terminal-server). The CLI
 * never sends these tokens to terminal-server directly — it sends the
 * access_token to /api/token-exchange, which verifies it server-side.
 */

import type { TokenSet, UserInfo } from "./types.js";
import { AuthError } from "./types.js";

export interface ExchangeParams {
  issuer: string;
  clientId: string;
  code: string;
  codeVerifier: string;
  redirectUri: string;
}

export interface RefreshParams {
  issuer: string;
  clientId: string;
  refreshToken: string;
  scopes?: string[];
}

export interface UserInfoParams {
  issuer: string;
  accessToken: string;
}

export interface RevokeParams {
  issuer: string;
  clientId: string;
  token: string;
}

interface OAuthTokenResponse {
  access_token?: unknown;
  refresh_token?: unknown;
  expires_in?: unknown;
  scope?: unknown;
  token_type?: unknown;
}

function endpoint(issuer: string, path: string): string {
  return `${issuer.replace(/\/+$/, "")}${path}`;
}

async function parseBody(response: Response): Promise<unknown> {
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    return response.json();
  }
  return response.text();
}

function messageFromBody(body: unknown, fallback: string): string {
  if (typeof body === "string" && body.trim()) return body.trim();
  if (body && typeof body === "object") {
    const record = body as Record<string, unknown>;
    for (const key of ["error_description", "message", "error"]) {
      const value = record[key];
      if (typeof value === "string" && value.trim()) return value.trim();
    }
  }
  return fallback;
}

function mapTokenResponse(data: OAuthTokenResponse): TokenSet {
  if (typeof data.access_token !== "string" || data.access_token.length === 0) {
    throw new AuthError("token_exchange", "Token response did not include access_token.");
  }

  const tokenSet: TokenSet = {
    accessToken: data.access_token,
  };

  if (typeof data.refresh_token === "string") tokenSet.refreshToken = data.refresh_token;
  if (typeof data.scope === "string") tokenSet.scope = data.scope;
  if (typeof data.token_type === "string") tokenSet.tokenType = data.token_type;
  if (typeof data.expires_in === "number") {
    tokenSet.expiresAt = Date.now() + data.expires_in * 1000;
  }

  return tokenSet;
}

async function requestTokens(issuer: string, body: URLSearchParams): Promise<TokenSet> {
  const url = endpoint(issuer, "/oauth/token");
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
      signal: AbortSignal.timeout(15_000),
    });
  } catch (error) {
    throw new AuthError(
      "token_exchange",
      `Token request failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  let parsed: unknown;
  try {
    parsed = await parseBody(response);
  } catch (error) {
    throw new AuthError(
      "token_exchange",
      `Token response could not be parsed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (!response.ok) {
    throw new AuthError(
      "token_exchange",
      messageFromBody(parsed, `Token request failed with HTTP ${response.status}.`),
    );
  }

  if (!parsed || typeof parsed !== "object") {
    throw new AuthError("token_exchange", "Token response was not JSON.");
  }

  return mapTokenResponse(parsed as OAuthTokenResponse);
}

/** Exchange an authorization code for access + refresh tokens (PKCE). */
export async function exchangeCodeForTokens(params: ExchangeParams): Promise<TokenSet> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: params.clientId,
    code: params.code,
    code_verifier: params.codeVerifier,
    redirect_uri: params.redirectUri,
  });

  return requestTokens(params.issuer, body);
}

/** Refresh an expired access token using a refresh_token. */
export async function refreshAccessToken(params: RefreshParams): Promise<TokenSet> {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    client_id: params.clientId,
    refresh_token: params.refreshToken,
  });

  if (params.scopes?.length) body.set("scope", params.scopes.join(" "));

  try {
    return await requestTokens(params.issuer, body);
  } catch (error) {
    if (error instanceof AuthError) {
      // Re-throw with token_refresh code for refresh-specific failures
      throw new AuthError("token_refresh", error.message);
    }
    throw error;
  }
}

/** Fetch user info from Clerk's /oauth/userinfo endpoint. */
export async function fetchUserInfo(params: UserInfoParams): Promise<UserInfo> {
  let response: Response;
  try {
    response = await fetch(endpoint(params.issuer, "/oauth/userinfo"), {
      headers: { Authorization: `Bearer ${params.accessToken}` },
      signal: AbortSignal.timeout(10_000),
    });
  } catch (error) {
    throw new AuthError(
      "userinfo",
      `Userinfo request failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  let parsed: unknown;
  try {
    parsed = await parseBody(response);
  } catch (error) {
    throw new AuthError(
      "userinfo",
      `Userinfo response could not be parsed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (!response.ok) {
    throw new AuthError(
      "userinfo",
      messageFromBody(parsed, `Userinfo request failed with HTTP ${response.status}.`),
    );
  }

  if (!parsed || typeof parsed !== "object") {
    throw new AuthError("userinfo", "Userinfo response was not JSON.");
  }

  const user = parsed as UserInfo;
  if (typeof user.sub !== "string" || user.sub.length === 0) {
    throw new AuthError("userinfo", "Userinfo response did not include sub.");
  }

  return user;
}

/**
 * Revoke a token server-side via Clerk's /oauth/revoke endpoint.
 * Best-effort — if revocation fails (network, endpoint unavailable),
 * local credentials are still cleared. The token becomes useless
 * once the refresh_token is revoked.
 */
export async function revokeToken(params: RevokeParams): Promise<void> {
  const body = new URLSearchParams({
    client_id: params.clientId,
    token: params.token,
  });

  try {
    const response = await fetch(endpoint(params.issuer, "/oauth/token/revoke"), {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      // Non-fatal — local credentials are cleared regardless
      const text = await response.text().catch(() => "");
      throw new AuthError(
        "revoke",
        `Token revocation failed (HTTP ${response.status}): ${text || "no detail"}`,
      );
    }
  } catch (error) {
    if (error instanceof AuthError) throw error;
    throw new AuthError(
      "revoke",
      `Token revocation request failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
