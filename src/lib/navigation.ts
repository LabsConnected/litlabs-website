import type { LucideIcon } from "lucide-react";
import {
  LayoutDashboard,
  Users,
  Sparkles,
  ShoppingBag,
  Gamepad2,
  BarChart3,
  Settings,
  Home,
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
  Zap,
  Star,
  Receipt,
  Brain,
  Database,
  Code2,
  Workflow,
  FolderKanban,
  PlusCircle,
  Menu,
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
    href: "/studio",
    icon: Sparkles,
    accent: GROUP_ACCENTS.Studio,
    items: [
      { label: "Create", href: "/studio", icon: Sparkles },
      { label: "Image", href: "/studio?tool=image", icon: Image },
      { label: "Video", href: "/studio?tool=video", icon: Video },
      { label: "Music", href: "/dashboard?app=music", icon: Music },
      { label: "Workflows", href: "/studio?tool=pipeline", icon: Workflow },
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
    label: "Agents",
    href: "/agents",
    icon: Bot,
    accent: GROUP_ACCENTS.Agents,
    items: [
      { label: "All Agents", href: "/agents", icon: Bot },
      { label: "Memory", href: "/memories", icon: Database },
      { label: "Automations", href: "/studio?tool=pipeline", icon: Zap },
    ],
  },
  {
    label: "Gallery",
    href: "/gallery",
    icon: Image,
    accent: GROUP_ACCENTS.Gallery,
    items: [
      { label: "Community", href: "/gallery", icon: Image },
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
      { label: "LiTBits", href: "/marketplace?tab=coins", icon: Wallet },
      { label: "Purchases", href: "/wallet?tab=history", icon: Receipt },
      { label: "Creator Hub", href: "/creator", icon: BarChart3 },
    ],
  },
  {
    label: "Social",
    href: "/social",
    icon: Users,
    accent: GROUP_ACCENTS.Social,
    items: [
      { label: "Community", href: "/social", icon: Users },
    ],
  },
  {
    label: "More",
    href: "/games",
    icon: Menu,
    accent: GROUP_ACCENTS.More,
    items: [
      { label: "Games", href: "/games", icon: Gamepad2 },
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
  { label: "Home", href: "/dashboard", icon: Home },
  { label: "Studio", href: "/studio", icon: Sparkles },
  { label: "Create", href: "/studio?tool=builder", icon: PlusCircle },
  { label: "Agents", href: "/agents", icon: Bot },
  { label: "Projects", href: "/projects", icon: FolderKanban },
  { label: "Gallery", href: "/gallery", icon: Image },
  { label: "Market", href: "/marketplace", icon: Store },
  { label: "Games", href: "/games", icon: Gamepad2 },
  { label: "Wallet", href: "/wallet", icon: Wallet },
  { label: "Settings", href: "/settings", icon: Settings },
];

export const AI_SUGGESTIONS = [
  "Take me to my unfinished images",
  "Open my agents",
  "Continue yesterday's song",
  "Show my revenue",
  "Play Hextris",
  "Find Builder",
  "Show trending games",
  "Create a new post",
];

export const QUICK_CREATE_ITEMS = [
  { label: "Create Image", href: "/studio?tool=image", icon: Image },
  { label: "Create Music", href: "/dashboard?app=music", icon: Music },
  { label: "Create Video", href: "/studio?tool=video", icon: Video },
  { label: "Create Agent", href: "/agents", icon: Bot },
  { label: "Create Workflow", href: "/studio?tool=pipeline", icon: Layers },
  { label: "Create Post", href: "/social", icon: MessagesSquare },
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
