import "@testing-library/jest-dom";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import StudioBrowserSideDock, {
  clampBrowserDockWidth,
} from "./StudioBrowserSideDock";

/**
 * Rail consolidation (Larry, 2026-11-25): the Regular layout's
 * Browser home is an on-demand side dock — right by default,
 * flippable (button or header drag across), resizable by its inner
 * divider, and poppable into a free floating panel.
 */

function renderDock(
  overrides: Partial<React.ComponentProps<typeof StudioBrowserSideDock>> = {},
) {
  const props: React.ComponentProps<typeof StudioBrowserSideDock> = {
    side: "right",
    onSideChange: vi.fn(),
    width: 420,
    onWidthChange: vi.fn(),
    free: false,
    onFreeChange: vi.fn(),
    onClose: vi.fn(),
    children: <div data-testid="browser-panel-slot">browser</div>,
    ...overrides,
  };
  return { props, ...render(<StudioBrowserSideDock {...props} />) };
}

/** jsdom's synthetic pointer events drop clientX — dispatch a real
    MouseEvent under the pointer event name so React's handler sees
    the coordinates. */
function pointer(el: Element, type: string, clientX: number, clientY = 10) {
  fireEvent(
    el,
    new window.MouseEvent(type, {
      bubbles: true,
      cancelable: true,
      clientX,
      clientY,
    }),
  );
}

describe("StudioBrowserSideDock", () => {
  it("renders docked on the given side with the browser as its child", () => {
    renderDock();
    const dock = screen.getByTestId("studio-browser-side-dock");
    expect(dock).toHaveAttribute("data-side", "right");
    expect(dock).toHaveAttribute("data-mode", "docked");
    expect(dock.style.width).toBe("420px");
    expect(screen.getByTestId("browser-panel-slot")).toBeInTheDocument();
  });

  it("flip button flips to the other side", () => {
    const { props } = renderDock();
    fireEvent.click(screen.getByTestId("browser-dock-flip"));
    expect(props.onSideChange).toHaveBeenCalledWith("left");
  });

  it("close button closes, pop-out button frees the panel", () => {
    const { props } = renderDock();
    fireEvent.click(screen.getByTestId("browser-dock-close"));
    expect(props.onClose).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByTestId("browser-dock-popout"));
    expect(props.onFreeChange).toHaveBeenCalledWith(true);
  });

  it("dragging the header across flips the dock side", () => {
    const { props } = renderDock();
    const header = screen.getByTestId("browser-dock-header");
    pointer(header, "pointerdown", 500);
    pointer(header, "pointermove", 300);
    expect(props.onSideChange).toHaveBeenCalledWith("left");
    pointer(header, "pointerup", 300);
  });

  it("a small header drag does not flip", () => {
    const { props } = renderDock();
    const header = screen.getByTestId("browser-dock-header");
    pointer(header, "pointerdown", 500);
    pointer(header, "pointermove", 450);
    expect(props.onSideChange).not.toHaveBeenCalled();
    pointer(header, "pointerup", 300);
  });

  it("dragging the inner divider resizes (right dock: drag left = wider)", () => {
    const { props } = renderDock();
    const grip = screen.getByTestId("browser-dock-resize");
    pointer(grip, "pointerdown", 400);
    pointer(grip, "pointermove", 350);
    expect(props.onWidthChange).toHaveBeenCalledWith(470);
    pointer(grip, "pointerup", 350);
  });

  it("free mode renders the floating panel anchored to its side", () => {
    renderDock({ free: true, side: "left" });
    const dock = screen.getByTestId("studio-browser-side-dock");
    expect(dock).toHaveAttribute("data-mode", "free");
    expect(dock).toHaveAttribute("data-side", "left");
    expect(dock.style.left).toBe("12px");
  });

  it("clampBrowserDockWidth enforces the min and max bounds", () => {
    expect(clampBrowserDockWidth(120)).toBe(300);
    expect(clampBrowserDockWidth(5000)).toBeLessThanOrEqual(720);
    expect(clampBrowserDockWidth(420)).toBe(420);
  });
});
