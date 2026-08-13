/**
 * UTM URL builder for the Growth Engine.
 *
 * Every prepared post that links back to the site carries a unique UTM
 * so Phase 2 analytics can attribute traffic/signups to the campaign +
 * provider that drove them.
 */

import "server-only";

export interface UtmParams {
  campaign: string;
  source: string;
  medium: string;
  content?: string;
  term?: string;
}

/**
 * Build a UTM-tagged URL. If baseUrl has no query string, appends ?utm_...;
 * if it already has one, appends &utm_....
 */
export function buildUtmUrl(baseUrl: string, params: UtmParams): string {
  if (!baseUrl) return baseUrl;
  const url = new URL(baseUrl);
  url.searchParams.set("utm_campaign", params.campaign);
  url.searchParams.set("utm_source", params.source);
  url.searchParams.set("utm_medium", params.medium);
  if (params.content) url.searchParams.set("utm_content", params.content);
  if (params.term) url.searchParams.set("utm_term", params.term);
  return url.toString();
}

/**
 * Slugify a campaign name for use as utm_campaign.
 * "Canvas Launch!" → "canvas-launch"
 */
export function campaignSlug(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "campaign";
}

/**
 * Default UTM params for a (campaignName, provider) pair.
 * utm_medium is "social" for all social providers.
 */
export function defaultUtmParams(
  campaignName: string,
  provider: string,
): UtmParams {
  return {
    campaign: campaignSlug(campaignName),
    source: provider,
    medium: "social",
  };
}
