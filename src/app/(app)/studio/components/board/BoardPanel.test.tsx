import "@testing-library/jest-dom";
import { describe, expect, it, vi } from "vitest";

// jsdom has no PointerEvent constructor; fireEvent falls back to a
// generic Event that drops clientX/pointerId, which the drag sessions
// read. A MouseEvent-based stub carries both (test scaffolding only).
class PointerEventStub extends MouseEvent {
  pointerId: number;
  constructor(type: string, params: PointerEventInit & MouseEventInit = {}) {
    super(type, params);
    this.pointerId = params.pointerId ?? 0;
  }
}
globalThis.PointerEvent = PointerEventStub as typeof PointerEvent;
import { fireEvent, render, screen } from "@testing-library/react";
import { ThemeProvider } from "@/context/ThemeContext";
import BoardPanel from "./BoardPanel";
import type { BoardRect } from "./board-types";

const RECT: BoardRect = { x: 100, y: 80, width: 400, height: 300 };

function renderPanel(overrides: Partial<Parameters<typeof BoardPanel>[0]> = {}) {
  const handlers = {
    onRectChange: vi.fn(),
    onBringToFront: vi.fn(),
    onMinimize: vi.fn(),
    onToggleMaximize: vi.fn(),
    onClose: vi.fn(),
  };
  render(
    <ThemeProvider>
      <BoardPanel
        id="preview"
        title="Preview"
        rect={RECT}
        zIndex={3}
        maximized={false}
        {...handlers}
        {...overrides}
      >
        <div>panel body</div>
      </BoardPanel>
    </ThemeProvider>,
  );
  return handlers;
}

describe("BoardPanel chrome", () => {
  it("renders at the given rect and z-order with its title and body", () => {
    renderPanel();
    const panel = screen.getByTestId("board-panel-preview");
    expect(panel.style.left).toBe("100px");
    expect(panel.style.top).toBe("80px");
    expect(panel.style.width).toBe("400px");
    expect(panel.style.height).toBe("300px");
    expect(panel.style.zIndex).toBe("3");
    expect(screen.getByText("Preview")).toBeInTheDocument();
    expect(screen.getByText("panel body")).toBeInTheDocument();
  });

  it("pointer down anywhere on the panel brings it to the front", () => {
    const handlers = renderPanel();
    fireEvent.pointerDown(screen.getByTestId("board-panel-preview"), { pointerId: 1 });
    expect(handlers.onBringToFront).toHaveBeenCalledWith("preview");
  });

  it("dragging the header moves the panel by the pointer delta", () => {
    const handlers = renderPanel();
    const header = screen.getByTestId("board-panel-header-preview");
    fireEvent.pointerDown(header, { pointerId: 7, clientX: 150, clientY: 90 });
    fireEvent.pointerMove(window, { pointerId: 7, clientX: 190, clientY: 125 });
    expect(handlers.onRectChange).toHaveBeenCalledWith("preview", {
      x: 140,
      y: 115,
      width: 400,
      height: 300,
    });
    fireEvent.pointerUp(window, { pointerId: 7, clientX: 190, clientY: 125 });
    fireEvent.pointerMove(window, { pointerId: 7, clientX: 400, clientY: 400 });
    // Session ended on pointer-up — no further rect changes.
    expect(handlers.onRectChange).toHaveBeenCalledTimes(1);
  });

  it("dragging a marked drag-handle strip in the body moves the panel", () => {
    const handlers = {
      onRectChange: vi.fn(),
      onBringToFront: vi.fn(),
      onMinimize: vi.fn(),
      onToggleMaximize: vi.fn(),
      onClose: vi.fn(),
    };
    render(
      <ThemeProvider>
        <BoardPanel
          id="preview"
          title="Preview"
          rect={RECT}
          zIndex={3}
          maximized={false}
          {...handlers}
        >
          <div data-board-drag-handle>
            <span data-testid="drag-strip-label">strip</span>
            <button type="button" data-testid="drag-strip-button">
              strip button
            </button>
          </div>
        </BoardPanel>
      </ThemeProvider>,
    );
    const strip = screen.getByTestId("drag-strip-label");
    fireEvent.pointerDown(strip, { pointerId: 21, clientX: 150, clientY: 90 });
    fireEvent.pointerMove(window, { pointerId: 21, clientX: 190, clientY: 125 });
    expect(handlers.onRectChange).toHaveBeenCalledWith("preview", {
      x: 140,
      y: 115,
      width: 400,
      height: 300,
    });
    fireEvent.pointerUp(window, { pointerId: 21, clientX: 190, clientY: 125 });
    fireEvent.pointerMove(window, { pointerId: 21, clientX: 400, clientY: 400 });
    // Session ended on pointer-up — no further rect changes.
    expect(handlers.onRectChange).toHaveBeenCalledTimes(1);
  });

  it("a button inside the drag-handle strip does not start a drag, and its click still fires", () => {
    const onStripButton = vi.fn();
    const handlers = {
      onRectChange: vi.fn(),
      onBringToFront: vi.fn(),
      onMinimize: vi.fn(),
      onToggleMaximize: vi.fn(),
      onClose: vi.fn(),
    };
    render(
      <ThemeProvider>
        <BoardPanel
          id="preview"
          title="Preview"
          rect={RECT}
          zIndex={3}
          maximized={false}
          {...handlers}
        >
          <div data-board-drag-handle>
            <button type="button" data-testid="drag-strip-button" onClick={onStripButton}>
              strip button
            </button>
          </div>
        </BoardPanel>
      </ThemeProvider>,
    );
    const button = screen.getByTestId("drag-strip-button");
    fireEvent.pointerDown(button, { pointerId: 23, clientX: 150, clientY: 90 });
    // The press still bubbles to the panel's click-to-front…
    expect(handlers.onBringToFront).toHaveBeenCalledWith("preview");
    fireEvent.pointerMove(window, { pointerId: 23, clientX: 220, clientY: 160 });
    // …but no drag session starts from an interactive element.
    expect(handlers.onRectChange).not.toHaveBeenCalled();
    fireEvent.pointerUp(window, { pointerId: 23 });
    fireEvent.click(button);
    expect(onStripButton).toHaveBeenCalledTimes(1);
  });

  it("drag deltas are divided by the board scale so zoomed drags track 1:1", () => {
    const handlers = renderPanel({ scale: 0.5 });
    const header = screen.getByTestId("board-panel-header-preview");
    fireEvent.pointerDown(header, { pointerId: 3, clientX: 0, clientY: 0 });
    fireEvent.pointerMove(window, { pointerId: 3, clientX: 20, clientY: 10 });
    expect(handlers.onRectChange).toHaveBeenCalledWith("preview", {
      x: 140,
      y: 100,
      width: 400,
      height: 300,
    });
    fireEvent.pointerUp(window, { pointerId: 3 });
  });

  it("dragging the corner handle resizes instead of moving", () => {
    const handlers = renderPanel();
    const handle = screen.getByTestId("board-panel-resize-preview");
    fireEvent.pointerDown(handle, { pointerId: 9, clientX: 500, clientY: 380 });
    fireEvent.pointerMove(window, { pointerId: 9, clientX: 560, clientY: 430 });
    expect(handlers.onRectChange).toHaveBeenCalledWith("preview", {
      x: 100,
      y: 80,
      width: 460,
      height: 350,
    });
    fireEvent.pointerUp(window, { pointerId: 9 });
  });

  it("captures the pointer on drag start and releases it on pointer up (iframe-crossing fix)", () => {
    const handlers = renderPanel();
    const header = screen.getByTestId("board-panel-header-preview");
    const setCapture = vi.fn();
    const releaseCapture = vi.fn();
    header.setPointerCapture = setCapture;
    header.hasPointerCapture = () => true;
    header.releasePointerCapture = releaseCapture;
    fireEvent.pointerDown(header, { pointerId: 11, clientX: 150, clientY: 90 });
    // Capture is what keeps pointermove flowing to this document when
    // the drag crosses the Preview panel's cross-origin iframe.
    expect(setCapture).toHaveBeenCalledWith(11);
    fireEvent.pointerMove(window, { pointerId: 11, clientX: 190, clientY: 125 });
    expect(handlers.onRectChange).toHaveBeenCalledTimes(1);
    fireEvent.pointerUp(window, { pointerId: 11 });
    expect(releaseCapture).toHaveBeenCalledWith(11);
  });

  it("pointercancel ends the drag session — no leaked drag on the next move", () => {
    const handlers = renderPanel();
    const header = screen.getByTestId("board-panel-header-preview");
    fireEvent.pointerDown(header, { pointerId: 13, clientX: 150, clientY: 90 });
    fireEvent.pointerMove(window, { pointerId: 13, clientX: 190, clientY: 125 });
    expect(handlers.onRectChange).toHaveBeenCalledTimes(1);
    fireEvent.pointerCancel(window, { pointerId: 13 });
    fireEvent.pointerMove(window, { pointerId: 13, clientX: 400, clientY: 400 });
    expect(handlers.onRectChange).toHaveBeenCalledTimes(1);
  });

  it("minimize, maximize and close buttons fire their handlers (and do not start a drag)", () => {
    const handlers = renderPanel();
    fireEvent.click(screen.getByTestId("board-panel-minimize-preview"));
    expect(handlers.onMinimize).toHaveBeenCalledWith("preview");
    fireEvent.click(screen.getByTestId("board-panel-maximize-preview"));
    expect(handlers.onToggleMaximize).toHaveBeenCalledWith("preview");
    fireEvent.click(screen.getByTestId("board-panel-close-preview"));
    expect(handlers.onClose).toHaveBeenCalledWith("preview");
    expect(handlers.onRectChange).not.toHaveBeenCalled();
  });

  it("a maximized panel hides the resize handle and labels the button Restore", () => {
    renderPanel({ maximized: true });
    expect(screen.queryByTestId("board-panel-resize-preview")).toBeNull();
    expect(screen.getByLabelText("Restore Preview")).toBeInTheDocument();
  });
});
