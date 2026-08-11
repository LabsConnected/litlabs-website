/**
 * GHL Service Inquiry Sender
 *
 * After a service inquiry is stored in Supabase, this module sends
 * the lead to GoHighLevel via an inbound webhook. GHL's workflow
 * engine then:
 *   1. Creates or updates a contact
 *   2. Tags the contact with "service-inquiry" + the specific service tag
 *   3. Creates an opportunity in the "Service Inquiries" pipeline
 *   4. Sends a notification to the LiTT/admin team
 *
 * This is fire-and-forget — failures are logged but never block
 * the inquiry submission. The Supabase row is the source of truth.
 */

export interface GHLServiceInquiryPayload {
  /** Type of event — GHL workflow uses this to route */
  type: "service_inquiry";
  /** Supabase row ID */
  inquiryId: string;
  /** Service offer ID (launch_sprint, automation_setup, brand_pack) */
  serviceId: string | null;
  /** Human-readable service name */
  serviceName: string | null;
  /** Lead name */
  name: string;
  /** Lead email */
  email: string;
  /** Lead phone (if provided) */
  phone: string | null;
  /** Lead company (if provided) */
  company: string | null;
  /** Lead message (if provided) */
  message: string | null;
  /** Source of the inquiry */
  source: string;
  /** Referral code (if provided) */
  referralCode: string | null;
  /** ISO timestamp */
  submittedAt: string;
  /** Tags for GHL contact */
  tags: string[];
}

/**
 * Build the GHL payload for a service inquiry.
 * Tags are derived server-side — never from client input.
 */
export function buildGHLServiceInquiryPayload(params: {
  inquiryId: string;
  serviceId: string | null;
  serviceName: string | null;
  name: string;
  email: string;
  phone: string | null;
  company: string | null;
  message: string | null;
  source: string;
  referralCode: string | null;
}): GHLServiceInquiryPayload {
  // Server-derived tags — client cannot inject arbitrary tags
  const tags = ["service-inquiry"];
  if (params.serviceId) {
    // Map service IDs to GHL-friendly tag names
    const serviceTagMap: Record<string, string> = {
      launch_sprint: "launch-sprint",
      automation_setup: "automation-setup",
      brand_pack: "brand-pack",
    };
    const tag = serviceTagMap[params.serviceId];
    if (tag) tags.push(tag);
  }

  return {
    type: "service_inquiry",
    inquiryId: params.inquiryId,
    serviceId: params.serviceId,
    serviceName: params.serviceName,
    name: params.name,
    email: params.email,
    phone: params.phone,
    company: params.company,
    message: params.message,
    source: params.source,
    referralCode: params.referralCode,
    submittedAt: new Date().toISOString(),
    tags,
  };
}

/**
 * Send a service inquiry to GHL via webhook.
 * Returns true on success, false on failure.
 * Never throws — caller doesn't need to handle errors.
 */
export async function sendServiceInquiryToGHL(
  payload: GHLServiceInquiryPayload,
): Promise<boolean> {
  const webhookUrl = process.env.GHL_SERVICE_INQUIRY_WEBHOOK_URL;

  if (!webhookUrl) {
    console.log("[GHL] No GHL_SERVICE_INQUIRY_WEBHOOK_URL configured — skipping CRM sync for service inquiry");
    return false;
  }

  try {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15_000),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      console.error(
        `[GHL] Service inquiry webhook returned ${res.status}: ${text.slice(0, 200)}`,
      );
      return false;
    }

    console.log(
      `[GHL] Service inquiry ${payload.inquiryId} synced to GHL (service: ${payload.serviceId ?? "none"}, tags: ${payload.tags.join(",")})`,
    );
    return true;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[GHL] Failed to send service inquiry to GHL: ${msg}`);
    return false;
  }
}
