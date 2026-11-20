import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildToolManifest, type RuntimeContextSnapshot } from "../runtime-context-injector";

function baseSnapshot(): RuntimeContextSnapshot {
  return {
    projectId: "proj-1",
    projectName: "Test Project",
    repositoryConnected: true,
    repositoryName: "owner/repo",
    activeBranch: "main",
    workspaceStatus: "ready",
    workspaceReady: true,
    terminalConnected: true,
    terminalStatus: "connected",
    terminalSessionId: "sess-1",
    deploymentStatus: "deployed",
    deploymentUrl: "https://example.com",
    writeAccess: true,
    approvalRequired: false,
    selectedModelLabel: "Test Model",
    selectedModelId: "test-model",
    activeAgentMode: "builder",
    activeAgentSlug: "litt",
    recentHealthResults: [],
  };
}

beforeEach(() => {
  vi.stubEnv("GOOGLE_PLACES_API_KEY", "test-key");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("buildToolManifest — places.search", () => {
  it("advertises places.search as available when the key is configured", () => {
    const manifest = buildToolManifest(baseSnapshot());
    const places = manifest.tools.find((t) => t.id === "places.search");
    expect(places).toBeDefined();
    expect(places?.available).toBe(true);
  });

  it("reports the exact unavailable reason when no key is configured", () => {
    vi.stubEnv("GOOGLE_PLACES_API_KEY", "");
    const manifest = buildToolManifest(baseSnapshot());
    const places = manifest.tools.find((t) => t.id === "places.search");
    expect(places?.available).toBe(false);
    expect(places?.unavailableReason).toContain("GOOGLE_PLACES_API_KEY");
  });
});
