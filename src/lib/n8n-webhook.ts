/**
 * Signed Webhook Gateway for n8n integration.
 *
 * This module provides the utilities to send HMAC-SHA256 signed payloads
 * from the LiTTree app to the private n8n instance, and to verify incoming
 * signed requests at the webhook bridge.
 *
 * Architecture:
 *   LiTTree app → signWebhookPayload() → sendToN8n()
 *     → POST ${N8N_WEBHOOK_URL}/webhook/{path}
 *       Headers: x-litt-signature, x-litt-timestamp
 *       Body:   JSON-serialized signed payload
 *
 *   External → POST /api/n8n/webhook/{path}
 *     → route.ts verifies x-litt-signature (HMAC-SHA256) + x-litt-timestamp
 *     → Rejects signatures older than 5 minutes (replay protection)
 *     → Falls back to legacy x-n8n-bridge-secret shared secret for backward compat
 *     → Forwards to n8n
 *
 * Security:
 * - The shared secret (LITT_N8N_BRIDGE_SECRET) is NEVER sent in the body.
 * - The signature is computed over the exact JSON-serialized payload bytes.
 * - Timestamps prevent replay attacks (5-minute window).
 * - Verification uses timingSafeEqual to avoid timing side-channels.
 */

import { createHmac, randomUUID, timingSafeEqual } from "crypto";

/**
 * The structured payload that LiTTree sends to n8n via signed webhooks.
 * Every field is explicitly typed so n8n workflows can rely on the shape.
 */
export interface N8nWebhookPayload {
  /** Clerk user ID initiating the event (or "system" for server-side events). */
  userId: string;
  /** Supabase project ID the event belongs to (or "platform" for global). */
  projectId: string;
  /** Mission ID if the event is tied to a LiTT mission (or null). */
  missionId: string | null;
  /** Event type, e.g. "lead.created", "user.created", "mission.approved". */
  eventType: string;
  /** The approved action that n8n is allowed to perform. */
  approvedAction: string;
  /** URL n8n should call back to report results (LiTTree callback endpoint). */
  callbackUrl: string;
  /** Unique key to prevent duplicate processing of the same event. */
  idempotencyKey: string;
  /** Arbitrary event-specific data. */
  data: Record<string, unknown>;
}

/** Result of signing a payload. */
export interface SignedWebhook {
  /** The JSON-serialized payload string (sent as the request body). */
  body: string;
  /** HMAC-SHA256 hex signature (sent as x-litt-signature header). */
  signature: string;
  /** Unix timestamp in seconds (sent as x-litt-timestamp header). */
  timestamp: number;
}

/** Response wrapper from sendToN8n. */
export interface N8nResponse {
  ok: boolean;
  status: number;
  body: unknown;
}

const BRIDGE_SECRET = () => process.env.LITT_N8N_BRIDGE_SECRET;
const N8N_WEBHOOK_URL = () => process.env.N8N_WEBHOOK_URL;

/** Maximum age (in seconds) a signed webhook timestamp can be before rejection. */
export const MAX_SIGNATURE_AGE_SECONDS = 300; // 5 minutes

/**
 * Sign a webhook payload using HMAC-SHA256 with the bridge secret.
 *
 * The signature is computed over the exact JSON-serialized payload string,
 * so the *same* string must be sent as the request body — do not re-serialize.
 *
 * @throws if LITT_N8N_BRIDGE_SECRET is not set.
 */
/** @deprecated v1 signs the body only (timestamp/request ID unauthenticated). Kept for reference; new code must use signWebhookPayloadV2. */
export function signWebhookPayload(payload: N8nWebhookPayload): SignedWebhook {
  const secret = BRIDGE_SECRET();
  if (!secret) {
    throw new Error(
      "signWebhookPayload: LITT_N8N_BRIDGE_SECRET is not configured",
    );
  }

  const body = JSON.stringify(payload);
  const timestamp = Math.floor(Date.now() / 1000);

  const hmac = createHmac("sha256", secret);
  hmac.update(body);
  const signature = hmac.digest("hex");

  return { body, signature, timestamp };
}

/**
 * Verify a signed webhook request's HMAC-SHA256 signature and timestamp.
 *
 * @param body         The raw request body string (as received).
 * @param signature    The x-litt-signature header value (hex).
 * @param timestamp    The x-litt-timestamp header value (unix seconds).
 * @param now          Current time in seconds (injectable for testing).
 * @returns true if the signature is valid and within the replay window.
 */
/** @deprecated v1 verifier: the timestamp it checks is NOT authenticated. Protected routes must use verifyWebhookSignatureV2. */
export function verifyWebhookSignature(
  body: string,
  signature: string,
  timestamp: number,
  now: number = Math.floor(Date.now() / 1000),
): boolean {
  const secret = BRIDGE_SECRET();
  if (!secret) return false;

  // ── Replay protection: reject timestamps older than the max age ──
  const age = now - timestamp;
  if (age > MAX_SIGNATURE_AGE_SECONDS || age < -MAX_SIGNATURE_AGE_SECONDS) {
    return false;
  }

  // ── Recompute the expected signature over the raw body ──
  const hmac = createHmac("sha256", secret);
  hmac.update(body);
  const expected = hmac.digest("hex");

  // ── Timing-safe comparison ──
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Send a signed webhook to the private n8n instance.
 *
 * The payload is signed with HMAC-SHA256 and forwarded to:
 *   ${N8N_WEBHOOK_URL}/webhook/${webhookPath}
 *
 * @param webhookPath  The n8n webhook path (e.g. "litt-new-lead").
 * @param payload      The structured LiTTree webhook payload.
 * @returns The n8n response status and body.
 * @throws if the bridge is not configured or n8n is unreachable.
 */
// ─────────────────────────────────────────────────────────────────────────────
// Signing protocol v2 (security correction, ART-20261022-019)
//
// v1 signed ONLY the body: the timestamp and request ID travelled unsigned,
// so a captured (body, signature) pair could be re-presented with a fresh
// timestamp and a new request ID — defeating the freshness window and any
// request-ID replay claim. v2 binds every field into one canonical message:
//
//   litt-n8n-bridge-v2\n{timestamp}\n{requestId}\n{path}\n{exact body}
//
// Requests carry x-litt-signature-version: 2. Protected webhooks accept v2
// ONLY — there is no silent v1 fallback (see the v2 verifier + bridge route).
// ─────────────────────────────────────────────────────────────────────────────

/** Value of the x-litt-signature-version header for the v2 protocol. */
export const SIGNING_VERSION_V2 = "2";

const CANONICAL_PREFIX_V2 = "litt-n8n-bridge-v2";

/** Canonical string that v2 signs. Field order and separators are protocol. */
export function buildCanonicalSigningStringV2(input: {
  timestamp: number;
  requestId: string;
  path: string;
  body: string;
}): string {
  return [
    CANONICAL_PREFIX_V2,
    String(input.timestamp),
    input.requestId,
    input.path,
    input.body,
  ].join("\n");
}

/** Result of signing a payload with the v2 protocol. */
export interface SignedWebhookV2 extends SignedWebhook {
  /** Unique request ID (sent as x-litt-request-id header). */
  requestId: string;
  /** Signature protocol version (sent as x-litt-signature-version header). */
  version: typeof SIGNING_VERSION_V2;
}

/** Sign a payload with the v2 protocol, bound to its target webhook path. */
export function signWebhookPayloadV2(
  payload: N8nWebhookPayload,
  webhookPath: string,
  requestId: string = randomUUID(),
  timestamp: number = Math.floor(Date.now() / 1000),
): SignedWebhookV2 {
  const secret = BRIDGE_SECRET();
  if (!secret) {
    throw new Error(
      "signWebhookPayloadV2: LITT_N8N_BRIDGE_SECRET is not configured",
    );
  }
  const body = JSON.stringify(payload);
  const signature = createHmac("sha256", secret)
    .update(buildCanonicalSigningStringV2({ timestamp, requestId, path: webhookPath, body }))
    .digest("hex");
  return { body, signature, timestamp, requestId, version: SIGNING_VERSION_V2 };
}

/**
 * Verify a v2 signed request. Every field is required and authenticated:
 * the timestamp window is meaningful precisely because the timestamp is
 * inside the MAC. Missing request ID or path fails closed.
 */
export function verifyWebhookSignatureV2(input: {
  body: string;
  signature: string;
  timestamp: number;
  requestId: string;
  path: string;
  now?: number;
}): boolean {
  const secret = BRIDGE_SECRET();
  if (!secret) return false;
  if (!input.signature || !input.requestId || !input.path) return false;
  if (!Number.isFinite(input.timestamp)) return false;

  const now = input.now ?? Math.floor(Date.now() / 1000);
  const age = now - input.timestamp;
  if (age > MAX_SIGNATURE_AGE_SECONDS || age < -MAX_SIGNATURE_AGE_SECONDS) {
    return false;
  }

  const expected = createHmac("sha256", secret)
    .update(buildCanonicalSigningStringV2(input))
    .digest("hex");
  const a = Buffer.from(input.signature);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function sendToN8n(
  webhookPath: string,
  payload: N8nWebhookPayload,
): Promise<N8nResponse> {
  const baseUrl = N8N_WEBHOOK_URL();
  if (!baseUrl) {
    throw new Error("sendToN8n: N8N_WEBHOOK_URL is not configured");
  }

  const { body, signature, timestamp, requestId, version } =
    signWebhookPayloadV2(payload, webhookPath);
  const targetUrl = `${baseUrl.replace(/\/$/, "")}/webhook/${webhookPath}`;

  const res = await fetch(targetUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-litt-signature": signature,
      "x-litt-timestamp": String(timestamp),
      "x-litt-request-id": requestId,
      "x-litt-signature-version": version,
    },
    body,
    signal: AbortSignal.timeout(60_000),
  });

  const text = await res.text();
  let parsed: unknown = text;
  try {
    parsed = JSON.parse(text);
  } catch {
    // keep raw text
  }

  return { ok: res.ok, status: res.status, body: parsed };
}
