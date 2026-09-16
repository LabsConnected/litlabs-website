import type { LucideIcon } from "lucide-react";
import { isFeatureEnabled } from "@/config/feature-flags";
import {
  LayoutDashboard,
  Users,
  Sparkles,
  ShoppingBag,
  Gamepad2,
  BarChart3,
  Settings,
  MessagesSquare,
  User,
  Store,
  Wallet,
  Bookmark,
  Video,
  Music,
  Image,
  Bot,
  Layers,
  FileText,
  Star,
  Receipt,
  Menu,
  Brain,
  Code2,
  Workflow,
  FolderKanban,
  Bell,
  Gamepad2 as GamesIcon,
  Compass,
  Terminal,
  Mic,
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

export type NavGroup = {
  label: string;
  href: string;
  icon: LucideIcon;
  accent: string;
  items: NavItem[];
};

export const GROUP_ACCENTS: Record<string, string> = {
  Dashboard: "#00f0ff",
  Studio: "#ff00a0",
  Projects: "#8b5cf6",
  Agents: "#ec4899",
  Gallery: "#06b6d4",
  Social: "#22c55e",
  Marketplace: "#f59e0b",
  More: "#94a3b8",
};

/* ─── Canonical App Shell navigation ───────────────────────────────────
 * Main: Dashboard · Studio · Projects · Explore · Marketplace
 * Secondary: Library · Wallet · Developer Tools · Settings · Profile
 *   (Wallet/Settings live in APP_NAV_BOTTOM; Profile lives in the
 *   identity dock's account menu.)
 * Legacy creation routes (/builder, /ai-builder, /chat, /generate, …)
 * all redirect into Studio, so they are not separate destinations.
 */

export const APP_NAV_SECTIONS: NavSection[] = [
  {
    id: "main",
    label: "Main",
    items: [
      { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard, shortcut: "⌘D" },
      { label: "Studio", href: "/studio", icon: Sparkles, shortcut: "⌘S" },
      { label: "Projects", href: "/projects", icon: FolderKanban },
      { label: "Explore", href: "/discover", icon: Compass },
      { label: "Marketplace", href: "/marketplace", icon: ShoppingBag },
      { label: "Games", href: "/games", icon: GamesIcon },
      // /hire is permanently retired (always redirects to /studio — see
      // src/app/(app)/hire/page.tsx) so it is not a nav destination.
    ],
  },
];

/* ─── Secondary navigation ─────────────────────────────────────────────
 * Library + Developer Tools destinations. Rendered inside the identity
 * dock's account menu (AppShell) — the top bar only carries Main pills,
 * so secondary surfaces live one click away without flooding the bar.
 * Wallet/Settings are APP_NAV_BOTTOM; Profile stays in the account menu.
 */
export const APP_NAV_SECONDARY: NavSection[] = [
  {
    id: "library",
    label: "Library",
    items: [
      { label: "Files", href: "/library/files", icon: FileText },
      { label: "Saved", href: "/library/saved", icon: Bookmark },
      { label: "Code Workspace", href: "/code", icon: Code2 },
    ],
  },
  {
    id: "devtools",
    label: "Developer Tools",
    items: [
      { label: "CLI", href: "/cli", icon: Terminal },
      { label: "Terminal", href: "/studio?tool=terminal", icon: Terminal },
      { label: "Connections", href: "/settings/connections", icon: Layers },
      { label: "Docs", href: "/docs", icon: FileText },
    ],
  },
];

/* ─── Flag-gated visibility ──────────────────────────────────────────── */
// /games 404s while the retroGameRuntime flag is off (see
// src/app/(app)/games/layout.tsx — games are not part of the public V1
// product). The top navbar already hides the link behind the same flag;
// this helper applies the same rule to the app-shell sidebar so no nav
// surface ever links to a 404.
export function getVisibleNavSections(): NavSection[] {
  return APP_NAV_SECTIONS.map((section) => ({
    ...section,
    items: section.items.filter(
      (item) => item.href !== "/games" || isFeatureEnabled("retroGameRuntime"),
    ),
  }));
}

/* Bottom-of-sidebar utility items (always visible).
   Profile is NOT here — it lives inside the identity dock's account menu. */
export const APP_NAV_BOTTOM: NavItem[] = [
  { label: "Wallet", href: "/wallet", icon: Wallet },
  { label: "Settings", href: "/settings", icon: Settings },
];

/* Mobile bottom-bar data — currently unused by the top-bar AppShell
   (mobile uses the scrollable section strip + account menu), kept for
   the mobile bottom-bar surface if it returns. */
export const APP_MOBILE_BOTTOM_ITEMS: MobileNavItem[] = [
  { label: "Home", href: "/dashboard", icon: LayoutDashboard },
  { label: "Studio", href: "/studio", icon: Sparkles },
  { label: "Explore", href: "/discover", icon: Compass },
  { label: "Me", href: "/profile", icon: User },
];

/* Legacy compat — still used by dead Sidebar.tsx, keep for safety */
export const NAV_GROUPS: NavGroup[] = [
  {
    label: "Dashboard",
    href: "/dashboard",
    icon: LayoutDashboard,
    accent: GROUP_ACCENTS.Dashboard,
    items: [
      { label: "Overview", href: "/dashboard", icon: LayoutDashboard },
      { label: "LiTT Assistant", href: "/litt", icon: Brain },
    ],
  },
  {
    label: "Studio",
    href: "/studio?tool=chat",
    icon: Sparkles,
    accent: GROUP_ACCENTS.Studio,
    items: [
      { label: "Create", href: "/studio?tool=chat", icon: Sparkles },
      { label: "Image", href: "/studio?tool=image", icon: Image },
      { label: "Video", href: "/studio?tool=video", icon: Video },
      { label: "Music", href: "/studio?tool=music", icon: Music },
      { label: "Workflow Forge", href: "/studio?tool=pipeline", icon: Workflow },
    ],
  },
  {
    label: "Projects",
    href: "/projects",
    icon: FolderKanban,
    accent: GROUP_ACCENTS.Projects,
    items: [
      { label: "All Projects", href: "/projects", icon: FolderKanban },
      { label: "Code Workspace", href: "/code", icon: Code2 },
      { label: "Files", href: "/library/files", icon: FileText },
      { label: "Saved", href: "/library/saved", icon: Bookmark },
    ],
  },
  {
    label: "Gallery",
    href: "/gallery",
    icon: Image,
    accent: GROUP_ACCENTS.Gallery,
    items: [
      { label: "Overview", href: "/gallery", icon: Image },
      { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
      { label: "Showcase", href: "/showcase", icon: Star },
    ],
  },
  {
    label: "Marketplace",
    href: "/marketplace",
    icon: ShoppingBag,
    accent: GROUP_ACCENTS.Marketplace,
    items: [
      { label: "Browse Agents", href: "/marketplace", icon: Store },
      { label: "AI Credits", href: "/marketplace?tab=littbits", icon: Wallet },
      { label: "Purchases", href: "/wallet?tab=history", icon: Receipt },
      { label: "Creator Hub", href: "/creator", icon: BarChart3 },
    ],
  },
  {
    label: "Discover",
    href: "/discover",
    icon: Users,
    accent: GROUP_ACCENTS.Social,
    items: [
      { label: "Feed", href: "/discover", icon: Users },
      { label: "Gallery", href: "/gallery", icon: Image },
    ],
  },
  {
    label: "More",
    href: "/wallet",
    icon: Menu,
    accent: GROUP_ACCENTS.More,
    items: [
      { label: "Wallet", href: "/wallet", icon: Wallet },
      { label: "Docs", href: "/docs", icon: FileText },
      { label: "Settings", href: "/settings", icon: Settings },
      { label: "Profile", href: "/profile", icon: User },
    ],
  },
];

type MobileNavItem = {
  label: string;
  href: string;
  icon: LucideIcon;
  badge?: number;
};

export const MOBILE_BOTTOM_ITEMS: MobileNavItem[] = [
  { label: "Studio", href: "/studio?tool=chat", icon: Sparkles },
  { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
  { label: "Discover", href: "/discover", icon: MessagesSquare },
  { label: "Gallery", href: "/gallery", icon: Image },
];

export const AI_SUGGESTIONS = [
  "Take me to my unfinished images",
  "Open my agents",
  "Continue yesterday's song",
  "Show my revenue",
  "Open Studio",
  "Create a new post",
];

export const QUICK_CREATE_ITEMS = [
  { label: "Create Image", href: "/studio?tool=image", icon: Image },
  { label: "Create Music", href: "/studio?tool=music", icon: Music },
  { label: "Create Video", href: "/studio?tool=video", icon: Video },
  { label: "Create Agent", href: "/studio?tool=agents", icon: Bot },
  { label: "Create Workflow", href: "/studio?tool=pipeline", icon: Layers },
  { label: "Create Post", href: "/discover", icon: MessagesSquare },
];

export function isActive(
  pathname: string | null,
  searchParams: URLSearchParams,
  href?: string,
  appId?: string,
) {
  if (!href) return false;
  const [path, query] = href.split("?");
  if (appId) {
    return pathname === "/dashboard" && searchParams.get("app") === appId;
  }
  if (path === "/dashboard" && !appId) {
    return pathname === "/dashboard" && !searchParams.get("app");
  }
  if (query) {
    const hrefParams = new URLSearchParams(query);
    const searchMatch = Array.from(hrefParams.entries()).every(
      ([key, value]) => searchParams.get(key) === value,
    );
    return pathname === path && searchMatch;
  }
  return pathname?.startsWith(path) ?? false;
}

/**
 * Active-route check for the new AppShell navigation.
 * Matches by path prefix, with special handling for /dashboard (exact match
 * unless ?app= is present).
 */
export function isAppNavActive(
  pathname: string | null,
  searchParams: URLSearchParams,
  href: string,
): boolean {
  if (!pathname) return false;
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
  // /studio is active for all /studio* routes
  if (path === "/studio") {
    return pathname === "/studio" || pathname.startsWith("/studio/");
  }
  // Exact match for root-level, prefix for others
  if (path === "/") return pathname === "/";
  return pathname === path || pathname.startsWith(`${path}/`);
}

export function flattenNav(): {
  label: string;
  href: string;
  icon: LucideIcon;
}[] {
  const result: { label: string; href: string; icon: LucideIcon }[] = [];
  NAV_GROUPS.forEach((group) => {
    group.items.forEach((item) => {
      if (item.href)
        result.push({ label: item.label, href: item.href, icon: item.icon });
      item.children?.forEach((child) => {
        if (child.href)
          result.push({
            label: child.label,
            href: child.href,
            icon: child.icon,
          });
      });
    });
  });
  return result;
}

export const CREATOR_MODES = [
  { label: "Creator Mode", value: "creator", icon: Sparkles },
  { label: "Gamer Mode", value: "gamer", icon: Gamepad2 },
  { label: "Developer Mode", value: "developer", icon: Bot },
  { label: "Social Mode", value: "social", icon: Users },
];

export const PINNED_KEY = "litlabs-nav-pinned-v2";
export const HIDDEN_KEY = "litlabs-nav-hidden-v2";
export const MODE_KEY = "litlabs-nav-mode";
export const COLLAPSED_KEY = "litlabs-sidebar-collapsed";
export const GROUP_EXPANDED_KEY = "litlabs-sidebar-groups-expanded-v2";
