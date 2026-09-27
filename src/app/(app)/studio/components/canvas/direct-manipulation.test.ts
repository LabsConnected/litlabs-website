import { describe, expect, it } from "vitest";
import { applyElementPatch } from "../../lib/element-edits";
import {
  MIN_ELEMENT_SIZE,
  applyGesture,
  canvasKeyAction,
  geometryToStylePatch,
  isCanvasShown,
  isPrimaryPointerButton,
  isTypingTarget,
  moveBox,
  nudgeBox,
  panBy,
  resizeBox,
  screenDeltaToCanvas,
  zoomByWheel,
  zoomPercentByWheel,
  type Box,
} from "./direct-manipulation";

const START: Box = { x: 10, y: 20, width: 200, height: 100 };

describe("direct manipulation geometry", () => {
  it("moves a box by the pointer delta", () => {
    expect(moveBox(START, 15, -4)).toEqual({ x: 25, y: 16, width: 200, height: 100 });
  });

  it("resizes from the east and south edges without moving the origin", () => {
    expect(resizeBox(START, "e", 40, 0)).toEqual({ x: 10, y: 20, width: 240, height: 100 });
    expect(resizeBox(START, "s", 0, 25)).toEqual({ x: 10, y: 20, width: 200, height: 125 });
  });

  it("resizes from the west and north edges and keeps the opposite edge fixed", () => {
    expect(resizeBox(START, "w", 30, 0)).toEqual({ x: 40, y: 20, width: 170, height: 100 });
    expect(resizeBox(START, "n", 0, 10)).toEqual({ x: 10, y: 30, width: 200, height: 90 });
  });

  it("resizes a corner from both axes", () => {
    expect(resizeBox(START, "se", 20, 10)).toEqual({ x: 10, y: 20, width: 220, height: 110 });
    expect(resizeBox(START, "nw", 20, 10)).toEqual({ x: 30, y: 30, width: 180, height: 90 });
  });

  it("locks aspect ratio when shift is held", () => {
    const east = resizeBox(START, "e", 100, 0, { lockAspect: true });
    expect(east.width).toBe(300);
    expect(east.height).toBe(150);
    expect(east.x).toBe(10);
    expect(east.y).toBe(20 + (100 - 150) / 2);

    const corner = resizeBox(START, "se", 100, 0, { lockAspect: true });
    expect(corner.width / corner.height).toBeCloseTo(2, 5);
    expect(corner.x).toBe(10);
    expect(corner.y).toBe(20);
  });

  it("enforces a minimum size and keeps the anchored edge put", () => {
    const shrunk = resizeBox(START, "w", 500, 0, { min: MIN_ELEMENT_SIZE });
    expect(shrunk.width).toBe(MIN_ELEMENT_SIZE);
    expect(shrunk.x).toBe(START.x + START.width - MIN_ELEMENT_SIZE);
    expect(shrunk.height).toBe(START.height);

    const flat = resizeBox(START, "n", 0, 500, { min: 24 });
    expect(flat.height).toBe(24);
    expect(flat.y).toBe(START.y + START.height - 24);
  });

  it("nudges 1px, or 10px with shift", () => {
    expect(nudgeBox(START, "ArrowRight", false)).toMatchObject({ x: 11, y: 20 });
    expect(nudgeBox(START, "ArrowLeft", true)).toMatchObject({ x: 0 });
    expect(nudgeBox(START, "ArrowUp", false)).toMatchObject({ y: 19 });
    expect(nudgeBox(START, "ArrowDown", true)).toMatchObject({ y: 30 });
  });

  it("applies move and resize gestures with the same delta contract", () => {
    expect(applyGesture(START, "move", 5, 6, false)).toMatchObject({ x: 15, y: 26 });
    expect(applyGesture(START, "e", 10, 0, false).width).toBe(210);
  });

  it("pans and converts screen deltas through zoom", () => {
    expect(panBy({ x: 0, y: 0 }, -12, 8)).toEqual({ x: -12, y: 8 });
    expect(screenDeltaToCanvas(20, 10, 2)).toEqual({ dx: 10, dy: 5 });
  });

  it("zooms with the wheel and stays inside the allowed range", () => {
    expect(zoomByWheel(1, -1)).toBeGreaterThan(1);
    expect(zoomByWheel(1, 1)).toBeLessThan(1);
    expect(zoomByWheel(0.25, 10)).toBe(0.25);
    expect(zoomByWheel(3, -10)).toBe(3);
    expect(zoomPercentByWheel(100, -1)).toBeGreaterThan(100);
    expect(zoomPercentByWheel(25, 50)).toBe(25);
    expect(zoomPercentByWheel(200, -50)).toBe(200);
  });

  it("writes the inspector's width/height/position style keys", () => {
    expect(geometryToStylePatch({ x: 12.4, y: 8.6, width: 200.2, height: 40.8 })).toEqual({
      styles: {
        position: "absolute",
        left: "12px",
        top: "9px",
        width: "200px",
        height: "41px",
      },
    });
  });

  it("persists a move through the same element patch the inspector uses", () => {
    const html = "<!DOCTYPE html><html><body><h1 id=\"hero\">Hi</h1></body></html>";
    const patch = geometryToStylePatch({ x: 12, y: 9, width: 200, height: 41 });
    const result = applyElementPatch(html, { selector: "#hero", tagName: "h1", attrs: { id: "hero" } }, patch);
    expect(result.ok).toBe(true);
    expect(result.html).toContain("width: 200px");
    expect(result.html).toContain("height: 41px");
    expect(result.html).toContain("left: 12px");
    expect(result.html).toContain("top: 9px");
    expect(result.changed.join(" ")).toContain("width");
  });
});

describe("canvas keyboard handling", () => {
  const idle = { shiftKey: false, metaKey: false, ctrlKey: false, altKey: false };

  it("nudges and deselects when the user is not typing", () => {
    expect(canvasKeyAction({ key: "ArrowRight", ...idle }, null)).toEqual({ type: "nudge", dx: 1, dy: 0 });
    expect(canvasKeyAction({ key: "ArrowUp", ...idle, shiftKey: true }, null)).toEqual({ type: "nudge", dx: 0, dy: -10 });
    expect(canvasKeyAction({ key: "Escape", ...idle }, null)).toEqual({ type: "deselect" });
    expect(canvasKeyAction({ key: " ", ...idle }, null)).toEqual({ type: "space" });
  });

  it("ignores canvas keys while typing in inputs, textareas, and contenteditable", () => {
    const input = document.createElement("input");
    const area = document.createElement("textarea");
    const editable = document.createElement("div");
    editable.setAttribute("contenteditable", "true");
    const nested = document.createElement("span");
    editable.appendChild(nested);
    expect(isTypingTarget(input)).toBe(true);
    expect(isTypingTarget(area)).toBe(true);
    expect(isTypingTarget(editable)).toBe(true);
    expect(isTypingTarget(nested)).toBe(true);
    expect(canvasKeyAction({ key: "ArrowRight", ...idle }, input)).toBeNull();
    expect(canvasKeyAction({ key: "Escape", ...idle }, area)).toBeNull();
    expect(canvasKeyAction({ key: "ArrowDown", ...idle, shiftKey: true }, editable)).toBeNull();
    expect(canvasKeyAction({ key: " ", ...idle }, nested)).toBeNull();
  });

  it("treats a missing pointer button as primary and ignores middle and right", () => {
    expect(isPrimaryPointerButton(undefined)).toBe(true);
    expect(isPrimaryPointerButton(null)).toBe(true);
    expect(isPrimaryPointerButton(0)).toBe(true);
    expect(isPrimaryPointerButton(1)).toBe(false);
    expect(isPrimaryPointerButton(2)).toBe(false);
  });

  it("hides canvases inside an inactive studio surface", () => {
    const hidden = document.createElement("div");
    hidden.className = "hidden";
    const canvas = document.createElement("div");
    hidden.appendChild(canvas);
    document.body.appendChild(hidden);
    expect(isCanvasShown(canvas)).toBe(false);

    const shown = document.createElement("div");
    document.body.appendChild(shown);
    expect(isCanvasShown(shown)).toBe(true);

    shown.style.display = "none";
    expect(isCanvasShown(shown)).toBe(false);

    hidden.remove();
    shown.remove();
  });

  it("does not treat modified arrow keys as nudges", () => {
    expect(canvasKeyAction({ key: "ArrowLeft", ...idle, metaKey: true }, null)).toBeNull();
    expect(canvasKeyAction({ key: "ArrowLeft", ...idle, ctrlKey: true }, null)).toBeNull();
  });
});
