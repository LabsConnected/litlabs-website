import { beforeAll, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { DirectManipulationCanvas, type DirectCommit } from "./DirectManipulationCanvas";

// jsdom does not implement PointerEvent, so testing-library would otherwise
// dispatch a plain Event and drop clientX/button/pointerId.
beforeAll(() => {
  if (typeof window.PointerEvent === "function") return;
  class PointerEventPolyfill extends MouseEvent {
    pointerId: number;
    pointerType: string;
    width: number;
    height: number;
    pressure: number;
    isPrimary: boolean;
    constructor(type: string, init: PointerEventInit = {}) {
      super(type, init);
      this.pointerId = init.pointerId ?? 0;
      this.pointerType = init.pointerType ?? "mouse";
      this.width = init.width ?? 1;
      this.height = init.height ?? 1;
      this.pressure = init.pressure ?? 0;
      this.isPrimary = init.isPrimary ?? true;
    }
  }
  Object.defineProperty(window, "PointerEvent", { configurable: true, writable: true, value: PointerEventPolyfill });
});

function setup(onCommit?: (commit: DirectCommit) => void) {
  render(
    <div>
      <input data-testid="typing-field" />
      <textarea data-testid="typing-area" />
      <div data-testid="typing-editable" contentEditable />
      <div style={{ width: 800, height: 600 }}>
        <DirectManipulationCanvas onCommit={onCommit} />
      </div>
    </div>,
  );
}

describe("DirectManipulationCanvas keyboard", () => {
  it("selects an element and shows corner and edge handles", () => {
    setup();
    fireEvent.click(screen.getByTestId("canvas-element-hero"));
    expect(screen.getByTestId("selection-chrome")).toBeInTheDocument();
    for (const handle of ["n", "s", "e", "w", "nw", "ne", "sw", "se"]) {
      expect(screen.getByTestId(`resize-handle-${handle}`)).toBeInTheDocument();
    }
  });

  it("nudges the selection 1px, or 10px with shift, and escape deselects", () => {
    const onCommit = vi.fn();
    setup(onCommit);
    fireEvent.click(screen.getByTestId("canvas-element-hero"));

    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(onCommit).toHaveBeenCalledWith(expect.objectContaining({
      element: expect.objectContaining({ id: "hero", x: 49, y: 36 }),
      patch: expect.objectContaining({
        styles: expect.objectContaining({ width: "320px", height: "72px", left: "49px" }),
      }),
    }));

    fireEvent.keyDown(window, { key: "ArrowDown", shiftKey: true });
    expect(onCommit).toHaveBeenLastCalledWith(expect.objectContaining({
      element: expect.objectContaining({ id: "hero", x: 49, y: 46 }),
    }));

    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByTestId("selection-chrome")).not.toBeInTheDocument();
  });

  it("does not nudge or deselect while typing in inputs, textareas, or contenteditable", () => {
    const onCommit = vi.fn();
    setup(onCommit);
    fireEvent.click(screen.getByTestId("canvas-element-cta"));

    fireEvent.keyDown(screen.getByTestId("typing-field"), { key: "ArrowRight" });
    fireEvent.keyDown(screen.getByTestId("typing-area"), { key: "ArrowLeft", shiftKey: true });
    fireEvent.keyDown(screen.getByTestId("typing-editable"), { key: "Escape" });

    expect(onCommit).not.toHaveBeenCalled();
    expect(screen.getByTestId("selection-chrome")).toBeInTheDocument();
  });

  it("resizes from a handle and commits an inspector style patch", () => {
    const onCommit = vi.fn();
    setup(onCommit);
    fireEvent.click(screen.getByTestId("canvas-element-copy"));
    const handle = screen.getByTestId("resize-handle-e");
    fireEvent.pointerDown(handle, { pointerId: 1, button: 0, clientX: 100, clientY: 40 });
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 140, clientY: 40 });
    fireEvent.pointerUp(handle, { pointerId: 1, clientX: 140, clientY: 40 });

    expect(onCommit).toHaveBeenCalledWith(expect.objectContaining({
      element: expect.objectContaining({ id: "copy", width: 320, height: 64 }),
      patch: {
        styles: {
          position: "absolute",
          left: "48px",
          top: "128px",
          width: "320px",
          height: "64px",
        },
      },
    }));
  });
});
