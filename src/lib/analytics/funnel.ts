import "server-only";

import { supabaseAdmin } from "@/lib/supabase";

/**
 * Funnel analytics service.
 *
 * Tracks the user journey from homepage prompt to deployment completion.
 * All events are stored in the analytics_events table and can be used
 * to measure conversion at each stage of the funnel.
 *
 * Primary success metrics:
 *   - visitor to signup
 *   - signup to first mission
 *   - mission to preview
 *   - preview to deployment
 *   - deployment to second run
 *   - free to paid
 *   - 7-day retained builders
 *   - 30-day retained builders
 *   - successful runs per active user
 *   - failed/refunded run rate
 */

export type FunnelEvent =
  | "homepage_prompt_started"
  | "signup_started"
  | "signup_completed"
  | "onboarding_goal_selected"
  | "project_created"
  | "agent_viewed"
  | "checkout_started"
  | "checkout_completed"
  | "agent_installed"
  | "run_created"
  | "plan_approved"
  | "mutation_approved"
  | "preview_ready"
  | "deployment_approved"
  | "deployment_completed"
  | "result_shared"
  | "second_run_created"
  | "subscription_started"
  | "subscription_cancelled";

export interface FunnelEventInput {
  event: FunnelEvent;
  userId?: string;
  anonymousId?: string;
  properties?: Record<string, unknown>;
}

/**
 * Track a funnel event. Silent fail — analytics never blocks the operation.
 */
export async function trackFunnelEvent(input: FunnelEventInput): Promise<void> {
  try {
    await supabaseAdmin.from("analytics_events").insert({
      event_name: input.event,
      user_id: input.userId ?? null,
      anonymous_id: input.anonymousId ?? null,
      properties: input.properties ?? {},
      created_at: new Date().toISOString(),
    });
  } catch {
    // Silent fail — analytics must not block operations
  }
}

/**
 * Track multiple funnel events in batch.
 */
export async function trackFunnelEvents(events: FunnelEventInput[]): Promise<void> {
  try {
    await supabaseAdmin.from("analytics_events").insert(
      events.map((e) => ({
        event_name: e.event,
        user_id: e.userId ?? null,
        anonymous_id: e.anonymousId ?? null,
        properties: e.properties ?? {},
        created_at: new Date().toISOString(),
      })),
    );
  } catch {
    // Silent fail
  }
}

/**
 * Get funnel metrics for a date range.
 */
export async function getFunnelMetrics(
  startDate: string,
  endDate: string,
): Promise<Record<string, number>> {
  const { data } = await supabaseAdmin
    .from("analytics_events")
    .select("event_name")
    .gte("created_at", startDate)
    .lte("created_at", endDate);

  const counts: Record<string, number> = {};
  for (const row of data ?? []) {
    const name = (row as { event_name: string }).event_name;
    counts[name] = (counts[name] ?? 0) + 1;
  }

  return counts;
}
