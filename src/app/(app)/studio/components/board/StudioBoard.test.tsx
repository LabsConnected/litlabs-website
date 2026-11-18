import "@testing-library/jest-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { ThemeProvider } from "@/context/ThemeContext";
import StudioBoard from "./StudioBoard";
import { useBoardLayoutStore } from "../../stores/useBoardLayoutStore";
import { useBoardSettingsStore } from "../../stores/useBoardSettingsStore";
import { boardScopeKey } from "./board-types";

const USER = "user_1";
const PROJECT = "project_1";
const SCOPE = boardScopeKey(USER, PROJECT);
const store = useBoardLayoutStore;

function renderBoard() {
  return render(
    <ThemeProvider>
      <StudioBoard userId={USER} projectId={PROJECT} projectType="website" />
    </ThemeProvider>,
  );
}

function openLayoutMenu() {
  fireEvent.click(screen.getByTestId("board-layout-menu"));
}

beforeEach(() => {
  localStorage.clear();
  store.setState({ enabledByUser: {}, scopes: {} });
  useBoardSettingsStore.getState().resetBoardSettings();
});

describe("StudioBoard surface (board-only)", () => {
  it("renders the mockup default panels: Chat, Preview, Files, Media — Terminal closed until requested", () => {
    renderBoard();
    expect(screen.getByTestId("studio-board")).toBeInTheDocument();
    expect(screen.getByTestId("board-panel-chat")).toBeInTheDocument();
    expect(screen.getByTestId("board-panel-preview")).toBeInTheDocument();
    expect(screen.getByTestId("board-panel-files")).toBeInTheDocument();
    expect(screen.getByTestId("board-panel-media")).toBeInTheDocument();
    // Terminal is closed until requested (Studio Finish Spec,
    // Larry 2026-11-14) — one click away in the pill toolbar.
    expect(screen.queryByTestId("board-panel-terminal")).toBeNull();
    // Everything else starts closed, one click away in the pill toolbar.
    expect(screen.queryByTestId("board-panel-code")).toBeNull();
    expect(screen.queryByTestId("board-panel-health")).toBeNull();
    expect(screen.queryByTestId("board-panel-inspector")).toBeNull();
    expect(screen.queryByTestId("board-panel-deploy")).toBeNull();
    expect(screen.queryByTestId("board-panel-browser")).toBeNull();
    expect(screen.queryByTestId("board-panel-world")).toBeNull();
    // Slots state what binds — no fake system is rendered.
    expect(screen.getByTestId("board-panel-slot-preview")).toHaveTextContent("StudioPreviewPanel");
  });

  it("the pill toolbar holds exactly the nine toggles plus Layout, Board settings and zoom — no Inspector", () => {
    renderBoard();
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
      expect(screen.getByTestId(`board-summon-${id}`)).toBeInTheDocument();
    }
    // Inspector is retired as a toolbar entry (Amendments 2–3): its
    // keepers live in the chat panel's Jobs tab.
    expect(screen.queryByTestId("board-summon-inspector")).toBeNull();
    expect(screen.getByTestId("board-layout-menu")).toBeInTheDocument();
    expect(screen.getByTestId("board-settings-button")).toBeInTheDocument();
    expect(screen.getByTestId("board-zoom-control")).toBeInTheDocument();
    expect(screen.getByTestId("board-zoom-label")).toHaveTextContent("100%");
  });

  it("the pill toolbar is centered in the board's top bar area, not docked to an edge", () => {
    renderBoard();
    const toolbar = screen.getByTestId("board-toolbar");
    // Horizontally centered: positioned at the container's midpoint
    // and translated back by half its own width.
    expect(toolbar.className).toContain("left-1/2");
    expect(toolbar.className).toContain("-translate-x-1/2");
    expect(toolbar.className).not.toContain("left-3");
    expect(toolbar.className).not.toContain("right-3");
  });

  it("the toolbar menus live outside its scroll region, so no scroll container clips them into the pill (2026-11-17 strip defect)", () => {
    renderBoard();
    const toolbar = screen.getByTestId("board-toolbar");
    const scrollRegion = screen.getByTestId("board-toolbar-scroll");
    // The pill itself is NOT a scroll container. overflow-x:auto on
    // it forces overflow-y to compute to auto too, which clipped the
    // menus into a ~35px strip inside the pill on the live board.
    expect(toolbar.className).not.toContain("overflow-x-auto");
    expect(toolbar.className).not.toContain("overflow-y-auto");
    // Only the summon row scrolls horizontally, and it can shrink.
    expect(scrollRegion.className).toContain("overflow-x-auto");
    expect(scrollRegion.className).toContain("min-w-0");
    expect(scrollRegion).toContainElement(screen.getByTestId("board-summon-chat"));
    // Neither menu trigger is inside the scroll region.
    expect(scrollRegion).not.toContainElement(screen.getByTestId("board-layout-menu"));
    expect(scrollRegion).not.toContainElement(screen.getByTestId("board-settings-button"));
    // Open both popovers: each renders inside the toolbar but NOT
    // inside the scroll region, and no ancestor between a popover
    // and the toolbar is a scroll container — a scroll container on
    // that chain is exactly what clips an absolutely-positioned
    // popover to the pill's box.
    fireEvent.click(screen.getByTestId("board-layout-menu"));
    fireEvent.click(screen.getByTestId("board-settings-button"));
    const popovers = [
      screen.getByTestId("board-layout-menu-popover"),
      screen.getByTestId("board-settings-menu"),
    ];
    for (const popover of popovers) {
      expect(toolbar).toContainElement(popover);
      expect(scrollRegion).not.toContainElement(popover);
      let node = popover.parentElement;
      while (node && node !== toolbar) {
        expect(node.className).not.toContain("overflow-x-auto");
        expect(node.className).not.toContain("overflow-y-auto");
        node = node.parentElement;
      }
    }
  });

  it("the toolbar summons a closed panel — user action only", () => {
    renderBoard();
    fireEvent.click(screen.getByTestId("board-summon-code"));
    expect(screen.getByTestId("board-panel-code")).toBeInTheDocument();
    expect(store.getState().scopes[SCOPE].panels.code.open).toBe(true);
  });

  it("the Layout menu holds Activity and World — Plan and Canvas left with the scroll strip (Amendment 4)", () => {
    renderBoard();
    openLayoutMenu();
    // Plan / Canvas & Design moved inside the Code box; they are gone
    // from the menu so nothing a user needs hides in a scrollable strip.
    expect(screen.queryByTestId("board-summon-plan")).toBeNull();
    expect(screen.queryByTestId("board-summon-canvas")).toBeNull();
    fireEvent.click(screen.getByTestId("board-summon-activity"));
    expect(store.getState().scopes[SCOPE].panels.activity.open).toBe(true);
    openLayoutMenu();
    fireEvent.click(screen.getByTestId("board-summon-world"));
    expect(store.getState().scopes[SCOPE].panels.world.open).toBe(true);
  });

  it("maximize receives the visible REGION in board coordinates — origin follows pan and scale", () => {
    const toggleMaximize = vi.fn();
    store.setState({ toggleMaximize });
    renderBoard();
    // Pan the board and zoom to 200%: the visible top-left in board
    // coordinates is (-panX/scale, -panY/scale) = (100, 40), and the
    // visible size is the container divided by scale (jsdom measures
    // 0×0, floored to 1×1 by the board, so 1/2 rounds to 1).
    act(() => {
      store.getState().setViewport(SCOPE, { panX: -200, panY: -80, scale: 2 });
    });
    fireEvent.click(screen.getByTestId("board-panel-maximize-chat"));
    expect(toggleMaximize).toHaveBeenCalledWith(SCOPE, "chat", {
      x: 100,
      y: 40,
      width: 1,
      height: 1,
    });
  });

  it("closing a panel removes it; minimizing parks it in the tray and restore returns it", () => {
    renderBoard();
    fireEvent.click(screen.getByTestId("board-panel-close-files"));
    expect(screen.queryByTestId("board-panel-files")).toBeNull();

    fireEvent.click(screen.getByTestId("board-panel-minimize-preview"));
    expect(screen.queryByTestId("board-panel-preview")).toBeNull();
    expect(screen.getByTestId("board-tray")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("board-tray-restore-preview"));
    expect(screen.getByTestId("board-panel-preview")).toBeInTheDocument();
    expect(screen.queryByTestId("board-tray")).toBeNull();
  });

  it("Tidy snaps panels into the visible area", () => {
    renderBoard();
    store.getState().setPanelRect(SCOPE, "preview", { x: 900, y: 700, width: 700, height: 500 });
    openLayoutMenu();
    fireEvent.click(screen.getByTestId("board-tidy"));
    const panels = store.getState().scopes[SCOPE].panels;
    // jsdom containers measure 0×0, so the grid is clamped to minimum
    // panel sizes at the padding origin instead of the scattered rect:
    // the first panel in reading order (Chat) takes the origin cell and
    // the scattered Preview lands inside the grid, not at 900,700.
    expect(panels.chat.rect.x).toBe(16);
    expect(panels.chat.rect.y).toBe(16);
    expect(panels.preview.rect.x).toBeLessThan(900);
    expect(panels.preview.rect.y).toBeLessThan(700);
  });

  it("Overview zooms the world layer out and back", () => {
    renderBoard();
    openLayoutMenu();
    fireEvent.click(screen.getByTestId("board-overview"));
    expect(store.getState().scopes[SCOPE].viewport.scale).toBeLessThan(1);
    expect(screen.getByTestId("board-overview")).toHaveTextContent("Exit overview");
    fireEvent.click(screen.getByTestId("board-overview"));
    expect(store.getState().scopes[SCOPE].viewport).toEqual({ panX: 0, panY: 0, scale: 1 });
  });

  it("saves and applies a named preset from the Layout menu", () => {
    renderBoard();
    openLayoutMenu();
    fireEvent.change(screen.getByTestId("board-preset-name"), { target: { value: "Design" } });
    fireEvent.click(screen.getByTestId("board-preset-save"));
    expect(store.getState().scopes[SCOPE].presets.Design).toBeDefined();

    store.getState().closePanel(SCOPE, "preview");
    fireEvent.click(screen.getByTestId("board-preset-apply-Design"));
    expect(store.getState().scopes[SCOPE].panels.preview.open).toBe(true);
  });

  it("Reset returns the default arrangement", () => {
    renderBoard();
    fireEvent.click(screen.getByTestId("board-panel-close-preview"));
    expect(screen.queryByTestId("board-panel-preview")).toBeNull();
    openLayoutMenu();
    fireEvent.click(screen.getByTestId("board-reset"));
    expect(screen.getByTestId("board-panel-preview")).toBeInTheDocument();
  });

  it("Ctrl + mouse wheel zooms the board; a plain wheel does not", () => {
    renderBoard();
    const board = screen.getByTestId("studio-board");
    fireEvent.wheel(board, { deltaY: -120 });
    expect(store.getState().scopes[SCOPE].viewport.scale).toBe(1);
    fireEvent.wheel(board, { deltaY: -120, ctrlKey: true });
    expect(store.getState().scopes[SCOPE].viewport.scale).toBeGreaterThan(1);
    fireEvent.wheel(board, { deltaY: 240, ctrlKey: true });
    expect(store.getState().scopes[SCOPE].viewport.scale).toBeLessThan(1.2);
  });

  it("the zoom control steps the scale and reports the percentage", () => {
    renderBoard();
    fireEvent.click(screen.getByTestId("board-zoom-in"));
    expect(store.getState().scopes[SCOPE].viewport.scale).toBeCloseTo(1.1);
    expect(screen.getByTestId("board-zoom-label")).toHaveTextContent("110%");
    fireEvent.click(screen.getByTestId("board-zoom-out"));
    fireEvent.click(screen.getByTestId("board-zoom-out"));
    expect(store.getState().scopes[SCOPE].viewport.scale).toBeCloseTo(0.9);
    expect(screen.getByTestId("board-zoom-label")).toHaveTextContent("90%");
  });
});

describe("StudioBoard Board Settings wiring (Amendment 5)", () => {
  function openSettingsMenu() {
    fireEvent.click(screen.getByTestId("board-settings-button"));
  }

  it("the Board settings trigger stays in the board toolbar, in the board (Larry, 2026-11-17)", () => {
    renderBoard();
    // Larry reversed an earlier placement: Board settings does NOT go
    // up in the site header by the project name — it stays in the
    // board, in the board's own pill toolbar.
    const button = screen.getByTestId("board-settings-button");
    expect(screen.getByTestId("board-toolbar")).toContainElement(button);
    expect(screen.getByTestId("studio-board")).toContainElement(button);
  });

  it("the settings menu explains that a maximized panel is restored before it can be dragged", () => {
    renderBoard();
    openSettingsMenu();
    expect(screen.getByTestId("board-settings-menu")).toBeInTheDocument();
    expect(screen.getByTestId("board-settings-maximized-note")).toHaveTextContent(
      /maximized panel.*cannot be dragged/i,
    );
  });

  it("toolbar visibility checkboxes in Board Settings show and hide toolbar buttons", () => {
    renderBoard();
    expect(screen.getByTestId("board-summon-media")).toBeInTheDocument();
    openSettingsMenu();
    fireEvent.click(screen.getByTestId("board-settings-toolbar-media"));
    expect(useBoardSettingsStore.getState().toolbarPanels.media).toBe(false);
    expect(screen.queryByTestId("board-summon-media")).toBeNull();
    // Other toolbar buttons are untouched.
    expect(screen.getByTestId("board-summon-chat")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("board-settings-toolbar-media"));
    expect(screen.getByTestId("board-summon-media")).toBeInTheDocument();
  });

  it("the Ctrl+scroll toggle in Board Settings enables and disables wheel zoom", () => {
    renderBoard();
    const board = screen.getByTestId("studio-board");
    openSettingsMenu();
    fireEvent.click(screen.getByTestId("board-settings-ctrl-scroll"));
    expect(useBoardSettingsStore.getState().ctrlScrollZoom).toBe(false);
    fireEvent.wheel(board, { deltaY: -120, ctrlKey: true });
    expect(store.getState().scopes[SCOPE].viewport.scale).toBe(1);
    fireEvent.click(screen.getByTestId("board-settings-ctrl-scroll"));
    expect(useBoardSettingsStore.getState().ctrlScrollZoom).toBe(true);
    fireEvent.wheel(board, { deltaY: -120, ctrlKey: true });
    expect(store.getState().scopes[SCOPE].viewport.scale).toBeGreaterThan(1);
  });

  it("the Board Settings default zoom applies on board mount", () => {
    useBoardSettingsStore.getState().setDefaultZoomPercent(150);
    renderBoard();
    expect(store.getState().scopes[SCOPE].viewport.scale).toBe(1.5);
    expect(screen.getByTestId("board-zoom-label")).toHaveTextContent("150%");
  });

  it("the default zoom never overrides a viewport the user already arranged", () => {
    store.getState().ensureScope(USER, PROJECT, "website");
    store.getState().setViewport(SCOPE, { panX: 24, panY: 12, scale: 1 });
    useBoardSettingsStore.getState().setDefaultZoomPercent(150);
    renderBoard();
    expect(store.getState().scopes[SCOPE].viewport).toEqual({ panX: 24, panY: 12, scale: 1 });
  });
});

describe("StudioBoard phone layout (Finish Spec)", () => {
  function mockPhoneViewport() {
    const listeners = new Set<(e: MediaQueryListEvent) => void>();
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: query.includes("max-width: 767px"),
      media: query,
      addEventListener: (_: string, fn: (e: MediaQueryListEvent) => void) => listeners.add(fn),
      removeEventListener: (_: string, fn: (e: MediaQueryListEvent) => void) => listeners.delete(fn),
      addListener: () => {},
      removeListener: () => {},
      onchange: null,
      dispatchEvent: () => false,
    }));
    // jsdom has no scrollIntoView — the nav jump uses it.
    Element.prototype.scrollIntoView = vi.fn();
  }

  it("renders the Chat · Preview · Files · More bottom nav and stacked panels", () => {
    mockPhoneViewport();
    renderBoard();
    expect(screen.getByTestId("board-mobile-nav")).toBeInTheDocument();
    for (const id of ["chat", "preview", "files", "more"]) {
      expect(screen.getByTestId(`board-mobile-nav-${id}`)).toBeInTheDocument();
    }
    // Panels render stacked (relative flow), not absolute board geometry.
    const chat = screen.getByTestId("board-panel-chat");
    expect(chat.className).toContain("relative");
    // The desktop pill toolbar is not the phone's navigation — it is
    // hidden (display:none via the hidden class) in this layout.
    expect(screen.getByTestId("board-summon-chat").closest("[data-board-chrome]")?.className).toContain("hidden");
    vi.unstubAllGlobals();
  });

  it("More opens a sheet with every panel and Settings, and a jump summons a closed panel", () => {
    mockPhoneViewport();
    renderBoard();
    fireEvent.click(screen.getByTestId("board-mobile-nav-more"));
    expect(screen.getByTestId("board-mobile-more-sheet")).toBeInTheDocument();
    expect(screen.getByTestId("board-mobile-more-settings")).toHaveAttribute("href", "/settings");
    fireEvent.click(screen.getByTestId("board-mobile-more-terminal"));
    expect(store.getState().scopes[SCOPE].panels.terminal.open).toBe(true);
    expect(screen.getByTestId("board-panel-terminal")).toBeInTheDocument();
    vi.unstubAllGlobals();
  });

  it("the offline banner appears only while offline", () => {
    mockPhoneViewport();
    renderBoard();
    expect(screen.queryByTestId("board-offline-banner")).toBeNull();
    fireEvent(window, new Event("offline"));
    expect(screen.getByTestId("board-offline-banner")).toBeInTheDocument();
    fireEvent(window, new Event("online"));
    expect(screen.queryByTestId("board-offline-banner")).toBeNull();
    vi.unstubAllGlobals();
  });
});

describe("board toggle (legacy compat)", () => {
  it("useBoardEnabled still round-trips for surfaces that reference it", () => {
    expect(store.getState().enabledByUser[USER]).toBeUndefined();
    store.getState().setBoardEnabled(USER, true);
    expect(store.getState().enabledByUser[USER]).toBe(true);
  });
});
