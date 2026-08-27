/**
 * Auth + runtime configuration — the canonical source for the three
 * public production values the CLI needs to function out-of-the-box.
 *
 * The CLI needs three PUBLIC values (no secrets are ever shipped):
 *   1. Clerk issuer URL (Frontend API base URL)
 *   2. OAuth application's public client_id (PKCE public client — no secret)
 *   3. Production terminal-server URL (where --remote / runtime connects)
 *
 * Resolution precedence (for each value):
 *   explicit environment override  →  compiled safe production default
 *
 * Env vars (all OPTIONAL — overrides for dev/staging/testing only):
 *   LITT_CLERK_ISSUER            — Clerk issuer URL
 *   LITT_CLERK_OAUTH_CLIENT_ID   — OAuth application client_id
 *   LITT_TERMINAL_URL            — terminal-server base URL
 *
 * SECURITY BOUNDARY — what is safe to ship as a compiled default:
 *   ✅ Clerk public OAuth client_id (PKCE public client, no secret)
 *   ✅ Clerk issuer / public auth endpoint
 *   ✅ Production terminal-server URL
 *
 * NEVER shipped as a default (server-side secrets only):
 *   ❌ CLERK_SECRET_KEY
 *   ❌ TERMINAL_AUTH_SECRET
 *   ❌ TERMINAL_INTERNAL_SERVICE_KEY
 *   ❌ SUPABASE_SERVICE_ROLE_KEY
 *   ❌ OAuth client_secret
 *   ❌ refresh/access tokens
 *   ❌ user session credentials
 */

import { AuthError } from "./types.js";

/** Default Clerk issuer for the LiTT production instance. */
const DEFAULT_ISSUER = "https://clerk.litlabs.net";

/**
 * Default Clerk OAuth client_id for the LiTT CLI.
 *
 * This is a PUBLIC PKCE client (no client_secret) created in the Clerk
 * Dashboard for the production instance. It is safe to ship in the CLI
 * binary — the security comes from PKCE, not from secrecy of the
 * client_id. The redirect URI is http://127.0.0.1/callback (loopback,
 * dynamic port per RFC 8252 §7.3).
 */
const DEFAULT_CLERK_OAUTH_CLIENT_ID = "YWeGjVVwoNnX4RTY";

/**
 * Default production terminal-server URL.
 *
 * This is the public Railway deployment of litlabs-terminal-server.
 * REMOTE runtime state is only TRUE after a successful connection —
 * the mere existence of this URL does NOT mean the runtime is
 * connected. Use isRemoteAvailable() to check actual connectivity.
 */
const DEFAULT_TERMINAL_URL = "https://terminal-server-production-68ac.up.railway.app";

export interface ResolvedAuthConfig {
  issuer: string;
  clientId: string;
}

/**
 * Resolve the auth config (issuer + client_id) from env overrides or
 * the compiled safe production defaults.
 *
 * With safe defaults compiled in, this always returns a valid config
 * for the production CLI. Env overrides replace the defaults for
 * development, staging, and acceptance testing.
 *
 * Throws AuthError only if an explicit override is set to an empty
 * string (treated as "I meant to clear this" → misconfiguration).
 */
export function resolveAuthConfig(): ResolvedAuthConfig {
  const issuer = process.env.LITT_CLERK_ISSUER ?? DEFAULT_ISSUER;
  const clientId = process.env.LITT_CLERK_OAUTH_CLIENT_ID ?? DEFAULT_CLERK_OAUTH_CLIENT_ID;

  if (!clientId) {
    throw new AuthError(
      "config",
      "Clerk OAuth client_id resolved to empty. This should not happen — " +
      "the CLI ships a safe production default. If you set " +
      "LITT_CLERK_OAUTH_CLIENT_ID explicitly, ensure it is not empty.",
    );
  }

  if (!issuer) {
    throw new AuthError(
      "config",
      "Clerk issuer resolved to empty. If you set LITT_CLERK_ISSUER " +
      "explicitly, ensure it is a valid URL.",
    );
  }

  return { issuer, clientId };
}

/**
 * Check if auth config is available (without throwing).
 *
 * With safe production defaults compiled in, this is ALWAYS true for
 * a normal installed CLI. It returns false only if an explicit env
 * override is set to an empty string (a deliberate misconfiguration
 * that should not occur in normal use).
 *
 * Used by `litt doctor` and the startup gate to decide whether to
 * attempt auth or show a config-missing message.
 */
export function hasAuthConfig(): boolean {
  const clientId = process.env.LITT_CLERK_OAUTH_CLIENT_ID ?? DEFAULT_CLERK_OAUTH_CLIENT_ID;
  return !!clientId;
}

/**
 * Get the issuer URL (env override or production default).
 */
export function getIssuer(): string {
  return process.env.LITT_CLERK_ISSUER ?? DEFAULT_ISSUER;
}

/**
 * Get the terminal-server URL (env override or production default).
 *
 * This is the CONFIGURED URL — it does NOT imply a connected REMOTE
 * runtime. Use isRemoteAvailable() (from remote.ts) to check actual
 * connectivity. The configured URL existing does not make REMOTE true.
 */
export function getTerminalUrl(): string {
  return process.env.LITT_TERMINAL_URL ?? DEFAULT_TERMINAL_URL;
}

/**
 * Export the default terminal URL for modules that need the raw
 * constant (e.g. remote.ts, runtime-client.ts). Prefer getTerminalUrl()
 * for runtime resolution.
 */
export { DEFAULT_TERMINAL_URL };
