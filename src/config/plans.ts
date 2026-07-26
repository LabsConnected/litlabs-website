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
      "1 active project",
      "500 monthly LiTBits",
      "LiTT and Spark",
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
    description: "Individual builders and creators",
    billingType: "subscription",
    monthlyPriceCents: 700,
    standardPriceCents: 1500,
    stripePriceIdEnv: "STRIPE_PRICE_CREATOR_BETA",
    monthlyCredits: 6000,
    activeProjectLimit: 5,
    features: [
      "5 active projects",
      "6,000 monthly LiTBits",
      "Private projects",
      "GitHub connection",
      "Project downloads",
      "Images and audio",
      "Voice mode",
      "Longer memory",
      "Basic deployment",
      "Premium themes and wallpapers",
    ],
    beta: true,
    enabled: true,
  },
  pro_builder_beta: {
    id: "pro_builder_beta",
    name: "Pro Builder Beta",
    description: "Heavy code, media, terminal, deployment",
    billingType: "subscription",
    monthlyPriceCents: 1900,
    standardPriceCents: 3900,
    stripePriceIdEnv: "STRIPE_PRICE_PRO_BUILDER_BETA",
    monthlyCredits: 20000,
    activeProjectLimit: 25,
    features: [
      "25 active projects",
      "20,000 monthly LiTBits",
      "Terminal runtime",
      "Advanced coding models",
      "Diff and approval",
      "Vercel deployment",
      "Supabase integration",
      "Larger uploads",
      "Longer autonomous Missions",
      "Priority generation",
      "Usage controls",
    ],
    beta: true,
    enabled: true,
  },
  founder: {
    id: "founder",
    name: "Founding Member",
    description: "Early supporters with permanent benefits",
    billingType: "one_time",
    monthlyPriceCents: 14900,
    standardPriceCents: null,
    stripePriceIdEnv: "STRIPE_PRICE_FOUNDER",
    monthlyCredits: 6000,
    activeProjectLimit: 5,
    features: [
      "Permanent Creator-level account",
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

export function getPlanById(id: string): PlanDefinition | null {
  return PLANS[id as PlanId] ?? null;
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
