import type { LucideIcon } from "lucide-react";
import {
  LayoutDashboard,
  Users,
  Sparkles,
  Shapes as ShapesIcon,
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

/* ─── Canonical App Shell navigation (COMMAND / STUDIO / EXPLORE) ─── */
// Studio is its own top-level section — it is the primary product surface
// and must not sit under Command. Creation routes remain reachable directly
// through Studio without adding a separate Create sidebar section.

export const CANONICAL_MORE_ITEMS: NavItem[] = [
  { label: "Projects", href: "/projects", icon: FolderKanban },
  { label: "Games", href: "/games", icon: GamesIcon },
  { label: "Discover", href: "/discover", icon: Compass },
  { label: "Marketplace", href: "/marketplace", icon: ShoppingBag },
  { label: "Showcase", href: "/showcase", icon: Star },
  { label: "Wallet", href: "/wallet", icon: Wallet },
  { label: "Docs", href: "/docs", icon: FileText },
  { label: "Settings", href: "/settings", icon: Settings },
];

/** One global navigation contract shared by desktop and mobile shells. */
export const CANONICAL_GLOBAL_NAV: NavItem[] = [
  { label: "Home", href: "/dashboard", icon: LayoutDashboard, shortcut: "⌘H" },
  { label: "Studio", href: "/studio", icon: Sparkles, shortcut: "⌘S" },
  { label: "Create", href: "/studio?tool=chat", icon: ShapesIcon, shortcut: "⌘N" },
  { label: "Assets", href: "/gallery", icon: Image },
  { label: "Agents", href: "/agents", icon: Bot },
  { label: "Missions", href: "/studio?tool=workflows", icon: Workflow },
  { label: "More", href: "/projects", icon: Menu, children: CANONICAL_MORE_ITEMS },
];

/** Compatibility wrapper consumed by older shell code during migration. */
export const APP_NAV_SECTIONS: NavSection[] = [
  { id: "global", label: "LiTT", items: CANONICAL_GLOBAL_NAV },
];

/* Bottom-of-sidebar utility items (always visible).
   Profile is NOT here — it lives inside the identity dock's account menu. */
export const APP_NAV_BOTTOM: NavItem[] = [];

/* Mobile bottom bar — uses same canonical data, simplified to 5 slots */
export const APP_MOBILE_BOTTOM_ITEMS: MobileNavItem[] = [
  { label: "Home", href: "/dashboard", icon: LayoutDashboard },
  { label: "Studio", href: "/studio", icon: Sparkles },
  { label: "Assets", href: "/gallery", icon: Image },
  { label: "Agents", href: "/agents", icon: Bot },
];

/* Compatibility projection for older consumers. It is derived from the
   canonical contract so legacy shells cannot introduce a second nav model. */
export const NAV_GROUPS: NavGroup[] = [
  ...CANONICAL_GLOBAL_NAV.map((item) => ({
    label: item.label,
    href: item.href ?? "/dashboard",
    icon: item.icon,
    accent: GROUP_ACCENTS[item.label] ?? GROUP_ACCENTS.More,
    items: item.children ?? [],
  })),
];

type MobileNavItem = {
  label: string;
  href: string;
  icon: LucideIcon;
  badge?: number;
};

export const MOBILE_BOTTOM_ITEMS: MobileNavItem[] = [
  ...APP_MOBILE_BOTTOM_ITEMS,
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
