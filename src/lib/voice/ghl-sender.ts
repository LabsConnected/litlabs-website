/**
 * GoHighLevel Webhook Sender
 *
 * Sends the normalized call payload to GHL's inbound webhook.
 * This is fire-and-forget — failures are logged but never block
 * the call lifecycle response.
 */

import type { GHLCallPayload } from "./ghl-types";

const GHL_WEBHOOK_URL = process.env.GHL_WEBHOOK_URL;

/**
 * Send a call payload to GoHighLevel's webhook.
 * Returns true on success, false on failure.
 * Never throws — caller doesn't need to handle errors.
 */
export async function sendCallToGHL(payload: GHLCallPayload): Promise<boolean> {
  if (!GHL_WEBHOOK_URL) {
    console.log("[GHL] No GHL_WEBHOOK_URL configured — skipping CRM sync");
    return false;
  }

  try {
    const res = await fetch(GHL_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15_000),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      console.error(`[GHL] Webhook returned ${res.status}: ${text.slice(0, 200)}`);
      return false;
    }

    console.log(`[GHL] Call ${payload.callId} synced to GHL (intent: ${payload.intent}, lead: ${payload.leadStatus})`);
    return true;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[GHL] Failed to send call to GHL: ${msg}`);
    return false;
  }
}
