import { describe, expect, it } from "vitest";
import { fitWithinBox } from "./canvas-fit";

describe("fitWithinBox", () => {
  it("fits a square source by the box height when the box is wider than tall", () => {
    expect(
      fitWithinBox(
        { width: 1024, height: 1024 },
        { width: 1000, height: 800 },
      ),
    ).toEqual({ width: 800, height: 800 });
  });

  it("fits a portrait source inside both box dimensions", () => {
    const fitted = fitWithinBox(
      { width: 768, height: 1344 },
      { width: 1000, height: 800 },
    );

    expect(fitted.width).toBeLessThanOrEqual(1000);
    expect(fitted.height).toBe(800);
    expect(fitted.width).toBe(457);
  });

  it("honors an additional maximum width without breaking the aspect ratio", () => {
    expect(
      fitWithinBox(
        { width: 1024, height: 1024 },
        { width: 1000, height: 1000 },
        720,
      ),
    ).toEqual({ width: 720, height: 720 });
  });

  it("does not upscale a smaller source and returns zero for an unmeasured box", () => {
    expect(
      fitWithinBox({ width: 320, height: 240 }, { width: 1000, height: 800 }),
    ).toEqual({ width: 320, height: 240 });
    expect(
      fitWithinBox({ width: 320, height: 240 }, { width: 0, height: 800 }),
    ).toEqual({ width: 0, height: 0 });
  });
});
