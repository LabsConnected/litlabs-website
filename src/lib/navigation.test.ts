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
    // The rest of More stays intact
    expect(hrefs).toEqual(
      expect.arrayContaining(["/projects", "/marketplace", "/docs", "/deployments"]),
    );
  });

  it("hides /games when retroGameRuntime is disabled", async () => {
    vi.doMock("@/config/feature-flags", () => ({
      isFeatureEnabled: (flag: string) => flag !== "retroGameRuntime",
    }));
    const { getVisibleMoreNav } = await import("./navigation");
    expect(getVisibleMoreNav().map((i) => i.href)).not.toContain("/games");
  });

  it("hides /discover when communitySocial is disabled", async () => {
    vi.doMock("@/config/feature-flags", () => ({
      isFeatureEnabled: (flag: string) => flag !== "communitySocial",
    }));
    const { getVisibleMoreNav } = await import("./navigation");
    expect(getVisibleMoreNav().map((i) => i.href)).not.toContain("/discover");
  });

  it("shows gated items when both flags are enabled", async () => {
    vi.doMock("@/config/feature-flags", () => ({
      isFeatureEnabled: () => true,
    }));
    const { getVisibleMoreNav } = await import("./navigation");
    const hrefs = getVisibleMoreNav().map((i) => i.href);
    expect(hrefs).toContain("/games");
    expect(hrefs).toContain("/discover");
  });

  it("never mutates the canonical APP_NAV_MORE", async () => {
    vi.doMock("@/config/feature-flags", () => ({
      isFeatureEnabled: () => false,
    }));
    const { getVisibleMoreNav, APP_NAV_MORE } = await import("./navigation");
    getVisibleMoreNav();
    expect(APP_NAV_MORE.map((i) => i.href)).toContain("/games");
    expect(APP_NAV_MORE.map((i) => i.href)).toContain("/discover");
  });

  it("main nav is never flag-gated", async () => {
    vi.doMock("@/config/feature-flags", () => ({
      isFeatureEnabled: () => false,
    }));
    const { getVisibleMainNav, APP_NAV_MAIN } = await import("./navigation");
    expect(getVisibleMainNav()).toEqual(APP_NAV_MAIN);
  });
});

describe("withActiveProjectContext — Studio nav keeps the active project", () => {
  it("carries the active project into every Studio destination href", async () => {
    const { withActiveProjectContext, APP_NAV_MAIN } = await import("./navigation");
    const items = withActiveProjectContext(APP_NAV_MAIN, "proj-9");
    const byLabel = new Map(items.map((i) => [i.label, i.href]));
    expect(byLabel.get("Studio")).toBe("/studio?project=proj-9");
    expect(byLabel.get("Assets")).toBe("/studio?tool=assets&project=proj-9");
    expect(byLabel.get("Agents")).toBe("/studio?tool=agents&project=proj-9");
    expect(byLabel.get("Missions")).toBe("/studio?tool=workflows&project=proj-9");
  });

  it("leaves non-Studio hrefs untouched", async () => {
    const { withActiveProjectContext, APP_NAV_MORE } = await import("./navigation");
    const items = withActiveProjectContext(APP_NAV_MORE, "proj-9");
    expect(items.map((i) => i.href)).toEqual(APP_NAV_MORE.map((i) => i.href));
  });

  it("replaces a stale project param instead of duplicating it", async () => {
    const { withActiveProjectContext, APP_NAV_MAIN } = await import("./navigation");
    const assets = APP_NAV_MAIN.find((i) => i.label === "Assets")!;
    const items = withActiveProjectContext(
      [{ ...assets, href: "/studio?tool=assets&project=stale" }],
      "proj-9",
    );
    expect(items[0].href).toBe("/studio?tool=assets&project=proj-9");
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
      "/studio?tool=assets",
      "/studio?tool=agents",
      "/studio?tool=workflows",
    ]);
  });
});

describe("isAppNavActive — project param is context, not destination", () => {
  it("lights the Assets item for a project-carrying Assets href on the Assets surface", async () => {
    const { isAppNavActive } = await import("./navigation");
    const params = new URLSearchParams("tool=assets&project=proj-9");
    expect(isAppNavActive("/studio", params, "/studio?tool=assets&project=proj-9")).toBe(true);
  });

  it("does NOT light the Studio item on a sibling destination surface", async () => {
    const { isAppNavActive } = await import("./navigation");
    const params = new URLSearchParams("tool=assets&project=proj-9");
    expect(isAppNavActive("/studio", params, "/studio?project=proj-9")).toBe(false);
  });

  it("lights the Studio item on the default surface", async () => {
    const { isAppNavActive } = await import("./navigation");
    expect(isAppNavActive("/studio", new URLSearchParams("project=proj-9"), "/studio?project=proj-9")).toBe(true);
    expect(isAppNavActive("/studio", new URLSearchParams("tool=chat&project=proj-9"), "/studio?project=proj-9")).toBe(true);
  });
});
