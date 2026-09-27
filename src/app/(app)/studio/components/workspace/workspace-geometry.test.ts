import { describe, expect, it } from "vitest";
import { MIN_WINDOW_HEIGHT, MIN_WINDOW_WIDTH } from "@/lib/studio/workspace-document";
import { isTypingTarget, moveFrame, resizeFrame, snapFrame, zoomAtPoint } from "./workspace-geometry";

describe("workspace geometry", () => {
  it("snaps a move to the 8px grid and keeps the minimum window size", () => {
    const frame = { x: 10, y: 10, width: 360, height: 280 };
    expect(moveFrame(frame, 3, 5)).toEqual({ x: 16, y: 16, width: 360, height: 280 });
    expect(resizeFrame(frame, "se", -400, -400)).toMatchObject({ width: MIN_WINDOW_WIDTH, height: MIN_WINDOW_HEIGHT });
    expect(snapFrame(frame).x).toBe(8);
  });

  it("ignores shortcuts inside inputs, textareas, contenteditable, and xterm", () => {
    const input = globalThis.document.createElement("input");
    const area = globalThis.document.createElement("textarea");
    const editable = globalThis.document.createElement("div");
    editable.setAttribute("contenteditable", "true");
    const term = globalThis.document.createElement("div");
    term.className = "xterm";
    const termInner = globalThis.document.createElement("div");
    term.appendChild(termInner);
    globalThis.document.body.append(input, area, editable, term);
    expect(isTypingTarget(input)).toBe(true);
    expect(isTypingTarget(area)).toBe(true);
    expect(isTypingTarget(editable)).toBe(true);
    expect(isTypingTarget(termInner)).toBe(true);
    const plain = globalThis.document.createElement("div");
    expect(isTypingTarget(plain)).toBe(false);
  });

  it("zooms around the pointer instead of the canvas origin", () => {
    const next = zoomAtPoint({ x: 0, y: 0, zoom: 1 }, { x: 100, y: 40 }, -1);
    expect(next.zoom).toBeGreaterThan(1);
    expect(next.x).not.toBe(0);
    expect(next.y).not.toBe(0);
  });
});
