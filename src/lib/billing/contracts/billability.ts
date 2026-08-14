/**
 * Canonical billability classification.
 *
 * Every usage event must know WHY the customer is or is not charged.
 * This is a typed field that billing policy can use to answer:
 *
 *   "Why is this execution billable?"
 *
 * Failure classification rules (from master directive):
 *
 *   LiTT internal failure       → customer pays 0 → LiTT absorbs cost
 *   Duplicate due to LiTT retry → customer pays once
 *   User cancel before usage    → 0
 *   User cancel after usage     → charge consumed amount
 *   Successful partial result   → charge actual usage
 *   Provider outage             → generally LiTT absorbs
 *   LiTT incorrectly retried    → LiTT absorbs unnecessary retry cost
 */

/**
 * Billability cause — why this execution is or is not billable.
 */
export type BillabilityCause =
  /** Normal customer-initiated usage. Customer is charged. */
  | "USER_REQUEST"
  /** Customer cancelled before provider usage occurred. Not charged. */
  | "USER_CANCEL_BEFORE_USAGE"
  /** Customer cancelled after meaningful provider usage. Charged for consumed amount. */
  | "USER_CANCEL_AFTER_USAGE"
  /** LiTT internal retry of the same request. Customer pays once; LiTT absorbs retry. */
  | "RETRY_INTERNAL"
  /** Provider-side retry (e.g. transient 429/503). Customer pays once; LiTT absorbs retry. */
  | "PROVIDER_RETRY"
  /** System-initiated retry (e.g. timeout, infrastructure). LiTT absorbs. */
  | "SYSTEM_RETRY"
  /** Speculative/prefetch execution. Not charged. */
  | "SPECULATIVE"
  /** Result served from cache. Not charged (or charged at reduced rate). */
  | "CACHE_HIT"
  /** Execution failed due to LiTT internal error. Not charged. LiTT absorbs cost. */
  | "FAILURE_LITT"
  /** Execution failed due to provider error/outage. Not charged. LiTT absorbs cost. */
  | "FAILURE_PROVIDER"
  /** Promotional/free usage. Not charged. */
  | "PROMOTION"
  /** Internal/platform usage. Not charged to customer. Metered for cost analysis. */
  | "INTERNAL"
  /** BYOK (bring-your-own-key). Provider bills user directly. LiTT charges platform fee only. */
  | "BYOK";

/**
 * Whether a billability cause results in a customer charge.
 */
export function isBillable(cause: BillabilityCause): boolean {
  switch (cause) {
    case "USER_REQUEST":
    case "USER_CANCEL_AFTER_USAGE":
    case "BYOK": // BYOK charges platform fee, not provider cost
      return true;
    case "USER_CANCEL_BEFORE_USAGE":
    case "RETRY_INTERNAL":
    case "PROVIDER_RETRY":
    case "SYSTEM_RETRY":
    case "SPECULATIVE":
    case "CACHE_HIT":
    case "FAILURE_LITT":
    case "FAILURE_PROVIDER":
    case "PROMOTION":
    case "INTERNAL":
      return false;
    default:
      return false;
  }
}

/**
 * Whether LiTT absorbs the provider cost for this cause.
 * (Cost is still metered, but not passed to the customer.)
 */
export function isLiittAbsorbed(cause: BillabilityCause): boolean {
  switch (cause) {
    case "RETRY_INTERNAL":
    case "PROVIDER_RETRY":
    case "SYSTEM_RETRY":
    case "FAILURE_LITT":
    case "FAILURE_PROVIDER":
    case "SPECULATIVE":
      return true;
    case "USER_REQUEST":
    case "USER_CANCEL_AFTER_USAGE":
    case "USER_CANCEL_BEFORE_USAGE":
    case "CACHE_HIT":
    case "PROMOTION":
    case "INTERNAL":
    case "BYOK":
      return false;
    default:
      return false;
  }
}

/**
 * Whether the provider cost should still be metered (recorded for analytics)
 * even if the customer is not charged.
 */
export function shouldMeterProviderCost(cause: BillabilityCause): boolean {
  // All causes should meter provider cost for analytics, except CACHE_HIT
  // where no provider call was made.
  return cause !== "CACHE_HIT";
}

/**
 * Billability decision attached to a usage event.
 */
export interface BillabilityDecision {
  /** The classified cause. */
  cause: BillabilityCause;
  /** Whether the customer is charged. */
  billable: boolean;
  /** Whether LiTT absorbs the provider cost. */
  liittAbsorbed: boolean;
  /** Whether provider cost is metered. */
  meterProviderCost: boolean;
  /** Human-readable explanation. */
  reason: string;
  /** The original request ID if this is a retry (for deduplication). */
  originalRequestId: string | null;
  /** Retry sequence number (0 = first attempt, 1+ = retries). */
  retrySequence: number;
}

/**
 * Create a billability decision from a cause.
 */
export function createBillabilityDecision(
  cause: BillabilityCause,
  options?: {
    reason?: string;
    originalRequestId?: string;
    retrySequence?: number;
  },
): BillabilityDecision {
  return {
    cause,
    billable: isBillable(cause),
    liittAbsorbed: isLiittAbsorbed(cause),
    meterProviderCost: shouldMeterProviderCost(cause),
    reason: options?.reason ?? cause,
    originalRequestId: options?.originalRequestId ?? null,
    retrySequence: options?.retrySequence ?? 0,
  };
}
