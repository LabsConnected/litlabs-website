/**
 * Full-page starter builds — complete page templates that populate
 * the Canvas with multiple sections at once.
 *
 * Each build returns a root node + all child nodes for a complete page.
 * When a user picks "Landing Page" or "Dashboard", LiTT creates the
 * entire structure directly on the Canvas.
 */

import { createNode, type CanvasNode, type CanvasDocument, createEmptyDocument } from "./types";
import { SECTION_BLOCKS } from "./section-blocks";

export interface StarterBuild {
  id: string;
  label: string;
  category: string;
  description: string;
  icon: string;
  /** Block IDs from SECTION_BLOCKS to include, in order */
  sectionIds: string[];
}

export const STARTER_BUILDS: StarterBuild[] = [
  {
    id: "landing-page",
    label: "Landing Page",
    category: "Website",
    description: "Hero, features, testimonials, pricing, CTA, footer",
    icon: "Rocket",
    sectionIds: ["navbar-minimal", "hero-centered", "features-grid", "testimonials", "pricing-tiers", "cta-section", "footer-simple"],
  },
  {
    id: "business-site",
    label: "Business Site",
    category: "Website",
    description: "Navbar, hero, services, stats, contact, footer",
    icon: "Building2",
    sectionIds: ["navbar-minimal", "hero-split", "features-grid", "stats-row", "contact-form", "footer-simple"],
  },
  {
    id: "portfolio",
    label: "Portfolio",
    category: "Creator",
    description: "Hero, gallery, about, contact",
    icon: "Palette",
    sectionIds: ["navbar-minimal", "hero-centered", "gallery-grid", "team-grid", "contact-form", "footer-simple"],
  },
  {
    id: "saas-dashboard",
    label: "SaaS Dashboard",
    category: "SaaS",
    description: "Stats cards, data table, activity",
    icon: "LayoutDashboard",
    sectionIds: ["dashboard-stats", "data-table"],
  },
  {
    id: "store",
    label: "Store",
    category: "Store",
    description: "Navbar, hero, product grid, newsletter, footer",
    icon: "ShoppingBag",
    sectionIds: ["navbar-minimal", "hero-centered", "product-grid", "newsletter", "footer-simple"],
  },
  {
    id: "ai-tool",
    label: "AI Tool",
    category: "AI",
    description: "Hero, features, CTA, footer",
    icon: "Bot",
    sectionIds: ["navbar-minimal", "hero-centered", "bento-grid", "cta-section", "footer-simple"],
  },
  {
    id: "login-page",
    label: "Login Page",
    category: "App UI",
    description: "Simple centered login form",
    icon: "LogIn",
    sectionIds: ["login-form"],
  },
  {
    id: "signup-page",
    label: "Signup Page",
    category: "App UI",
    description: "Simple centered signup form",
    icon: "UserPlus",
    sectionIds: ["signup-form"],
  },
];

export const STARTER_CATEGORIES: { id: string; label: string; icon: string }[] = [
  { id: "Website", label: "Website", icon: "Globe" },
  { id: "SaaS", label: "SaaS", icon: "LayoutDashboard" },
  { id: "Store", label: "Store", icon: "ShoppingBag" },
  { id: "Creator", label: "Creator", icon: "Palette" },
  { id: "AI", label: "AI Tool", icon: "Bot" },
  { id: "App UI", label: "App UI", icon: "Smartphone" },
];

/**
 * Build a complete page document from a starter build.
 * Returns a new CanvasDocument with all sections populated.
 */
export function buildStarterPage(build: StarterBuild): CanvasDocument {
  const doc = createEmptyDocument();
  const root = doc.nodes[doc.rootNodeIds[0]];

  const allNewNodes: Record<string, CanvasNode> = { ...doc.nodes };
  const rootChildren: string[] = [];

  for (const sectionId of build.sectionIds) {
    const template = SECTION_BLOCKS.find((b) => b.id === sectionId);
    if (!template) continue;
    const { node: section, children } = template.build();
    section.parentId = root.id;
    allNewNodes[section.id] = section;
    for (const child of children) {
      allNewNodes[child.id] = child;
    }
    rootChildren.push(section.id);
  }

  const updatedRoot: CanvasNode = {
    ...root,
    children: rootChildren,
    metadata: { ...root.metadata, updatedAt: Date.now() },
  };
  allNewNodes[root.id] = updatedRoot;

  return {
    ...doc,
    nodes: allNewNodes,
    version: 2,
    updatedAt: Date.now(),
  };
}
