/**
 * n8n Webhook Sender
 *
 * Sends the normalized call payload to n8n's inbound webhook.
 * n8n is the orchestration layer — it decides what to do with
 * the call data: create/update CRM contacts, send notifications,
 * trigger follow-up workflows, route to GHL, send emails, etc.
 *
 * This replaces the direct GHL integration. LiTT no longer
 * talks to GoHighLevel directly for voice calls — n8n handles
 * all downstream routing.
 *
 * This is fire-and-forget — failures are logged but never block
 * the call lifecycle response.
 */

import type { CallPayload } from "./call-payload-types";

const N8N_VOICE_WEBHOOK_URL = process.env.N8N_VOICE_WEBHOOK_URL;
const N8N_VOICE_WEBHOOK_TOKEN = process.env.N8N_VOICE_WEBHOOK_TOKEN;

/**
 * Send a call payload to n8n's webhook.
 * Returns true on success, false on failure.
 * Never throws — caller doesn't need to handle errors.
 */
export async function sendCallToN8n(payload: CallPayload): Promise<boolean> {
  if (!N8N_VOICE_WEBHOOK_URL) {
    console.log("[n8n] No N8N_VOICE_WEBHOOK_URL configured — skipping orchestration");
    return false;
  }

  try {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    // Optional auth token if configured
    if (N8N_VOICE_WEBHOOK_TOKEN) {
      headers["Authorization"] = `Bearer ${N8N_VOICE_WEBHOOK_TOKEN}`;
    }

    const res = await fetch(N8N_VOICE_WEBHOOK_URL, {
      method: "POST",
      headers,
      body: JSON.stringify({
        // Wrap in a labeled event so n8n can route by type
        event: "voice.call.ended",
        source: "litt-vapi",
        timestamp: new Date().toISOString(),
        data: payload,
      }),
      signal: AbortSignal.timeout(15_000),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      console.error(`[n8n] Webhook returned ${res.status}: ${text.slice(0, 200)}`);
      return false;
    }

    console.log(
      `[n8n] Call ${payload.callId} sent to n8n (intent: ${payload.intent}, lead: ${payload.leadStatus})`,
    );
    return true;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[n8n] Failed to send call to n8n: ${msg}`);
    return false;
  }
}
