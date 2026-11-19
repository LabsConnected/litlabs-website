import "@testing-library/jest-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ThemeProvider } from "@/context/ThemeContext";
import BoardSettingsMenu from "./BoardSettingsMenu";
import { useBoardSettingsStore } from "../../stores/useBoardSettingsStore";

function renderMenu() {
  return render(
    <ThemeProvider>
      <BoardSettingsMenu />
    </ThemeProvider>,
  );
}

function openMenu() {
  fireEvent.click(screen.getByTestId("board-settings-button"));
}

beforeEach(() => {
  localStorage.clear();
  useBoardSettingsStore.getState().resetBoardSettings();
});

describe("BoardSettingsMenu (Amendment 5)", () => {
  it("is closed until its button is clicked, then shows every setting group", () => {
    renderMenu();
    expect(screen.queryByTestId("board-settings-menu")).toBeNull();
    openMenu();
    expect(screen.getByTestId("board-settings-menu")).toBeInTheDocument();
    // Open size options
    expect(screen.getByTestId("board-settings-open-size-full")).toBeChecked();
    expect(screen.getByTestId("board-settings-open-size-remember")).toBeInTheDocument();
    expect(screen.getByTestId("board-settings-open-size-smart")).toBeInTheDocument();
    // Maximize toggles, both on by default
    expect(screen.getByTestId("board-settings-maximize-snap")).toBeChecked();
    expect(screen.getByTestId("board-settings-maximize-dblclick")).toBeChecked();
    // New panels + layout memory
    expect(screen.getByTestId("board-settings-new-panels-where-you-are")).toBeChecked();
    expect(screen.getByTestId("board-settings-new-panels-center")).toBeInTheDocument();
    expect(screen.getByTestId("board-settings-new-panels-tile")).toBeInTheDocument();
    expect(screen.getByTestId("board-settings-layout-memory-per-project")).toBeChecked();
    expect(screen.getByTestId("board-settings-layout-memory-fresh")).toBeInTheDocument();
    // Zoom
    expect(screen.getByTestId("board-settings-default-zoom")).toHaveValue("100");
    expect(screen.getByTestId("board-settings-ctrl-scroll")).toBeChecked();
    // Toolbar checkboxes: the nine panels, all on
    for (const id of [
      "chat",
      "preview",
      "code",
      "terminal",
      "files",
      "health",
      "deploy",
      "media",
      "browser",
    ]) {
      expect(screen.getByTestId(`board-settings-toolbar-${id}`)).toBeChecked();
    }
  });

  it("opens as a surface sized to its content, not the old tiny scroll box (Larry, 2026-11-17)", () => {
    renderMenu();
    openMenu();
    const menu = screen.getByTestId("board-settings-menu");
    // The old surface was w-64 (256px) capped at max-h-[70vh] — a tiny
    // box Larry had to scroll just to find a setting.
    expect(menu.className).not.toContain("w-64");
    expect(menu.className).not.toContain("max-h-[70vh]");
    // Sized to its content: 360px wide, clamped to the viewport width
    // on small windows so it never clips off-screen, and a generous
    // viewport-relative height cap.
    expect(menu.className).toContain("w-[min(360px,calc(100vw-24px))]");
    expect(menu.className).toContain("max-h-[calc(100vh-96px)]");
    // Internal scrolling remains only as the fallback for viewports
    // too short to fit the content.
    expect(menu.className).toContain("overflow-y-auto");
    // Still anchored to its trigger, opening directly below it.
    expect(menu.className).toContain("right-0");
    expect(menu.className).toContain("top-[calc(100%+8px)]");
  });

  it("fits the menu to the measured space below its trigger (mockup port fix, 2026-11-18)", () => {
    renderMenu();
    openMenu();
    const menu = screen.getByTestId("board-settings-menu");
    // jsdom: the trigger rect is all zeros and innerHeight is 768, so
    // the measured space below is 768 - 0 (bottom) - 8 (gap) - 12
    // (margin) = 748px, applied as an inline max-height that overrides
    // the static class cap.
    expect(menu.dataset.placement).toBe("below");
    expect(menu.style.maxHeight).toBe("748px");
  });

  it("flips above the trigger when the space below is too small — the Browser row and Reset can never be cut off", () => {
    renderMenu();
    const wrap = screen.getByTestId("board-settings-button").parentElement!;
    // Trigger sitting low on a 768px-tall viewport: 28px below it,
    // 680px above it.
    vi.spyOn(wrap, "getBoundingClientRect").mockReturnValue({
      top: 700,
      bottom: 740,
      left: 0,
      right: 360,
      width: 360,
      height: 40,
      x: 0,
      y: 700,
      toJSON: () => ({}),
    } as DOMRect);
    openMenu();
    const menu = screen.getByTestId("board-settings-menu");
    expect(menu.dataset.placement).toBe("above");
    expect(menu.style.maxHeight).toBe("680px");
    expect(menu.className).toContain("bottom-[calc(100%+8px)]");
    // Every row is still reachable inside the flipped menu.
    expect(screen.getByTestId("board-settings-toolbar-browser")).toBeInTheDocument();
    expect(screen.getByTestId("board-settings-reset")).toBeInTheDocument();
  });

  it("caps the height to the space from the menu's own rendered position — the live 1919x998 failure (follow-up, 2026-11-18)", () => {
    // Live geometry, reduced to jsdom's 768px viewport: the trigger
    // measured near the top of the board (its rect bottom at 176px),
    // but by the time the menu painted, the board's layout had
    // settled lower — the menu's rendered top sat at 300px with the
    // static-cap height of 902px, putting its bottom at 1202px, far
    // past the fold. The old fit trusted the anchor measurement
    // alone (768 - 176 - 8 - 12 = 572px) and the painted menu
    // overflowed. The hardened fit reads the menu's own rendered box
    // and caps to the space from its rendered top to the viewport
    // edge: 768 - 12 (margin) - 300 (rendered top) = 456px, so the
    // menu's bottom lands exactly at 756px — fully on screen, every
    // row reachable by its internal scroll.
    const originalRect = HTMLElement.prototype.getBoundingClientRect;
    const rectSpy = vi
      .spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockImplementation(function (this: HTMLElement) {
        if (this.dataset?.testid === "board-settings-menu") {
          return {
            top: 300,
            bottom: 1202,
            left: 0,
            right: 360,
            width: 360,
            height: 902,
            x: 0,
            y: 300,
            toJSON: () => ({}),
          } as DOMRect;
        }
        return originalRect.call(this);
      });
    try {
      renderMenu();
      const wrap = screen.getByTestId("board-settings-button").parentElement!;
      vi.spyOn(wrap, "getBoundingClientRect").mockReturnValue({
        top: 140,
        bottom: 176,
        left: 0,
        right: 360,
        width: 360,
        height: 36,
        x: 0,
        y: 140,
        toJSON: () => ({}),
      } as DOMRect);
      openMenu();
      const menu = screen.getByTestId("board-settings-menu");
      expect(menu.dataset.placement).toBe("below");
      expect(menu.style.maxHeight).toBe("456px");
      // The rows the live proof could not reach are inside the cap.
      expect(screen.getByTestId("board-settings-toolbar-browser")).toBeInTheDocument();
      expect(screen.getByTestId("board-settings-reset")).toBeInTheDocument();
    } finally {
      rectSpy.mockRestore();
    }
  });

  it("flips above the trigger when the menu's actual content height exceeds the space below (follow-up, 2026-11-18)", () => {
    // The old flip test used a fixed 360px threshold: with 382px
    // below the trigger it kept the menu below, even though this
    // menu's content is ~950px tall — most of it forced into a short
    // scroll box while 528px sat empty above. The hardened fit
    // judges "insufficient" against the menu's real content height
    // (scrollHeight) and flips when above is roomier.
    const originalInnerHeight = window.innerHeight;
    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      writable: true,
      value: 998,
    });
    const originalRect = HTMLElement.prototype.getBoundingClientRect;
    const rectSpy = vi
      .spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockImplementation(function (this: HTMLElement) {
        if (this.dataset?.testid === "board-settings-menu") {
          // The flipped render: bottom anchored 8px above the
          // trigger's top (560 - 8 = 552).
          return {
            top: -350,
            bottom: 552,
            left: 0,
            right: 360,
            width: 360,
            height: 902,
            x: 0,
            y: -350,
            toJSON: () => ({}),
          } as DOMRect;
        }
        return originalRect.call(this);
      });
    const heightSpy = vi
      .spyOn(Element.prototype, "scrollHeight", "get")
      .mockImplementation(function (this: Element) {
        return this instanceof HTMLElement && this.dataset.testid === "board-settings-menu"
          ? 950
          : 0;
      });
    try {
      renderMenu();
      const wrap = screen.getByTestId("board-settings-button").parentElement!;
      vi.spyOn(wrap, "getBoundingClientRect").mockReturnValue({
        top: 560,
        bottom: 596,
        left: 0,
        right: 360,
        width: 360,
        height: 36,
        x: 0,
        y: 560,
        toJSON: () => ({}),
      } as DOMRect);
      openMenu();
      const menu = screen.getByTestId("board-settings-menu");
      // below = 998 - 596 - 8 - 12 = 382 < 950 (content); above =
      // 560 - 8 - 12 = 540, and the rendered-box allowance agrees
      // (flipped bottom 552 - 12 margin = 540), so the cap is 540px.
      expect(menu.dataset.placement).toBe("above");
      expect(menu.style.maxHeight).toBe("540px");
      expect(menu.className).toContain("bottom-[calc(100%+8px)]");
    } finally {
      rectSpy.mockRestore();
      heightSpy.mockRestore();
      Object.defineProperty(window, "innerHeight", {
        configurable: true,
        writable: true,
        value: originalInnerHeight,
      });
    }
  });

  it("writes every control through to the board settings store", () => {
    renderMenu();
    openMenu();
    fireEvent.click(screen.getByTestId("board-settings-open-size-smart"));
    fireEvent.click(screen.getByTestId("board-settings-maximize-snap"));
    fireEvent.click(screen.getByTestId("board-settings-new-panels-tile"));
    expect(useBoardSettingsStore.getState().newPanelPlacement).toBe("tile");
    fireEvent.click(screen.getByTestId("board-settings-new-panels-center"));
    fireEvent.click(screen.getByTestId("board-settings-layout-memory-fresh"));
    fireEvent.change(screen.getByTestId("board-settings-default-zoom"), {
      target: { value: "125" },
    });
    fireEvent.click(screen.getByTestId("board-settings-toolbar-deploy"));
    const s = useBoardSettingsStore.getState();
    expect(s.openSize).toBe("smart");
    expect(s.maximizeSnapFull).toBe(false);
    expect(s.newPanelPlacement).toBe("center");
    expect(s.layoutMemory).toBe("fresh");
    expect(s.defaultZoomPercent).toBe(125);
    expect(s.toolbarPanels.deploy).toBe(false);
  });

  it("Reset returns the menu to Larry's defaults", () => {
    useBoardSettingsStore.getState().setOpenSize("remember");
    useBoardSettingsStore.getState().setCtrlScrollZoom(false);
    renderMenu();
    openMenu();
    fireEvent.click(screen.getByTestId("board-settings-reset"));
    expect(screen.getByTestId("board-settings-open-size-full")).toBeChecked();
    expect(screen.getByTestId("board-settings-ctrl-scroll")).toBeChecked();
  });

  it("carries the crossbreed layout switch (Amendment 8): Board by default, Regular writes the shared choice", () => {
    renderMenu();
    openMenu();
    // Board is the flagship default (no explicit choice made yet).
    expect(screen.getByTestId("board-settings-layout-board")).toBeChecked();
    expect(screen.getByTestId("board-settings-layout-classic")).not.toBeChecked();
    fireEvent.click(screen.getByTestId("board-settings-layout-classic"));
    expect(useBoardSettingsStore.getState().layoutMode).toBe("classic");
    expect(screen.getByTestId("board-settings-layout-classic")).toBeChecked();
    // The legacy escape-hatch key stays in sync with the choice.
    expect(localStorage.getItem("litt:studio:layout-mode")).toBe("classic");
    fireEvent.click(screen.getByTestId("board-settings-layout-board"));
    expect(useBoardSettingsStore.getState().layoutMode).toBe("board");
    expect(localStorage.getItem("litt:studio:layout-mode")).toBeNull();
  });
});
