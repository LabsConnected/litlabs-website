/**
 * AppShell navigation regression tests.
 *
 * Verifies the ONE canonical authenticated global nav (issue #627 —
 * Studio Merge, 2026-11-12, superseding the prior Assets/Agents/Missions
 * pill layout this file used to encode):
 *   Main: Studio · Discover · Projects · Settings
 *   More: Marketplace · Showcase · Games · CLI · Deployments · Docs
 *
 * Studio is the prime signed-in surface — there is no Home item and no
 * /dashboard destination (the route only redirects into Studio).
 *
 * Assets/Agents/Missions/Create are internal Studio surfaces now
 * (?tool=…), reached from inside Studio itself — they have no nav pill
 * of their own anymore, so the bare Studio pill is active across the
 * whole /studio tree regardless of which internal tool is open.
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
        "Studio",
        "Discover",
        "Projects",
        "Settings",
      ]);
    });

    it("every main item resolves to a real route", () => {
      const hrefs = APP_NAV_MAIN.map((i) => i.href);
      expect(hrefs).toEqual([
        "/studio",
        "/discover",
        "/projects",
        "/settings",
      ]);
    });

    it("has no Home item and no /dashboard destination (Studio is prime)", () => {
      expect(APP_NAV_MAIN.some((i) => i.label === "Home")).toBe(false);
      const allHrefs = [
        ...APP_NAV_MAIN.map((i) => i.href),
        ...APP_NAV_MORE.map((i) => i.href),
        ...APP_NAV_SECONDARY.flatMap((s) => s.items.map((i) => i.href)),
      ];
      expect(allHrefs).not.toContain("/dashboard");
    });

    it("does not link to the dead short aliases (issue #602)", () => {
      const hrefs = [
        ...APP_NAV_MAIN.map((i) => i.href),
        ...APP_NAV_MORE.map((i) => i.href),
        ...APP_NAV_SECONDARY.flatMap((s) => s.items.map((i) => i.href)),
      ];
      for (const dead of ["/assets", "/missions", "/files", "/saved", "/connections"]) {
        expect(hrefs).not.toContain(dead);
      }
    });

    it("no competing legacy nav bars remain (single flat main list)", () => {
      // One source of truth — no sectioned groups duplicating the bar.
      expect(APP_NAV_MAIN.length).toBe(4);
      expect(getVisibleMainNav()).toEqual(APP_NAV_MAIN);
    });
  });

  describe("More menu", () => {
    it("carries every secondary destination", () => {
      const labels = APP_NAV_MORE.map((i) => i.label);
      expect(labels).toEqual([
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

    it("Studio stays active for any internal tool — no sibling nav item to carve out against anymore", () => {
      // Assets/Agents/Missions/Create lost their own nav pills in the
      // Studio Merge (issue #627) — they are internal Studio surfaces
      // now, so the bare Studio pill owns the whole /studio tree
      // regardless of ?tool=.
      for (const tool of ["assets", "agents", "workflows", "chat", "build"]) {
        expect(
          isAppNavActive("/studio", new URLSearchParams(`tool=${tool}`), "/studio"),
        ).toBe(true);
      }
      // Not on /studio at all → not active
      expect(
        isAppNavActive("/projects", new URLSearchParams("tool=assets"), "/studio"),
      ).toBe(false);
    });

    it("Studio owns creation and /create is no longer a nav destination", () => {
      expect(APP_NAV_MAIN.some((item) => item.label === "Create")).toBe(false);
      expect(isAppNavActive("/studio", search, "/studio")).toBe(true);
      expect(isAppNavActive("/create", search, "/studio")).toBe(false);
    });

    it("Settings is active on /settings and /settings/*", () => {
      expect(isAppNavActive("/settings", search, "/settings")).toBe(true);
      expect(isAppNavActive("/settings/connections", search, "/settings")).toBe(true);
    });

    it("null pathname returns false", () => {
      expect(isAppNavActive(null, search, "/studio")).toBe(false);
    });
  });

  describe("No duplicate navigation", () => {
    it("main and More items have unique hrefs across both lists", () => {
      const allHrefs = [...APP_NAV_MAIN, ...APP_NAV_MORE].map((i) => i.href);
      expect(allHrefs.length).toBe(new Set(allHrefs).size);
    });
  });
});
