/**
 * Slugs `/agents/[slug]` still serves. Kept free of path aliases so
 * next.config can import it. tests/agent-slug-not-found.test.ts checks this
 * list against the agent registries.
 */
export const KNOWN_AGENT_SLUG_LIST = [
  "analyst",
  "coder",
  "echo",
  "forge",
  "litt",
  "marketer",
  "nova",
  "researcher",
  "spark",
  "writer",
] as const;

const KNOWN_AGENT_SLUG_SET = new Set<string>(KNOWN_AGENT_SLUG_LIST);

export function isListedAgentSlug(slug: string): boolean {
  return KNOWN_AGENT_SLUG_SET.has(slug);
}

/** Rewrite unknown `/agents/:slug` requests to a path that does not exist. */
export function unknownAgentSlugRewrites(): { source: string; destination: string }[] {
  const alternation = KNOWN_AGENT_SLUG_LIST.join("|");
  return [
    {
      source: `/agents/:slug((?!(?:${alternation})$)[^/]+)`,
      destination: "/__unknown-agent",
    },
  ];
}
