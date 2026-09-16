import { describe, it, expect } from "vitest";
import { PLUGIN_REGISTRY } from "./plugin-registry";

describe("plugin registry connect URLs", () => {
  it("points GitHub Connect at the real OAuth entry point", () => {
    const github = PLUGIN_REGISTRY.find((p) => p.id === "github");
    expect(github).toBeDefined();
    // /api/github/install 302s to the GitHub App install flow (with an
    // honest redirect to settings when the app isn't configured).
    expect(github!.connectUrl).toBe("/api/github/install");
  });

  it("has no connectUrl pointing at the nonexistent /api/github/connect route", () => {
    for (const plugin of PLUGIN_REGISTRY) {
      expect(
        plugin.connectUrl,
        `${plugin.id} connectUrl`,
      ).not.toBe("/api/github/connect");
    }
  });
});
