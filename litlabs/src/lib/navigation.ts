import type { LucideIcon } from "lucide-react";
import {
  LayoutDashboard,
  Users,
  Sparkles,
  ShoppingBag,
  Gamepad2,
  BarChart3,
  Library,
  Settings,
  Home,
  MessagesSquare,
  Bell,
  User,
  Store,
  Wallet,
  Heart,
  TrendingUp,
  Bookmark,
  Video,
  Music,
  Image,
  Bot,
  PenTool,
  Search,
  Shield,
  Star,
  Flame,
  Award,
  Folder,
  Megaphone,
  Terminal,
  Paintbrush,
  Brain,
  Code2,
  Activity,
  Coins,
  FileText,
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
  Home:        "#22d3ee",
  Social:      "#4ade80",
  Create:      "#e879f9",
  Marketplace: "#fb923c",
  Gaming:      "#f43f5e",
  Creator:     "#a78bfa",
  Library:     "#38bdf8",
  Agents:      "#a3f546",
  System:      "#94a3b8",
};

export const NAV_GROUPS: NavGroup[] = [
  {
    label: "Home",
    href: "/dashboard",
    icon: Home,
    accent: GROUP_ACCENTS.Home,
    items: [
      { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
      { label: "LiTTree", href: "/studio?tool=chat", icon: Brain, online: true },
      { label: "LiT Console", href: "/studio?tool=chat", icon: Terminal, online: true },
      { label: "Feed", href: "/social?feed=main", icon: Flame },
      { label: "Notifications", href: "/social?tab=notifications", icon: Bell, badge: 3 },
      { label: "Showcase", href: "/showcase", icon: Star },
    ],
  },
  {
    label: "Social",
    href: "/social",
    icon: Users,
    accent: GROUP_ACCENTS.Social,
    items: [
      { label: "Feed", href: "/social?feed=main", icon: Flame },
      { label: "AI Feed", href: "/social?feed=ai", icon: Sparkles },
      {
        label: "Trending",
        href: "/social?feed=trending",
        icon: TrendingUp,
      },
      {
        label: "Friends",
        href: "/social?tab=friends",
        icon: Users,
        online: true,
      },
      {
        label: "Messages",
        href: "/social?tab=messages",
        icon: MessagesSquare,
        badge: 1,
      },
      {
        label: "Notifications",
        href: "/social?tab=notifications",
        icon: Bell,
        badge: 3,
      },
    ],
  },
  {
    label: "Create",
    href: "/studio",
    icon: Sparkles,
    accent: GROUP_ACCENTS.Create,
    items: [
      { label: "Studio", href: "/studio", icon: Sparkles },
      { label: "Image", href: "/studio?tool=image", icon: Image },
      { label: "Video", href: "/studio?tool=video", icon: Video },
      { label: "Music", href: "/studio?tool=audio", icon: Music },
      { label: "Build with LiTTree", href: "/studio?tool=chat", icon: Code2 },
      { label: "Color by Number", href: "/color", icon: Paintbrush },
      { label: "Agent Skills", href: "/studio?tool=chat", icon: Bot },
      { label: "Gallery", href: "/gallery", icon: Library },
    ],
  },
  {
    label: "Marketplace",
    href: "/marketplace",
    icon: ShoppingBag,
    accent: GROUP_ACCENTS.Marketplace,
    items: [
      { label: "Home", href: "/marketplace", icon: Home },
      { label: "Discover", href: "/marketplace?tab=discover", icon: Search },
      { label: "Sell", href: "/marketplace?tab=sell", icon: Store },
      { label: "Favorites", href: "/marketplace?tab=favorites", icon: Heart },
      { label: "Wallet", href: "/wallet", icon: Wallet },
    ],
  },
  {
    label: "Gaming",
    href: "/games/cloud",
    icon: Gamepad2,
    accent: GROUP_ACCENTS.Gaming,
    items: [
      { label: "Game Cloud", href: "/games/cloud", icon: Gamepad2 },
      { label: "Leaderboard", href: "/games/cloud", icon: BarChart3 },
      { label: "Achievements", href: "/games/cloud", icon: Award },
    ],
  },
  {
    label: "Creator",
    href: "/creator",
    icon: BarChart3,
    accent: GROUP_ACCENTS.Creator,
    items: [
      { label: "Analytics", href: "/creator?tab=analytics", icon: BarChart3 },
      { label: "Revenue", href: "/creator?tab=revenue", icon: Coins },
      { label: "Subscribers", href: "/creator?tab=subscribers", icon: Users },
      { label: "Portfolio", href: "/creator?tab=portfolio", icon: Folder },
      { label: "Content", href: "/creator?tab=content", icon: FileText },
      { label: "Promote", href: "/creator?tab=promote", icon: Megaphone },
    ],
  },
  {
    label: "Library",
    href: "/gallery",
    icon: Library,
    accent: GROUP_ACCENTS.Library,
    items: [
      { label: "Gallery", href: "/gallery", icon: Image },
      { label: "AI Images", href: "/gallery?tab=ai", icon: Sparkles },
      { label: "Videos", href: "/gallery?tab=videos", icon: Video },
      { label: "Collections", href: "/gallery?tab=collections", icon: Folder },
      { label: "Saved", href: "/library/saved", icon: Bookmark },
    ],
  },
  {
    label: "Agents",
    href: "/studio?tool=chat",
    icon: Bot,
    accent: GROUP_ACCENTS.Agents,
    items: [
      { label: "LiTTree", href: "/studio?tool=chat", icon: Brain, online: true },
      { label: "Forge", href: "/studio?tool=chat", icon: Code2, online: true },
      { label: "Pulse", href: "/studio?tool=chat", icon: Activity, online: true },
      { label: "Visionary", href: "/studio?tool=chat", icon: Sparkles, online: true },
      { label: "SocialPilot", href: "/studio?tool=chat", icon: Megaphone, online: true },
      { label: "LiT Console", href: "/studio?tool=chat", icon: Terminal },
    ],
  },
  {
    label: "System",
    href: "/settings",
    icon: Settings,
    accent: GROUP_ACCENTS.System,
    items: [
      { label: "Profile", href: "/profile", icon: User },
      { label: "Admin Dashboard", href: "/admin", icon: Shield, badge: 1 },
      { label: "Terminal", href: "/admin/terminal", icon: Terminal },
    ],
  },
];

export const MOBILE_BOTTOM_ITEMS = [
  { label: "Home", href: "/dashboard", icon: Home },
  { label: "LiT", href: "/studio?tool=chat", icon: Bot },
  { label: "Create", href: "/studio", icon: Sparkles },
  { label: "Market", href: "/marketplace", icon: Store },
  { label: "Games", href: "/games/cloud", icon: Gamepad2 },
  { label: "Profile", href: "/profile", icon: User },
];

export const MOBILE_MORE_ITEMS = [
  { label: "Profile", href: "/profile", icon: User },
  { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
  { label: "Studio", href: "/studio", icon: Paintbrush },
  { label: "Agent", href: "/studio?tool=chat", icon: Bot },
  { label: "Gallery", href: "/gallery", icon: Image },
  { label: "Marketplace", href: "/marketplace", icon: Store },
  { label: "Games", href: "/games/cloud", icon: Gamepad2 },
  { label: "Social", href: "/social", icon: Users },
  { label: "LiT Console", href: "/studio?tool=chat", icon: Terminal },
  { label: "LiTTree", href: "/studio?tool=chat", icon: Brain },
  { label: "Wallet", href: "/wallet", icon: Wallet },
  { label: "Admin", href: "/admin", icon: Shield },
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
  { label: "Create Music", href: "/studio?tool=audio", icon: Music },
  { label: "Create Video", href: "/studio?tool=video", icon: Video },
  { label: "Ask LiTTree", href: "/studio?tool=chat", icon: Bot },
  { label: "Create Post", href: "/social?create=post", icon: MessagesSquare },
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

export const PINNED_KEY = "litlabs-nav-pinned";
export const HIDDEN_KEY = "litlabs-nav-hidden";
export const MODE_KEY = "litlabs-nav-mode";
export const COLLAPSED_KEY = "litlabs-sidebar-collapsed";
export const GROUP_EXPANDED_KEY = "litlabs-sidebar-groups-expanded";
