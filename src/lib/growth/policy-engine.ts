/**
 * Growth Engine — Policy Engine.
 *
 * Enforces per-user/per-provider posting guardrails:
 *   - daily_post_limit
 *   - min_interval_minutes
 *   - cooldown_minutes
 *
 * In manual mode (1a) this is a guardrail against the user over-posting,
 * not an API gate. The check runs before recording a publication.
 */

import "server-only";

import {
  countPublishedToday,
  getLastPublished,
  getRulesOrDefault,
} from "./growth-repository";
import type { GrowthProviderId, PolicyCheckResult } from "./types";

function minutesBetween(a: Date, b: Date): number {
  return Math.abs(a.getTime() - b.getTime()) / 60000;
}

/**
 * Check whether a publication is allowed under the user's rules.
 * Returns { allowed: true } if no rule is violated.
 */
export async function enforcePrePublishRules(
  clerkId: string,
  provider: GrowthProviderId,
): Promise<PolicyCheckResult> {
  const rules = await getRulesOrDefault(clerkId, provider);
  const dailyCount = await countPublishedToday(clerkId, provider);
  const lastPublished = await getLastPublished(clerkId, provider);

  const now = new Date();
  let minutesSinceLastPost: number | null = null;
  if (lastPublished?.published_at) {
    minutesSinceLastPost = minutesBetween(now, new Date(lastPublished.published_at));
  }

  // Daily limit
  if (dailyCount >= rules.daily_post_limit) {
    return {
      allowed: false,
      reason: `Daily post limit reached for ${provider} (${dailyCount}/${rules.daily_post_limit}).`,
      dailyCount,
      minutesSinceLastPost,
    };
  }

  // Minimum interval between posts
  if (
    minutesSinceLastPost !== null &&
    minutesSinceLastPost < rules.min_interval_minutes
  ) {
    const wait = Math.ceil(rules.min_interval_minutes - minutesSinceLastPost);
    return {
      allowed: false,
      reason: `Minimum interval not met for ${provider}. Wait ${wait} more minute(s) (${Math.round(minutesSinceLastPost)}m since last post, limit ${rules.min_interval_minutes}m).`,
      dailyCount,
      minutesSinceLastPost,
    };
  }

  // Cooldown (separate from interval — e.g. after a failed/rejected post)
  if (rules.cooldown_minutes > 0 && minutesSinceLastPost !== null) {
    if (minutesSinceLastPost < rules.cooldown_minutes) {
      const wait = Math.ceil(rules.cooldown_minutes - minutesSinceLastPost);
      return {
        allowed: false,
        reason: `Cooldown active for ${provider}. Wait ${wait} more minute(s).`,
        dailyCount,
        minutesSinceLastPost,
      };
    }
  }

  return {
    allowed: true,
    dailyCount,
    minutesSinceLastPost,
  };
}
