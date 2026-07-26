import "server-only";
import { getSupabaseAdmin } from "@/lib/supabase";
import { PLANS, type PlanId, type PlanDefinition } from "@/config/plans";

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

export async function getUserEntitlements(clerkId: string): Promise<Entitlements> {
  const plan = await getUserPlan(clerkId);
  return ENTITLEMENTS_BY_PLAN[plan.id] ?? STARTER_ENTITLEMENTS;
}

export function getEntitlementsForPlan(planId: PlanId): Entitlements {
  return ENTITLEMENTS_BY_PLAN[planId] ?? STARTER_ENTITLEMENTS;
}
