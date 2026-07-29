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
    it("has exactly two agents: litt and spark", () => {
      const keys = Object.keys(BUILT_IN_AGENTS);
      expect(keys).toHaveLength(2);
      expect(keys).toContain("litt");
      expect(keys).toContain("spark");
    });

    it("litt agent has correct display name", () => {
      expect(BUILT_IN_AGENTS.litt.displayName).toBe("LiTT");
    });

    it("spark agent has correct display name", () => {
      expect(BUILT_IN_AGENTS.spark.displayName).toBe("Spark");
    });

    it("both agents have non-empty system prompts", () => {
      expect(BUILT_IN_AGENTS.litt.systemPrompt.length).toBeGreaterThan(50);
      expect(BUILT_IN_AGENTS.spark.systemPrompt.length).toBeGreaterThan(50);
    });

    it("both agents have capabilities arrays", () => {
      expect(BUILT_IN_AGENTS.litt.capabilities.length).toBeGreaterThan(0);
      expect(BUILT_IN_AGENTS.spark.capabilities.length).toBeGreaterThan(0);
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

    it("returns null for unknown slug", () => {
      expect(resolveAgent("director")).toBeNull();
      expect(resolveAgent("forge")).toBeNull();
      expect(resolveAgent("")).toBeNull();
      expect(resolveAgent("LiTT")).toBeNull();
    });
  });

  describe("isValidAgentSlug", () => {
    it("returns true for 'litt' and 'spark'", () => {
      expect(isValidAgentSlug("litt")).toBe(true);
      expect(isValidAgentSlug("spark")).toBe(true);
    });

    it("returns false for invalid slugs", () => {
      expect(isValidAgentSlug("director")).toBe(false);
      expect(isValidAgentSlug("forge")).toBe(false);
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
  });
});
