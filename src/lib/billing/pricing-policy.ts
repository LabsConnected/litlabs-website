/**
 * Versioned LiTTBits exchange policies.
 *
 * littbits-exchange-v1 is the legacy policy: generation lane 100 LiTTBits
 * per USD, LLM lane 1,000 LiTTBits per USD. It stays identifiable so
 * historical charges stamped with that id can still be read.
 *
 * littbits-exchange-v2-100-unapproved is the #684 candidate: 100 LiTTBits
 * per USD on every lane. It is UNAPPROVED pending owner economics review.
 * It must not be treated as permission to change customer-facing pricing
 * pages, plan allowances, balances, or Stripe.
 */

export const LEGACY_EXCHANGE_POLICY_ID = "littbits-exchange-v1" as const;
export const UNAPPROVED_EXCHANGE_POLICY_ID = "littbits-exchange-v2-100-unapproved" as const;

/** Legacy LLM lane. Kept so the 1,000 bits/$ policy remains identifiable. */
export const LEGACY_LLM_BITS_PER_USD = 1000;

/**
 * Candidate LLM lane. UNAPPROVED — pending owner economics review.
 * The cost engine reads this number. Shipping it is not an approval.
 */
export const UNAPPROVED_LLM_BITS_PER_USD = 100;

export const GENERATION_BITS_PER_USD = 100;

export type PricingPolicyApproval = "legacy" | "UNAPPROVED";

export interface PricingPolicy {
  id: typeof LEGACY_EXCHANGE_POLICY_ID | typeof UNAPPROVED_EXCHANGE_POLICY_ID;
  llmBitsPerUsd: number;
  generationBitsPerUsd: number;
  approval: PricingPolicyApproval;
  /** Human-readable status. The 100/$ policy must stay marked UNAPPROVED. */
  note: string;
}

export const PRICING_POLICIES: Record<
  typeof LEGACY_EXCHANGE_POLICY_ID | typeof UNAPPROVED_EXCHANGE_POLICY_ID,
  PricingPolicy
> = {
  [LEGACY_EXCHANGE_POLICY_ID]: {
    id: LEGACY_EXCHANGE_POLICY_ID,
    llmBitsPerUsd: LEGACY_LLM_BITS_PER_USD,
    generationBitsPerUsd: GENERATION_BITS_PER_USD,
    approval: "legacy",
    note: "Legacy parity. LLM lane is 1,000 LiTTBits per USD. Generation lane is 100.",
  },
  [UNAPPROVED_EXCHANGE_POLICY_ID]: {
    id: UNAPPROVED_EXCHANGE_POLICY_ID,
    llmBitsPerUsd: UNAPPROVED_LLM_BITS_PER_USD,
    generationBitsPerUsd: GENERATION_BITS_PER_USD,
    approval: "UNAPPROVED",
    note: "UNAPPROVED pending owner economics review. 100 LiTTBits = $1 on the LLM lane. Do not change customer-facing prices, plan allowances, balances, or Stripe on the strength of this policy.",
  },
};

/**
 * Policy id the cost engine is computing with. UNAPPROVED.
 * Not the id to stamp as an approved production rate.
 */
export const ACTIVE_LLM_POLICY_ID = UNAPPROVED_EXCHANGE_POLICY_ID;
