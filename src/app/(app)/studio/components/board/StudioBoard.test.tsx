import "@testing-library/jest-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ThemeProvider } from "@/context/ThemeContext";
import StudioBoard from "./StudioBoard";
import { useBoardLayoutStore } from "../../stores/useBoardLayoutStore";
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

  it("the pill toolbar holds exactly the ten mockup toggles plus Layout and zoom", () => {
    renderBoard();
    for (const id of [
      "chat",
      "preview",
      "code",
      "terminal",
      "files",
      "health",
      "inspector",
      "deploy",
      "media",
      "browser",
    ]) {
      expect(screen.getByTestId(`board-summon-${id}`)).toBeInTheDocument();
    }
    expect(screen.getByTestId("board-layout-menu")).toBeInTheDocument();
    expect(screen.getByTestId("board-zoom-control")).toBeInTheDocument();
    expect(screen.getByTestId("board-zoom-label")).toHaveTextContent("100%");
  });

  it("the toolbar summons a closed panel — user action only", () => {
    renderBoard();
    fireEvent.click(screen.getByTestId("board-summon-code"));
    expect(screen.getByTestId("board-panel-code")).toBeInTheDocument();
    expect(store.getState().scopes[SCOPE].panels.code.open).toBe(true);
  });

  it("the Layout menu summons Plan, Canvas & Design and Activity", () => {
    renderBoard();
    openLayoutMenu();
    fireEvent.click(screen.getByTestId("board-summon-plan"));
    expect(store.getState().scopes[SCOPE].panels.plan.open).toBe(true);
    openLayoutMenu();
    fireEvent.click(screen.getByTestId("board-summon-canvas"));
    expect(store.getState().scopes[SCOPE].panels.canvas.open).toBe(true);
    openLayoutMenu();
    fireEvent.click(screen.getByTestId("board-summon-activity"));
    expect(store.getState().scopes[SCOPE].panels.activity.open).toBe(true);
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
