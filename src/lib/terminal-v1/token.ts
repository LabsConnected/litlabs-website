/**
 * Hardened terminal token system for Terminal V1.
 *
 * Tokens are project-bound and include:
 * - User ID (sub)
 * - Project ID (pid)
 * - Workspace ID (wid)
 * - Sandbox ID (sid)
 * - Audience (aud)
 * - Issued-at (iat)
 * - Expiration (exp)
 * - Unique token ID (jti)
 * - Operation scopes (scope)
 *
 * Tokens fail closed. If any required claim is missing or invalid,
 * the token is rejected. No generic fallback shell tokens are issued.
 */

import { createHmac, randomUUID, timingSafeEqual } from "crypto";
import type { TerminalToken, TerminalTokenClaims, TerminalTokenScope } from "./types";

const TOKEN_AUDIENCE = "littree-terminal-v1";
const TOKEN_TTL_SECONDS = 5 * 60;

const ALL_SCOPES: TerminalTokenScope[] = [
  "terminal:connect",
  "terminal:input",
  "terminal:resize",
  "files:read",
  "files:write",
  "preview:open",
];

function getTerminalSecret(): string {
  const secret = process.env.TERMINAL_AUTH_SECRET ?? "";
  if (secret.length < 32) {
    throw new Error("TERMINAL_AUTH_SECRET must contain at least 32 characters");
  }
  return secret;
}

function sign(encodedPayload: string, secret: string): string {
  return createHmac("sha256", secret).update(encodedPayload).digest("base64url");
}

export interface CreateTerminalTokenInput {
  userId: string;
  projectId: string;
  workspaceId: string;
  sandboxId: string;
  scopes?: TerminalTokenScope[];
  ttlSeconds?: number;
}

/**
 * Create a hardened project-bound terminal token.
 *
 * All of userId, projectId, workspaceId, and sandboxId are required.
 * Never issue a generic fallback token without project binding.
 */
export function createTerminalTokenV1(
  input: CreateTerminalTokenInput,
): TerminalToken {
  if (!input.userId) throw new Error("userId is required for terminal token");
  if (!input.projectId) throw new Error("projectId is required for terminal token");
  if (!input.workspaceId) throw new Error("workspaceId is required for terminal token");
  if (!input.sandboxId) throw new Error("sandboxId is required for terminal token");

  const now = Math.floor(Date.now() / 1000);
  const ttl = input.ttlSeconds ?? TOKEN_TTL_SECONDS;
  const scopes = input.scopes ?? ALL_SCOPES;

  const claims: TerminalTokenClaims = {
    sub: input.userId,
    pid: input.projectId,
    wid: input.workspaceId,
    sid: input.sandboxId,
    aud: TOKEN_AUDIENCE,
    iat: now,
    exp: now + ttl,
    jti: randomUUID(),
    scope: scopes,
  };

  const encodedPayload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  const signature = sign(encodedPayload, getTerminalSecret());
  const token = `${encodedPayload}.${signature}`;

  return {
    token,
    claims,
    expiresAt: claims.exp * 1000,
  };
}

export interface VerifyTerminalTokenOptions {
  /** Require the token to match this userId. */
  userId?: string;
  /** Require the token to match this projectId. */
  projectId?: string;
  /** Require the token to match this workspaceId. */
  workspaceId?: string;
  /** Require the token to match this sandboxId. */
  sandboxId?: string;
  /** Require the token to have this scope. */
  scope?: TerminalTokenScope;
}

/**
 * Verify a terminal token. Fails closed on any mismatch.
 *
 * Returns the verified claims, or throws an error with a specific
 * code that can be mapped to an HTTP status.
 */
export function verifyTerminalTokenV1(
  token: string,
  options?: VerifyTerminalTokenOptions,
): TerminalTokenClaims {
  const [encodedPayload, signature, extra] = token.split(".");
  if (!encodedPayload || !signature || extra) {
    throw new TerminalTokenError("Invalid token format", "TOKEN_INVALID");
  }

  const secret = getTerminalSecret();
  const expected = sign(encodedPayload, secret);

  const providedBuf = Buffer.from(signature);
  const expectedBuf = Buffer.from(expected);
  if (
    providedBuf.length !== expectedBuf.length ||
    !timingSafeEqual(providedBuf, expectedBuf)
  ) {
    throw new TerminalTokenError("Invalid token signature", "TOKEN_INVALID");
  }

  let claims: TerminalTokenClaims;
  try {
    claims = JSON.parse(
      Buffer.from(encodedPayload, "base64url").toString("utf-8"),
    ) as TerminalTokenClaims;
  } catch {
    throw new TerminalTokenError("Malformed token payload", "TOKEN_INVALID");
  }

  // Verify required fields exist
  if (!claims.sub) throw new TerminalTokenError("Missing subject", "TOKEN_INVALID");
  if (!claims.pid) throw new TerminalTokenError("Missing project ID", "TOKEN_INVALID");
  if (!claims.wid) throw new TerminalTokenError("Missing workspace ID", "TOKEN_INVALID");
  if (!claims.sid) throw new TerminalTokenError("Missing sandbox ID", "TOKEN_INVALID");
  if (!claims.jti) throw new TerminalTokenError("Missing token ID", "TOKEN_INVALID");
  if (!claims.scope || !Array.isArray(claims.scope)) {
    throw new TerminalTokenError("Missing scopes", "TOKEN_INVALID");
  }

  // Verify audience
  if (claims.aud !== TOKEN_AUDIENCE) {
    throw new TerminalTokenError("Wrong audience", "TOKEN_WRONG_AUDIENCE");
  }

  // Verify expiration
  const now = Math.floor(Date.now() / 1000);
  if (claims.exp <= now) {
    throw new TerminalTokenError("Token expired", "TOKEN_EXPIRED");
  }

  // Verify issued-at (not too far in the future)
  if (claims.iat > now + 30) {
    throw new TerminalTokenError("Token issued in the future", "TOKEN_INVALID");
  }

  // Verify optional constraints
  if (options?.userId && claims.sub !== options.userId) {
    throw new TerminalTokenError("Wrong user", "TOKEN_WRONG_USER");
  }
  if (options?.projectId && claims.pid !== options.projectId) {
    throw new TerminalTokenError("Wrong project", "TOKEN_WRONG_PROJECT");
  }
  if (options?.workspaceId && claims.wid !== options.workspaceId) {
    throw new TerminalTokenError("Wrong workspace", "TOKEN_WRONG_WORKSPACE");
  }
  if (options?.sandboxId && claims.sid !== options.sandboxId) {
    throw new TerminalTokenError("Wrong sandbox", "TOKEN_WRONG_SANDBOX");
  }
  if (options?.scope && !claims.scope.includes(options.scope)) {
    throw new TerminalTokenError("Missing required scope", "TOKEN_MISSING_SCOPE");
  }

  return claims;
}

export class TerminalTokenError extends Error {
  readonly code: string;

  constructor(message: string, code: string) {
    super(message);
    this.name = "TerminalTokenError";
    this.code = code;
  }
}

/** Map token error codes to HTTP status codes. */
export function tokenErrorToStatus(code: string): number {
  switch (code) {
    case "TOKEN_EXPIRED":
      return 401;
    case "TOKEN_INVALID":
      return 401;
    case "TOKEN_WRONG_AUDIENCE":
      return 401;
    case "TOKEN_WRONG_USER":
      return 403;
    case "TOKEN_WRONG_PROJECT":
      return 403;
    case "TOKEN_WRONG_WORKSPACE":
      return 403;
    case "TOKEN_WRONG_SANDBOX":
      return 403;
    case "TOKEN_MISSING_SCOPE":
      return 403;
    default:
      return 401;
  }
}

export { TOKEN_AUDIENCE, TOKEN_TTL_SECONDS, ALL_SCOPES };
