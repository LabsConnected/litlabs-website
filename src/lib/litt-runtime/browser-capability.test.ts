import { afterEach, describe, expect, it } from "vitest";
import { buildRunContextFromStudio } from "./request-context";
import type { ResolvedStudioContext } from "@/lib/studio";

/**
 * Browser capability registration regression tests.
 *
 * The browser lane requires the "browser" capability to be registered
 * for Kernel decisions to return ok:true. The record must be scoped to
 * THIS user (beta gate) and the provider actually being configured.
 */

const OWNER_ID = "user_owner_browser_cap";

function studioCtx(): ResolvedStudioContext {
  return {
    userId: "user_1",
    projectId: "proj_1",
    projectName: "Test",
    projectDescription: null,
    repositoryProvider: null,
    repositoryOwner: null,
    repositoryName: null,
    repositoryDefaultBranch: null,
    activeBranch: null,
    framework: null,
    scanStatus: null,
    scanSummary: null,
    conversationId: "conv_1",
    activeAgentSlug: "litt",
    activeAgentMode: "standard",
    agentInstanceId: null,
    capabilities: {
      repositoryConnected: false,
      repositoryName: null,
      terminalConnected: false,
      availableTools: [],
      connectionSummary: "",
    },
  } as ResolvedStudioContext;
}

const savedEnv = {
  LITTLABS_VAPI_OWNER_CLERK_ID: process.env.LITTLABS_VAPI_OWNER_CLERK_ID,
  BROWSERBASE_API_KEY: process.env.BROWSERBASE_API_KEY,
};

afterEach(() => {
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

function build(userId: string) {
  return buildRunContextFromStudio({
    userId,
    clerkId: userId,
    studioCtx: studioCtx(),
    history: [],
    memoryContext: "",
  });
}

describe("kernel browser capability record", () => {
  it("is ready for a beta-allowed user when the provider is configured", () => {
    process.env.LITTLABS_VAPI_OWNER_CLERK_ID = OWNER_ID;
    process.env.BROWSERBASE_API_KEY = "bb_test_key";
    const cap = build(OWNER_ID).kernelCapabilities.find((c) => c.id === "browser");
    expect(cap).toBeDefined();
    expect(cap!.state).toBe("ready");
  });

  it("is registered but unavailable for non-beta users", () => {
    process.env.LITTLABS_VAPI_OWNER_CLERK_ID = OWNER_ID;
    process.env.BROWSERBASE_API_KEY = "bb_test_key";
    const cap = build("user_not_owner").kernelCapabilities.find((c) => c.id === "browser");
    expect(cap).toBeDefined();
    expect(cap!.state).toBe("unavailable");
  });

  it("is registered but unavailable when the provider key is missing", () => {
    process.env.LITTLABS_VAPI_OWNER_CLERK_ID = OWNER_ID;
    delete process.env.BROWSERBASE_API_KEY;
    const cap = build(OWNER_ID).kernelCapabilities.find((c) => c.id === "browser");
    expect(cap).toBeDefined();
    expect(cap!.state).toBe("unavailable");
  });
});
