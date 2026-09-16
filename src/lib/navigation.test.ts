import { describe, it, expect, vi, afterEach } from "vitest";

afterEach(() => {
  vi.resetModules();
  vi.doUnmock("@/config/feature-flags");
});

describe("getVisibleNavSections — flag-gated nav items", () => {
  it("shows /games now that retroGameRuntime is enabled (default)", async () => {
    const { getVisibleNavSections } = await import("./navigation");
    const main = getVisibleNavSections().find((s) => s.id === "main");
    expect(main).toBeDefined();
    expect(main!.items.map((i) => i.href)).toContain("/games");
    // The rest of Main stays intact
    expect(main!.items.map((i) => i.href)).toEqual(
      expect.arrayContaining(["/dashboard", "/studio", "/projects", "/discover", "/marketplace"]),
    );
  });

  it("hides /games when retroGameRuntime is disabled", async () => {
    vi.doMock("@/config/feature-flags", () => ({
      isFeatureEnabled: (flag: string) => flag !== "retroGameRuntime",
    }));
    const { getVisibleNavSections } = await import("./navigation");
    const main = getVisibleNavSections().find((s) => s.id === "main");
    expect(main).toBeDefined();
    expect(main!.items.map((i) => i.href)).not.toContain("/games");
  });

  it("shows /games when retroGameRuntime is enabled", async () => {
    vi.doMock("@/config/feature-flags", () => ({
      isFeatureEnabled: (flag: string) => flag === "retroGameRuntime",
    }));
    const { getVisibleNavSections } = await import("./navigation");
    const main = getVisibleNavSections().find((s) => s.id === "main");
    expect(main!.items.map((i) => i.href)).toContain("/games");
  });

  it("never mutates the canonical APP_NAV_SECTIONS", async () => {
    const { getVisibleNavSections, APP_NAV_SECTIONS } = await import("./navigation");
    getVisibleNavSections();
    const main = APP_NAV_SECTIONS.find((s) => s.id === "main");
    expect(main!.items.map((i) => i.href)).toContain("/games");
  });
});
