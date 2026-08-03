export type PlanId =
  | "starter"
  | "creator_beta"
  | "pro_builder_beta"
  | "founder";

export type BillingType = "free" | "subscription" | "one_time";

export interface PlanDefinition {
  id: PlanId;
  name: string;
  description: string;
  billingType: BillingType;
  monthlyPriceCents: number | null;
  standardPriceCents: number | null;
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
    description: "Try LiTT and complete small projects",
    billingType: "free",
    monthlyPriceCents: 0,
    standardPriceCents: 0,
    monthlyCredits: 500,
    activeProjectLimit: 1,
    features: [
      "LiTT & Spark AI agents",
      "1 active project",
      "500 monthly LiTTBits",
      "Free AI routing",
      "Basic code generation",
      "Basic image generation",
      "Public previews",
      "Free Marketplace tools",
      "Community support",
    ],
    beta: false,
    enabled: true,
  },
  creator_beta: {
    id: "creator_beta",
    name: "Creator Beta",
    description: "Research, write, and market with your AI team",
    billingType: "subscription",
    monthlyPriceCents: 700,
    standardPriceCents: 1500,
    stripePriceIdEnv: "STRIPE_PRICE_CREATOR_BETA",
    monthlyCredits: 6000,
    activeProjectLimit: 5,
    features: [
      "Researcher — source-backed research & comparisons",
      "Writer — ready-to-publish content & copy",
      "Marketer — campaigns, SEO & growth",
      "LiTT & Spark included",
      "5 active projects",
      "6,000 monthly LiTTBits",
      "Private projects",
      "GitHub connection",
      "Project downloads",
      "Images and audio",
      "Voice mode",
      "Basic deployment",
    ],
    beta: true,
    enabled: true,
  },
  pro_builder_beta: {
    id: "pro_builder_beta",
    name: "Pro Builder Beta",
    description: "Build, debug, and analyze with your full AI team",
    billingType: "subscription",
    monthlyPriceCents: 1900,
    standardPriceCents: 3900,
    stripePriceIdEnv: "STRIPE_PRICE_PRO_BUILDER_BETA",
    monthlyCredits: 20000,
    activeProjectLimit: 25,
    features: [
      "Coder — repository-aware implementation & debugging",
      "Analyst — data interpretation & recommendations",
      "Everything in Creator Beta",
      "25 active projects",
      "20,000 monthly LiTTBits",
      "Terminal runtime",
      "Advanced coding models",
      "Diff and approval",
      "Vercel deployment",
      "Supabase integration",
      "Larger uploads",
      "Priority generation",
    ],
    beta: true,
    enabled: true,
  },
  founder: {
    id: "founder",
    name: "Founding Member",
    description: "Permanent Creator-level AI team access",
    billingType: "one_time",
    monthlyPriceCents: 14900,
    standardPriceCents: null,
    stripePriceIdEnv: "STRIPE_PRICE_FOUNDER",
    monthlyCredits: 6000,
    activeProjectLimit: 5,
    features: [
      "Permanent Creator-level agent access",
      "Researcher, Writer & Marketer forever",
      "Founder badge",
      "Early feature access",
      "20% off future usage packs",
      "Higher beta limits",
      "Priority feedback channel",
      "Price protection",
    ],
    beta: true,
    enabled: true,
    founderLimit: 250,
  },
};

export const PLAN_LIST = Object.values(PLANS);

/**
 * Plan rank — higher = more access. Used by the agent entitlement resolver
 * to determine whether a user's active plan covers a specialist agent's
 * minimumPlan requirement. Founder is treated as Creator-level for agent
 * access (permanent Creator-tier benefit), so it ranks equal to creator_beta.
 */
export const PLAN_RANK: Record<PlanId, number> = {
  starter: 0,
  creator_beta: 1,
  founder: 1,
  pro_builder_beta: 2,
};

export function getPlanById(id: string): PlanDefinition | null {
  return PLANS[id as PlanId] ?? null;
}

/**
 * Returns true if `userPlan` satisfies the `requiredPlan` threshold.
 * Founder counts as Creator-level (rank 1) — it does NOT unlock Pro-only
 * agents (Coder, Analyst). Pro Builder unlocks everything.
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
