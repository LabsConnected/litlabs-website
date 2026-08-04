import { describe, it, expect } from "vitest";
import {
  AGENT_DEFINITIONS,
  AGENT_REGISTRY,
  CORE_PERSONALITIES,
  INTERNAL_SPECIALISTS,
  getAgentDefinition,
  getStudioAgents,
  getMarketplaceAgents,
  PREMIUM_AGENTS,
  planIncludesAgent,
} from "@/lib/agent-registry";

describe("marketplace agent-registry", () => {
  describe("CORE_PERSONALITIES", () => {
    it("includes exactly 2 core personalities (LiTT and Spark)", () => {
      expect(CORE_PERSONALITIES).toHaveLength(2);
      const slugs = CORE_PERSONALITIES.map((a) => a.id);
      expect(slugs).toContain("litt");
      expect(slugs).toContain("spark");
    });
  });

  describe("AGENT_DEFINITIONS", () => {
    it("includes 7 total (2 core + 5 internal specialists)", () => {
      const slugs = AGENT_DEFINITIONS.map((a) => a.id);
      expect(slugs).toContain("litt");
      expect(slugs).toContain("spark");
      expect(slugs).toContain("researcher");
      expect(slugs).toContain("writer");
      expect(slugs).toContain("marketer");
      expect(slugs).toContain("coder");
      expect(slugs).toContain("analyst");
      expect(AGENT_DEFINITIONS).toHaveLength(7);
    });

    it("all agents have required fields", () => {
      for (const agent of AGENT_DEFINITIONS) {
        expect(agent.id).toBeTruthy();
        expect(agent.name).toBeTruthy();
        expect(agent.description).toBeTruthy();
        expect(agent.systemPrompt.length).toBeGreaterThan(50);
        expect(agent.tools.allowlist.length).toBeGreaterThan(0);
      }
    });
  });

  describe("PREMIUM_AGENTS", () => {
    it("contains exactly the 5 specialists", () => {
      expect(PREMIUM_AGENTS).toHaveLength(5);
      const slugs = PREMIUM_AGENTS.map((a) => a.id);
      expect(slugs).toContain("researcher");
      expect(slugs).toContain("writer");
      expect(slugs).toContain("marketer");
      expect(slugs).toContain("coder");
      expect(slugs).toContain("analyst");
    });

    it("all premium agents are marketplace-visible", () => {
      for (const agent of PREMIUM_AGENTS) {
        expect(agent.marketplaceVisible).toBe(true);
        expect(agent.enabled).toBe(true);
      }
    });

    it("Coder and Researcher are NOT studio-visible (consolidated into LiTT)", () => {
      expect(AGENT_REGISTRY["coder"].studioVisible).toBe(false);
      expect(AGENT_REGISTRY["researcher"].studioVisible).toBe(false);
    });

    it("Researcher minimum plan is creator_beta", () => {
      expect(AGENT_REGISTRY["researcher"].minimumPlan).toBe("creator_beta");
    });

    it("Coder minimum plan is pro_builder_beta", () => {
      expect(AGENT_REGISTRY["coder"].minimumPlan).toBe("pro_builder_beta");
    });

    it("Analyst minimum plan is pro_builder_beta", () => {
      expect(AGENT_REGISTRY["analyst"].minimumPlan).toBe("pro_builder_beta");
    });
  });

  describe("getAgentDefinition", () => {
    it("returns agent by slug", () => {
      expect(getAgentDefinition("researcher")?.name).toBe("Researcher");
      expect(getAgentDefinition("writer")?.name).toBe("Writer");
      expect(getAgentDefinition("coder")?.name).toBe("Coder");
    });

    it("returns null for unknown slug", () => {
      expect(getAgentDefinition("nonexistent")).toBeNull();
    });
  });

  describe("getStudioAgents", () => {
    it("includes only LiTT and Spark (2 agents)", () => {
      const studioAgents = getStudioAgents();
      expect(studioAgents).toHaveLength(2);
      const slugs = studioAgents.map((a) => a.id);
      expect(slugs).toContain("litt");
      expect(slugs).toContain("spark");
      expect(slugs).not.toContain("researcher");
      expect(slugs).not.toContain("coder");
    });

    it("LiTT role includes Engineer and Researcher", () => {
      const litt = getStudioAgents().find((a) => a.id === "litt");
      expect(litt?.role).toMatch(/Engineer/i);
      expect(litt?.role).toMatch(/Researcher/i);
    });

    it("Spark role includes Creative Companion and Designer", () => {
      const spark = getStudioAgents().find((a) => a.id === "spark");
      expect(spark?.role).toMatch(/Creative Companion/i);
      expect(spark?.role).toMatch(/Designer/i);
    });
  });

  describe("getMarketplaceAgents", () => {
    it("includes the 5 specialists", () => {
      const marketplaceAgents = getMarketplaceAgents();
      expect(marketplaceAgents).toHaveLength(5);
      const slugs = marketplaceAgents.map((a) => a.id);
      expect(slugs).toContain("researcher");
      expect(slugs).toContain("writer");
      expect(slugs).toContain("marketer");
      expect(slugs).toContain("coder");
      expect(slugs).toContain("analyst");
    });
  });

  describe("planIncludesAgent", () => {
    it("creator_beta includes Researcher, Writer, Marketer", () => {
      expect(planIncludesAgent("creator_beta", "researcher")).toBe(true);
      expect(planIncludesAgent("creator_beta", "writer")).toBe(true);
      expect(planIncludesAgent("creator_beta", "marketer")).toBe(true);
    });

    it("creator_beta does NOT include Coder or Analyst", () => {
      expect(planIncludesAgent("creator_beta", "coder")).toBe(false);
      expect(planIncludesAgent("creator_beta", "analyst")).toBe(false);
    });

    it("pro_builder_beta includes all specialists", () => {
      expect(planIncludesAgent("pro_builder_beta", "researcher")).toBe(true);
      expect(planIncludesAgent("pro_builder_beta", "coder")).toBe(true);
      expect(planIncludesAgent("pro_builder_beta", "analyst")).toBe(true);
    });

    it("starter does not include specialists", () => {
      expect(planIncludesAgent("starter", "researcher")).toBe(false);
      expect(planIncludesAgent("starter", "coder")).toBe(false);
      expect(planIncludesAgent("starter", "analyst")).toBe(false);
    });

    it("returns false for unknown agent", () => {
      expect(planIncludesAgent("creator_beta", "nonexistent")).toBe(false);
    });
  });
});
