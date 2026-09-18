import type { LucideIcon } from "lucide-react";
import { isFeatureEnabled } from "@/config/feature-flags";
import {
  LayoutDashboard,
  Sparkles,
  ShoppingBag,
  BarChart3,
  Settings,
  User,
  Wallet,
  Bookmark,
  Bot,
  Layers,
  FileText,
  Star,
  Workflow,
  FolderKanban,
  Gamepad2 as GamesIcon,
  Compass,
  Terminal,
  CirclePlus,
  FolderOpen,
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
 * ONE canonical authenticated global nav:
 *   Main: Home · Studio · Create · Assets · Agents · Missions · More
 *   More: Projects · Games · Discover · Marketplace · Showcase · Wallet ·
 *         CLI · Docs · Deployments · Settings · Profile
 *
 * Assets/Agents/Missions resolve to their real Studio destinations
 * (?tool=assets|agents|workflows — the same canonical URLs the Studio
 * router writes back via destinationToLegacyTool). Legacy creation
 * routes (/builder, /ai-builder, /chat, /generate, …) all redirect into
 * Studio, so they are not separate destinations.
 */

export const APP_NAV_MAIN: NavItem[] = [
  { label: "Home", href: "/dashboard", icon: LayoutDashboard, shortcut: "⌘D" },
  { label: "Studio", href: "/studio", icon: Sparkles, shortcut: "⌘S" },
  { label: "Create", href: "/create", icon: CirclePlus },
  { label: "Assets", href: "/studio?tool=assets", icon: FolderOpen },
  { label: "Agents", href: "/studio?tool=agents", icon: Bot },
  { label: "Missions", href: "/studio?tool=workflows", icon: Workflow },
];

/* Secondary destinations behind the More menu — real routes only. */
export const APP_NAV_MORE: NavItem[] = [
  { label: "Projects", href: "/projects", icon: FolderKanban },
  { label: "Games", href: "/games", icon: GamesIcon },
  { label: "Discover", href: "/discover", icon: Compass },
  { label: "Marketplace", href: "/marketplace", icon: ShoppingBag },
  { label: "Showcase", href: "/showcase", icon: Star },
  { label: "Wallet", href: "/wallet", icon: Wallet },
  { label: "CLI", href: "/cli", icon: Terminal },
  { label: "Docs", href: "/docs", icon: FileText },
  { label: "Deployments", href: "/deployments", icon: BarChart3 },
  { label: "Settings", href: "/settings", icon: Settings },
  { label: "Profile", href: "/profile", icon: User },
];

/* ─── Secondary navigation ─────────────────────────────────────────────
 * Library + Developer Tools destinations. Rendered inside the identity
 * dock's account menu (AppShell) — the top bar only carries Main pills +
 * More, so secondary surfaces live one click away without flooding the bar.
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
      { label: "Docs", href: "/docs", icon: FileText },
    ],
  },
];

/* ─── Flag-gated visibility ──────────────────────────────────────────── */
// /games hides while the retroGameRuntime flag is off (see
// src/app/(app)/games/layout.tsx) so no nav surface ever links to a 404.
// /discover is flag-gated the same way (communitySocial).
export function getVisibleMainNav(): NavItem[] {
  return APP_NAV_MAIN;
}

export function getVisibleMoreNav(): NavItem[] {
  return APP_NAV_MORE.filter((item) => {
    if (item.href === "/games") return isFeatureEnabled("retroGameRuntime");
    if (item.href === "/discover") return isFeatureEnabled("communitySocial");
    return true;
  });
}

/**
 * Studio `?tool=` values that route to their own top-level nav
 * destinations (Assets / Agents / Missions / More) rather than the
 * default Studio surface — see mapLegacyToolToDestination.
 */
const STUDIO_DESTINATION_TOOLS = new Set([
  "assets",
  "agents",
  "workflows",
  "pipeline",
  "plugins",
  "clibridge",
]);

/**
 * Active-route check for the new AppShell navigation.
 * Matches by path prefix, with special handling for /dashboard (exact match
 * unless ?app= is present).
 */
export function isAppNavActive(
  pathname: string | null,
  searchParams: URLSearchParams,
  href?: string,
): boolean {
  if (!pathname || !href) return false;
  const [path, query] = href.split("?");
  // /dashboard is active only when there's no ?app= param (unless the href has one)
  if (path === "/dashboard" && !query) {
    return pathname === "/dashboard" && !searchParams.get("app");
  }
  if (path === "/dashboard" && query) {
    const hrefParams = new URLSearchParams(query);
    return pathname === "/dashboard" &&
      Array.from(hrefParams.entries()).every(([k, v]) => searchParams.get(k) === v);
  }
  // /studio: a bare "/studio" href is the DEFAULT Studio surface — it must
  // not light up while a sibling destination owns the URL (?tool=assets,
  // agents, workflows, plugins, clibridge get their own nav items). An
  // href carrying ?tool=X is active only on that exact tool.
  if (path === "/studio") {
    if (!(pathname === "/studio" || pathname.startsWith("/studio/"))) return false;
    if (!query) {
      const tool = searchParams.get("tool");
      return tool === null || !STUDIO_DESTINATION_TOOLS.has(tool);
    }
    const hrefParams = new URLSearchParams(query);
    return pathname === "/studio" &&
      Array.from(hrefParams.entries()).every(([k, v]) => searchParams.get(k) === v);
  }
  // Exact match for root-level, prefix for others
  if (path === "/") return pathname === "/";
  return pathname === path || pathname.startsWith(`${path}/`);
}
