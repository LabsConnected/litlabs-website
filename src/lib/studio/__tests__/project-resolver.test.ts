import { describe, it, expect } from "vitest";
import { buildProjectContextBlock } from "../project-resolver";
import type { ResolvedStudioContext } from "../types";

function makeCtx(overrides: Partial<ResolvedStudioContext> = {}): ResolvedStudioContext {
  return {
    userId: "user_test",
    projectId: "proj_test",
    conversationId: "conv_test",
    projectName: "Test Project",
    projectDescription: null,
    repositoryProvider: "github",
    repositoryOwner: "litbi",
    repositoryName: "litlab",
    repositoryDefaultBranch: "main",
    activeAgentSlug: "litt",
    capabilities: {
      repositoryConnected: true,
      repositoryName: "litbi/litlab",
      terminalConnected: false,
      availableTools: ["repository"],
      connectionSummary: "Connected: repository (litbi/litlab)",
    },
    ...overrides,
  };
}

describe("project-resolver", () => {
  describe("buildProjectContextBlock", () => {
    it("includes project name and ID", () => {
      const block = buildProjectContextBlock(makeCtx());
      expect(block).toContain("Test Project");
      expect(block).toContain("proj_test");
    });

    it("includes repository info when connected", () => {
      const block = buildProjectContextBlock(makeCtx());
      expect(block).toContain("litbi/litlab");
      expect(block).toContain("main");
    });

    it("omits repository info when not connected", () => {
      const block = buildProjectContextBlock(makeCtx({
        repositoryProvider: null,
        repositoryOwner: null,
        repositoryName: null,
        repositoryDefaultBranch: null,
        capabilities: {
          repositoryConnected: false,
          repositoryName: null,
          terminalConnected: false,
          availableTools: [],
          connectionSummary: "No services connected.",
        },
      }));
      expect(block).not.toContain("Repository:");
      expect(block).toContain("No services connected.");
    });

    it("includes agent slug", () => {
      const block = buildProjectContextBlock(makeCtx({ activeAgentSlug: "spark" }));
      expect(block).toContain("spark");
    });

    it("includes description when present", () => {
      const block = buildProjectContextBlock(makeCtx({ projectDescription: "A test project for V12" }));
      expect(block).toContain("A test project for V12");
    });
  });
});
