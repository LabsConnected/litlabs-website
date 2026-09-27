import { AGENT_DEFINITIONS } from "@/lib/agent-registry";
import { BUILT_IN_AGENTS } from "@/lib/studio/agent-registry";

const PUBLIC_AGENT_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function collectKnownAgentSlugs(): string[] {
  const slugs = new Set<string>();
  for (const agent of AGENT_DEFINITIONS) {
    slugs.add(agent.slug);
    slugs.add(agent.id);
  }
  for (const slug of Object.keys(BUILT_IN_AGENTS)) {
    slugs.add(slug);
  }
  return [...slugs].filter((slug) => PUBLIC_AGENT_SLUG.test(slug)).sort();
}

/** Slugs that `/agents/[slug]` still serves (redirects into Studio). */
export const KNOWN_AGENT_SLUGS: readonly string[] = collectKnownAgentSlugs();

const KNOWN_AGENT_SLUG_SET = new Set(KNOWN_AGENT_SLUGS);

/**
 * True for a registered agent slug. Empty, malformed, and unknown values
 * are rejected so the route can 404 instead of rendering a soft not-found.
 */
export function isKnownAgentSlug(slug: string): boolean {
  return PUBLIC_AGENT_SLUG.test(slug) && KNOWN_AGENT_SLUG_SET.has(slug);
}
