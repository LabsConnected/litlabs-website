import type { LucideIcon } from "lucide-react";
import {
  LayoutDashboard,
  Users,
  Sparkles,
  ShoppingBag,
  Gamepad2,
  BarChart3,
  Library,
  Wand2,
  Settings,
  Home,
  MessagesSquare,
  Bell,
  User,
  Store,
  Wallet,
  Coins,
  Heart,
  TrendingUp,
  Map,
  Calendar,
  Bookmark,
  Video,
  Music,
  Image,
  Mic,
  Bot,
  Layers,
  PenTool,
  Clapperboard,
  Radio,
  MonitorPlay,
  Search,
  FileText,
  Zap,
  Shield,
  Star,
  Trophy,
  Target,
  Flame,
  Share2,
  Award,
  Clock,
  Fingerprint,
  Aperture,
  Folder,
  Download,
  CreditCard,
  Receipt,
  Tag,
  Package,
  Megaphone,
  Rocket,
  Menu,
  Terminal,
  Gift,
  Paintbrush,
  Brain,
  Database,
  Code2,
  Cpu,
  Workflow,
  FolderTree,
  History,
  GitBranch,
  Activity,
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
  Home: "#00f0ff",
  Social: "#22c55e",
  Create: "#ff00a0",
  Marketplace: "#f59e0b",
  Gaming: "#ef4444",
  Creator: "#8b5cf6",
  Library: "#06b6d4",
  AI: "#ec4899",
  System: "#666688",
};

export const NAV_GROUPS: NavGroup[] = [
  {
    label: "Home",
    href: "/dashboard",
    icon: Home,
    accent: GROUP_ACCENTS.Home,
    items: [
      { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
      { label: "Feed", href: "/social?feed=main", icon: Flame },
      {
        label: "Notifications",
        href: "/social?tab=notifications",
        icon: Bell,
        badge: 3,
      },
      {
        label: "Messages",
        href: "/social?tab=messages",
        icon: MessagesSquare,
        badge: 1,
      },
      { label: "Wallet", href: "/wallet", icon: Wallet },
      { label: "LiTT", href: "/litt", icon: Brain, online: true },
      { label: "Showcase", href: "/showcase", icon: Star },
    ],
  },
  {
    label: "Social",
    href: "/social",
    icon: Users,
    accent: GROUP_ACCENTS.Social,
    items: [
      {
        label: "Feed",
        icon: Flame,
        children: [
          { label: "AI Feed", href: "/social?feed=ai", icon: Sparkles },
          { label: "Following", href: "/social?feed=following", icon: Users },
          { label: "Friends", href: "/social?feed=friends", icon: Heart },
          { label: "Local", href: "/social?feed=local", icon: Map },
          {
            label: "Trending",
            href: "/social?feed=trending",
            icon: TrendingUp,
          },
          { label: "Creator Feed", href: "/social?feed=creator", icon: Star },
          {
            label: "Marketplace Feed",
            href: "/social?feed=marketplace",
            icon: ShoppingBag,
          },
          { label: "Music Feed", href: "/social?feed=music", icon: Music },
          { label: "Image Feed", href: "/social?feed=image", icon: Image },
          { label: "Video Feed", href: "/social?feed=video", icon: Video },
          { label: "Game Clips", href: "/social?feed=clips", icon: Gamepad2 },
          { label: "Live Feed", href: "/social?feed=live", icon: MonitorPlay },
          { label: "Events", href: "/social?feed=events", icon: Calendar },
          { label: "Saved", href: "/social?feed=saved", icon: Bookmark },
          { label: "History", href: "/social?feed=history", icon: Clock },
        ],
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
      { label: "Communities", href: "/social?tab=communities", icon: Users },
      { label: "Groups", href: "/social?tab=groups", icon: Folder },
      { label: "Events", href: "/social?tab=events", icon: Calendar },
      {
        label: "Live",
        href: "/social?tab=live",
        icon: MonitorPlay,
        online: true,
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
      { label: "Canvas Builder", href: "/studio?tool=canvas", icon: PenTool },
      { label: "Image", href: "/studio?tool=image", icon: Image },
      { label: "Video", href: "/studio?tool=video", icon: Video },
      { label: "Music", href: "/dashboard?app=music", icon: Music },
      { label: "Voice", href: "/dashboard?app=audio-tools", icon: Mic },
      { label: "AI Agents", href: "/agents", icon: Bot },
      { label: "AI Builder", href: "/ai-builder", icon: Code2 },
      { label: "Flow", href: "/studio?tool=workflow", icon: Layers },
      { label: "Prompt Library", href: "/studio?tool=prompts", icon: Library },
      { label: "Models", href: "/studio?tool=models", icon: Aperture },
      { label: "History", href: "/studio?tool=history", icon: Clock },
      {
        label: "Color by Number",
        href: "/studio?tool=color",
        icon: Paintbrush,
      },
      { label: "Exports", href: "/studio?tool=exports", icon: Download },
      { label: "Templates", href: "/studio?tool=templates", icon: FileText },
      { label: "Workflows", href: "/studio?tool=workflows", icon: Layers },
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
      {
        label: "Subscriptions",
        href: "/marketplace?tab=subscriptions",
        icon: CreditCard,
      },
      {
        label: "Downloads",
        href: "/marketplace?tab=downloads",
        icon: Download,
      },
      { label: "Purchases", href: "/marketplace?tab=purchases", icon: Receipt },
      { label: "Favorites", href: "/marketplace?tab=favorites", icon: Heart },
      {
        label: "Collections",
        href: "/marketplace?tab=collections",
        icon: Folder,
      },
      { label: "Coupons", href: "/marketplace?tab=coupons", icon: Tag },
      { label: "Orders", href: "/marketplace?tab=orders", icon: Package },
      { label: "Reviews", href: "/marketplace?tab=reviews", icon: Star },
      { label: "Wallet", href: "/wallet", icon: Wallet },
      { label: "LitBits", href: "/wallet?tab=litbits", icon: Coins },
    ],
  },
  {
    label: "Gaming",
    href: "/games",
    icon: Gamepad2,
    accent: GROUP_ACCENTS.Gaming,
    items: [
      { label: "Game Cloud", href: "/games", icon: Gamepad2 },
      { label: "Cloud Arcade", href: "/games/cloud", icon: MonitorPlay },
      { label: "Continue Playing", href: "/games?tab=continue", icon: Clock },
      { label: "Arcade", href: "/games?category=arcade", icon: Trophy },
      { label: "Puzzle", href: "/games?category=puzzle", icon: Target },
      { label: "Racing", href: "/games?category=racing", icon: Zap },
      { label: "FPS", href: "/games?category=fps", icon: Target },
      { label: "Simulation", href: "/games?category=simulation", icon: Layers },
      {
        label: "Multiplayer",
        href: "/games?tab=multiplayer",
        icon: Users,
        online: true,
      },
      { label: "Achievements", href: "/games?tab=achievements", icon: Award },
      { label: "Friends", href: "/games?tab=friends", icon: Heart },
      { label: "Leaderboard", href: "/games?tab=leaderboard", icon: BarChart3 },
      { label: "Tournaments", href: "/games?tab=tournaments", icon: Trophy },
      { label: "Season Pass", href: "/games?tab=season", icon: Star },
      { label: "Daily Rewards", href: "/games?tab=rewards", icon: Gift },
      { label: "Cloud Saves", href: "/games?tab=saves", icon: Download },
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
      { label: "Photos", href: "/gallery?tab=photos", icon: Image },
      { label: "Videos", href: "/gallery?tab=videos", icon: Video },
      { label: "Collections", href: "/gallery?tab=collections", icon: Folder },
      { label: "Favorites", href: "/gallery?tab=favorites", icon: Heart },
      { label: "AI Images", href: "/gallery?tab=ai", icon: Sparkles },
      { label: "Albums", href: "/gallery?tab=albums", icon: Library },
      { label: "Shared", href: "/gallery?tab=shared", icon: Share2 },
      {
        label: "Marketplace",
        href: "/marketplace?tab=library",
        icon: ShoppingBag,
      },
      { label: "Music", href: "/dashboard?app=music", icon: Music },
      { label: "Files", href: "/library/files", icon: FileText },
      { label: "Saved", href: "/library/saved", icon: Bookmark },
    ],
  },
  {
    label: "AI",
    href: "/agents",
    icon: Wand2,
    accent: GROUP_ACCENTS.AI,
    items: [
      { label: "LiTT", href: "/litt", icon: Brain, online: true },
      { label: "Code Scanner", href: "/code", icon: Code2 },
      { label: "Installed", href: "/agents?tab=installed", icon: Download },
      { label: "Marketplace", href: "/agents?tab=marketplace", icon: Store },
      { label: "Agent Forge", href: "/agents?tab=forge", icon: Sparkles },
      { label: "Memory", href: "/agents?tab=memory", icon: Library },
      { label: "Workflows", href: "/agents?tab=workflows", icon: Layers },
      { label: "Tools", href: "/agents?tab=tools", icon: Wand2 },
      { label: "Logs", href: "/agents?tab=logs", icon: Clock },
      { label: "Training", href: "/agents?tab=training", icon: Target },
      { label: "Versions", href: "/agents?tab=versions", icon: Layers },
      { label: "Deployments", href: "/agents?tab=deployments", icon: Rocket },
      { label: "Monitor", href: "/agents?tab=monitor", icon: MonitorPlay },
      { label: "Chats", href: "/agents?tab=chats", icon: MessagesSquare },
      { label: "Models", href: "/agents?tab=models", icon: Aperture },
      { label: "Prompt Library", href: "/agents?tab=prompts", icon: Library },
      { label: "Automations", href: "/agents?tab=automations", icon: Zap },
    ],
  },
  {
    label: "System",
    href: "/settings",
    icon: Settings,
    accent: GROUP_ACCENTS.System,
    items: [
      { label: "Settings", href: "/settings", icon: Settings },
      { label: "Profile", href: "/settings?tab=profile", icon: User },
      {
        label: "Notifications",
        href: "/settings?tab=notifications",
        icon: Bell,
      },
      { label: "Theme", href: "/settings?tab=appearance", icon: Aperture },
      { label: "Admin", href: "/admin", icon: Shield },
      { label: "Terminal", href: "/admin/terminal", icon: Terminal },
      { label: "Terms", href: "/terms", icon: FileText },
      { label: "Logout", href: "/sign-in", icon: Fingerprint },
    ],
  },
];

export const MOBILE_BOTTOM_ITEMS = [
  { label: "Home", href: "/dashboard", icon: Home },
  { label: "Create", href: "/studio", icon: Sparkles },
  { label: "Social", href: "/social", icon: MessagesSquare, badge: 4 },
  { label: "Games", href: "/games", icon: Gamepad2 },
  { label: "More", href: "#menu", icon: Menu },
];

export const MOBILE_MORE_ITEMS = [
  { label: "Profile", href: "/profile", icon: User },
  { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
  { label: "Studio", href: "/studio", icon: Paintbrush },
  { label: "Agents", href: "/agents", icon: Bot },
  { label: "Gallery", href: "/gallery", icon: Image },
  { label: "Music", href: "/dashboard?app=music", icon: Music },
  { label: "Marketplace", href: "/marketplace", icon: Store },
  { label: "Games", href: "/games", icon: Gamepad2 },
  { label: "Social", href: "/social", icon: Users },
  { label: "Flow", href: "/studio?tool=workflow", icon: Layers },
  { label: "Watch", href: "/dashboard?app=watch", icon: Clapperboard },
  { label: "Radio", href: "/dashboard?app=radio", icon: Radio },
  { label: "Terminal", href: "/admin/terminal", icon: Terminal },
  { label: "LiTT", href: "/litt", icon: Brain },
  { label: "Wallet", href: "/wallet", icon: Wallet },
  { label: "Notifications", href: "/social?tab=notifications", icon: Bell },
  { label: "Settings", href: "/settings", icon: Settings },
  { label: "Admin", href: "/admin", icon: Shield },
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
  { label: "Create Workflow", href: "/studio?tool=workflow", icon: Layers },
  { label: "Create Post", href: "/social?create=post", icon: MessagesSquare },
  { label: "Start Stream", href: "/studio?tool=stream", icon: MonitorPlay },
  { label: "Upload", href: "/studio?tool=upload", icon: Download },
  { label: "New Community", href: "/social?create=community", icon: Users },
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
