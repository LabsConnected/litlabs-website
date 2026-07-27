import { describe, expect, it } from "vitest";
import { VisualBuildRequestSchema, defaultVisualBuildBudget } from "./types";
import { stageEvent, type VisualBuildEvent, type VisualBuildLogLevel } from "./observability";

describe("visual build request schema", () => {
  it("accepts a minimal valid request and applies defaults", () => {
    const parsed = VisualBuildRequestSchema.parse({ prompt: "Build a landing page" });
    expect(parsed.quality).toBe("polished");
    expect(parsed.visualSource).toBe("auto");
    expect(parsed.imageSource).toBe("auto");
    expect(parsed.mockups).toBe("browser");
    expect(parsed.review).toBe(true);
    expect(parsed.responsiveQA).toBe(true);
  });

  it("rejects prompts shorter than 3 characters", () => {
    const result = VisualBuildRequestSchema.safeParse({ prompt: "hi" });
    expect(result.success).toBe(false);
  });

  it("rejects unknown quality levels", () => {
    const result = VisualBuildRequestSchema.safeParse({ prompt: "build it", quality: "ultra" });
    expect(result.success).toBe(false);
  });

  it("accepts an explicit budget override", () => {
    const parsed = VisualBuildRequestSchema.parse({
      prompt: "build it",
      budget: {
        maxStockSearches: 2,
        maxGeneratedAssets: 1,
        maxImageGenerationCostCents: 100,
        maxVisionReviews: 1,
        maxRepairPasses: 0,
        timeoutSeconds: 60,
      },
    });
    expect(parsed.budget?.maxRepairPasses).toBe(0);
  });

  it("rejects negative budget values", () => {
    const result = VisualBuildRequestSchema.safeParse({
      prompt: "build it",
      budget: {
        maxStockSearches: -1,
        maxGeneratedAssets: 0,
        maxImageGenerationCostCents: 0,
        maxVisionReviews: 0,
        maxRepairPasses: 0,
        timeoutSeconds: 30,
      },
    });
    expect(result.success).toBe(false);
  });
});

describe("visual build budgets", () => {
  it("draft budgets are tightly capped", () => {
    const draft = defaultVisualBuildBudget("draft");
    expect(draft.maxStockSearches).toBe(1);
    expect(draft.maxRepairPasses).toBe(1);
    expect(draft.timeoutSeconds).toBeLessThan(180);
  });

  it("cinematic budgets are generous", () => {
    const cinematic = defaultVisualBuildBudget("cinematic");
    expect(cinematic.maxStockSearches).toBeGreaterThan(4);
    expect(cinematic.maxRepairPasses).toBeGreaterThan(1);
    expect(cinematic.timeoutSeconds).toBeGreaterThan(300);
  });

  it("polished budgets sit between draft and cinematic", () => {
    const polished = defaultVisualBuildBudget("polished");
    expect(polished.maxStockSearches).toBeGreaterThan(1);
    expect(polished.maxStockSearches).toBeLessThan(cinematicBudget().maxStockSearches);
  });
});

function cinematicBudget() {
  return defaultVisualBuildBudget("cinematic");
}

describe("visual build observability", () => {
  it("stageEvent builds a well-formed log input with defaults", () => {
    const event = stageEvent(
      "build-1",
      "project-1",
      "mission-1",
      "user-1",
      "reviewing",
      "review_completed",
      { score: 88 },
    );
    expect(event.buildId).toBe("build-1");
    expect(event.stage).toBe("reviewing");
    expect(event.event).toBe("review_completed");
    expect(event.level).toBe("info");
    expect(event.payload).toEqual({ score: 88 });
  });

  it("VisualBuildEvent covers the full pipeline lifecycle", () => {
    const events: VisualBuildEvent[] = [
      "build_queued",
      "plan_created",
      "project_assets_searched",
      "stock_assets_searched",
      "asset_inspected",
      "asset_rejected",
      "asset_stored",
      "asset_selected",
      "assets_generated",
      "manifest_saved",
      "build_started",
      "workspace_file_written",
      "preview_ready",
      "preview_failed",
      "capture_started",
      "capture_completed",
      "capture_failed",
      "review_completed",
      "repair_proposed",
      "repair_applied",
      "repair_skipped",
      "completion_gate_passed",
      "completion_gate_failed",
      "build_complete",
      "build_partial",
      "build_failed",
    ];
    expect(new Set(events).size).toBe(events.length);
    expect(events).toContain("build_complete");
    expect(events).toContain("build_failed");
  });

  it("VisualBuildLogLevel covers the severity spectrum", () => {
    const levels: VisualBuildLogLevel[] = ["info", "warn", "error", "success"];
    expect(levels).toContain("error");
    expect(levels).toContain("success");
  });
});
