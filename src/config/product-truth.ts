/**
 * Machine-readable product contract.
 *
 * This is the single source of truth for product identity, pricing, plans,
 * LiTTBits terminology, agent model, and public policy statuses. All pricing
 * pages, Marketplace plan displays, Wallet explanations, entitlement labels,
 * metadata, and agent-facing product explanations must derive from this
 * contract.
 *
 * Do NOT hardcode prices or plan benefits inside React pages. Import from here.
 *
 * Sensitive Stripe Price IDs remain server-side in environment variables —
 * this contract only declares the env-var names, never the values.
 *
 * @see docs/PRODUCT_TRUTH.md for the full human-readable canonical truth.
 */

// ---------------------------------------------------------------------------
// Product Identity
// ---------------------------------------------------------------------------

export const PRODUCT_IDENTITY = {
  brand: "LiTTree LabStudios",
  domain: "litlabs.net",
  definition:
    "LiTTree LabStudios is an AI creative operating system and social creator platform where LiTT helps people build apps, create media, preserve project context, collaborate and ship real work from Studio.",
  corePromise: "Bring the idea. LiTT helps you build the rest.",
  primaryWorkspace: "Studio",
} as const;

// ---------------------------------------------------------------------------
// Product Hierarchy
// ---------------------------------------------------------------------------

export const PRODUCT_HIERARCHY = [
  "AI creative Studio",
  "Social creator world",
  "Marketplace",
] as const;

// ---------------------------------------------------------------------------
// Official Personalities
// ---------------------------------------------------------------------------

export type CorePersonalityId = "litt" | "spark";

export interface PersonalityDefinition {
  id: CorePersonalityId;
  name: string;
  role: string;
  description: string;
  canControlTerminal: boolean;
  canControlFiles: boolean;
  canControlGit: boolean;
  canControlMissions: boolean;
  canControlDeployment: boolean;
}

export const CORE_PERSONALITIES: Record<CorePersonalityId, PersonalityDefinition> = {
  litt: {
    id: "litt",
    name: "LiTT",
    role: "Primary operator and control plane",
    description:
      "LiTT owns intent routing, conversation, project context, research, code, files, terminal, missions, tools, approvals, testing, deployment, and truthful runtime status.",
    canControlTerminal: true,
    canControlFiles: true,
    canControlGit: true,
    canControlMissions: true,
    canControlDeployment: true,
  },
  spark: {
    id: "spark",
    name: "Spark",
    role: "Creative partner (hidden — not user-visible)",
    description:
      "Legacy creative profile. Hidden from all user-facing surfaces; the name must never be shown to the user.",
    canControlTerminal: false,
    canControlFiles: false,
    canControlGit: false,
    canControlMissions: false,
    canControlDeployment: false,
  },
};

export const CORE_PERSONALITY_COUNT = Object.keys(CORE_PERSONALITIES).length; // 2

// ---------------------------------------------------------------------------
// Specialist Categories
// ---------------------------------------------------------------------------

export type SpecialistCategory = "internal" | "marketplace";

export interface SpecialistDefinition {
  slug: string;
  name: string;
  category: SpecialistCategory;
  description: string;
  /** Minimum plan required to access this specialist (internal only). */
  minimumPlan?: PlanId;
}

export const INTERNAL_SPECIALISTS: SpecialistDefinition[] = [
  { slug: "researcher", name: "Researcher", category: "internal", description: "Source-backed research & comparisons", minimumPlan: "creator_beta" },
  { slug: "writer", name: "Writer", category: "internal", description: "Ready-to-publish content & copy", minimumPlan: "creator_beta" },
  { slug: "marketer", name: "Marketer", category: "internal", description: "Campaigns, SEO & growth", minimumPlan: "creator_beta" },
  { slug: "coder", name: "Coder", category: "internal", description: "Repository-aware implementation & debugging", minimumPlan: "pro_builder_beta" },
  { slug: "analyst", name: "Analyst", category: "internal", description: "Data interpretation & recommendations", minimumPlan: "pro_builder_beta" },
];

// ---------------------------------------------------------------------------
// Plans
// ---------------------------------------------------------------------------

export type PlanId = "starter" | "creator_beta" | "pro_builder_beta" | "founder";
export type BillingType = "free" | "subscription" | "one_time";
export type CreditCategory = "starter" | "monthly" | "purchased" | "promotional";

export const PLAN_RANK: Record<PlanId, number> = {
  starter: 0,
  creator_beta: 1,
  founder: 1, // Founder = permanent Creator-level
  pro_builder_beta: 2,
};

export function hasPlanAccess(userPlan: PlanId, requiredPlan: PlanId): boolean {
  return PLAN_RANK[userPlan] >= PLAN_RANK[requiredPlan];
}

export function formatPrice(cents: number | null): string {
  if (cents === null || cents === 0) return "Free";
  return `$${(cents / 100).toFixed(0)}`;
}

export function formatPriceMonthly(cents: number | null): string {
  if (cents === null || cents === 0) return "Free";
  return `$${(cents / 100).toFixed(0)}/month`;
}

// ---------------------------------------------------------------------------
// AI Credits Terminology
// ---------------------------------------------------------------------------

export const LITTBITS_TERMINOLOGY = {
  singular: "AI credit",
  plural: "AI credits",
  abbreviation: "LBC",
  /** Terms that must NEVER be used in user-facing copy. */
  bannedTerms: ["coins", "coin pack", "coin packs", "tokens", "crypto", "cryptocurrency", "cash"],
} as const;

// ---------------------------------------------------------------------------
// Credit Policy
// ---------------------------------------------------------------------------

export interface CreditPolicyEntry {
  category: CreditCategory;
  source: string;
  expiration: string;
  rollover: string;
}

export const CREDIT_POLICY: Record<CreditCategory, CreditPolicyEntry> = {
  starter: {
    category: "starter",
    source: "500 once at account creation",
    expiration: "Does not expire",
    rollover: "N/A (one-time grant)",
  },
  monthly: {
    category: "monthly",
    source: "Granted after successful Stripe billing",
    expiration: "Valid for current billing period; resets on next grant",
    rollover: "Does not roll over",
  },
  purchased: {
    category: "purchased",
    source: "Bought via approved Stripe products",
    expiration: "Does not expire",
    rollover: "N/A",
  },
  promotional: {
    category: "promotional",
    source: "Must define explicit expiration when created",
    expiration: "Per grant",
    rollover: "N/A",
  },
};

/** Consumption order: monthly first, then promotional, then purchased. */
export const CREDIT_CONSUMPTION_ORDER: CreditCategory[] = [
  "monthly",
  "promotional",
  "purchased",
];

// ---------------------------------------------------------------------------
// Feature Flags
// ---------------------------------------------------------------------------

/**
 * Daily LiTTBit bonus — NOT approved for public production.
 * Disabled by default. The endpoint must reject claims while disabled.
 */
export const DAILY_LITTBITS_ENABLED = process.env.ENABLE_DAILY_LITTBITS === "true";

/**
 * Credit packs — NOT approved. No catalog exists.
 * When false, all credit-pack UI and checkout must be hidden.
 */
export const CREDIT_PACKS_ENABLED = false;

/**
 * Stripe automatic tax — disabled by default.
 * Enable only after Stripe Tax is fully configured (registrations,
 * product tax codes, tax behavior, address collection).
 * See docs/STRIPE_CATALOG_WIRING.md for the configuration checklist.
 */
export const STRIPE_AUTOMATIC_TAX_ENABLED =
  process.env.STRIPE_AUTOMATIC_TAX_ENABLED === "true";

// ---------------------------------------------------------------------------
// Banned Obsolete Phrases (for automated auditing)
// ---------------------------------------------------------------------------

export const BANNED_PHRASES: string[] = [
  "$49",
  "six months",
  "6 months",
  "Founding Supporter",
  "seven AI agents",
  "7 AI agents",
  "7 specialist AI agents",
  "coin pack",
  "coin packs",
  "15% off future credit packs",
  "20% off credit packs",
  "5,000 bonus AI credits",
  "500 monthly AI credits",
  "AI creative studio",
  "AI project workspace",
];

// ---------------------------------------------------------------------------
// Public Policy Statuses
// ---------------------------------------------------------------------------

export const POLICY_STATUSES = {
  dailyBonus: "NOT APPROVED — disabled by default",
  creditPacks: "NOT APPROVED — no catalog exists",
  monthlyRefresh: "APPROVED — per billing cycle for paid plans",
  creditExpiration: "APPROVED — monthly resets, starter/purchased do not expire",
  founderCheckout: "ENABLED — $149 one-time purchase",
  refunds: "NO POLICY — do not promise refunds",
  automaticTax: "DISABLED — awaiting Stripe Tax configuration",
} as const;

// ---------------------------------------------------------------------------
// Verified Stripe Catalog (as of 2026-08-04)
// ---------------------------------------------------------------------------

/**
 * The three official plan products already exist in Stripe at the correct
 * prices. They need to be wired to environment variables — do NOT create
 * new Stripe products for these.
 *
 * This is an inventory of what exists in STRIPE, not of what LiTT sells.
 * The founder entry is retained deliberately: the $149 price object still
 * exists and still backs historical purchases, so it must not be deleted.
 * What changed is that LiTT no longer offers it — PLANS.founder has no
 * stripePriceIdEnv and the retired founder plan is false, so
 * nothing can resolve a new checkout against it.
 */
export const VERIFIED_STRIPE_PLANS = {
  creator_beta: {
    stripeStatus: "exists",
    priceCents: 1500,
    priceMode: "recurring" as const,
    envVar: "STRIPE_PRICE_CREATOR_BETA",
  },
  pro_builder_beta: {
    stripeStatus: "exists",
    priceCents: 3900,
    priceMode: "recurring" as const,
    envVar: "STRIPE_PRICE_PRO_BUILDER_BETA",
  },
  founder: {
    stripeStatus: "exists",
    priceCents: 14900,
    priceMode: "one_time" as const,
    envVar: "STRIPE_PRICE_FOUNDER",
  },
} as const;

/**
 * Premium marketplace agents that exist as Stripe products.
 * These are separate from subscription-tier internal specialists.
 * Purchases remain disabled until all gates pass.
 */
export const VERIFIED_PREMIUM_AGENTS = {
  "litt-coder-pro": {
    name: "LiTT Coder Pro",
    stripePriceCents: 2900,
    dbPriceCents: 2900,
    status: "matches" as const,
  },
  "litt-social": {
    name: "LiTT Social",
    stripePriceCents: 1500,
    dbPriceCents: 1500,
    status: "matches" as const,
  },
  "litt-growth": {
    name: "LiTT Growth",
    stripePriceCents: 2000,
    dbPriceCents: 1900,
    status: "mismatch" as const,
    note: "Stripe has $20; DB has $19. Owner must create a new $19 Price in Stripe and archive the $20 Price. Do not attach the $20 Price ID to the $19 DB version.",
  },
} as const;

/**
 * Legacy membership products that must be archived in Stripe.
 * Do NOT reference these in code, pricing, checkout, SEO, or documentation.
 * Do NOT cancel existing customers automatically.
 */
export const LEGACY_STRIPE_PRODUCTS = [
  { name: "LiTTree-LabStudios Basic Membership", price: "$9.99/month" },
  { name: "LiTTree-LabStudios Elite Membership", price: "$39/month" },
  { name: "LiTTree-LabStudios Starter Membership", price: "$5/month" },
  { name: "LiTTree-LabStudios Pro Membership", price: "$19.99/month" },
] as const;

// ---------------------------------------------------------------------------
// Feature Availability
// ---------------------------------------------------------------------------

export type FeatureAvailability = "live" | "beta" | "coming_soon" | "planned";

export const FEATURE_AVAILABILITY: Record<string, FeatureAvailability> = {
  studio: "live",
  litt: "live",
  spark: "live",
  voice: "beta",
  terminal: "beta",
  marketplace: "live",
  gallery: "live",
  discover: "live",
  social: "live",
  projects: "live",
  github: "live",
  deployment: "beta",
  creditPacks: "coming_soon",
  dailyBonus: "planned",
};
