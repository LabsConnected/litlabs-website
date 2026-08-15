/**
 * Tests for the semantic color system.
 *
 * Verifies that:
 *   - LiTT brand is magenta (purple)
 *   - Success/pass is green
 *   - Working is cyan
 *   - Warning is yellow
 *   - Failure is red
 *   - Secondary is gray
 *   - State colors map correctly
 *   - Activity tags map correctly
 */

import { describe, it, expect } from "vitest";
import { COLORS, stateColor, activityColor, healthColor, costTier } from "../ink/colors.js";

describe("colors", () => {
  describe("COLORS constants", () => {
    it("brand is magenta (purple)", () => {
      expect(COLORS.brand).toBe("magenta");
    });

    it("success is green", () => {
      expect(COLORS.success).toBe("green");
    });

    it("working is cyan", () => {
      expect(COLORS.working).toBe("cyan");
    });

    it("warning is yellow", () => {
      expect(COLORS.warning).toBe("yellow");
    });

    it("error is red", () => {
      expect(COLORS.error).toBe("red");
    });

    it("secondary is gray", () => {
      expect(COLORS.secondary).toBe("gray");
    });
  });

  describe("stateColor", () => {
    it("IDLE/READY → brand", () => {
      expect(stateColor("IDLE")).toBe(COLORS.brand);
    });

    it("working states → cyan", () => {
      expect(stateColor("UNDERSTANDING")).toBe(COLORS.working);
      expect(stateColor("PLANNING")).toBe(COLORS.working);
      expect(stateColor("READING")).toBe(COLORS.working);
      expect(stateColor("EDITING")).toBe(COLORS.working);
      expect(stateColor("RUNNING")).toBe(COLORS.working);
      expect(stateColor("TESTING")).toBe(COLORS.working);
      expect(stateColor("VERIFYING")).toBe(COLORS.working);
    });

    it("COMPLETE → green", () => {
      expect(stateColor("COMPLETE")).toBe(COLORS.success);
    });

    it("FAILED → red", () => {
      expect(stateColor("FAILED")).toBe(COLORS.error);
    });

    it("CANCELLED/TIMEOUT → yellow", () => {
      expect(stateColor("CANCELLED")).toBe(COLORS.warning);
      expect(stateColor("TIMEOUT")).toBe(COLORS.warning);
    });

    it("APPROVAL → yellow", () => {
      expect(stateColor("APPROVAL")).toBe(COLORS.warning);
    });
  });

  describe("activityColor", () => {
    it("working tags → cyan", () => {
      expect(activityColor("THINK")).toBe(COLORS.working);
      expect(activityColor("ROUTE")).toBe(COLORS.working);
      expect(activityColor("READ")).toBe(COLORS.working);
      expect(activityColor("EDIT")).toBe(COLORS.working);
      expect(activityColor("RUN")).toBe(COLORS.working);
    });

    it("success tags → green", () => {
      expect(activityColor("PASS")).toBe(COLORS.success);
      expect(activityColor("VERIFY")).toBe(COLORS.success);
      expect(activityColor("DONE")).toBe(COLORS.success);
    });

    it("failure tags → red", () => {
      expect(activityColor("FAIL")).toBe(COLORS.error);
      expect(activityColor("ERROR")).toBe(COLORS.error);
    });

    it("warning tags → yellow", () => {
      expect(activityColor("WARN")).toBe(COLORS.warning);
      expect(activityColor("APPROVAL")).toBe(COLORS.warning);
    });

    it("brand tags → magenta", () => {
      expect(activityColor("CHAT")).toBe(COLORS.brand);
      expect(activityColor("INFO")).toBe(COLORS.brand);
    });
  });

  describe("healthColor", () => {
    it("ready → green", () => {
      expect(healthColor("ready")).toBe(COLORS.success);
    });

    it("unverified → yellow", () => {
      expect(healthColor("unverified")).toBe(COLORS.warning);
    });

    it("no-key → gray", () => {
      expect(healthColor("no-key")).toBe(COLORS.secondary);
    });

    it("rate-limited → yellow", () => {
      expect(healthColor("rate-limited")).toBe(COLORS.warning);
    });

    it("down → red", () => {
      expect(healthColor("down")).toBe(COLORS.error);
    });
  });

  describe("costTier", () => {
    it("returns $ for cost 1", () => {
      expect(costTier(1)).toBe("$");
    });

    it("returns $$ for cost 2", () => {
      expect(costTier(2)).toBe("$$");
    });

    it("returns $$$ for cost 3", () => {
      expect(costTier(3)).toBe("$$$");
    });

    it("returns $$$$ for cost 4", () => {
      expect(costTier(4)).toBe("$$$$");
    });

    it("returns $$$$$ for cost 5", () => {
      expect(costTier(5)).toBe("$$$$$");
    });
  });
});
