import { describe, expect, it } from "vitest";
import {
  STUDIO_NAV_BOTTOM,
  STUDIO_NAV_ITEMS,
  getStudioShellMode,
} from "./navigation";

describe("Studio shell navigation", () => {
  it("keeps the Studio shell focused on workspace destinations", () => {
    expect(STUDIO_NAV_ITEMS.map((item) => item.label)).toEqual([
      "Dashboard",
      "Studio",
      "Projects",
    ]);
    expect(STUDIO_NAV_BOTTOM.map((item) => item.label)).toEqual([
      "Wallet",
      "Settings",
    ]);

    const labels = [...STUDIO_NAV_ITEMS, ...STUDIO_NAV_BOTTOM].map((item) => item.label);
    expect(labels).not.toEqual(expect.arrayContaining([
      "Create",
      "Music",
      "Showcase",
      "Games",
      "Discover",
      "Marketplace",
    ]));
  });

  it.each([300, 768, 800, 1023])("uses an overlay drawer below desktop at %dpx", (width) => {
    expect(getStudioShellMode(width)).toBe("drawer");
  });

  it.each([1024, 1280, 1440])("uses the compact wide shell at %dpx", (width) => {
    expect(getStudioShellMode(width)).toBe("wide");
  });
});
