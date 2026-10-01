// Canonical route aliases — permanent (308) redirects.
//
// Consumed by next.config.ts redirects(). Kept in src (not inline in the
// config) so the routing contract is unit-testable.
//
// 1. Community: /discover is the ONE true route. /community and
//    /communities 308 so bookmarks and forks cannot silently duplicate it.
// 2. Authenticated aliases observed 404 on production (issue #602):
//    short paths that AppShell no longer uses, but users still hit via
//    guess, bookmark, or stale links. Each 308s to the real destination
//    already listed in src/lib/navigation.ts.

export const CANONICAL_REDIRECTS = [
  { source: "/community", destination: "/discover", permanent: true },
  { source: "/communities", destination: "/discover", permanent: true },
  { source: "/assets", destination: "/studio?tool=assets", permanent: true },
  { source: "/missions", destination: "/studio?tool=workflows", permanent: true },
  { source: "/files", destination: "/library/files", permanent: true },
  { source: "/saved", destination: "/library/saved", permanent: true },
  { source: "/connections", destination: "/settings/connections", permanent: true },
] as const;

export type CanonicalRedirect =
  (typeof CANONICAL_REDIRECTS)[number];
