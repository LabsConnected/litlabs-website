import StudioShell from "@/components/page-shells/StudioShell";

/**
 * Route-level loading shell for /studio. This renders server-side,
 * before the persisted layout choice (client state) can be read, so
 * it uses the board shape — the flagship default layout. StudioHub
 * takes over a beat later with the skeleton matching the user's
 * chosen layout (Regular users included), so no returning user sits
 * on a mismatched shell or a centered spinner (Studio entry fix,
 * Larry 2026-11-18).
 */
export default function StudioLoading() {
  return <StudioShell layout="board" />;
}
