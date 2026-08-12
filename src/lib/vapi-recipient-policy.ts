/**
 * Recipient policy for Vapi owner notification tools (send_sms, send_email).
 *
 * Pure, side-effect-free module so the policy can be behaviorally tested
 * without spinning up the route or mocking fetch.
 *
 * Rules:
 * - The configured owner destination is always allowed.
 * - An explicit server-side allowlist (LITTLABS_ALLOWED_RECIPIENTS) may
 *   permit additional destinations.
 * - Any other destination is rejected.
 * - If no owner destination is configured, the policy fails closed.
 */

export interface RecipientPolicyEnv {
  ownerDestination: string | undefined;
  allowedRecipientsRaw: string | undefined;
}

/**
 * Parse the comma-separated allowlist into a Set.
 */
export function parseAllowedRecipients(raw: string | undefined): Set<string> {
  if (!raw) return new Set();
  return new Set(
    raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  );
}

/**
 * Resolve whether a requested destination is permitted.
 *
 * Returns { allowed: true } if the destination is the owner or in the
 * allowlist. Returns { allowed: false, reason } otherwise.
 *
 * If ownerDestination is empty/undefined, the policy fails closed with
 * a clear reason — no outbound send may proceed without a configured
 * owner destination.
 */
export function resolveRecipient(
  requestedDestination: string,
  env: RecipientPolicyEnv,
): { allowed: true } | { allowed: false; reason: string } {
  const owner = (env.ownerDestination ?? "").trim();

  if (!owner) {
    return {
      allowed: false,
      reason:
        "No owner destination is configured. Set LITTLABS_OWNER_PHONE or LITTLABS_OWNER_EMAIL before sending.",
    };
  }

  if (requestedDestination === owner) {
    return { allowed: true };
  }

  const allowlist = parseAllowedRecipients(env.allowedRecipientsRaw);
  if (allowlist.has(requestedDestination)) {
    return { allowed: true };
  }

  return {
    allowed: false,
    reason: `Rejected: destination ${requestedDestination} is not the configured owner or in the server-side allowlist (LITTLABS_ALLOWED_RECIPIENTS).`,
  };
}
