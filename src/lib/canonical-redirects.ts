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
// 3. Phase 3A (#627): duplicate chat/assistant and builder routes
//    consolidate into the canonical Studio experience. Global LiTT is
//    persistent across the app (not a separate page), so chat routes
//    redirect to /studio where both Studio and Global LiTT are available.

export const CANONICAL_REDIRECTS = [
  { source: "/community", destination: "/discover", permanent: true },
  { source: "/communities", destination: "/discover", permanent: true },
  { source: "/assets", destination: "/studio?tool=assets", permanent: true },
  { source: "/missions", destination: "/studio?tool=workflows", permanent: true },
  { source: "/files", destination: "/library/files", permanent: true },
  { source: "/saved", destination: "/library/saved", permanent: true },
  { source: "/connections", destination: "/settings/connections", permanent: true },
  // Phase 3A: duplicate chat/assistant surfaces → Studio (Global LiTT is persistent there)
  { source: "/agent-chat", destination: "/studio", permanent: true },
  { source: "/agent", destination: "/studio", permanent: true },
  { source: "/chat", destination: "/studio", permanent: true },
  { source: "/litt", destination: "/studio", permanent: true },
  // Phase 3A: duplicate builder entry points → Studio
  { source: "/ai-builder", destination: "/studio", permanent: true },
  { source: "/builder", destination: "/studio", permanent: true },
  { source: "/generate", destination: "/studio", permanent: true },
  { source: "/create", destination: "/studio", permanent: true },
  { source: "/flow", destination: "/studio", permanent: true },
  // Phase 3A: legacy profile route → canonical handle route
  { source: "/profile/:username", destination: "/u/:username", permanent: true },
  // Marketplace and its agent/capability detail pages remain canonical here.
  // Do not redirect to the Discover social feed until equivalent pages exist.
] as const;

export type CanonicalRedirect =
  (typeof CANONICAL_REDIRECTS)[number];
