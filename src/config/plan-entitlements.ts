/**
 * PLAN_ENTITLEMENTS — the SINGLE source of truth for plan allowances.
 *
 * Every consumer (src/config/plans.ts, src/config/product-truth.ts,
 * src/lib/entitlements.ts, grant logic, UI) MUST derive its numbers from
 * here. Do not hardcode plan allowances anywhere else.
 *
 * Locked pricing (rev 2, 2026-09-29):
 * - Starter: free, 1,500 LiTTBits ONE-TIME grant (not monthly, not renewing)
 * - Creator: $15/mo, 7,500 LiTTBits/month
 * - Pro Builder: $39/mo, 18,000 LiTTBits/month
 *
 * The 40,000 Pro allowance is dead. There are no comeback credits and no
 * rollover in rev 2.
 *
 * NOTE on the $1 / 1,000 LiTTBits conversion: this is a PRICING MODEL, not a
 * validated fact. It is labeled `modeled` everywhere and must not be treated
 * as measured ground truth until 50–100 genuine Studio sessions validate it.
 */
import type { PlanId } from "./plans";

export type RoutingTier = "standard" | "better" | "best";

export interface PlanFeatureGates {
  privateProjects: boolean;
  github: boolean;
  terminal: boolean;
  voice: boolean;
  premiumModels: boolean;
  deployment: boolean;
}

export interface PlanEntitlements {
  /**
   * Recurring LiTTBits granted per billing cycle. 0 for one-time plans
   * (Starter) and non-billable plans (founder one-time, owner exempt).
   * Founder is a retired one-time tier with permanent Creator-level access,
   * so its recurring-equivalent access is Creator-level (7,500).
   */
  monthlyBits: number;
  /**
   * One-time LiTTBits grant for free plans. Starter only (1,500).
   * Granted idempotently on first billable attempt via key
   * `starter:v1:{userId}` — never collides with the legacy
   * `starter:{userId}` 500 grants. Accounts holding only a legacy grant
   * receive a one-time idempotent +1,000 top-up (`starter:topup-v1:{userId}`)
   * so their lifetime Starter grant equals the locked 1,500.
   */
  oneTimeGrantBits: number;
  /** Price in cents per billing cycle. null = not purchasable. */
  monthlyPriceCents: number | null;
  /** Agent starts per rolling 5-hour window. */
  agentStartsPer5h: number;
  /** Browser starts per rolling 5-hour window. */
  browserStartsPer5h: number;
  /** Max concurrent agents. */
  maxConcurrency: number;
  /** Max agent runtime in minutes (hard cap). */
  maxRuntimeMinutes: number;
  /** Model routing tier. */
  routingTier: RoutingTier;
  /** Feature gates. */
  features: PlanFeatureGates;
  /** Max active projects. */
  activeProjectLimit: number;
}

export const PLAN_ENTITLEMENTS: Record<PlanId, PlanEntitlements> = {
  starter: {
    monthlyBits: 0,
    oneTimeGrantBits: 1500,
    monthlyPriceCents: 0,
    agentStartsPer5h: 1,
    browserStartsPer5h: 1,
    maxConcurrency: 1,
    maxRuntimeMinutes: 15,
    routingTier: "standard",
    features: {
      privateProjects: false,
      github: false,
      terminal: false,
      voice: false,
      premiumModels: false,
      deployment: false,
    },
    activeProjectLimit: 1,
  },
  creator_beta: {
    monthlyBits: 7500,
    oneTimeGrantBits: 0,
    monthlyPriceCents: 1500,
    agentStartsPer5h: 3,
    browserStartsPer5h: 3,
    maxConcurrency: 3,
    maxRuntimeMinutes: 45,
    routingTier: "better",
    features: {
      privateProjects: true,
      github: true,
      terminal: false,
      voice: true,
      premiumModels: false,
      deployment: true,
    },
    activeProjectLimit: 5,
  },
  pro_builder_beta: {
    monthlyBits: 18000,
    oneTimeGrantBits: 0,
    monthlyPriceCents: 3900,
    agentStartsPer5h: 8,
    browserStartsPer5h: 8,
    maxConcurrency: 8,
    maxRuntimeMinutes: 120,
    routingTier: "best",
    features: {
      privateProjects: true,
      github: true,
      terminal: true,
      voice: true,
      premiumModels: true,
      deployment: true,
    },
    activeProjectLimit: 25,
  },
  founder: {
    // Retired one-time tier — permanent Creator-level access for existing members.
    monthlyBits: 7500,
    oneTimeGrantBits: 0,
    monthlyPriceCents: null,
    agentStartsPer5h: 3,
    browserStartsPer5h: 3,
    maxConcurrency: 3,
    maxRuntimeMinutes: 45,
    routingTier: "better",
    features: {
      privateProjects: true,
      github: true,
      terminal: false,
      voice: true,
      premiumModels: false,
      deployment: true,
    },
    activeProjectLimit: 5,
  },
  owner: {
    // Internal — billing exempt. Generous capacity, no credit accounting.
    monthlyBits: 0,
    oneTimeGrantBits: 0,
    monthlyPriceCents: null,
    agentStartsPer5h: 999,
    browserStartsPer5h: 999,
    maxConcurrency: 999,
    maxRuntimeMinutes: 480,
    routingTier: "best",
    features: {
      privateProjects: true,
      github: true,
      terminal: true,
      voice: true,
      premiumModels: true,
      deployment: true,
    },
    activeProjectLimit: 999_999,
  },
};

/**
 * The headline credit number for a plan: the one-time grant for Starter,
 * the monthly allowance for subscriptions, the Creator-equivalent for
 * founder, 0 for owner (billing exempt).
 */
export function getPlanCreditAllowance(planId: PlanId): number {
  const e = PLAN_ENTITLEMENTS[planId];
  if (planId === "starter") return e.oneTimeGrantBits;
  return e.monthlyBits;
}

/**
 * Display formatting for LiTTBits allowances, e.g. 1500 -> "1,500".
 * UI copy MUST use this (via getPlanCreditAllowance), never hardcoded numbers.
 */
export function formatBits(bits: number): string {
  return bits.toLocaleString("en-US");
}

/**
 * Modeled provider-cost conversion: 1,000 LiTTBits ≈ $1.00 of provider spend.
 * MODEL ONLY — not validated against measured costs. Do not use as ground
 * truth for billing; it exists for capacity planning and margin estimates.
 */
export const BITS_PER_USD_MODELED = 1000;

/** Idempotency key namespace for the Starter one-time grant. */
export const STARTER_GRANT_KEY_PREFIX = "starter:v1:";

/** Idempotency key namespace for the legacy pre-v1 Starter grant (500 bits). */
export const LEGACY_STARTER_GRANT_KEY_PREFIX = "starter:";

/** Idempotency key namespace for the one-time legacy top-up (+1,000 bits). */
export const STARTER_TOPUP_KEY_PREFIX = "starter:topup-v1:";

/**
 * Bits granted by the legacy pre-v1 Starter grant. Historical fact — the old
 * grant issued exactly this amount under `starter:{userId}` keys.
 */
export const LEGACY_STARTER_GRANT_BITS = 500;

/**
 * One-time top-up for accounts that only ever received the legacy 500-bit
 * Starter grant. Derived from the single source so the lifetime Starter
 * grant always equals the locked allowance — never a second full grant.
 */
export const STARTER_TOPUP_BITS =
  PLAN_ENTITLEMENTS.starter.oneTimeGrantBits - LEGACY_STARTER_GRANT_BITS;
