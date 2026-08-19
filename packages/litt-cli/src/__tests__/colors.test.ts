/**
 * Tests for the semantic color system.
 *
 * Verifies that:
 *   - LiTT brand is warm amber/orange (the ONE controlled accent)
 *   - Content text is warm near-white (never pure white)
 *   - Metadata is gray; dim gray for de-emphasis
 *   - Success is muted green
 *   - Working is warm amber
 *   - Warning is muted amber
 *   - Failure is muted red
 *   - Info is muted blue
 *   - State colors map correctly
 *   - Activity tags map correctly
 */

import { describe, it, expect } from "vitest";
import { COLORS, stateColor, activityColor, healthColor, costTier } from "../ink/colors.js";

describe("colors", () => {
  describe("COLORS constants", () => {
    it("brand is warm amber/orange", () => {
      expect(COLORS.brand).toBe("#ff9e64");
    });

    it("success is muted green", () => {
      expect(COLORS.success).toBe("#9ece6a");
    });

    it("working is warm amber", () => {
      expect(COLORS.working).toBe("#ffb454");
    });

    it("warning is muted amber", () => {
      expect(COLORS.warning).toBe("#e0af68");
    });

    it("error is muted red", () => {
      expect(COLORS.error).toBe("#f7768e");
    });

    it("secondary is medium gray", () => {
      expect(COLORS.secondary).toBe("#8d897f");
    });

    it("secondaryDim is dim gray", () => {
      expect(COLORS.secondaryDim).toBe("#5f5c55");
    });

    it("content text is warm near-white — not pure white", () => {
      expect(COLORS.text).toBe("#e4e1da");
      expect(COLORS.text).not.toBe("white");
    });

    it("user text is brighter than metadata", () => {
      expect(COLORS.textBright).toBe("#f7f5f0");
      expect(COLORS.textBright.length).toBe(7);
    });
  });

  describe("stateColor", () => {
    it("IDLE/READY → brand", () => {
      expect(stateColor("IDLE")).toBe(COLORS.brand);
    });

    it("working states → working (amber)", () => {
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
    it("working tags → amber", () => {
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

    it("warning tags → amber", () => {
      expect(activityColor("WARN")).toBe(COLORS.warning);
      expect(activityColor("APPROVAL")).toBe(COLORS.warning);
    });

    it("brand tags → amber", () => {
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
