/**
 * AppShell navigation regression tests.
 *
 * Verifies the ONE canonical authenticated global nav:
 *   Main: Home · Studio · Create · Assets · Agents · Missions · More
 *   More: Projects · Games · Discover · Marketplace · Showcase · Wallet ·
 *         CLI · Docs · Deployments · Settings · Profile
 *
 * Assets/Agents/Missions are Studio destinations (?tool=…) and must light
 * up independently of the bare-Studio pill (isAppNavActive).
 */

import { describe, it, expect } from "vitest";
import {
  APP_NAV_MAIN,
  APP_NAV_MORE,
  APP_NAV_SECONDARY,
  getVisibleMainNav,
  isAppNavActive,
} from "@/lib/navigation";

describe("AppShell Navigation", () => {
  describe("Canonical main nav", () => {
    it("has exactly the canonical destinations in order", () => {
      const labels = APP_NAV_MAIN.map((i) => i.label);
      expect(labels).toEqual([
        "Home",
        "Studio",
        "Create",
        "Assets",
        "Agents",
        "Missions",
      ]);
    });

    it("every main item resolves to a real route", () => {
      const hrefs = APP_NAV_MAIN.map((i) => i.href);
      expect(hrefs).toEqual([
        "/dashboard",
        "/studio",
        "/create",
        "/studio?tool=assets",
        "/studio?tool=agents",
        "/studio?tool=workflows",
      ]);
    });

    it("no competing legacy nav bars remain (single flat main list)", () => {
      // One source of truth — no sectioned groups duplicating the bar.
      expect(APP_NAV_MAIN.length).toBe(6);
      expect(getVisibleMainNav()).toEqual(APP_NAV_MAIN);
    });
  });

  describe("More menu", () => {
    it("carries every secondary destination", () => {
      const labels = APP_NAV_MORE.map((i) => i.label);
      expect(labels).toEqual([
        "Projects",
        "Games",
        "Discover",
        "Marketplace",
        "Showcase",
        "Wallet",
        "CLI",
        "Docs",
        "Deployments",
        "Settings",
        "Profile",
      ]);
    });

    it("all More items have real hrefs", () => {
      APP_NAV_MORE.forEach((item) => {
        expect(item.href).toMatch(/^\//);
      });
    });

    it("CLI is reachable from nav (Developer tooling)", () => {
      const cli = APP_NAV_MORE.find((i) => i.label === "CLI");
      expect(cli?.href).toBe("/cli");
    });
  });

  describe("Secondary (account-menu) navigation", () => {
    it("Secondary sections expose Library and Developer Tools", () => {
      const ids = APP_NAV_SECONDARY.map((s) => s.id);
      expect(ids).toEqual(["library", "devtools"]);
      const hrefs = APP_NAV_SECONDARY.flatMap((s) => s.items.map((i) => i.href));
      expect(hrefs).toEqual(
        expect.arrayContaining([
          "/library/files",
          "/library/saved",
          "/code",
          "/cli",
          "/settings/connections",
          "/docs",
        ]),
      );
    });
  });

  // Regression: /hire is permanently retired — the page always redirects
  // to /studio — so no nav surface may link to it.
  it("does NOT link to /hire anywhere", () => {
    const hrefs = [...APP_NAV_MAIN, ...APP_NAV_MORE].map((i) => i.href);
    expect(hrefs).not.toContain("/hire");
  });

  describe("Active route detection (isAppNavActive)", () => {
    const search = new URLSearchParams();

    it("Home is active on /dashboard", () => {
      expect(isAppNavActive("/dashboard", search, "/dashboard")).toBe(true);
    });

    it("Home is NOT active when ?app= is present", () => {
      const s = new URLSearchParams("app=music");
      expect(isAppNavActive("/dashboard", s, "/dashboard")).toBe(false);
    });

    it("Studio is active on /studio and default surfaces", () => {
      expect(isAppNavActive("/studio", search, "/studio")).toBe(true);
      expect(isAppNavActive("/studio/image", search, "/studio")).toBe(true);
      expect(
        isAppNavActive("/studio", new URLSearchParams("tool=chat"), "/studio"),
      ).toBe(true);
      expect(
        isAppNavActive("/studio", new URLSearchParams("tool=build"), "/studio"),
      ).toBe(true);
    });

    it("Studio is NOT active while a sibling destination owns the URL", () => {
      for (const tool of ["assets", "agents", "workflows"]) {
        expect(
          isAppNavActive("/studio", new URLSearchParams(`tool=${tool}`), "/studio"),
        ).toBe(false);
      }
    });

    it("Assets/Agents/Missions light up only on their own tool param", () => {
      expect(
        isAppNavActive("/studio", new URLSearchParams("tool=assets"), "/studio?tool=assets"),
      ).toBe(true);
      expect(
        isAppNavActive("/studio", new URLSearchParams("tool=agents"), "/studio?tool=agents"),
      ).toBe(true);
      expect(
        isAppNavActive("/studio", new URLSearchParams("tool=workflows"), "/studio?tool=workflows"),
      ).toBe(true);
      // Wrong tool → not active
      expect(
        isAppNavActive("/studio", new URLSearchParams("tool=chat"), "/studio?tool=assets"),
      ).toBe(false);
      expect(
        isAppNavActive("/studio", new URLSearchParams("tool=assets"), "/studio?tool=agents"),
      ).toBe(false);
      // Not on /studio at all → not active
      expect(
        isAppNavActive("/dashboard", new URLSearchParams("tool=assets"), "/studio?tool=assets"),
      ).toBe(false);
    });

    it("Create is active on /create", () => {
      expect(isAppNavActive("/create", search, "/create")).toBe(true);
      expect(isAppNavActive("/dashboard", search, "/create")).toBe(false);
    });

    it("Settings is active on /settings and /settings/*", () => {
      expect(isAppNavActive("/settings", search, "/settings")).toBe(true);
      expect(isAppNavActive("/settings/connections", search, "/settings")).toBe(true);
    });

    it("null pathname returns false", () => {
      expect(isAppNavActive(null, search, "/dashboard")).toBe(false);
    });
  });

  describe("No duplicate navigation", () => {
    it("main and More items have unique hrefs across both lists", () => {
      const allHrefs = [...APP_NAV_MAIN, ...APP_NAV_MORE].map((i) => i.href);
      expect(allHrefs.length).toBe(new Set(allHrefs).size);
    });
  });
});
