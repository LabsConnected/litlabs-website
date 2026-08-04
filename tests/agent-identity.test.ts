import { describe, it, expect } from "vitest";
import {
  isValidAgentMode,
  slugToMode,
  modeToSlug,
  modeLabel,
  modeDisplayLabel,
  parseAgentIdentity,
  LITT_AGENT_ID,
  DEFAULT_AGENT_MODE,
  AGENT_MODES,
} from "@/lib/litt-intelligence/agent-identity";
import {
  AGENT_PROFILES,
  getProfile,
  isToolAllowed,
  isMemoryTypeAllowed,
} from "@/lib/litt-intelligence/agent-profiles";
import type { ToolPermissionLevel } from "@/lib/litt-intelligence/types";

describe("LiTT Agent Identity", () => {
  describe("isValidAgentMode", () => {
    it("accepts all valid modes", () => {
      expect(isValidAgentMode("standard")).toBe(true);
      expect(isValidAgentMode("builder")).toBe(true);
      expect(isValidAgentMode("research")).toBe(true);
      expect(isValidAgentMode("spark")).toBe(true);
    });

    it("rejects invalid modes", () => {
      expect(isValidAgentMode("sparkle")).toBe(false);
      expect(isValidAgentMode("")).toBe(false);
      expect(isValidAgentMode(null)).toBe(false);
      expect(isValidAgentMode(undefined)).toBe(false);
      expect(isValidAgentMode(123)).toBe(false);
    });
  });

  describe("slugToMode", () => {
    it("maps spark slug to spark mode", () => {
      expect(slugToMode("spark")).toBe("spark");
    });

    it("maps researcher slug to research mode", () => {
      expect(slugToMode("researcher")).toBe("research");
    });

    it("maps coder slug to builder mode", () => {
      expect(slugToMode("coder")).toBe("builder");
    });

    it("maps litt slug to standard mode", () => {
      expect(slugToMode("litt")).toBe("standard");
    });

    it("defaults to standard for unknown slugs", () => {
      expect(slugToMode("unknown")).toBe("standard");
      expect(slugToMode(null)).toBe("standard");
      expect(slugToMode(undefined)).toBe("standard");
    });
  });

  describe("modeToSlug", () => {
    it("maps spark mode to spark slug", () => {
      expect(modeToSlug("spark")).toBe("spark");
    });

    it("maps non-spark modes to litt slug", () => {
      expect(modeToSlug("standard")).toBe("litt");
      expect(modeToSlug("builder")).toBe("litt");
      expect(modeToSlug("research")).toBe("litt");
    });
  });

  describe("modeLabel", () => {
    it("returns human-readable labels", () => {
      expect(modeLabel("standard")).toBe("Standard");
      expect(modeLabel("builder")).toBe("Builder");
      expect(modeLabel("research")).toBe("Research");
      expect(modeLabel("spark")).toBe("Spark Creative");
    });
  });

  describe("modeDisplayLabel", () => {
    it("returns full display label with LiTT prefix", () => {
      expect(modeDisplayLabel("standard")).toBe("LiTT · Standard");
      expect(modeDisplayLabel("spark")).toBe("LiTT · Spark Creative");
    });
  });

  describe("parseAgentIdentity", () => {
    it("parses valid identity", () => {
      const result = parseAgentIdentity({
        agentId: "litt",
        agentMode: "spark",
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.identity.agentId).toBe("litt");
        expect(result.identity.agentMode).toBe("spark");
      }
    });

    it("rejects missing agentId", () => {
      const result = parseAgentIdentity({ agentMode: "spark" });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain("agentId");
      }
    });

    it("rejects missing agentMode", () => {
      const result = parseAgentIdentity({ agentId: "litt" });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain("agentMode");
      }
    });

    it("rejects invalid agentMode", () => {
      const result = parseAgentIdentity({
        agentId: "litt",
        agentMode: "sparkle",
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain("Invalid agentMode");
      }
    });

    it("rejects null input", () => {
      const result = parseAgentIdentity(null);
      expect(result.ok).toBe(false);
    });

    it("rejects non-object input", () => {
      const result = parseAgentIdentity("litt");
      expect(result.ok).toBe(false);
    });
  });

  describe("constants", () => {
    it("LITT_AGENT_ID is 'litt'", () => {
      expect(LITT_AGENT_ID).toBe("litt");
    });

    it("DEFAULT_AGENT_MODE is 'standard'", () => {
      expect(DEFAULT_AGENT_MODE).toBe("standard");
    });

    it("AGENT_MODES contains all four modes", () => {
      expect(AGENT_MODES).toEqual(["standard", "builder", "research", "spark"]);
    });
  });
});

describe("LiTT Agent Profiles", () => {
  describe("getProfile", () => {
    it("returns profile for each mode", () => {
      for (const mode of AGENT_MODES) {
        const profile = getProfile(mode);
        expect(profile).toBeDefined();
        expect(profile.mode).toBe(mode);
      }
    });

    it("throws for invalid mode", () => {
      expect(() => getProfile("invalid" as never)).toThrow();
    });
  });

  describe("AGENT_PROFILES", () => {
    it("has all four modes", () => {
      expect(Object.keys(AGENT_PROFILES).sort()).toEqual(
        ["builder", "research", "spark", "standard"].sort(),
      );
    });

    it("each profile has a system prompt", () => {
      for (const mode of AGENT_MODES) {
        expect(AGENT_PROFILES[mode].systemPrompt.length).toBeGreaterThan(100);
      }
    });

    it("each profile has a prompt version", () => {
      for (const mode of AGENT_MODES) {
        expect(AGENT_PROFILES[mode].promptVersion).toMatch(/^\d+\.\d+\.\d+$/);
      }
    });
  });

  describe("Spark mode restrictions", () => {
    const sparkProfile = AGENT_PROFILES.spark;

    it("cannot use terminal", () => {
      expect(sparkProfile.canUseTerminal).toBe(false);
    });

    it("cannot deploy", () => {
      expect(sparkProfile.canDeploy).toBe(false);
    });

    it("cannot modify production", () => {
      expect(sparkProfile.canModifyProduction).toBe(false);
    });

    it("cannot request approval", () => {
      expect(sparkProfile.canRequestApproval).toBe(false);
    });

    it("does not allow workspace-write tools", () => {
      expect(sparkProfile.allowedToolLevels).not.toContain("workspace-write");
    });

    it("does not allow production tools", () => {
      expect(sparkProfile.allowedToolLevels).not.toContain("production");
    });

    it("does not allow destructive tools", () => {
      expect(sparkProfile.allowedToolLevels).not.toContain("destructive");
    });

    it("blocks terminal.execute", () => {
      expect(sparkProfile.blockedToolIds).toContain("terminal.execute");
    });

    it("blocks git.push", () => {
      expect(sparkProfile.blockedToolIds).toContain("git.push");
    });

    it("blocks file.delete", () => {
      expect(sparkProfile.blockedToolIds).toContain("file.delete");
    });

    it("blocks deploy.execute", () => {
      expect(sparkProfile.blockedToolIds).toContain("deploy.execute");
    });
  });

  describe("Standard mode capabilities", () => {
    const standardProfile = AGENT_PROFILES.standard;

    it("can use terminal", () => {
      expect(standardProfile.canUseTerminal).toBe(true);
    });

    it("can deploy", () => {
      expect(standardProfile.canDeploy).toBe(true);
    });

    it("can modify production", () => {
      expect(standardProfile.canModifyProduction).toBe(true);
    });

    it("allows all tool levels", () => {
      expect(standardProfile.allowedToolLevels).toContain("workspace-write");
      expect(standardProfile.allowedToolLevels).toContain("production");
      expect(standardProfile.allowedToolLevels).toContain("destructive");
    });
  });

  describe("Research mode restrictions", () => {
    const researchProfile = AGENT_PROFILES.research;

    it("cannot use terminal", () => {
      expect(researchProfile.canUseTerminal).toBe(false);
    });

    it("cannot deploy", () => {
      expect(researchProfile.canDeploy).toBe(false);
    });

    it("does not allow workspace-write tools", () => {
      expect(researchProfile.allowedToolLevels).not.toContain("workspace-write");
    });
  });

  describe("isToolAllowed", () => {
    it("allows read tools in standard mode", () => {
      expect(isToolAllowed("standard", "project.scan", "read")).toBe(true);
    });

    it("allows workspace-write tools in standard mode", () => {
      expect(isToolAllowed("standard", "file.write", "workspace-write")).toBe(true);
    });

    it("blocks workspace-write tools in spark mode", () => {
      expect(isToolAllowed("spark", "file.write", "workspace-write")).toBe(false);
    });

    it("blocks terminal.execute in spark mode even if level is allowed", () => {
      expect(isToolAllowed("spark", "terminal.execute", "read")).toBe(false);
    });

    it("blocks production tools in research mode", () => {
      expect(isToolAllowed("research", "deploy.execute", "production")).toBe(false);
    });
  });

  describe("isMemoryTypeAllowed", () => {
    it("allows all memory types in standard mode", () => {
      expect(isMemoryTypeAllowed("standard", "user_preference")).toBe(true);
      expect(isMemoryTypeAllowed("standard", "conversation_summary")).toBe(true);
    });

    it("restricts memory types in spark mode", () => {
      expect(isMemoryTypeAllowed("spark", "user_preference")).toBe(true);
      expect(isMemoryTypeAllowed("spark", "project_fact")).toBe(true);
      expect(isMemoryTypeAllowed("spark", "conversation_summary")).toBe(true);
      // Spark mode should not access architecture memories
      expect(isMemoryTypeAllowed("spark", "architecture")).toBe(false);
    });
  });
});

describe("Agent Identity Architecture — Acceptance Tests", () => {
  // These tests verify the acceptance criteria from the directive.

  it("Test 7: Spark mode cannot invoke terminal or deployment tools", () => {
    const spark = AGENT_PROFILES.spark;
    expect(spark.blockedToolIds).toContain("terminal.execute");
    expect(spark.blockedToolIds).toContain("deploy.execute");
    expect(spark.blockedToolIds).toContain("git.push");
    expect(spark.canUseTerminal).toBe(false);
    expect(spark.canDeploy).toBe(false);
  });

  it("Test 8: LiTT Standard retains project and repository context", () => {
    const standard = AGENT_PROFILES.standard;
    expect(standard.canUseTerminal).toBe(true);
    expect(standard.canDeploy).toBe(true);
    expect(standard.canModifyProduction).toBe(true);
    expect(standard.systemPrompt).toContain("repository");
    expect(standard.systemPrompt).toContain("terminal");
    expect(standard.systemPrompt).toContain("git");
  });

  it("Test 11: Missing agent identity causes a typed error", () => {
    const result = parseAgentIdentity({});
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBeDefined();
      expect(result.error.length).toBeGreaterThan(0);
    }
  });

  it("Test 12: Existing conversations are migrated safely (slugToMode)", () => {
    // Spark slug → spark mode
    expect(slugToMode("spark")).toBe("spark");
    // Other slugs → standard mode
    expect(slugToMode("litt")).toBe("standard");
    expect(slugToMode("researcher")).toBe("research");
    expect(slugToMode(null)).toBe("standard");
  });

  it("LiTT and Spark have visibly different system prompts", () => {
    const standard = AGENT_PROFILES.standard.systemPrompt;
    const spark = AGENT_PROFILES.spark.systemPrompt;
    expect(standard).not.toEqual(spark);
    // Spark prompt should mention creative concepts
    expect(spark.toLowerCase()).toContain("creative");
    // Standard prompt should mention engineering concepts
    expect(standard.toLowerCase()).toContain("engineering");
  });

  it("Spark mode prompt explicitly forbids deployment and terminal", () => {
    const spark = AGENT_PROFILES.spark.systemPrompt.toLowerCase();
    expect(spark).toContain("must not");
    expect(spark).toContain("deploy");
    expect(spark).toContain("terminal");
  });

  it("All profiles have distinct display labels", () => {
    const labels = AGENT_MODES.map((m) => modeDisplayLabel(m));
    const unique = new Set(labels);
    expect(unique.size).toBe(AGENT_MODES.length);
  });
});
