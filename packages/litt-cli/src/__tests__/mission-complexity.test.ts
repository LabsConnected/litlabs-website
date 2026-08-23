/**
 * Tests for mission complexity routing — determines whether semantic
 * planning (planMission) is needed for a given mission intent.
 *
 * Tests:
 *   - Simple missions (single-action, bounded) → "simple" (skip planning)
 *   - Complex missions (multi-step, architecture) → "complex" (plan)
 *   - Mutating intent ALWAYS remains MISSION (complexity only decides planning)
 *   - shouldSkipPlanning returns true for simple, false for complex
 */

import { describe, it, expect } from "vitest";
import { classifyMissionComplexity, shouldSkipPlanning } from "../lib/mission-complexity.js";

describe("classifyMissionComplexity", () => {
  describe("simple missions (skip planning)", () => {
    it("'fix this failing test' is simple", () => {
      expect(classifyMissionComplexity("fix this failing test")).toBe("simple");
    });

    it("'fix the bug' is simple", () => {
      expect(classifyMissionComplexity("fix the bug")).toBe("simple");
    });

    it("'run the build' is simple", () => {
      expect(classifyMissionComplexity("run the build")).toBe("simple");
    });

    it("'run tests' is simple", () => {
      expect(classifyMissionComplexity("run tests")).toBe("simple");
    });

    it("'verify it' is simple", () => {
      expect(classifyMissionComplexity("verify it")).toBe("simple");
    });

    it("'show me the diff' is simple", () => {
      expect(classifyMissionComplexity("show me the diff")).toBe("simple");
    });

    it("'make a safe code change' is simple", () => {
      expect(classifyMissionComplexity("make a safe code change")).toBe("simple");
    });

    it("'fix this file' is simple", () => {
      expect(classifyMissionComplexity("fix this file")).toBe("simple");
    });
  });

  describe("complex missions (use planning)", () => {
    it("'implement auth' is complex", () => {
      expect(classifyMissionComplexity("implement auth")).toBe("complex");
    });

    it("'refactor the auth module' is complex", () => {
      expect(classifyMissionComplexity("refactor the auth module")).toBe("complex");
    });

    it("'audit and repair security issue' is complex", () => {
      expect(classifyMissionComplexity("audit and repair security issue")).toBe("complex");
    });

    it("'scan this repo and tell me what needs attention' is complex", () => {
      expect(classifyMissionComplexity("scan this repo and tell me what needs attention")).toBe("complex");
    });

    it("'ship this feature' is complex", () => {
      expect(classifyMissionComplexity("ship this feature")).toBe("complex");
    });

    it("'fix this failing test and then update the docs' is complex", () => {
      expect(classifyMissionComplexity("fix this failing test and then update the docs")).toBe("complex");
    });

    it("'inspect this repo and tell me the framework and branch' is complex", () => {
      expect(classifyMissionComplexity("inspect this repo and tell me the framework and branch")).toBe("complex");
    });

    it("long multi-step request is complex", () => {
      expect(classifyMissionComplexity(
        "I need you to look into the authentication flow, check the database schema, and then fix the user session handling"
      )).toBe("complex");
    });
  });

  describe("shouldSkipPlanning", () => {
    it("returns true for simple missions", () => {
      expect(shouldSkipPlanning("fix the bug")).toBe(true);
      expect(shouldSkipPlanning("run the build")).toBe(true);
    });

    it("returns false for complex missions", () => {
      expect(shouldSkipPlanning("implement auth")).toBe(false);
      expect(shouldSkipPlanning("scan this repo and tell me what needs attention")).toBe(false);
    });
  });
});
