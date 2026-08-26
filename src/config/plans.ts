export type PlanId =
  | "starter"
  | "creator_beta"
  | "pro_builder_beta"
  | "founder"
  | "owner"; // Internal-only — not billable via Stripe, not shown in PLANS

export type BillingType = "free" | "subscription" | "one_time";

export interface PlanDefinition {
  id: PlanId;
  name: string;
  description: string;
  billingType: BillingType;
  monthlyPriceCents: number | null;
  standardPriceCents: number | null;
  default_price: number | null;
  stripePriceIdEnv?: string;
  monthlyCredits: number;
  activeProjectLimit: number;
  features: string[];
  beta: boolean;
  enabled: boolean;
  founderLimit?: number;
}

export const PLANS: Record<PlanId, PlanDefinition> = {
  starter: {
    id: "starter",
    name: "Starter",
    description: "Explore LiTT and complete small projects",
    billingType: "free",
    monthlyPriceCents: 0,
    standardPriceCents: 0,
    default_price: 0,
    monthlyCredits: 500,
    activeProjectLimit: 1,
    features: [
      "LiTT & Spark agents",
      "1 active project",
      "500 AI credits (one-time)",
      "Standard AI routing",
      "Code generation",
      "Image generation",
      "Public previews",
      "Marketplace tools",
      "Community support",
    ],
    beta: false,
    enabled: true,
  },
  creator_beta: {
    id: "creator_beta",
    name: "Creator Beta",
    description: "Research, write, and market with AI agents",
    billingType: "subscription",
    monthlyPriceCents: 1500,
    standardPriceCents: 2500,
    default_price: 1500,
    stripePriceIdEnv: "STRIPE_PRICE_CREATOR_BETA",
    monthlyCredits: 6000,
    activeProjectLimit: 5,
    features: [
      "LiTT & Spark agents",
      "Research, writing & marketing skills",
      "5 active projects",
      "6,000 AI credits per billing cycle",
      "Private projects",
      "GitHub connection",
      "Project downloads",
      "Image and audio generation",
      "Voice mode",
      "Preview deployments",
    ],
    beta: true,
    enabled: true,
  },
  pro_builder_beta: {
    id: "pro_builder_beta",
    name: "Pro Builder Beta",
    description: "Build, debug, and deploy with full AI tooling",
    billingType: "subscription",
    monthlyPriceCents: 3900,
    standardPriceCents: 4900,
    default_price: 3900,
    stripePriceIdEnv: "STRIPE_PRICE_PRO_BUILDER_BETA",
    monthlyCredits: 20000,
    activeProjectLimit: 25,
    features: [
      "LiTT & Spark agents",
      "Coding & analytics skills",
      "Everything in Creator Beta",
      "25 active projects",
      "20,000 AI credits per billing cycle",
      "Terminal runtime",
      "Advanced coding models",
      "Diff review and approval",
      "Production deployment",
      "Supabase integration",
      "Larger file uploads",
      "Priority generation",
    ],
    beta: true,
    enabled: true,
  },
  founder: {
    id: "founder",
    name: "Founding Member",
    description: "Permanent Creator-level access — $149 one-time",
    billingType: "one_time",
    monthlyPriceCents: 14900,
    standardPriceCents: null,
    default_price: 14900,
    stripePriceIdEnv: "STRIPE_PRICE_FOUNDER",
    monthlyCredits: 0,
    activeProjectLimit: 5,
    features: [
      "Permanent Creator-level access",
      "Founder badge",
    ],
    beta: true,
    enabled: true,
    founderLimit: 100,
  },
  owner: {
    id: "owner",
    name: "OWNER",
    description: "Internal — platform owner. Not billable, not shown to customers.",
    billingType: "free",
    monthlyPriceCents: null,
    standardPriceCents: null,
    default_price: null,
    monthlyCredits: 0, // billing_exempt — wallet not used; display "DEV ∞"
    activeProjectLimit: 999_999,
    features: [],
    beta: true,
    enabled: false, // Not purchasable
  },
};

export const PLAN_LIST = Object.values(PLANS).filter((p) => p.enabled); // Excludes internal "owner" plan (enabled: false)

/**
 * Plan rank — higher = more access. Used by the agent entitlement resolver
 * to determine whether a user's active plan covers a specialist agent's
 * minimumPlan requirement. Founding Member grants permanent Creator-level
 * access, so it ranks equal to creator_beta.
 */
export const PLAN_RANK: Record<PlanId, number> = {
  starter: 0,
  creator_beta: 1,
  founder: 1,
  pro_builder_beta: 2,
  owner: 999, // Internal — above all customer tiers
};

export function getPlanById(id: string): PlanDefinition | null {
  return PLANS[id as PlanId] ?? null;
}

/**
 * Returns true if `userPlan` satisfies the `requiredPlan` threshold.
 * Founding Member counts as Creator-level (rank 1) — it does NOT unlock
 * Pro-only agents (Coder, Analyst). Pro Builder unlocks everything.
 */
export function hasPlanAccess(userPlan: PlanId, requiredPlan: PlanId): boolean {
  return PLAN_RANK[userPlan] >= PLAN_RANK[requiredPlan];
}

export function getStripePriceId(plan: PlanDefinition): string | null {
  if (!plan.stripePriceIdEnv) return null;
  const priceId = process.env[plan.stripePriceIdEnv];
  if (!priceId || priceId.length < 5) return null;
  return priceId;
}

export function formatPrice(cents: number | null): string {
  if (cents === null || cents === 0) return "Free";
  return `$${(cents / 100).toFixed(0)}`;
}

export function formatPriceMonthly(cents: number | null): string {
  if (cents === null || cents === 0) return "Free";
  return `$${(cents / 100).toFixed(0)}/month`;
}
