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
import {
  buildCanonicalSigningStringV2,
  SIGNING_VERSION_V2,
} from "./n8n-webhook";

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
  "x-litt-signature-version": string;
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
  path: string,
  nowSeconds: number = Math.floor(Date.now() / 1000),
  requestId: string = randomUUID(),
): ForwardSigningHeaders {
  if (!secret) {
    throw new Error("buildForwardSigningHeaders: bridge secret is not configured");
  }
  // v2: the signature binds timestamp, request ID, authorized path and the
  // exact body (see buildCanonicalSigningStringV2 in src/lib/n8n-webhook.ts).
  const signature = createHmac("sha256", secret)
    .update(
      buildCanonicalSigningStringV2({
        timestamp: nowSeconds,
        requestId,
        path,
        body: rawBody,
      }),
    )
    .digest("hex");
  return {
    "x-litt-signature": signature,
    "x-litt-timestamp": String(nowSeconds),
    "x-litt-request-id": requestId,
    "x-litt-signature-version": SIGNING_VERSION_V2,
  };
}

/**
 * Atomic one-time claim for a verified request ID — the replay gate.
 * Returns true exactly once per key inside the TTL window.
 *
 * The in-process implementation below is correct for a single bridge
 * instance and exists so the protocol is testable today. PRODUCTION must
 * back this with the shared atomic store (Supabase
 * `claim_n8n_bridge_request`, migration in ART-20261022-016 d5-prep) so the
 * claim holds across litt-shell replicas; the route awaits the claim, so an
 * async implementation drops in without protocol changes.
 */
export type ReplayClaim = (
  claimKey: string,
  nowSeconds?: number,
) => boolean | Promise<boolean>;

/** Replay-claim TTL: matches the 300s signature window. */
export const REPLAY_CLAIM_TTL_SECONDS = 300;

export function createInMemoryReplayClaim(
  ttlSeconds: number = REPLAY_CLAIM_TTL_SECONDS,
): ReplayClaim {
  const seen = new Map<string, number>();
  return (claimKey, nowSeconds = Math.floor(Date.now() / 1000)) => {
    for (const [k, exp] of seen) {
      if (exp <= nowSeconds) seen.delete(k);
    }
    if (seen.has(claimKey)) return false;
    seen.set(claimKey, nowSeconds + ttlSeconds);
    return true;
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
  "x-litt-signature-version",
  "x-n8n-bridge-secret",
  "authorization",
  "cookie",
];
