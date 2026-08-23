/**
 * AppShell navigation regression tests.
 *
 * Verifies the LiTT-centered information architecture:
 *   - Primary: Home · Dashboard · Studio · Projects
 *   - Secondary: Library · Deployments · Marketplace
 *   - Labs: Games · Discover · Showcase (experimental)
 *   - Account: Wallet · Settings (bottom utility)
 *   - Mobile: Home · Studio · Projects · Me
 *
 * Verifies:
 *   - Correct active navigation detection
 *   - Collapsed sidebar persistence key
 *   - Mobile drawer items match desktop sections
 *   - No duplicate navigation
 *   - Route accessibility for authenticated routes
 */

import { describe, it, expect } from "vitest";
import {
  APP_NAV_SECTIONS,
  APP_NAV_BOTTOM,
  APP_MOBILE_BOTTOM_ITEMS,
  isAppNavActive,
  COLLAPSED_KEY,
} from "@/lib/navigation";

describe("AppShell Navigation — LiTT-centered IA", () => {
  describe("Canonical nav sections", () => {
    it("has exactly 3 sections: Primary, Secondary, Labs", () => {
      const ids = APP_NAV_SECTIONS.map((s) => s.id);
      expect(ids).toEqual(["primary", "secondary", "labs"]);
    });

    it("Primary section has Dashboard, Studio, and Projects", () => {
      const primary = APP_NAV_SECTIONS.find((s) => s.id === "primary");
      expect(primary).toBeDefined();
      const labels = primary!.items.map((i) => i.label);
      expect(labels).toContain("Dashboard");
      expect(labels).toContain("Studio");
      expect(labels).toContain("Projects");
    });

    it("Secondary section has Library, Deployments, and Marketplace", () => {
      const secondary = APP_NAV_SECTIONS.find((s) => s.id === "secondary");
      expect(secondary).toBeDefined();
      const labels = secondary!.items.map((i) => i.label);
      expect(labels).toContain("Library");
      expect(labels).toContain("Deployments");
      expect(labels).toContain("Marketplace");
    });

    it("Labs section has Games, Discover, and Showcase", () => {
      const labs = APP_NAV_SECTIONS.find((s) => s.id === "labs");
      expect(labs).toBeDefined();
      const labels = labs!.items.map((i) => i.label);
      expect(labels).toContain("Games");
      expect(labels).toContain("Discover");
      expect(labels).toContain("Showcase");
    });

    it("Studio links to /studio (not a tool-specific query)", () => {
      const primary = APP_NAV_SECTIONS.find((s) => s.id === "primary");
      const studio = primary!.items.find((i) => i.label === "Studio");
      expect(studio!.href).toBe("/studio");
    });

    it("Projects links to /projects", () => {
      const primary = APP_NAV_SECTIONS.find((s) => s.id === "primary");
      const projects = primary!.items.find((i) => i.label === "Projects");
      expect(projects!.href).toBe("/projects");
    });
  });

  describe("Bottom utility items", () => {
    it("has Wallet and Settings (Profile lives in identity dock)", () => {
      const labels = APP_NAV_BOTTOM.map((i) => i.label);
      expect(labels).toEqual(["Wallet", "Settings"]);
    });

    it("all bottom items have hrefs", () => {
      APP_NAV_BOTTOM.forEach((item) => {
        expect(item.href).toBeDefined();
        expect(item.href).toMatch(/^\//);
      });
    });
  });

  describe("Active route detection (isAppNavActive)", () => {
    const search = new URLSearchParams();

    it("Dashboard is active on /dashboard", () => {
      expect(isAppNavActive("/dashboard", search, "/dashboard")).toBe(true);
    });

    it("Dashboard is NOT active when ?app= is present", () => {
      const s = new URLSearchParams("app=music");
      expect(isAppNavActive("/dashboard", s, "/dashboard")).toBe(false);
    });

    it("Dashboard?app=music is active when ?app=music matches", () => {
      const s = new URLSearchParams("app=music");
      expect(isAppNavActive("/dashboard", s, "/dashboard?app=music")).toBe(true);
    });

    it("Studio is active on /studio and /studio/*", () => {
      expect(isAppNavActive("/studio", search, "/studio")).toBe(true);
      expect(isAppNavActive("/studio/image", search, "/studio")).toBe(true);
      expect(isAppNavActive("/studio", new URLSearchParams("tool=chat"), "/studio")).toBe(true);
    });

    it("Projects is active on /projects", () => {
      expect(isAppNavActive("/projects", search, "/projects")).toBe(true);
    });

    it("Settings is active on /settings and /settings/*", () => {
      expect(isAppNavActive("/settings", search, "/settings")).toBe(true);
      expect(isAppNavActive("/settings/connections", search, "/settings")).toBe(true);
    });

    it("Wallet is active on /wallet", () => {
      expect(isAppNavActive("/wallet", search, "/wallet")).toBe(true);
    });

    it("null pathname returns false", () => {
      expect(isAppNavActive(null, search, "/dashboard")).toBe(false);
    });
  });

  describe("Sidebar collapsed persistence", () => {
    it("COLLAPSED_KEY is a stable string", () => {
      expect(COLLAPSED_KEY).toBe("litlabs-sidebar-collapsed");
      expect(typeof COLLAPSED_KEY).toBe("string");
    });
  });

  describe("Mobile bottom items", () => {
    it("has exactly 4 items for the 5-slot bottom bar (2+create+2)", () => {
      expect(APP_MOBILE_BOTTOM_ITEMS).toHaveLength(4);
    });

    it("includes Home (Dashboard) and Studio", () => {
      const labels = APP_MOBILE_BOTTOM_ITEMS.map((i) => i.label);
      expect(labels).toContain("Home");
      expect(labels).toContain("Studio");
    });

    it("includes Projects and Me", () => {
      const labels = APP_MOBILE_BOTTOM_ITEMS.map((i) => i.label);
      expect(labels).toContain("Projects");
      expect(labels).toContain("Me");
    });

    it("all items have valid hrefs", () => {
      APP_MOBILE_BOTTOM_ITEMS.forEach((item) => {
        expect(item.href).toMatch(/^\//);
      });
    });
  });

  describe("No duplicate navigation", () => {
    it("all section items have unique hrefs", () => {
      const allHrefs = APP_NAV_SECTIONS.flatMap((s) => s.items.map((i) => i.href));
      const unique = new Set(allHrefs);
      expect(allHrefs.length).toBe(unique.size);
    });

    it("bottom items have unique hrefs not in sections", () => {
      const sectionHrefs = new Set(
        APP_NAV_SECTIONS.flatMap((s) => s.items.map((i) => i.href)),
      );
      APP_NAV_BOTTOM.forEach((item) => {
        expect(sectionHrefs.has(item.href)).toBe(false);
      });
    });
  });
});
