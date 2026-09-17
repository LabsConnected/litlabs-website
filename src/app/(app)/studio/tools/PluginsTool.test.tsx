import { describe, it, expect, vi } from "vitest";

/**
 * PluginsTool "Connect" routing — API-key and endpoint plugins must land
 * somewhere the user can actually enter a key.
 *
 * Regression: Connect used to route to `/settings#keys`, but the settings
 * page never reads location.hash and has no keys section (sections are
 * `?section=` query params), so users landed on Settings with no path to
 * enter a key — a dead end.
 */

vi.mock("@/context/ThemeContext", () => ({
  useTheme: () => ({ resolvedColors: {} }),
}));
vi.mock("@/app/(app)/studio/hooks/useCapabilities", () => ({
  useCapabilities: () => ({ summary: null, refresh: () => Promise.resolve() }),
}));
vi.mock("@/components/studio/ProjectSourceSelector", () => ({
  default: () => null,
}));

import { settingsDeepLinkForPlugin } from "./PluginsTool";

describe("settingsDeepLinkForPlugin", () => {
  it("routes api-key plugins to the connections section via query param", () => {
    expect(
      settingsDeepLinkForPlugin({ connectUrl: undefined, authMethod: "api-key" }),
    ).toBe("/settings?section=connections");
  });

  it("routes endpoint plugins to the connections section via query param", () => {
    expect(
      settingsDeepLinkForPlugin({ connectUrl: undefined, authMethod: "endpoint" }),
    ).toBe("/settings?section=connections");
  });

  it("never uses a location.hash fragment (the settings page ignores it)", () => {
    for (const authMethod of ["api-key", "endpoint"] as const) {
      const url = settingsDeepLinkForPlugin({ connectUrl: undefined, authMethod });
      expect(url).not.toContain("#");
    }
  });

  it("prefers a plugin's own connectUrl when present", () => {
    expect(
      settingsDeepLinkForPlugin({
        connectUrl: "https://example.com/connect",
        authMethod: "api-key",
      }),
    ).toBe("https://example.com/connect");
  });

  it("returns null when there is no in-app connect flow", () => {
    expect(
      settingsDeepLinkForPlugin({ connectUrl: undefined, authMethod: "none" }),
    ).toBe(null);
  });
});
