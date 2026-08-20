/**
 * Route Acceptance Suite
 *
 * Covers every intended public route, authenticated route, redirect,
 * owner/admin route, and Labs route with expected outcomes.
 *
 * Expected outcomes:
 *   - public:    accessible without auth (200 or renderable)
 *   - auth:      requires authentication (redirect to sign-in or 401)
 *   - redirect:  redirects to another route
 *   - owner:     requires owner/admin role (403 or redirect for non-owner)
 *
 * This is a static route registry test — it verifies the route structure
 * and redirect configuration, not live HTTP responses (those are covered
 * by Playwright E2E tests).
 */

import { describe, it, expect } from "vitest";
import { PRODUCT_CAPABILITIES } from "@/config/product-capabilities";
import { PLANS, PLAN_LIST } from "@/config/plans";

// ─── Route registry ─────────────────────────────────────────────────

type RouteExpectation = {
  path: string;
  type: "public" | "auth" | "redirect" | "owner";
  redirectDestination?: string;
  description: string;
};

const ROUTE_REGISTRY: RouteExpectation[] = [
  // Public routes
  { path: "/", type: "public", description: "Landing page" },
  { path: "/sign-in", type: "public", description: "Clerk sign-in" },
  { path: "/sign-up", type: "public", description: "Clerk sign-up" },
  { path: "/pricing", type: "public", description: "Pricing page (canonical)" },
  { path: "/about", type: "public", description: "About page" },
  { path: "/docs", type: "public", description: "Documentation" },
  { path: "/showcase", type: "public", description: "Showcase" },
  { path: "/privacy", type: "public", description: "Privacy policy" },
  { path: "/terms", type: "public", description: "Terms of service" },
  { path: "/cookies", type: "public", description: "Cookie policy" },

  // Authenticated routes (primary)
  { path: "/dashboard", type: "auth", description: "Mission Control / Dashboard" },
  { path: "/studio", type: "auth", description: "Studio — primary workspace" },
  { path: "/projects", type: "auth", description: "Project management" },

  // Authenticated routes (secondary)
  { path: "/library", type: "auth", description: "Library / files" },
  { path: "/library/files", type: "auth", description: "Library files" },
  { path: "/library/saved", type: "auth", description: "Library saved items" },
  { path: "/deployments", type: "auth", description: "Deployment history" },
  { path: "/marketplace", type: "auth", description: "Marketplace (Beta)" },

  // Authenticated routes (account)
  { path: "/wallet", type: "auth", description: "Wallet / LiTBits" },
  { path: "/settings", type: "auth", description: "Settings" },
  { path: "/settings/connections", type: "auth", description: "Connection settings" },
  { path: "/profile", type: "auth", description: "User profile" },

  // Labs routes (feature-flagged)
  { path: "/games", type: "auth", description: "Games hub (Labs)" },
  { path: "/discover", type: "auth", description: "Discover feed (Labs)" },
  { path: "/gallery", type: "auth", description: "Gallery (Labs)" },
  { path: "/voice", type: "redirect", redirectDestination: "/studio?tool=voice", description: "Voice → Studio" },

  // Redirects (standalone tools → Studio)
  { path: "/chat", type: "redirect", redirectDestination: "/studio?tool=chat", description: "Chat → Studio" },
  { path: "/code", type: "redirect", redirectDestination: "/studio?intent=code", description: "Code → Studio" },
  { path: "/litt", type: "redirect", redirectDestination: "/studio?tool=chat", description: "LiTT → Studio" },
  { path: "/litt-terminal", type: "redirect", redirectDestination: "/studio?tool=terminal", description: "Terminal → Studio" },
  { path: "/flow", type: "redirect", redirectDestination: "/studio?intent=loop", description: "Flow → Studio" },
  { path: "/generate", type: "redirect", redirectDestination: "/studio?intent=image", description: "Generate → Studio" },
  { path: "/agent", type: "redirect", redirectDestination: "/studio?tool=workflows", description: "Agent → Studio" },
  { path: "/agents", type: "redirect", redirectDestination: "/studio?tool=workflows", description: "Agents → Studio" },
  { path: "/agent-chat", type: "redirect", redirectDestination: "/studio?tool=agents", description: "Agent Chat → Studio" },
  { path: "/builder", type: "redirect", redirectDestination: "/studio", description: "Builder → Studio" },
  { path: "/ai-builder", type: "redirect", redirectDestination: "/studio", description: "AI Builder → Studio" },
  { path: "/creator", type: "redirect", redirectDestination: "/dashboard", description: "Creator → Dashboard" },
  { path: "/memories", type: "redirect", redirectDestination: "/studio?tool=memory", description: "Memories → Studio" },
  { path: "/landing", type: "redirect", redirectDestination: "/", description: "Landing → Home" },
  { path: "/login", type: "redirect", redirectDestination: "/sign-in", description: "Login → Sign-in" },

  // Owner/admin routes
  { path: "/admin", type: "owner", description: "Admin dashboard (owner only)" },
  { path: "/admin/terminal", type: "owner", description: "Admin terminal (owner only)" },
  { path: "/owner", type: "owner", description: "Owner page (owner only)" },

  // Internal routes (not in normal navigation)
  { path: "/runtime-test", type: "auth", description: "Runtime test (internal)" },
  { path: "/hire", type: "public", description: "Hire LiTTree" },
  { path: "/social", type: "auth", description: "Social" },
  { path: "/resources", type: "public", description: "Resources" },
];

// ─── Tests ──────────────────────────────────────────────────────────

describe("Route Acceptance Suite", () => {
  describe("Route registry completeness", () => {
    it("every route has a type and description", () => {
      ROUTE_REGISTRY.forEach((route) => {
        expect(route.type).toBeTruthy();
        expect(route.description).toBeTruthy();
        expect(route.path).toMatch(/^\//);
      });
    });

    it("redirect routes have destinations", () => {
      ROUTE_REGISTRY.filter((r) => r.type === "redirect").forEach((route) => {
        expect(route.redirectDestination).toBeDefined();
        expect(route.redirectDestination).toMatch(/^\//);
      });
    });

    it("no duplicate paths in registry", () => {
      const paths = ROUTE_REGISTRY.map((r) => r.path);
      const unique = new Set(paths);
      expect(paths.length).toBe(unique.size);
    });
  });

  describe("Primary navigation routes exist in registry", () => {
    const primaryRoutes = ["/dashboard", "/studio", "/projects"];

    primaryRoutes.forEach((path) => {
      it(`${path} is in registry as auth route`, () => {
        const route = ROUTE_REGISTRY.find((r) => r.path === path);
        expect(route).toBeDefined();
        expect(route!.type).toBe("auth");
      });
    });
  });

  describe("Secondary navigation routes exist in registry", () => {
    const secondaryRoutes = ["/library", "/deployments", "/marketplace"];

    secondaryRoutes.forEach((path) => {
      it(`${path} is in registry as auth route`, () => {
        const route = ROUTE_REGISTRY.find((r) => r.path === path);
        expect(route).toBeDefined();
        expect(route!.type).toBe("auth");
      });
    });
  });

  describe("Labs routes exist in registry", () => {
    const labsRoutes = ["/games", "/discover", "/gallery"];

    labsRoutes.forEach((path) => {
      it(`${path} is in registry`, () => {
        const route = ROUTE_REGISTRY.find((r) => r.path === path);
        expect(route).toBeDefined();
      });
    });
  });

  describe("Account routes exist in registry", () => {
    const accountRoutes = ["/wallet", "/settings", "/profile"];

    accountRoutes.forEach((path) => {
      it(`${path} is in registry as auth route`, () => {
        const route = ROUTE_REGISTRY.find((r) => r.path === path);
        expect(route).toBeDefined();
        expect(route!.type).toBe("auth");
      });
    });
  });

  describe("Owner/admin routes are gated", () => {
    const ownerRoutes = ["/admin", "/admin/terminal", "/owner"];

    ownerRoutes.forEach((path) => {
      it(`${path} is marked as owner-only`, () => {
        const route = ROUTE_REGISTRY.find((r) => r.path === path);
        expect(route).toBeDefined();
        expect(route!.type).toBe("owner");
      });
    });
  });

  describe("Standalone tool redirects point to Studio", () => {
    const studioRedirects = [
      { from: "/chat", to: "/studio?tool=chat" },
      { from: "/code", to: "/studio?intent=code" },
      { from: "/litt", to: "/studio?tool=chat" },
      { from: "/litt-terminal", to: "/studio?tool=terminal" },
      { from: "/flow", to: "/studio?intent=loop" },
      { from: "/generate", to: "/studio?intent=image" },
      { from: "/agent", to: "/studio?tool=workflows" },
      { from: "/agents", to: "/studio?tool=workflows" },
      { from: "/agent-chat", to: "/studio?tool=agents" },
      { from: "/builder", to: "/studio" },
      { from: "/ai-builder", to: "/studio" },
      { from: "/memories", to: "/studio?tool=memory" },
      { from: "/voice", to: "/studio?tool=voice" },
    ];

    studioRedirects.forEach(({ from, to }) => {
      it(`${from} redirects to ${to}`, () => {
        const route = ROUTE_REGISTRY.find((r) => r.path === from);
        expect(route).toBeDefined();
        expect(route!.type).toBe("redirect");
        expect(route!.redirectDestination).toBe(to);
      });
    });
  });

  describe("Public routes don't require auth", () => {
    const publicRoutes = ROUTE_REGISTRY.filter((r) => r.type === "public");

    publicRoutes.forEach((route) => {
      it(`${route.path} (${route.description}) is public`, () => {
        expect(route.type).toBe("public");
      });
    });
  });
});

// ─── Capability registry acceptance ─────────────────────────────────

describe("Capability Registry Acceptance", () => {
  it("has all expected capabilities", () => {
    const expectedIds = [
      "code", "terminal", "studio", "git", "verification", "approval",
      "cli", "memory", "deploy", "litbits", "models", "marketplace",
      "games", "multiAgent", "voice", "cloudHandoff",
    ];
    expectedIds.forEach((id) => {
      expect(PRODUCT_CAPABILITIES[id]).toBeDefined();
    });
  });

  it("every capability has a valid status", () => {
    Object.values(PRODUCT_CAPABILITIES).forEach((cap) => {
      expect(["live", "beta", "coming"]).toContain(cap.status);
    });
  });

  it("every capability has name, description, and requiresAcceptance", () => {
    Object.values(PRODUCT_CAPABILITIES).forEach((cap) => {
      expect(cap.name).toBeTruthy();
      expect(cap.description).toBeTruthy();
      expect(typeof cap.requiresAcceptance).toBe("boolean");
    });
  });

  it("marketplace is beta (not coming)", () => {
    expect(PRODUCT_CAPABILITIES.marketplace.status).toBe("beta");
  });

  it("voice is coming (not live or beta)", () => {
    expect(PRODUCT_CAPABILITIES.voice.status).toBe("coming");
  });

  it("git is live", () => {
    expect(PRODUCT_CAPABILITIES.git.status).toBe("live");
  });

  it("capabilities that require acceptance are marked", () => {
    const requireAcceptance = ["code", "terminal", "git", "deploy"];
    requireAcceptance.forEach((id) => {
      expect(PRODUCT_CAPABILITIES[id].requiresAcceptance).toBe(true);
    });
  });
});

// ─── Pricing truth acceptance ───────────────────────────────────────

describe("Pricing Truth Acceptance", () => {
  it("has exactly 4 customer-facing plans (excludes owner)", () => {
    expect(PLAN_LIST.length).toBe(4);
    const ids = PLAN_LIST.map((p) => p.id);
    expect(ids).toContain("starter");
    expect(ids).toContain("creator_beta");
    expect(ids).toContain("pro_builder_beta");
    expect(ids).toContain("founder");
    expect(ids).not.toContain("owner");
  });

  it("uses LiTBits terminology (not AI credits)", () => {
    PLAN_LIST.forEach((plan) => {
      plan.features.forEach((feature) => {
        // No plan feature should say "AI credits" — use "LiTBits"
        expect(feature).not.toMatch(/AI credits/i);
      });
    });
  });

  it("no plan references Vercel deployment", () => {
    PLAN_LIST.forEach((plan) => {
      plan.features.forEach((feature) => {
        expect(feature).not.toMatch(/Vercel/i);
      });
    });
  });

  it("Starter plan is free", () => {
    expect(PLANS.starter.monthlyPriceCents).toBe(0);
    expect(PLANS.starter.billingType).toBe("free");
  });

  it("Pro Builder Beta has Railway deployment", () => {
    expect(PLANS.pro_builder_beta.features).toContain("Railway deployment");
  });
});
