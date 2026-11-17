import type { LucideIcon } from "lucide-react";
import { isFeatureEnabled } from "@/config/feature-flags";
import {
  Sparkles,
  ShoppingBag,
  BarChart3,
  Bookmark,
  Layers,
  FileText,
  Star,
  FolderKanban,
  Gamepad2 as GamesIcon,
  Compass,
  Terminal,
} from "lucide-react";

export type NavItem = {
  label: string;
  href?: string;
  icon: LucideIcon;
  badge?: number;
  online?: boolean;
  children?: NavItem[];
  shortcut?: string;
};

export type NavSection = {
  id: string;
  label: string;
  items: NavItem[];
};



/* ─── Canonical App Shell navigation ───────────────────────────────────
 * ONE canonical authenticated global nav (issue #627 — Studio Merge):
 *   Main: Studio · Discover · Projects · Marketplace · Games · CLI ·
 *         Deployments · Docs
 *   (Showcase was removed from More by Larry, 2026-11-14. The "More"
 *   overflow menu itself was emptied and removed by Larry, 2026-11-16:
 *   Marketplace · Games · CLI · Deployments · Docs each became their
 *   own visible main-nav item — there is no More menu anymore.)
 *   Settings is NOT a Main item anymore (Studio Finish Spec, Larry
 *   2026-11-14): it lives in the account menu (AppShell IdentityDock,
 *   which renders on every viewport) — never in the top navigation.
 *
 * Studio is the one primary work surface and the prime signed-in
 * landing — there is still no separate Home item and no /dashboard
 * destination (Larry's one-chat-entry directive, 2026-11-11,
 * ART-20261111-031; /dashboard only redirects into Studio and must
 * never appear in nav — see tests/dashboard-create-integration.test.ts
 * and tests/app-shell-navigation.test.ts). The owner's 2026-11-12
 * Studio Merge bundle listed "Home" first in its canonical-nav
 * shorthand, but that pre-existing, explicitly tested invariant reads
 * it as "Studio is home," not a literal 5th pill — flagged for the
 * owner to confirm; a real Home item was NOT added here.
 *
 * Assets / Agents / Missions / Create / More are no longer separate
 * nav destinations either — they are internal Studio surfaces, reached
 * from inside Studio itself (not from the global nav), per owner ruling
 * 2026-11-12: "No Agents tab — wasted space. Everything lives in
 * Studio, one main tab." Legacy ?tool=assets|agents|workflows URLs
 * still resolve (studio-destinations.ts), they just have no global
 * pill anymore.
 */

export const APP_NAV_MAIN: NavItem[] = [
  { label: "Studio", href: "/studio", icon: Sparkles, shortcut: "⌘S" },
  { label: "Discover", href: "/discover", icon: Compass },
  { label: "Projects", href: "/projects", icon: FolderKanban },
  // Promoted out of the old More overflow menu (Larry, 2026-11-16) —
  // labels and hrefs are exactly the ones the More menu used.
  { label: "Marketplace", href: "/marketplace", icon: ShoppingBag },
  { label: "Games", href: "/games", icon: GamesIcon },
  { label: "CLI", href: "/cli", icon: Terminal },
  { label: "Deployments", href: "/deployments", icon: BarChart3 },
  { label: "Docs", href: "/docs", icon: FileText },
];

/* The More overflow menu is GONE (Larry, 2026-11-16): every destination
 * it held is a visible main-nav item above, so nothing remains in it.
 * This export stays (empty) because src/lib/litt/page-context.ts still
 * spreads it into its closed destination set — those destinations now
 * reach that set through APP_NAV_MAIN instead. */
export const APP_NAV_MORE: NavItem[] = [];

/* ─── Secondary navigation ─────────────────────────────────────────────
 * Library + Developer Tools destinations. Rendered inside the identity
 * dock's account menu (AppShell) — the top bar only carries Main pills,
 * so secondary surfaces live one click away without flooding the bar.
 */
export const APP_NAV_SECONDARY: NavSection[] = [
  {
    id: "library",
    label: "Library",
    items: [
      { label: "Files", href: "/library/files", icon: FileText },
      { label: "Saved", href: "/library/saved", icon: Bookmark },
    ],
  },
  {
    id: "devtools",
    label: "Developer Tools",
    items: [
      { label: "Connections", href: "/settings/connections", icon: Layers },
    ],
  },
];

/* ─── Flag-gated visibility ──────────────────────────────────────────── */
// /games hides while the retroGameRuntime flag is off (see
// src/app/(app)/games/layout.tsx) so no nav surface ever links to a 404.
// Games carried this gate in the old More menu; it keeps it now that it
// is a Main item (Larry's 2026-11-16 promotion), so it is the ONE
// flag-gated Main item — every other Main item is always visible.
// Discover moved to the always-on Main nav (issue #627) and lost this
// gate in the process — see navigation.test.ts for the flagged caveat.
export function getVisibleMainNav(): NavItem[] {
  return APP_NAV_MAIN.filter((item) => {
    if (item.href === "/games") return isFeatureEnabled("retroGameRuntime");
    return true;
  });
}

/**
 * Carry the active Studio project across top-bar navigation.
 *
 * Studio project identity lives in the `?project=` URL param (see
 * resolveStudioProjectId). Following the Studio nav item from inside a
 * project used to DROP the param — Studio then fell back to server-side
 * most-recent resolution and landed on a different project (production
 * audit ART-20261111-082: a Studio-destination link opened from a
 * project reverted the header to the repo project and showed an empty
 * bucket). Kept generic (any `/studio` href) even though the Studio
 * Merge (issue #627) collapsed Assets/Agents/Missions out of the global
 * nav — in-Studio links to those internal surfaces still carry `tool=`
 * params through the same `/studio` path and benefit identically.
 *
 * Given the project id from the CURRENT URL, return the items with the
 * param set on every `/studio` href (replacing any stale value).
 * Non-Studio hrefs pass through untouched; without an id the input is
 * returned as-is. Inputs are never mutated.
 */
export function withActiveProjectContext(
  items: NavItem[],
  projectId: string | null | undefined,
): NavItem[] {
  const id = projectId?.trim();
  if (!id) return items;
  return items.map((item) => {
    if (!item.href) return item;
    const [path, query] = item.href.split("?");
    if (path !== "/studio") return item;
    const params = new URLSearchParams(query ?? "");
    params.set("project", id);
    return { ...item, href: `${path}?${params.toString()}` };
  });
}

/**
 * Active-route check for the AppShell navigation.
 * Matches by path prefix, with special handling for the Studio item.
 */
export function isAppNavActive(
  pathname: string | null,
  _searchParams: URLSearchParams,
  href?: string,
): boolean {
  if (!pathname || !href) return false;
  const [path] = href.split("?");
  // /studio: Studio is the ONE main tab (issue #627 — Studio Merge).
  // Assets/Agents/Missions/Create/More no longer have sibling nav items
  // to carve out against, so the bare "/studio" href is active for the
  // whole /studio tree regardless of ?tool=/?project= — there is no
  // other nav item left that could claim ownership of a destination.
  if (path === "/studio") {
    return pathname === "/studio" || pathname.startsWith("/studio/");
  }
  // Exact match for root-level, prefix for others
  if (path === "/") return pathname === "/";
  return pathname === path || pathname.startsWith(`${path}/`);
}
