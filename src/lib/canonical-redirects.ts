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
//    NOTE: /agent, /agent-chat, /chat, /litt, /ai-builder, /builder,
//    /generate and /flow are intentionally NOT listed here — next.config.ts
//    declares richer inline redirects for them (?tool=/?creator= deep
//    links) earlier in the array, and first-match wins. Duplicating them
//    here would be dead config that misstates the effective destination.

export const CANONICAL_REDIRECTS = [
  { source: "/community", destination: "/discover", permanent: true },
  { source: "/communities", destination: "/discover", permanent: true },
  { source: "/assets", destination: "/studio?tool=assets", permanent: true },
  { source: "/missions", destination: "/studio?tool=workflows", permanent: true },
  { source: "/files", destination: "/library/files", permanent: true },
  { source: "/saved", destination: "/library/saved", permanent: true },
  { source: "/connections", destination: "/settings/connections", permanent: true },
  // Phase 3A: /create has no inline counterpart — plain /studio handoff.
  { source: "/create", destination: "/studio", permanent: true },
  // Phase 3A: legacy profile route → canonical handle route
  { source: "/profile/:username", destination: "/u/:username", permanent: true },
] as const;

export type CanonicalRedirect =
  (typeof CANONICAL_REDIRECTS)[number];
