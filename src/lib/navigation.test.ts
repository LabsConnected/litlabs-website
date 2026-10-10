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
    // The rest of More stays intact (Phase 3B: Projects/Discover are top-level)
    expect(hrefs).toEqual(
      expect.arrayContaining(["/docs", "/deployments", "/showcase", "/cli"]),
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
    // Phase 3B: Discover is now a top-level nav item, not in More menu.
    // This test verifies the More menu behavior for remaining gated items.
    vi.doMock("@/config/feature-flags", () => ({
      isFeatureEnabled: (flag: string) => flag !== "communitySocial",
    }));
    const { getVisibleMoreNav } = await import("./navigation");
    // Discover should NOT be in More menu (it's top-level now)
    expect(getVisibleMoreNav().map((i) => i.href)).not.toContain("/discover");
  });

  it("shows gated items when both flags are enabled", async () => {
    vi.doMock("@/config/feature-flags", () => ({
      isFeatureEnabled: () => true,
    }));
    const { getVisibleMoreNav } = await import("./navigation");
    const hrefs = getVisibleMoreNav().map((i) => i.href);
    expect(hrefs).toContain("/games");
    // Phase 3B: Discover is top-level, not in More menu
    expect(hrefs).not.toContain("/discover");
  });

  it("never mutates the canonical APP_NAV_MORE", async () => {
    vi.doMock("@/config/feature-flags", () => ({
      isFeatureEnabled: () => false,
    }));
    const { getVisibleMoreNav, APP_NAV_MORE } = await import("./navigation");
    getVisibleMoreNav();
    expect(APP_NAV_MORE.map((i) => i.href)).toContain("/games");
    // Phase 3B: Discover is top-level, not in More menu
    expect(APP_NAV_MORE.map((i) => i.href)).not.toContain("/discover");
  });

  it("main nav is never flag-gated", async () => {
    vi.doMock("@/config/feature-flags", () => ({
      isFeatureEnabled: () => false,
    }));
    const { getVisibleMainNav, APP_NAV_MAIN } = await import("./navigation");
    expect(getVisibleMainNav()).toEqual(APP_NAV_MAIN);
  });
});
