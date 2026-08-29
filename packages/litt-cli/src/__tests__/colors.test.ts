/**
 * Tests for the semantic color system.
 *
 * Verifies that:
 *   - LiTT brand is purple (the ONE identity accent)
 *   - Gold is reserved for approvals / high-value attention (never decorative)
 *   - Content text is clean neutral near-white (no warm tint)
 *   - Metadata is slate gray; dim gray for de-emphasis
 *   - Success is bright green
 *   - Working is LiTT purple (identity)
 *   - Warning is amber — distinct from approval gold
 *   - Failure is soft red
 *   - Info is bright purple
 *   - State colors map correctly
 *   - Activity tags map correctly
 */

import { describe, it, expect } from "vitest";
import { COLORS, stateColor, activityColor, healthColor, costTier } from "../ink/colors.js";

describe("colors", () => {
  describe("COLORS constants", () => {
    it("brand is LiTT purple", () => {
      expect(COLORS.brand).toBe("#A855F7");
    });

    it("success is bright green", () => {
      expect(COLORS.success).toBe("#4ADE80");
    });

    it("working is LiTT purple (identity)", () => {
      expect(COLORS.working).toBe(COLORS.brand);
    });

    it("warning is amber", () => {
      expect(COLORS.warning).toBe("#FBBF24");
    });

    it("gold is reserved for approvals and differs from warning amber", () => {
      expect(COLORS.gold).toBe("#F5C451");
      expect(COLORS.gold).not.toBe(COLORS.warning);
    });

    it("error is soft red", () => {
      expect(COLORS.error).toBe("#F87171");
    });

    it("secondary is muted slate gray", () => {
      expect(COLORS.secondary).toBe("#8B8FA3");
    });

    it("secondaryDim is dim gray", () => {
      expect(COLORS.secondaryDim).toBe("#5C5F6E");
    });

    it("content text is clean neutral near-white — not pure white", () => {
      expect(COLORS.text).toBe("#F4F4F5");
      expect(COLORS.text).not.toBe("white");
    });

    it("user text is brighter than metadata", () => {
      expect(COLORS.textBright).toBe("#FAFAFA");
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

    it("APPROVAL → gold (reserved for approvals, not generic warning amber)", () => {
      expect(stateColor("APPROVAL")).toBe(COLORS.gold);
      expect(stateColor("APPROVAL")).not.toBe(COLORS.warning);
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
    });

    it("approval tags → gold (distinct from warning amber)", () => {
      expect(activityColor("APPROVAL")).toBe(COLORS.gold);
      expect(activityColor("APPROVAL")).not.toBe(COLORS.warning);
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
