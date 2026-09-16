import { describe, it, expect } from "vitest";
import { planDisplayLabel } from "./plan-label";
import { PLANS, type PlanId } from "@/config/plans";

describe("planDisplayLabel", () => {
  it("maps every real plan ID to a non-Free label", () => {
    const ids = Object.keys(PLANS) as PlanId[];
    expect(ids).toContain("starter");
    expect(ids).toContain("creator_beta");
    expect(ids).toContain("pro_builder_beta");
    expect(ids).toContain("founder");
    expect(ids).toContain("owner");
    for (const id of ids) {
      expect(planDisplayLabel(id)).not.toBe("Free");
    }
  });

  it("gives paying plans honest labels", () => {
    expect(planDisplayLabel("pro_builder_beta")).toBe("Pro Builder Beta");
    expect(planDisplayLabel("creator_beta")).toBe("Creator Beta");
    expect(planDisplayLabel("founder")).toBe("Founding Member");
    expect(planDisplayLabel("owner")).toBe("Owner");
    expect(planDisplayLabel("starter")).toBe("Starter");
  });

  it("renders genuinely free/unknown values as Free", () => {
    expect(planDisplayLabel("free")).toBe("Free");
    expect(planDisplayLabel(null)).toBe("Free");
    expect(planDisplayLabel(undefined)).toBe("Free");
    expect(planDisplayLabel("")).toBe("Free");
    // Legacy/non-plan values must not leak through unlabeled either.
    expect(planDisplayLabel("pro")).toBe("Free");
    expect(planDisplayLabel("enterprise")).toBe("Free");
  });
});
