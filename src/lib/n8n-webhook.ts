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

import { createHmac, timingSafeEqual } from "crypto";

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
export async function sendToN8n(
  webhookPath: string,
  payload: N8nWebhookPayload,
): Promise<N8nResponse> {
  const baseUrl = N8N_WEBHOOK_URL();
  if (!baseUrl) {
    throw new Error("sendToN8n: N8N_WEBHOOK_URL is not configured");
  }

  const { body, signature, timestamp } = signWebhookPayload(payload);
  const targetUrl = `${baseUrl.replace(/\/$/, "")}/webhook/${webhookPath}`;

  const res = await fetch(targetUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-litt-signature": signature,
      "x-litt-timestamp": String(timestamp),
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
