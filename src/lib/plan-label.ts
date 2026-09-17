import type { PlanId } from "@/config/plans";

/**
 * Honest display label for the plan ID returned by /api/users/[id]/plan.
 *
 * The API returns real plan IDs (starter, creator_beta, pro_builder_beta,
 * founder, owner) or "free". The identity menu must never render a paying
 * plan as "Free" — every known PlanId maps to its own label here, and only
 * genuinely free/unknown values fall through to "Free".
 */
const PLAN_DISPLAY_LABELS: Record<PlanId, string> = {
  starter: "Starter",
  creator_beta: "Creator Beta",
  pro_builder_beta: "Pro Builder Beta",
  founder: "Founding Member",
  owner: "Owner",
};

export function planDisplayLabel(
  plan: string | null | undefined,
): string {
  if (!plan) return "Free";
  return PLAN_DISPLAY_LABELS[plan as PlanId] ?? "Free";
}
