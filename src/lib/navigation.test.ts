import { describe, it, expect, vi, afterEach } from "vitest";

afterEach(() => {
  vi.resetModules();
  vi.doUnmock("@/config/feature-flags");
});

describe("getVisibleMoreNav — flag-gated nav items", () => {
  it("shows /games now that retroGameRuntime is enabled (default)", async () => {
    const { getVisibleMoreNav } = await import("./navigation");
    const hrefs = getVisibleMoreNav().map((i) => i.href);
    expect(hrefs).toContain("/games");
    // The rest of More stays intact. /projects/discover live in Main
    // now (issue #627 Studio Merge) — they are not More items anymore.
    expect(hrefs).toEqual(
      expect.arrayContaining(["/marketplace", "/docs", "/deployments"]),
    );
  });

  it("hides /games when retroGameRuntime is disabled", async () => {
    vi.doMock("@/config/feature-flags", () => ({
      isFeatureEnabled: (flag: string) => flag !== "retroGameRuntime",
    }));
    const { getVisibleMoreNav } = await import("./navigation");
    expect(getVisibleMoreNav().map((i) => i.href)).not.toContain("/games");
  });

  it("never mutates the canonical APP_NAV_MORE", async () => {
    vi.doMock("@/config/feature-flags", () => ({
      isFeatureEnabled: () => false,
    }));
    const { getVisibleMoreNav, APP_NAV_MORE } = await import("./navigation");
    getVisibleMoreNav();
    expect(APP_NAV_MORE.map((i) => i.href)).toContain("/games");
  });

  it("main nav is never flag-gated", async () => {
    vi.doMock("@/config/feature-flags", () => ({
      isFeatureEnabled: () => false,
    }));
    const { getVisibleMainNav, APP_NAV_MAIN } = await import("./navigation");
    expect(getVisibleMainNav()).toEqual(APP_NAV_MAIN);
  });
});

/**
 * Discover moved from the flag-gated More menu into the always-on Main
 * nav as part of the Studio Merge (issue #627). Main nav is never
 * flag-gated (see above) — Discover's prior `communitySocial` gate no
 * longer applies to its nav visibility. Flagged in the Step 2 report as
 * a behavior change worth the owner's explicit sign-off, not something
 * this test suite silently re-litigates.
 */

describe("withActiveProjectContext — Studio nav keeps the active project", () => {
  it("carries the active project into the Studio href", async () => {
    const { withActiveProjectContext, APP_NAV_MAIN } = await import("./navigation");
    const items = withActiveProjectContext(APP_NAV_MAIN, "proj-9");
    const byLabel = new Map(items.map((i) => [i.label, i.href]));
    expect(byLabel.get("Studio")).toBe("/studio?project=proj-9");
    // Non-Studio Main items are untouched
    expect(byLabel.get("Discover")).toBe("/discover");
    expect(byLabel.get("Projects")).toBe("/projects");
    expect(byLabel.get("Settings")).toBe("/settings");
  });

  it("leaves non-Studio hrefs untouched", async () => {
    const { withActiveProjectContext, APP_NAV_MORE } = await import("./navigation");
    const items = withActiveProjectContext(APP_NAV_MORE, "proj-9");
    expect(items.map((i) => i.href)).toEqual(APP_NAV_MORE.map((i) => i.href));
  });

  it("replaces a stale project param instead of duplicating it", async () => {
    const { withActiveProjectContext, APP_NAV_MAIN } = await import("./navigation");
    const studio = APP_NAV_MAIN.find((i) => i.label === "Studio")!;
    const items = withActiveProjectContext(
      [{ ...studio, href: "/studio?tool=code&project=stale" }],
      "proj-9",
    );
    expect(items[0].href).toBe("/studio?tool=code&project=proj-9");
  });

  it("is a no-op without an active project id", async () => {
    const { withActiveProjectContext, APP_NAV_MAIN } = await import("./navigation");
    expect(withActiveProjectContext(APP_NAV_MAIN, null)).toBe(APP_NAV_MAIN);
    expect(withActiveProjectContext(APP_NAV_MAIN, "")).toBe(APP_NAV_MAIN);
    expect(withActiveProjectContext(APP_NAV_MAIN, undefined)).toBe(APP_NAV_MAIN);
  });

  it("never mutates the canonical nav items", async () => {
    const { withActiveProjectContext, APP_NAV_MAIN } = await import("./navigation");
    withActiveProjectContext(APP_NAV_MAIN, "proj-9");
    expect(APP_NAV_MAIN.map((i) => i.href)).toEqual([
      "/studio",
      "/discover",
      "/projects",
      "/settings",
    ]);
  });
});

describe("isAppNavActive — Studio is the one main tab (issue #627)", () => {
  it("lights the Studio item for any /studio path regardless of ?tool=/?project=", async () => {
    const { isAppNavActive } = await import("./navigation");
    expect(isAppNavActive("/studio", new URLSearchParams(), "/studio")).toBe(true);
    expect(isAppNavActive("/studio", new URLSearchParams("tool=assets&project=proj-9"), "/studio")).toBe(true);
    expect(isAppNavActive("/studio", new URLSearchParams("tool=chat&project=proj-9"), "/studio?project=proj-9")).toBe(true);
    // Nested /studio routes (e.g. /studio/github) still count as Studio.
    expect(isAppNavActive("/studio/github", new URLSearchParams(), "/studio")).toBe(true);
  });

  it("does not light the Studio item off the /studio tree", async () => {
    const { isAppNavActive } = await import("./navigation");
    expect(isAppNavActive("/discover", new URLSearchParams(), "/studio")).toBe(false);
  });

  it("matches non-Studio Main items by path prefix", async () => {
    const { isAppNavActive } = await import("./navigation");
    expect(isAppNavActive("/settings/connections", new URLSearchParams(), "/settings")).toBe(true);
    expect(isAppNavActive("/discover", new URLSearchParams(), "/discover")).toBe(true);
    expect(isAppNavActive("/projects", new URLSearchParams(), "/discover")).toBe(false);
  });
});
