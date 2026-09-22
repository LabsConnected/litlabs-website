/**
 * Job step provenance — advanceProgress records the exact URL visited
 * and prunes older screenshots so the Studio card can only ever show a
 * screenshot captioned with the URL it was actually captured at.
 */
import { describe, it, expect } from "vitest";
import { buildInitialProgress, advanceProgress } from "../browser-jobs";

describe("advanceProgress provenance", () => {
  it("records the exact URL visited on a step", () => {
    const p = advanceProgress(
      buildInitialProgress(["Start", "Navigate"]),
      1,
      "completed",
      undefined,
      { url: "https://app.gohighlevel.com/v2/location/abc/workflows" },
    );
    expect(p.steps[1].url).toBe("https://app.gohighlevel.com/v2/location/abc/workflows");
    expect(p.steps[0].url).toBeUndefined();
  });

  it("attaches a screenshot to a step", () => {
    const p = advanceProgress(buildInitialProgress(["A", "B"]), 0, "completed", undefined, {
      url: "https://example.com",
      screenshotUrl: "data:image/png;base64,AAA",
    });
    expect(p.steps[0].screenshotUrl).toBe("data:image/png;base64,AAA");
    expect(p.steps[0].url).toBe("https://example.com");
  });

  it("prunes older screenshots when a newer one arrives (payload stays small)", () => {
    let p = advanceProgress(buildInitialProgress(["A", "B", "C"]), 0, "completed", undefined, {
      screenshotUrl: "data:image/png;base64,OLD",
    });
    expect(p.steps[0].screenshotUrl).toBe("data:image/png;base64,OLD");
    p = advanceProgress(p, 1, "completed", undefined, {
      url: "https://example.com/b",
      screenshotUrl: "data:image/png;base64,NEW",
    });
    expect(p.steps[1].screenshotUrl).toBe("data:image/png;base64,NEW");
    expect(p.steps[1].url).toBe("https://example.com/b");
    // Older frame is gone — the card can never show a stale screenshot.
    expect(p.steps[0].screenshotUrl).toBeUndefined();
  });

  it("does not prune when no new screenshot is recorded", () => {
    let p = advanceProgress(buildInitialProgress(["A", "B"]), 0, "completed", undefined, {
      screenshotUrl: "data:image/png;base64,KEEP",
    });
    p = advanceProgress(p, 1, "running", undefined, { url: "https://example.com/b" });
    expect(p.steps[0].screenshotUrl).toBe("data:image/png;base64,KEEP");
    expect(p.steps[1].screenshotUrl).toBeUndefined();
  });

  it("backwards compatible — extras are optional", () => {
    const p = advanceProgress(buildInitialProgress(["A"]), 0, "running", "Working");
    expect(p.steps[0].status).toBe("running");
    expect(p.steps[0].detail).toBe("Working");
    expect(p.steps[0].url).toBeUndefined();
    expect(p.steps[0].screenshotUrl).toBeUndefined();
  });
});
