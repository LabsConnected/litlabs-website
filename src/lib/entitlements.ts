import "server-only";
import { getSupabaseAdmin } from "@/lib/supabase";
import { PLANS, type PlanId, type PlanDefinition } from "@/config/plans";
import {
  isOwnerClerkId,
  getActiveSimulation,
  OWNER_ENTITLEMENTS,
  simulationToPlanId,
  type SimulatedPlan,
} from "@/lib/owner";

export interface Entitlements {
  planId: PlanId;
  planName: string;
  activeProjectLimit: number;
  monthlyCredits: number;
  privateProjects: boolean;
  github: boolean;
  terminal: boolean;
  voice: boolean;
  premiumModels: boolean;
  deployment: boolean;
  maxMissionSteps: number;
  maxUploadBytes: number;
  beta: boolean;
  founder: boolean;
}

/**
 * Extended entitlements result that includes owner/simulation metadata.
 * This is what owner-aware callers should use to get the full picture.
 */
export interface OwnerAwareEntitlements extends Entitlements {
  /** True if this user is the platform owner. */
  isOwner: boolean;
  /** The active simulation mode, or null if none. */
  simulation: SimulatedPlan | null;
  /** True if the owner is simulating zero LiTTBits balance. */
  simulatedZeroBalance: boolean;
}

const STARTER_ENTITLEMENTS: Entitlements = {
  planId: "starter",
  planName: "Starter",
  activeProjectLimit: 1,
  monthlyCredits: 500,
  privateProjects: false,
  github: false,
  terminal: false,
  voice: false,
  premiumModels: false,
  deployment: false,
  maxMissionSteps: 10,
  maxUploadBytes: 1_000_000,
  beta: false,
  founder: false,
};

const CREATOR_BETA_ENTITLEMENTS: Entitlements = {
  planId: "creator_beta",
  planName: "Creator Beta",
  activeProjectLimit: 5,
  monthlyCredits: 6000,
  privateProjects: true,
  github: true,
  terminal: false,
  voice: true,
  premiumModels: false,
  deployment: true,
  maxMissionSteps: 30,
  maxUploadBytes: 10_000_000,
  beta: true,
  founder: false,
};

const PRO_BUILDER_BETA_ENTITLEMENTS: Entitlements = {
  planId: "pro_builder_beta",
  planName: "Pro Builder Beta",
  activeProjectLimit: 25,
  monthlyCredits: 20000,
  privateProjects: true,
  github: true,
  terminal: true,
  voice: true,
  premiumModels: true,
  deployment: true,
  maxMissionSteps: 100,
  maxUploadBytes: 50_000_000,
  beta: true,
  founder: false,
};

const FOUNDER_ENTITLEMENTS: Entitlements = {
  ...CREATOR_BETA_ENTITLEMENTS,
  planId: "founder",
  planName: "Founding Member",
  founder: true,
  maxMissionSteps: 50,
  maxUploadBytes: 20_000_000,
};

const ENTITLEMENTS_BY_PLAN: Record<PlanId, Entitlements> = {
  starter: STARTER_ENTITLEMENTS,
  creator_beta: CREATOR_BETA_ENTITLEMENTS,
  pro_builder_beta: PRO_BUILDER_BETA_ENTITLEMENTS,
  founder: FOUNDER_ENTITLEMENTS,
};

export async function getUserPlan(clerkId: string): Promise<PlanDefinition> {
  const admin = getSupabaseAdmin();
  if (!admin) return PLANS.starter;

  try {
    const { data: user } = await admin
      .from("users")
      .select("id")
      .eq("clerk_id", clerkId)
      .single();
    if (!user) return PLANS.starter;

    const { data: sub } = await admin
      .from("subscriptions")
      .select("plan, status")
      .eq("user_id", user.id)
      .single();

    if (sub && sub.status === "active") {
      const planId = sub.plan as PlanId;
      if (PLANS[planId]) return PLANS[planId];
    }

    return PLANS.starter;
  } catch {
    return PLANS.starter;
  }
}

/**
 * Returns the user's entitlements, with owner override and test-mode
 * simulation applied.
 *
 * - If the user is the platform owner, returns OWNER_ENTITLEMENTS
 *   unless a simulation is active (via the litt_test_mode cookie).
 * - If simulating a customer tier, returns that tier's entitlements.
 * - If simulating "zero_bits", returns OWNER_ENTITLEMENTS but with
 *   simulatedZeroBalance = true so balance checks treat it as 0.
 * - Non-owner users always get their real subscription-based entitlements.
 *
 * The optional `simulationOverride` parameter lets callers (e.g. tests)
 * bypass the cookie read. When omitted, the cookie is read via
 * next/headers (returns null outside a request context).
 */
export async function getUserEntitlements(
  clerkId: string,
  simulationOverride?: SimulatedPlan | null,
): Promise<Entitlements> {
  // Owner override
  if (isOwnerClerkId(clerkId)) {
    const simulation = simulationOverride !== undefined ? simulationOverride : await getActiveSimulation();
    if (!simulation || simulation === "owner") {
      return OWNER_ENTITLEMENTS;
    }
    if (simulation === "zero_bits") {
      // Owner access but balance treated as 0 — handled by callers
      // via getOwnerAwareEntitlements which sets simulatedZeroBalance.
      return OWNER_ENTITLEMENTS;
    }
    // Simulate a customer tier
    const simPlanId = simulationToPlanId(simulation);
    return ENTITLEMENTS_BY_PLAN[simPlanId] ?? STARTER_ENTITLEMENTS;
  }

  // Normal user — read from subscription
  const plan = await getUserPlan(clerkId);
  return ENTITLEMENTS_BY_PLAN[plan.id] ?? STARTER_ENTITLEMENTS;
}

/**
 * Returns the full owner-aware entitlements including simulation metadata.
 * This is the preferred entry point for callers that need to know whether
 * the current session is in test mode (e.g. API routes, UI components).
 */
export async function getOwnerAwareEntitlements(
  clerkId: string,
  simulationOverride?: SimulatedPlan | null,
): Promise<OwnerAwareEntitlements> {
  const isOwner = isOwnerClerkId(clerkId);
  const simulation = isOwner
    ? (simulationOverride !== undefined ? simulationOverride : await getActiveSimulation())
    : null;

  const base = await getUserEntitlements(clerkId, simulation);

  return {
    ...base,
    isOwner,
    simulation,
    simulatedZeroBalance: simulation === "zero_bits",
  };
}

export function getEntitlementsForPlan(planId: PlanId): Entitlements {
  return ENTITLEMENTS_BY_PLAN[planId] ?? STARTER_ENTITLEMENTS;
}
