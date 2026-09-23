import "server-only";

import { createHmac, randomUUID, timingSafeEqual } from "crypto";
import type { NextRequest } from "next/server";

/**
 * Anonymous demo session identity.
 *
 * A signed httpOnly `demo_session` cookie carries an opaque UUID. The UUID is
 * HMAC-signed so a client cannot forge or tamper with another visitor's
 * session id; only the raw UUID's sha256 is ever persisted (demo_logs).
 *
 * Session identity is the per-session rate-limit and message-ceiling key.
 * Cookie theft across browsers is bounded by the per-IP rate limit.
 */

export const DEMO_SESSION_COOKIE = "demo_session";

const SIGNATURE_BYTES = 32;

let _processSecret: string | null = null;

/**
 * HMAC key for demo session cookies. Prefer DEMO_SESSION_SECRET; otherwise a
 * per-process random secret (sessions don't survive restarts, which is an
 * acceptable demo-lane tradeoff — and strictly safer than an unsigned cookie).
 */
function getSigningSecret(): string {
  const configured = process.env.DEMO_SESSION_SECRET;
  if (configured && configured.length >= 16) return configured;
  if (!_processSecret) {
    _processSecret = randomUUID() + randomUUID();
    if (process.env.NODE_ENV === "production") {
      console.warn(
        "[demo] DEMO_SESSION_SECRET is not set — using a per-process signing secret. Set DEMO_SESSION_SECRET for stable sessions across restarts/replicas.",
      );
    }
  }
  return _processSecret;
}

function sign(sessionId: string): string {
  return createHmac("sha256", getSigningSecret())
    .update(sessionId, "utf8")
    .digest("hex")
    .slice(0, SIGNATURE_BYTES * 2);
}

function verifySignature(sessionId: string, signature: string): boolean {
  const expected = sign(sessionId);
  const a = Buffer.from(signature, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** Create a fresh signed session value (`uuid.signature`). */
export function createDemoSessionValue(): string {
  const id = randomUUID();
  return `${id}.${sign(id)}`;
}

/**
 * Validate a raw cookie value. Returns the session UUID, or null when the
 * cookie is missing, malformed, or the signature doesn't verify.
 */
export function readDemoSessionValue(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const dot = raw.lastIndexOf(".");
  if (dot <= 0) return null;
  const id = raw.slice(0, dot);
  const signature = raw.slice(dot + 1);
  // Basic UUID shape check — rejects junk before the HMAC compare.
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    return null;
  }
  if (!verifySignature(id, signature)) return null;
  return id;
}

/** Extract the demo session UUID from an incoming request's cookies. */
export function getDemoSessionFromRequest(req: NextRequest): string | null {
  return readDemoSessionValue(req.cookies.get(DEMO_SESSION_COOKIE)?.value);
}

/**
 * Serialize the Set-Cookie header for a (new) demo session value.
 * httpOnly + SameSite=Lax + Secure in production; Path=/.
 */
export function serializeDemoSessionCookie(
  value: string,
  maxAgeSeconds: number,
): string {
  const parts = [
    `${DEMO_SESSION_COOKIE}=${value}`,
    "Path=/",
    `Max-Age=${Math.floor(maxAgeSeconds)}`,
    "HttpOnly",
    "SameSite=Lax",
  ];
  const forwardedProto = process.env.VERCEL === "1" || process.env.RAILWAY_ENVIRONMENT;
  if (process.env.NODE_ENV === "production" || forwardedProto) {
    parts.push("Secure");
  }
  return parts.join("; ");
}
