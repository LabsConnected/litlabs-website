/**
 * image-ops — the editor's pure geometry/filter/history core.
 * Canvas render is intentionally excluded (jsdom has no 2d context).
 */
import { describe, expect, it } from "vitest";
import {
  clampCrop, canRedo, canUndo, currentOps, defaultOps, filterString,
  opsAreIdentity, outputSize, pushOp, redoOp, resizeKeepingAspect, undoOp,
} from "./image-ops";

describe("crop + output geometry", () => {
  it("clamps crop inside source bounds and rejects degenerate rects", () => {
    expect(clampCrop({ x: -10, y: -10, w: 50, h: 50 }, 100, 100)).toEqual({ x: 0, y: 0, w: 50, h: 50 });
    expect(clampCrop({ x: 90, y: 90, w: 50, h: 50 }, 100, 100)).toEqual({ x: 90, y: 90, w: 10, h: 10 });
    expect(clampCrop({ x: 0, y: 0, w: 1, h: 1 }, 100, 100)).toBeNull();
  });

  it("rotate 90/270 swaps dimensions", () => {
    const ops = { ...defaultOps(), rotate: 90 as const };
    expect(outputSize(ops, 400, 200)).toEqual({ w: 200, h: 400 });
    expect(outputSize({ ...ops, rotate: 180 }, 400, 200)).toEqual({ w: 400, h: 200 });
  });

  it("crop then rotate composes in the right order", () => {
    const ops = { ...defaultOps(), crop: { x: 0, y: 0, w: 100, h: 50 }, rotate: 90 as const };
    expect(outputSize(ops, 400, 200)).toEqual({ w: 50, h: 100 });
  });

  it("explicit resize overrides", () => {
    const ops = { ...defaultOps(), resize: { w: 320, h: 240 } };
    expect(outputSize(ops, 4000, 2000)).toEqual({ w: 320, h: 240 });
  });
});

describe("filters + identity", () => {
  it("identity ops produce no filter string", () => {
    expect(filterString(defaultOps().filters)).toBe("");
    expect(opsAreIdentity(defaultOps())).toBe(true);
  });

  it("only non-default filters render", () => {
    const s = filterString({ brightness: 120, contrast: 100, saturate: 80, grayscale: 0, sepia: 0, blur: 4 });
    expect(s).toBe("brightness(120%) saturate(80%) blur(4px)");
  });

  it("resize keeps aspect when locked", () => {
    expect(resizeKeepingAspect({ w: 400, h: 200 }, "w", 200)).toEqual({ w: 200, h: 100 });
    expect(resizeKeepingAspect({ w: 400, h: 200 }, "h", 400)).toEqual({ w: 800, h: 400 });
  });
});

describe("op history (undo/redo)", () => {
  it("pushes, undoes, redoes and truncates the redo tail on new ops", () => {
    let h = { stack: [defaultOps()], index: 0 };
    const rotated = { ...defaultOps(), rotate: 90 as const };
    const flipped = { ...defaultOps(), flipH: true };
    h = pushOp(h, rotated);
    h = pushOp(h, flipped);
    expect(currentOps(h).flipH).toBe(true);
    expect(canUndo(h)).toBe(true);

    h = undoOp(h);
    expect(currentOps(h).rotate).toBe(90);
    h = redoOp(h);
    expect(currentOps(h).flipH).toBe(true);

    h = undoOp(h);
    const darker = { ...defaultOps(), filters: { ...defaultOps().filters, brightness: 50 } };
    h = pushOp(h, darker); // new op drops the redo tail
    expect(canRedo(h)).toBe(false);
    expect(currentOps(h).filters.brightness).toBe(50);
  });

  it("undo stops at the first op", () => {
    const h = { stack: [defaultOps()], index: 0 };
    expect(canUndo(h)).toBe(false);
    expect(undoOp(h)).toEqual(h);
  });
});
