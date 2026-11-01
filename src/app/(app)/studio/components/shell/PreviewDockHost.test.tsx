import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { useState } from "react";
import "@testing-library/jest-dom";
import PreviewDockHost from "./PreviewDockHost";
import { usePreviewDock } from "../../hooks/usePreviewDock";
import {
  PREVIEW_DOCK_KEY,
  PREVIEW_FLOAT_RECT_KEY,
  clampFloatRect,
  isPreviewPlacement,
  readStoredPlacement,
  type PreviewPlacement,
} from "../../lib/preview-dock";

function Harness({ initial }: { initial?: PreviewPlacement }) {
  const dock = usePreviewDock();
  const [forced, setForced] = useState<PreviewPlacement | null>(initial ?? null);
  const placement = forced ?? dock.placement;
  return (
    <div>
      <PreviewDockHost
        placement={placement}
        dockWidth={dock.dockWidth}
        splitFraction={dock.splitFraction}
        onDockWidthChange={dock.setDockWidth}
        onSplitFractionChange={dock.setSplitFraction}
        floatRect={dock.floatRect}
        floatMinimized={dock.floatMinimized}
        chatExpanded={dock.chatExpanded}
        onFloatRectChange={dock.setFloatRect}
        onFloatMinimizedChange={dock.setFloatMinimized}
        onChatExpandedChange={dock.setChatExpanded}
        onPlacementChange={(p) => { setForced(p); dock.setPlacement(p); }}
      >
        <div data-testid="preview-child">child</div>
      </PreviewDockHost>
      <button data-testid="set-left" onClick={() => { setForced("left"); dock.setPlacement("left"); }} />
      <button data-testid="set-float" onClick={() => { setForced("float"); dock.setPlacement("float"); }} />
      <button data-testid="set-full" onClick={() => { setForced("fullscreen"); dock.setPlacement("fullscreen"); }} />
      <button data-testid="set-chat" onClick={() => { setForced("chat"); dock.setPlacement("chat"); }} />
      <button data-testid="set-split" onClick={() => { setForced("split"); dock.setPlacement("split"); }} />
      <button data-testid="reset" onClick={() => { setForced(null); dock.reset(); }} />
    </div>
  );
}

describe("preview-dock lib", () => {
  it("validates placements", () => {
    expect(isPreviewPlacement("right")).toBe(true);
    expect(isPreviewPlacement("float")).toBe(true);
    expect(isPreviewPlacement("bogus")).toBe(false);
    expect(isPreviewPlacement(null)).toBe(false);
  });

  it("defaults to right with empty/corrupt storage", () => {
    localStorage.removeItem(PREVIEW_DOCK_KEY);
    expect(readStoredPlacement()).toBe("right");
    localStorage.setItem(PREVIEW_DOCK_KEY, "bogus");
    expect(readStoredPlacement()).toBe("right");
  });

  it("clamps float rects to the viewport", () => {
    const r = clampFloatRect({ x: -50, y: 9999, w: 10, h: 99999 }, 800, 600);
    expect(r.x).toBeGreaterThanOrEqual(0);
    expect(r.y).toBeLessThanOrEqual(552);
    expect(r.w).toBeGreaterThanOrEqual(320);
    expect(r.h).toBeLessThanOrEqual(584);
  });
});

describe("PreviewDockHost", () => {
  beforeEach(() => {
    localStorage.clear();
    window.innerWidth = 1440;
    window.innerHeight = 900;
  });

  it("renders edge-docked hosts without unmounting children", () => {
    render(<Harness />);
    const host = screen.getByTestId("preview-dock-host");
    expect(host).toHaveAttribute("data-placement", "right");
    expect(host.style.width).toBe("560px");
    const child = screen.getByTestId("preview-child");
    fireEvent.click(screen.getByTestId("set-left"));
    expect(screen.getByTestId("preview-dock-host")).toHaveAttribute("data-placement", "left");
    // Same child element across the transition — no remount.
    expect(screen.getByTestId("preview-child")).toBe(child);
    expect(localStorage.getItem(PREVIEW_DOCK_KEY)).toBe("left");
  });

  it("persists placement changes to localStorage", () => {
    render(<Harness />);
    fireEvent.click(screen.getByTestId("set-float"));
    expect(localStorage.getItem(PREVIEW_DOCK_KEY)).toBe("float");
    fireEvent.click(screen.getByTestId("set-split"));
    expect(localStorage.getItem(PREVIEW_DOCK_KEY)).toBe("split");
  });

  it("float mode supports minimize/restore and dock-back", () => {
    render(<Harness initial="float" />);
    const host = screen.getByTestId("preview-dock-host");
    expect(host).toHaveAttribute("data-minimized", "false");
    fireEvent.click(screen.getByTestId("preview-float-minimize"));
    expect(screen.getByTestId("preview-dock-host")).toHaveAttribute("data-minimized", "true");
    expect(screen.queryByTestId("preview-child")).toBeTruthy(); // still mounted (child exists in tree)
    fireEvent.click(screen.getByTestId("preview-float-minimize"));
    expect(screen.getByTestId("preview-dock-host")).toHaveAttribute("data-minimized", "false");
    fireEvent.click(screen.getByTestId("preview-float-dock"));
    expect(screen.getByTestId("preview-dock-host")).toHaveAttribute("data-placement", "right");
  });

  it("float drag moves the window and persists the rect", () => {
    render(<Harness initial="float" />);
    const grip = screen.getByTestId("preview-float-grip");
    // jsdom PointerEvent init drops clientX — MouseEvent carries it while
    // still matching "pointer*" listeners by type name.
    fireEvent(grip, new MouseEvent("pointerdown", { clientX: 100, clientY: 100, bubbles: true }));
    fireEvent(window, new MouseEvent("pointermove", { clientX: 160, clientY: 140, bubbles: true }));
    fireEvent(window, new MouseEvent("pointerup", { bubbles: true }));
    const stored = JSON.parse(localStorage.getItem(PREVIEW_FLOAT_RECT_KEY) ?? "{}");
    expect(stored.x).toBe(156);
    expect(stored.y).toBe(136);
  });

  it("chat mode renders an expandable card bar", () => {
    render(<Harness initial="chat" />);
    const host = screen.getByTestId("preview-dock-host");
    expect(host).toHaveAttribute("data-placement", "chat");
    expect(host).toHaveAttribute("data-expanded", "false");
    fireEvent.click(screen.getByTestId("preview-chat-expand"));
    expect(screen.getByTestId("preview-dock-host")).toHaveAttribute("data-expanded", "true");
  });

  it("fullscreen mode covers the workspace", () => {
    render(<Harness initial="fullscreen" />);
    const host = screen.getByTestId("preview-dock-host");
    expect(host).toHaveAttribute("data-placement", "fullscreen");
    expect(host.style.position).toBe("fixed");
    expect(host.style.inset).toBe("0");
  });

  it("split mode sizes to the split fraction", () => {
    render(<Harness initial="split" />);
    const host = screen.getByTestId("preview-dock-host");
    expect(host).toHaveAttribute("data-placement", "split");
    expect(host.style.width).toBe("720px"); // 50% of 1440
  });

  it("edge dock exposes a resize separator", () => {
    render(<Harness />);
    expect(screen.getByTestId("preview-dock-resize")).toBeTruthy();
    fireEvent(screen.getByTestId("preview-dock-resize"), new MouseEvent("pointerdown", { clientX: 880, bubbles: true }));
    fireEvent(window, new MouseEvent("pointermove", { clientX: 830, bubbles: true }));
    fireEvent(window, new MouseEvent("pointerup", { bubbles: true }));
    expect(screen.getByTestId("preview-dock-host").style.width).toBe("610px");
  });

  it("reset restores defaults", () => {
    render(<Harness />);
    fireEvent.click(screen.getByTestId("set-float"));
    fireEvent.click(screen.getByTestId("reset"));
    expect(screen.getByTestId("preview-dock-host")).toHaveAttribute("data-placement", "right");
    expect(localStorage.getItem(PREVIEW_DOCK_KEY)).toBeNull();
  });
});
