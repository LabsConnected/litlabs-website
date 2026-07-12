import type { LucideIcon } from "lucide-react";
import {
  LayoutDashboard,
  Users,
  Sparkles,
  ShoppingBag,
  Gamepad2,
  Settings,
  FileText,
  Folder,
  Bot,
  MoreHorizontal,
  Wallet,
  Image,
  Wand2,
  Zap,
  HelpCircle,
  Rocket,
} from "lucide-react";

export type NavItem = {
  label: string;
  href?: string;
  icon: LucideIcon;
  children?: NavItem[];
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
  Projects: "#22d3ee",
  Deployments: "#22c55e",
  Agents: "#ec4899",
  Gallery: "#a855f7",
  Marketplace: "#f59e0b",
  Social: "#34d399",
  More: "#666688",
};

export const NAV_GROUPS: NavGroup[] = [
  {
    label: "Dashboard",
    href: "/dashboard",
    icon: LayoutDashboard,
    accent: GROUP_ACCENTS.Dashboard,
    items: [
      { label: "Home", href: "/dashboard", icon: LayoutDashboard },
      { label: "Missions", href: "/dashboard?tab=missions", icon: Zap },
      { label: "Artifacts", href: "/gallery?source=user", icon: Image },
      { label: "Usage", href: "/settings?tab=usage", icon: Wand2 },
    ],
  },
  {
    label: "Studio",
    href: "/studio",
    icon: Sparkles,
    accent: GROUP_ACCENTS.Studio,
    items: [
      { label: "Workspace", href: "/studio", icon: Sparkles },
      { label: "Generate", href: "/studio?tool=image", icon: Wand2 },
      { label: "History", href: "/dashboard?tab=runs", icon: Zap },
    ],
  },
  {
    label: "Projects",
    href: "/projects",
    icon: Folder,
    accent: GROUP_ACCENTS.Projects,
    items: [
      { label: "All projects", href: "/projects", icon: Folder },
      { label: "Deployments", href: "/deployments", icon: Rocket },
      { label: "GitHub installs", href: "/settings?tab=integrations", icon: Zap },
    ],
  },
  {
    label: "Agents",
    href: "/agents",
    icon: Bot,
    accent: GROUP_ACCENTS.Agents,
    items: [
      { label: "My agents", href: "/agents", icon: Bot },
      { label: "Market agents", href: "/marketplace?type=agents", icon: ShoppingBag },
      { label: "Memory", href: "/agents/me?tab=memory", icon: Sparkles },
    ],
  },
  {
    label: "Gallery",
    href: "/gallery",
    icon: Image,
    accent: GROUP_ACCENTS.Gallery,
    items: [
      { label: "Museum", href: "/gallery", icon: Image },
      { label: "Saved", href: "/library/saved", icon: Sparkles },
    ],
  },
  {
    label: "Marketplace",
    href: "/marketplace",
    icon: ShoppingBag,
    accent: GROUP_ACCENTS.Marketplace,
    items: [
      { label: "Browse", href: "/marketplace", icon: ShoppingBag },
      { label: "Installed", href: "/marketplace?tab=installed", icon: Zap },
    ],
  },
  {
    label: "Social",
    href: "/social",
    icon: Users,
    accent: GROUP_ACCENTS.Social,
    items: [
      { label: "Feed", href: "/social", icon: Users },
      { label: "Trending", href: "/social?tab=trending", icon: Sparkles },
    ],
  },
  {
    label: "More",
    href: "/settings",
    icon: MoreHorizontal,
    accent: GROUP_ACCENTS.More,
    items: [
      { label: "Wallet", href: "/wallet", icon: Wallet },
      { label: "Games", href: "/games", icon: Gamepad2 },
      { label: "Docs", href: "/docs", icon: FileText },
      { label: "Support", href: "/docs?topic=support", icon: HelpCircle },
      { label: "Settings", href: "/settings", icon: Settings },
    ],
  },
];

export const MOBILE_BOTTOM_ITEMS = [
  { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
  { label: "Studio", href: "/studio", icon: Sparkles },
  { label: "Projects", href: "/projects", icon: Folder },
  { label: "Agents", href: "/agents", icon: Bot },
  { label: "More", href: "#menu", icon: MoreHorizontal },
];

export const MOBILE_MORE_ITEMS = [
  { label: "Gallery", href: "/gallery", icon: Image },
  { label: "Marketplace", href: "/marketplace", icon: ShoppingBag },
  { label: "Deployments", href: "/deployments", icon: Rocket },
  { label: "Social", href: "/social", icon: Users },
  { label: "Wallet", href: "/wallet", icon: Wallet },
  { label: "Settings", href: "/settings", icon: Settings },
];

export const AI_SUGGESTIONS = [
  "Open Studio",
  "Create an agent",
  "Generate an image",
  "Browse marketplace",
];

export const COLLAPSED_KEY = "litlabs-sidebar-collapsed";
export const GROUP_EXPANDED_KEY = "litlabs-nav-groups-expanded";
export const PINNED_KEY = "litlabs-nav-pinned";
export const HIDDEN_KEY = "litlabs-nav-hidden";
