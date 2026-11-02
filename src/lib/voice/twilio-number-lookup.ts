/**
 * Read-only Twilio number ownership/capabilities verification.
 *
 * This module makes NO real Twilio API calls anywhere in Phase 2A — it only
 * defines the operation and verifies its logic against a fake client. The
 * real implementation (constructing an actual `twilio` SDK client with
 * TWILIO_ACCOUNT_SID/TWILIO_AUTH_TOKEN) is explicitly out of scope until
 * Larry authorizes making a live Twilio API call, per the Phase 2 checklist.
 */

export interface TwilioIncomingNumber {
  sid: string;
  phoneNumber: string;
  capabilities: { voice: boolean; sms: boolean; mms: boolean };
}

// The one Twilio operation this module needs — intentionally narrow and
// read-only (Twilio's "list incoming phone numbers" lookup never mutates
// anything). A real implementation wraps the `twilio` SDK's
// client.incomingPhoneNumbers.list({ phoneNumber }) call behind this same
// shape; tests here only ever see a fake.
export interface TwilioNumberLookupClient {
  listIncomingPhoneNumbers(phoneNumber: string): Promise<TwilioIncomingNumber[]>;
}

export type NumberVerificationResult =
  | { owned: true; capabilities: TwilioIncomingNumber["capabilities"] }
  | { owned: false; reason: "not_found" | "lookup_failed" };

/**
 * Verifies that `phoneNumber` is actually owned by this Twilio account and
 * reports its capabilities. Read-only: never provisions, purchases, or
 * modifies anything. Fails closed — a lookup error is reported as
 * "not owned", never silently treated as verified.
 */
export async function verifyNumberOwnership(
  client: TwilioNumberLookupClient,
  phoneNumber: string,
): Promise<NumberVerificationResult> {
  let results: TwilioIncomingNumber[];
  try {
    results = await client.listIncomingPhoneNumbers(phoneNumber);
  } catch {
    return { owned: false, reason: "lookup_failed" };
  }

  const match = results.find((n) => n.phoneNumber === phoneNumber);
  if (!match) {
    return { owned: false, reason: "not_found" };
  }

  return { owned: true, capabilities: match.capabilities };
}
