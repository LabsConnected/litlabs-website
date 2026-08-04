/**
 * Dashboard Widget Registry — canonical definitions for all dashboard widgets.
 *
 * Each widget has:
 * - A unique id
 * - A category (user vs owner-only)
 * - Default placement (x, y, width, height)
 * - A render function reference (resolved by the dashboard)
 *
 * The registry is the single source of truth for what widgets exist.
 * The dashboard layout persists which widgets are visible and where.
 */

export type WidgetCategory = "user" | "owner";

export interface WidgetDefinition {
  id: string;
  label: string;
  description: string;
  category: WidgetCategory;
  /** Default grid placement (12-col grid on desktop) */
  defaultPlacement: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  /** Minimum size in grid units */
  minWidth: number;
  minHeight: number;
  /** Icon name from the dashboard icon set */
  icon: string;
}

export interface DashboardWidgetPlacement {
  widgetId: string;
  x: number;
  y: number;
  width: number;
  height: number;
  collapsed: boolean;
  hidden: boolean;
}

export interface DashboardLayout {
  userId: string;
  breakpoint: "desktop" | "tablet" | "mobile";
  placements: DashboardWidgetPlacement[];
  updatedAt: string;
}

/* ── Widget definitions ─────────────────────────────────────────── */

export const WIDGET_DEFINITIONS: WidgetDefinition[] = [
  // ── User widgets ──
  {
    id: "litt-quick-ask",
    label: "LiTT Quick Ask",
    description: "Quick prompt input to ask LiTT anything",
    category: "user",
    defaultPlacement: { x: 6, y: 0, width: 6, height: 2 },
    minWidth: 4,
    minHeight: 2,
    icon: "message",
  },
  {
    id: "mission-queue",
    label: "Mission Queue",
    description: "Active LiTT missions and their progress",
    category: "user",
    defaultPlacement: { x: 0, y: 2, width: 6, height: 4 },
    minWidth: 4,
    minHeight: 3,
    icon: "zap",
  },
  {
    id: "current-project",
    label: "Current Project",
    description: "Active project runtime and status",
    category: "user",
    defaultPlacement: { x: 0, y: 0, width: 6, height: 2 },
    minWidth: 4,
    minHeight: 2,
    icon: "layers",
  },
  {
    id: "project-runtime",
    label: "Project Runtime",
    description: "Workspace, terminal, preview, and deployment state",
    category: "user",
    defaultPlacement: { x: 0, y: 6, width: 6, height: 3 },
    minWidth: 4,
    minHeight: 2,
    icon: "cpu",
  },
  {
    id: "pending-approvals",
    label: "Pending Approvals",
    description: "Missions and changes awaiting your approval",
    category: "user",
    defaultPlacement: { x: 6, y: 2, width: 6, height: 2 },
    minWidth: 3,
    minHeight: 2,
    icon: "shield",
  },
  {
    id: "recent-activity",
    label: "Recent Activity",
    description: "Platform and project events",
    category: "user",
    defaultPlacement: { x: 0, y: 9, width: 6, height: 4 },
    minWidth: 4,
    minHeight: 3,
    icon: "activity",
  },
  {
    id: "recent-creations",
    label: "Recent Creations",
    description: "Your latest images, videos, and music",
    category: "user",
    defaultPlacement: { x: 6, y: 4, width: 6, height: 3 },
    minWidth: 4,
    minHeight: 2,
    icon: "sparkles",
  },
  {
    id: "my-gallery",
    label: "My Gallery",
    description: "Your published gallery items",
    category: "user",
    defaultPlacement: { x: 6, y: 7, width: 6, height: 3 },
    minWidth: 4,
    minHeight: 2,
    icon: "image",
  },
  {
    id: "trending-gallery",
    label: "Trending Gallery",
    description: "Trending community creations",
    category: "user",
    defaultPlacement: { x: 6, y: 10, width: 6, height: 3 },
    minWidth: 4,
    minHeight: 2,
    icon: "trending",
  },
  {
    id: "discover-feed",
    label: "Discover Feed",
    description: "Latest posts from the community",
    category: "user",
    defaultPlacement: { x: 6, y: 13, width: 6, height: 4 },
    minWidth: 4,
    minHeight: 3,
    icon: "users",
  },
  {
    id: "music-player",
    label: "Music Player",
    description: "Quick access to the music player",
    category: "user",
    defaultPlacement: { x: 0, y: 13, width: 6, height: 3 },
    minWidth: 4,
    minHeight: 2,
    icon: "music",
  },
  {
    id: "littbits",
    label: "LiTTBits",
    description: "Your credit balance and plan",
    category: "user",
    defaultPlacement: { x: 0, y: 16, width: 3, height: 2 },
    minWidth: 2,
    minHeight: 2,
    icon: "wallet",
  },
  {
    id: "notifications",
    label: "Notifications",
    description: "Recent notifications",
    category: "user",
    defaultPlacement: { x: 3, y: 16, width: 3, height: 2 },
    minWidth: 2,
    minHeight: 2,
    icon: "bell",
  },
  {
    id: "deployments",
    label: "Deployments",
    description: "Recent project deployments",
    category: "user",
    defaultPlacement: { x: 6, y: 17, width: 6, height: 2 },
    minWidth: 4,
    minHeight: 2,
    icon: "rocket",
  },
  {
    id: "saved-items",
    label: "Saved Items",
    description: "Bookmarked creations and posts",
    category: "user",
    defaultPlacement: { x: 0, y: 18, width: 6, height: 2 },
    minWidth: 3,
    minHeight: 2,
    icon: "bookmark",
  },

  // ── Owner-only widgets ──
  {
    id: "visitors-online",
    label: "Visitors Online",
    description: "Real-time visitor count",
    category: "owner",
    defaultPlacement: { x: 0, y: 20, width: 3, height: 2 },
    minWidth: 2,
    minHeight: 2,
    icon: "eye",
  },
  {
    id: "signed-in-online",
    label: "Signed-in Users",
    description: "Authenticated users currently online",
    category: "owner",
    defaultPlacement: { x: 3, y: 20, width: 3, height: 2 },
    minWidth: 2,
    minHeight: 2,
    icon: "users",
  },
  {
    id: "signups-today",
    label: "Signups Today",
    description: "New user registrations today",
    category: "owner",
    defaultPlacement: { x: 6, y: 19, width: 3, height: 2 },
    minWidth: 2,
    minHeight: 2,
    icon: "user-plus",
  },
  {
    id: "studio-opens",
    label: "Studio Opens",
    description: "Studio session starts today",
    category: "owner",
    defaultPlacement: { x: 9, y: 19, width: 3, height: 2 },
    minWidth: 2,
    minHeight: 2,
    icon: "sparkles",
  },
  {
    id: "first-prompts",
    label: "First Prompts",
    description: "Users who sent their first prompt today",
    category: "owner",
    defaultPlacement: { x: 0, y: 22, width: 3, height: 2 },
    minWidth: 2,
    minHeight: 2,
    icon: "message",
  },
  {
    id: "upgrades",
    label: "Upgrades",
    description: "Plan upgrades today",
    category: "owner",
    defaultPlacement: { x: 3, y: 22, width: 3, height: 2 },
    minWidth: 2,
    minHeight: 2,
    icon: "trending",
  },
  {
    id: "revenue",
    label: "Revenue",
    description: "Revenue today and this month",
    category: "owner",
    defaultPlacement: { x: 6, y: 21, width: 3, height: 2 },
    minWidth: 2,
    minHeight: 2,
    icon: "dollar",
  },
  {
    id: "provider-costs",
    label: "Provider Costs",
    description: "Estimated AI provider costs today",
    category: "owner",
    defaultPlacement: { x: 9, y: 21, width: 3, height: 2 },
    minWidth: 2,
    minHeight: 2,
    icon: "cpu",
  },
  {
    id: "failed-tools",
    label: "Failed Tools",
    description: "Tools that have failed recently",
    category: "owner",
    defaultPlacement: { x: 0, y: 24, width: 4, height: 2 },
    minWidth: 3,
    minHeight: 2,
    icon: "alert",
  },
  {
    id: "failed-jobs",
    label: "Failed Jobs",
    description: "Background jobs that have failed",
    category: "owner",
    defaultPlacement: { x: 4, y: 24, width: 4, height: 2 },
    minWidth: 3,
    minHeight: 2,
    icon: "alert",
  },
  {
    id: "terminal-sessions",
    label: "Terminal Sessions",
    description: "Active terminal sessions",
    category: "owner",
    defaultPlacement: { x: 8, y: 24, width: 4, height: 2 },
    minWidth: 3,
    minHeight: 2,
    icon: "terminal",
  },
  {
    id: "litt-live-sessions",
    label: "LiTT Live Sessions",
    description: "Active LiTT voice/chat sessions",
    category: "owner",
    defaultPlacement: { x: 0, y: 26, width: 4, height: 2 },
    minWidth: 3,
    minHeight: 2,
    icon: "bot",
  },
  {
    id: "marketplace-installs",
    label: "Marketplace Installs",
    description: "Agent/capability installs today",
    category: "owner",
    defaultPlacement: { x: 4, y: 26, width: 4, height: 2 },
    minWidth: 3,
    minHeight: 2,
    icon: "shopping",
  },
  {
    id: "system-health",
    label: "System Health",
    description: "Platform, workspace, and provider health",
    category: "owner",
    defaultPlacement: { x: 8, y: 26, width: 4, height: 3 },
    minWidth: 4,
    minHeight: 2,
    icon: "heart",
  },
  {
    id: "audit-events",
    label: "Audit Events",
    description: "Security and audit log events",
    category: "owner",
    defaultPlacement: { x: 0, y: 28, width: 12, height: 3 },
    minWidth: 6,
    minHeight: 2,
    icon: "shield",
  },
];

/* ── Helpers ────────────────────────────────────────────────────── */

export function getWidgetDefinition(id: string): WidgetDefinition | undefined {
  return WIDGET_DEFINITIONS.find((w) => w.id === id);
}

export function getUserWidgets(): WidgetDefinition[] {
  return WIDGET_DEFINITIONS.filter((w) => w.category === "user");
}

export function getOwnerWidgets(): WidgetDefinition[] {
  return WIDGET_DEFINITIONS.filter((w) => w.category === "owner");
}

export function getDefaultLayout(ownerMode: boolean): DashboardWidgetPlacement[] {
  const widgets = ownerMode
    ? WIDGET_DEFINITIONS
    : getUserWidgets();
  return widgets.map((w) => ({
    widgetId: w.id,
    x: w.defaultPlacement.x,
    y: w.defaultPlacement.y,
    width: w.defaultPlacement.width,
    height: w.defaultPlacement.height,
    collapsed: false,
    hidden: false,
  }));
}

export function detectBreakpoint(): "desktop" | "tablet" | "mobile" {
  if (typeof window === "undefined") return "desktop";
  const w = window.innerWidth;
  if (w < 768) return "mobile";
  if (w < 1280) return "tablet";
  return "desktop";
}
