import { AGENT_DEFINITIONS } from "@/lib/agent-registry";

/**
 * Legacy ids that still resolve to LiTT. They are own properties on the
 * AGENTS map in src/lib/agents.ts (non-enumerable aliases).
 */
export const LEGACY_AGENT_SLUGS = ["littcode", "littlebit"] as const;

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Registry ids plus the legacy aliases above. */
export function knownAgentSlugs(): string[] {
  return [
    ...AGENT_DEFINITIONS.map((agent) => agent.id),
    ...LEGACY_AGENT_SLUGS,
  ];
}

/**
 * True only for a canonical agent id or a legacy alias.
 * Rejects empty, malformed, and prototype-key slugs (`constructor`, etc.).
 */
export function isKnownAgentSlug(slug: string): boolean {
  if (!SLUG_PATTERN.test(slug)) return false;
  return knownAgentSlugs().includes(slug);
}
