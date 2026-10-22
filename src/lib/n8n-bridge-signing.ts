/**
 * n8n Bridge — server-side forward signing + authorization helpers.
 *
 * D4 fix (ART-20261022-013, prepared 2026-10-22, NOT deployed):
 * The bridge route authenticates the incoming caller, then must NOT forward
 * any caller-supplied signing material to n8n. Instead it generates a FRESH
 * HMAC-SHA256 signature over the exact body it forwards, plus a fresh
 * timestamp and a unique request ID for n8n-side replay protection.
 *
 * These helpers are pure (node:crypto only) so they can be unit-tested
 * without Next.js.
 */

import { createHmac, randomUUID } from "crypto";

/** Webhook paths the bridge is authorized to forward to. Anything else: 403. */
export const ALLOWED_WEBHOOK_PATHS: ReadonlySet<string> = new Set([
  "ai-orchestrate",
  "github-sync",
  "stripe-onboarding",
]);

/** Maximum forwarded body size (bytes). Larger requests: 413. */
export const MAX_FORWARD_BODY_BYTES = 256 * 1024;

/** True only for a single-segment path on the authorization allowlist. */
export function isAuthorizedWebhookPath(segments: string[] | undefined): boolean {
  if (!segments || segments.length !== 1) return false;
  return ALLOWED_WEBHOOK_PATHS.has(segments[0]);
}

/** Byte-accurate payload-limit check (UTF-8), not character count. */
export function exceedsPayloadLimit(rawBody: string): boolean {
  return Buffer.byteLength(rawBody, "utf8") > MAX_FORWARD_BODY_BYTES;
}

/** Headers the bridge generates itself for the forwarded request. */
export interface ForwardSigningHeaders {
  "x-litt-signature": string;
  "x-litt-timestamp": string;
  "x-litt-request-id": string;
}

/**
 * Generate a fresh signature over the exact forwarded body.
 *
 * - Signature: HMAC-SHA256 hex over the raw body string, keyed by the bridge
 *   secret — the same scheme n8n-side verification (and verifyWebhookSignature
 *   in src/lib/n8n-webhook.ts) expects.
 * - Timestamp: now, unix seconds (n8n enforces the 300s replay window).
 * - Request ID: a fresh UUID per forwarded request (n8n's atomic expiring
 *   replay store keys on this; it is never taken from the caller).
 *
 * @throws if the secret is not configured — the bridge must fail closed.
 */
export function buildForwardSigningHeaders(
  secret: string | undefined,
  rawBody: string,
  nowSeconds: number = Math.floor(Date.now() / 1000),
  requestId: string = randomUUID(),
): ForwardSigningHeaders {
  if (!secret) {
    throw new Error("buildForwardSigningHeaders: bridge secret is not configured");
  }
  const hmac = createHmac("sha256", secret);
  hmac.update(rawBody);
  return {
    "x-litt-signature": hmac.digest("hex"),
    "x-litt-timestamp": String(nowSeconds),
    "x-litt-request-id": requestId,
  };
}

/**
 * Caller headers that must NEVER be forwarded to n8n. The forward request is
 * built from an allowlist (Content-Type + the generated signing headers), so
 * these are excluded by construction; this list exists for tests/audits.
 */
export const NEVER_FORWARD_HEADERS: readonly string[] = [
  "x-litt-signature",
  "x-litt-timestamp",
  "x-litt-request-id",
  "x-n8n-bridge-secret",
  "authorization",
  "cookie",
];
