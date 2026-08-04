import { describe, it, expect } from "vitest";
import {
  BUILT_IN_AGENTS,
  resolveAgent,
  isValidAgentSlug,
  getAgentMemoryTypes,
} from "../agent-registry";
import type { AgentSlug } from "../types";

describe("agent-registry", () => {
  describe("BUILT_IN_AGENTS", () => {
    it("has all 10 agents", () => {
      const keys = Object.keys(BUILT_IN_AGENTS);
      expect(keys).toHaveLength(10);
      expect(keys).toContain("litt");
      expect(keys).toContain("spark");
      expect(keys).toContain("nova");
      expect(keys).toContain("forge");
      expect(keys).toContain("echo");
    });

    it("litt agent has correct display name", () => {
      expect(BUILT_IN_AGENTS.litt.displayName).toBe("LiTT");
    });

    it("spark agent has correct display name", () => {
      expect(BUILT_IN_AGENTS.spark.displayName).toBe("Spark");
    });

    it("all agents have non-empty system prompts", () => {
      for (const key of Object.keys(BUILT_IN_AGENTS) as AgentSlug[]) {
        expect(BUILT_IN_AGENTS[key].systemPrompt.length).toBeGreaterThan(20);
      }
    });

    it("all agents have capabilities arrays", () => {
      for (const key of Object.keys(BUILT_IN_AGENTS) as AgentSlug[]) {
        expect(BUILT_IN_AGENTS[key].capabilities.length).toBeGreaterThan(0);
      }
    });
  });

  describe("resolveAgent", () => {
    it("returns litt agent for 'litt' slug", () => {
      const agent = resolveAgent("litt");
      expect(agent).not.toBeNull();
      expect(agent?.slug).toBe("litt");
    });

    it("returns spark agent for 'spark' slug", () => {
      const agent = resolveAgent("spark");
      expect(agent).not.toBeNull();
      expect(agent?.slug).toBe("spark");
    });

    it("returns nova agent for 'nova' slug", () => {
      const agent = resolveAgent("nova");
      expect(agent).not.toBeNull();
      expect(agent?.slug).toBe("nova");
    });

    it("returns forge agent for 'forge' slug", () => {
      const agent = resolveAgent("forge");
      expect(agent).not.toBeNull();
      expect(agent?.slug).toBe("forge");
    });

    it("returns echo agent for 'echo' slug", () => {
      const agent = resolveAgent("echo");
      expect(agent).not.toBeNull();
      expect(agent?.slug).toBe("echo");
    });

    it("returns null for unknown slug", () => {
      expect(resolveAgent("director")).toBeNull();
      expect(resolveAgent("")).toBeNull();
      expect(resolveAgent("LiTT")).toBeNull();
    });
  });

  describe("isValidAgentSlug", () => {
    it("returns true for known agents", () => {
      expect(isValidAgentSlug("litt")).toBe(true);
      expect(isValidAgentSlug("spark")).toBe(true);
      expect(isValidAgentSlug("nova")).toBe(true);
      expect(isValidAgentSlug("forge")).toBe(true);
      expect(isValidAgentSlug("echo")).toBe(true);
    });

    it("returns false for invalid slugs", () => {
      expect(isValidAgentSlug("director")).toBe(false);
      expect(isValidAgentSlug("")).toBe(false);
    });

    it("acts as type guard", () => {
      const slug: string = "litt";
      if (isValidAgentSlug(slug)) {
        const typed: AgentSlug = slug;
        expect(typed).toBe("litt");
      }
    });
  });

  describe("getAgentMemoryTypes", () => {
    it("returns memory types for litt", () => {
      const types = getAgentMemoryTypes("litt");
      expect(types).toContain("user_preference");
      expect(types).toContain("project_fact");
      expect(types.length).toBeGreaterThan(3);
    });

    it("returns memory types for spark", () => {
      const types = getAgentMemoryTypes("spark");
      expect(types).toContain("user_preference");
      expect(types.length).toBeGreaterThan(0);
    });

    it("returns memory types for nova", () => {
      const types = getAgentMemoryTypes("nova");
      expect(types).toContain("user_preference");
      expect(types.length).toBeGreaterThan(0);
    });

    it("returns memory types for forge", () => {
      const types = getAgentMemoryTypes("forge");
      expect(types).toContain("user_preference");
      expect(types).toContain("architecture");
      expect(types.length).toBeGreaterThan(3);
    });

    it("returns memory types for echo", () => {
      const types = getAgentMemoryTypes("echo");
      expect(types).toContain("user_preference");
      expect(types.length).toBeGreaterThan(0);
    });
  });
});
