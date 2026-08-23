import { createHmac, timingSafeEqual } from "crypto";

const TOKEN_AUDIENCE = "littree-terminal";

type TerminalTokenPayload = {
  sub: string;
  aud: string;
  iat: number;
  exp: number;
  wid?: string;
  pid?: string;
  cwd?: string;
  /** Authenticated user's primary email (best-effort, from Clerk). */
  email?: string;
};

function sign(encodedPayload: string, secret: string): string {
  return createHmac("sha256", secret).update(encodedPayload).digest("base64url");
}

/**
 * Mint a short-lived terminal JWT (server-side only).
 *
 * This is called by the /api/token-exchange endpoint after verifying
 * a Clerk token and authorizing the workspace/project. The client
 * NEVER calls this — TERMINAL_AUTH_SECRET stays server-side.
 *
 * @param userId  Verified Clerk user ID (from the verified Clerk token)
 * @param ttlSec  Token lifetime in seconds (default 300 = 5 minutes)
 * @param claims  Optional authorized workspace/project claims
 * @returns Signed terminal JWT string
 */
export function mintTerminalToken(
  userId: string,
  ttlSec = 300,
  claims?: {
    workspaceId?: string;
    projectId?: string;
    cwd?: string;
    email?: string;
  },
): string {
  const secret = process.env.TERMINAL_AUTH_SECRET ?? "";
  if (secret.length < 32) throw new Error("Terminal authentication is not configured");
  if (!userId || typeof userId !== "string") throw new Error("userId is required");

  const now = Math.floor(Date.now() / 1000);
  const payload: TerminalTokenPayload = {
    sub: userId,
    aud: TOKEN_AUDIENCE,
    iat: now,
    exp: now + ttlSec,
  };
  if (claims?.workspaceId) payload.wid = claims.workspaceId;
  if (claims?.projectId) payload.pid = claims.projectId;
  if (claims?.cwd) payload.cwd = claims.cwd;
  if (claims?.email) payload.email = claims.email;
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = sign(encodedPayload, secret);
  return `${encodedPayload}.${signature}`;
}

export function verifyTerminalToken(token: unknown): TerminalTokenPayload {
  const secret = process.env.TERMINAL_AUTH_SECRET ?? "";

  // Development mode: accept "dev-" prefixed unsigned tokens ONLY when:
  //   1. TERMINAL_AUTH_SECRET is not configured (local dev), AND
  //   2. NODE_ENV is not "production" (hard-disable in production)
  // This allows local Desktop/TUI development without requiring full
  // auth setup, but is hard-blocked in production — no unsigned dev
  // tokens can ever authenticate against a production server.
  const isProduction = process.env.NODE_ENV === "production";
  if (
    !isProduction &&
    secret.length < 32 &&
    typeof token === "string" &&
    token.startsWith("dev-")
  ) {
    const payload = parseTokenPayload(token, "dev-");
    if (payload) return payload;
    // Fall through to error if dev token is malformed
  }

  if (secret.length < 32) throw new Error("Terminal authentication is not configured");
  if (typeof token !== "string") throw new Error("Missing terminal token");

  const [encodedPayload, encodedSignature, extra] = token.split(".");
  if (!encodedPayload || !encodedSignature || extra) throw new Error("Invalid terminal token");

  const supplied = Buffer.from(encodedSignature, "base64url");
  const expected = Buffer.from(sign(encodedPayload, secret), "base64url");
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
    throw new Error("Invalid terminal token");
  }

  const payload = parseTokenPayload(encodedPayload, "");
  if (!payload) throw new Error("Expired or invalid terminal token");
  return payload;
}

/** Parse token payload from base64url encoded string, optionally stripping prefix */
function parseTokenPayload(encodedPayload: string, prefix: string): TerminalTokenPayload | null {
  let payloadStr: string;
  if (prefix && encodedPayload.startsWith(prefix)) {
    // Dev token: "dev-" + base64url(JSON)
    payloadStr = Buffer.from(encodedPayload.slice(prefix.length), "base64url").toString("utf8");
  } else {
    // Signed token: base64url(JSON) + "." + signature
    payloadStr = Buffer.from(encodedPayload, "base64url").toString("utf8");
  }
  let payload: TerminalTokenPayload;
  try {
    payload = JSON.parse(payloadStr);
  } catch {
    return null;
  }

  const now = Math.floor(Date.now() / 1000);
  if (
    typeof payload.sub !== "string" ||
    !payload.sub ||
    payload.aud !== TOKEN_AUDIENCE ||
    !Number.isInteger(payload.iat) ||
    !Number.isInteger(payload.exp) ||
    payload.iat > now + 30 ||
    payload.exp <= now
  ) {
    return null;
  }
  return payload;
}

export function bearerToken(header: string | undefined): string | null {
  if (!header?.startsWith("Bearer ")) return null;
  return header.slice("Bearer ".length).trim() || null;
}
