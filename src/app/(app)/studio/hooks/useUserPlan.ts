"use client";

import { useEffect, useState } from "react";
import type { PlanId } from "@/config/plans";
import { hasPlanAccess } from "@/config/plans";

interface PlanState {
  plan: PlanId;
  loading: boolean;
}

/**
 * Fetches the authenticated user's active subscription plan.
 * Used by the Studio agent selector to determine which agents are unlocked.
 *
 * The plan is fetched from the server (/api/billing/subscription) and is
 * the authoritative source — client-side plan values are never trusted for
 * authorization (the API re-checks on every agent run).
 */
export function useUserPlan(): PlanState & {
  /** Whether the user's plan covers the given required plan. */
  hasAccess: (requiredPlan: PlanId) => boolean;
} {
  const [plan, setPlan] = useState<PlanId>("starter");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/billing/subscription")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled) return;
        if (data?.plan?.id) {
          setPlan(data.plan.id as PlanId);
        }
      })
      .catch(() => {
        // Unauthenticated or endpoint unavailable — default to starter.
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return {
    plan,
    loading,
    hasAccess: (requiredPlan: PlanId) => hasPlanAccess(plan, requiredPlan),
  };
}
