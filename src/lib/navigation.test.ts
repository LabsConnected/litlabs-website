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
      expect.arrayContaining(["/projects", "/marketplace", "/settings", "/profile"]),
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
