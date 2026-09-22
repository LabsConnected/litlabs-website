// Canonical route aliases — permanent (308) redirects.
//
// /discover is the ONE true route for the community surface. These aliases
// exist so external links, bookmarks, and any future fork can never silently
// duplicate it: every alias 308s to /discover, never 404s, never renders
// duplicate content.
//
// Consumed by next.config.ts redirects(). Kept in src (not inline in the
// config) so the routing contract is unit-testable — see
// src/__tests__/discover-canonical-route.test.ts.
export const CANONICAL_REDIRECTS = [
  { source: "/community", destination: "/discover", permanent: true },
  { source: "/communities", destination: "/discover", permanent: true },
] as const;

export type CanonicalRedirect =
  (typeof CANONICAL_REDIRECTS)[number];
