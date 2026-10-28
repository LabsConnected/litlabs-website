import { KNOWN_AGENT_SLUG_LIST, isListedAgentSlug } from "@/lib/known-agent-slug-list";

const PUBLIC_AGENT_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Slugs that `/agents/[slug]` still serves (redirects into Studio). */
export const KNOWN_AGENT_SLUGS: readonly string[] = KNOWN_AGENT_SLUG_LIST;

/**
 * True for a registered agent slug. Empty, malformed, and unknown values
 * are rejected so the route can 404 instead of rendering a soft not-found.
 */
export function isKnownAgentSlug(slug: string): boolean {
  return PUBLIC_AGENT_SLUG.test(slug) && isListedAgentSlug(slug);
}
