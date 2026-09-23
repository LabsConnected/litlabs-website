/**
 * AppShell navigation regression tests.
 *
 * Verifies the ONE canonical authenticated global nav:
 *   Main: Home · Studio · Assets · Agents · Missions · More
 *   More: Projects · Discover · Marketplace · Showcase · Games · CLI ·
 *         Deployments · Docs
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
        "/studio?tool=assets",
        "/studio?tool=agents",
        "/studio?tool=workflows",
      ]);
    });

    it("no competing legacy nav bars remain (single flat main list)", () => {
      // One source of truth — no sectioned groups duplicating the bar.
      expect(APP_NAV_MAIN.length).toBe(5);
      expect(getVisibleMainNav()).toEqual(APP_NAV_MAIN);
    });
  });

  describe("More menu", () => {
    it("carries every secondary destination", () => {
      const labels = APP_NAV_MORE.map((i) => i.label);
      expect(labels).toEqual([
        "Projects",
        "Discover",
        "Marketplace",
        "Showcase",
        "Games",
        "CLI",
        "Deployments",
        "Docs",
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
    it("Secondary sections expose the trimmed account menu", () => {
      const ids = APP_NAV_SECONDARY.map((s) => s.id);
      expect(ids).toEqual(["library", "devtools"]);
      const hrefs = APP_NAV_SECONDARY.flatMap((s) => s.items.map((i) => i.href));
      // Account menu keeps Files / Saved / Connections. Product resources
      // such as Docs stay in More, not the personal account menu.
      expect(hrefs).toEqual([
        "/library/files",
        "/library/saved",
        "/settings/connections",
      ]);
    });
  });

  it("does not duplicate account destinations in More", () => {
    const moreLabels = APP_NAV_MORE.map((item) => item.label);
    expect(moreLabels).not.toEqual(expect.arrayContaining(["Profile", "Wallet", "Settings"]));
    expect(moreLabels).toEqual(expect.arrayContaining(["Docs", "Deployments"]));
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

    it("Dashboard owns creation and /create is no longer a nav destination", () => {
      expect(APP_NAV_MAIN.some((item) => item.label === "Create")).toBe(false);
      expect(isAppNavActive("/dashboard", search, "/dashboard")).toBe(true);
      expect(isAppNavActive("/create", search, "/dashboard")).toBe(false);
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
