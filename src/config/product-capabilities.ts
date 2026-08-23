/**
 * Product Capabilities — the canonical single source of truth.
 *
 * Every product capability is defined here with its real status.
 * Landing page cards, roadmap, status surfaces, and navigation
 * all consume this registry. No hand-maintained marketing statuses.
 *
 * Status values:
 *   live     — implemented + tested + production proof
 *   beta     — implemented and usable but not fully verified
 *   coming   — planned but not yet implemented
 *
 * If a capability is missing from this registry, it doesn't exist
 * as a marketed product feature.
 */

export type CapabilityStatus = "live" | "beta" | "coming";

export interface ProductCapability {
  /** Unique identifier (e.g., "code", "terminal", "studio") */
  id: string;
  /** Customer-facing name */
  name: string;
  /** Short description for landing cards / roadmap */
  description: string;
  /** Real status — never hand-maintained, always reflects actual state */
  status: CapabilityStatus;
  /** Link to documentation or feature page */
  href?: string;
  /** Whether this capability requires acceptance before production mutation */
  requiresAcceptance: boolean;
}

export const PRODUCT_CAPABILITIES: Record<string, ProductCapability> = {
  code: {
    id: "code",
    name: "Code read / search / edit",
    description: "Read, search, and edit files inside your real project.",
    status: "live",
    href: "/studio",
    requiresAcceptance: true,
  },
  terminal: {
    id: "terminal",
    name: "Terminal execution",
    description: "Run commands in a real PTY with backpressure and session limits.",
    status: "beta",
    href: "/studio",
    requiresAcceptance: true,
  },
  studio: {
    id: "studio",
    name: "Studio (web workspace)",
    description: "Talk to LiTT, build, code, preview, and ship from one workspace.",
    status: "beta",
    href: "/studio",
    requiresAcceptance: false,
  },
  git: {
    id: "git",
    name: "Git diff / status / commit / push / PR",
    description: "Safe git write workflow with approval boundaries. Never commits to main.",
    status: "live",
    href: "/docs",
    requiresAcceptance: true,
  },
  verification: {
    id: "verification",
    name: "Verification gate",
    description: "LiTT proves work passed typecheck, tests, and build before claiming complete.",
    status: "live",
    href: "/docs",
    requiresAcceptance: false,
  },
  approval: {
    id: "approval",
    name: "Approval before dangerous actions",
    description: "Human approval required before commits, pushes, deploys, or destructive operations.",
    status: "live",
    href: "/docs",
    requiresAcceptance: false,
  },
  cli: {
    id: "cli",
    name: "CLI cockpit",
    description: "Run LiTT from the terminal with live tool progress and streaming chat.",
    status: "live",
    href: "/docs",
    requiresAcceptance: false,
  },
  memory: {
    id: "memory",
    name: "Project memory",
    description: "LiTT remembers project context, files, and previous work across sessions.",
    status: "beta",
    href: "/studio",
    requiresAcceptance: false,
  },
  deploy: {
    id: "deploy",
    name: "Deploy to Railway + GitHub PRs",
    description: "Review the diff, approve, and ship. Railway deployment with health verification.",
    status: "beta",
    href: "/docs",
    requiresAcceptance: true,
  },
  litbits: {
    id: "litbits",
    name: "LiTBits accounting",
    description: "Pay for what you use. Free entry, low-cost LiTBits, BYOK.",
    status: "beta",
    href: "/pricing",
    requiresAcceptance: false,
  },
  models: {
    id: "models",
    name: "Model selection / BYOK",
    description: "Bring your own OpenRouter key. Route to fast / smart / long profiles.",
    status: "beta",
    href: "/pricing",
    requiresAcceptance: false,
  },
  marketplace: {
    id: "marketplace",
    name: "Marketplace",
    description: "Share and install LiTT plugins, tools, and project templates.",
    status: "beta",
    href: "/marketplace",
    requiresAcceptance: false,
  },
  games: {
    id: "games",
    name: "Games pipeline",
    description: "Build, verify, and ship playable browser games end-to-end.",
    status: "coming",
    href: "/games",
    requiresAcceptance: false,
  },
  multiAgent: {
    id: "multiAgent",
    name: "Multi-agent crews",
    description: "Specialized agents (Forge, Visionary, Research, QA) on one mission.",
    status: "coming",
    href: "/studio",
    requiresAcceptance: false,
  },
  voice: {
    id: "voice",
    name: "Voice mode",
    description: "Talk to LiTT. Spoken responses, camera-assisted context.",
    status: "coming",
    href: "/voice",
    requiresAcceptance: false,
  },
  cloudHandoff: {
    id: "cloudHandoff",
    name: "Cloud handoff",
    description: "Run long missions in the cloud and pick them up anywhere.",
    status: "coming",
    href: "/docs",
    requiresAcceptance: false,
  },
};

/**
 * Get capabilities filtered by status.
 * Used by landing page cards and roadmap to render consistent sections.
 */
export function capabilitiesByStatus(status: CapabilityStatus): ProductCapability[] {
  return Object.values(PRODUCT_CAPABILITIES).filter((c) => c.status === status);
}

/**
 * Get all capabilities sorted by a defined order.
 * Used by roadmap and product cards.
 */
export function allCapabilities(): ProductCapability[] {
  return Object.values(PRODUCT_CAPABILITIES);
}
