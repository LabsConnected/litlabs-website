import "@testing-library/jest-dom";
import { beforeEach, describe, expect, it } from "vitest";
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

beforeEach(() => {
  localStorage.clear();
  store.setState({ enabledByUser: {}, scopes: {} });
});

describe("StudioBoard surface (B2 scaffold)", () => {
  it("renders the website default panels and honest B3 binding slots", () => {
    renderBoard();
    expect(screen.getByTestId("studio-board")).toBeInTheDocument();
    expect(screen.getByTestId("board-panel-preview")).toBeInTheDocument();
    expect(screen.getByTestId("board-panel-code")).toBeInTheDocument();
    expect(screen.getByTestId("board-panel-terminal")).toBeInTheDocument();
    expect(screen.queryByTestId("board-panel-files")).toBeNull();
    // Slots state what binds in B3 — no fake system is rendered.
    expect(screen.getByTestId("board-panel-slot-preview")).toHaveTextContent("StudioPreviewPanel");
  });

  it("the toolbar summons a closed panel — user action only", () => {
    renderBoard();
    fireEvent.click(screen.getByTestId("board-summon-files"));
    expect(screen.getByTestId("board-panel-files")).toBeInTheDocument();
    expect(store.getState().scopes[SCOPE].panels.files.open).toBe(true);
  });

  it("closing a panel removes it; minimizing parks it in the tray and restore returns it", () => {
    renderBoard();
    fireEvent.click(screen.getByTestId("board-panel-close-code"));
    expect(screen.queryByTestId("board-panel-code")).toBeNull();

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
    fireEvent.click(screen.getByTestId("board-tidy"));
    const rect = store.getState().scopes[SCOPE].panels.preview.rect;
    // jsdom containers measure 0×0, so the grid is clamped to minimum
    // panel sizes at the padding origin instead of the scattered rect.
    expect(rect.x).toBe(16);
    expect(rect.y).toBe(16);
  });

  it("Overview zooms the world layer out and back", () => {
    renderBoard();
    fireEvent.click(screen.getByTestId("board-overview"));
    expect(store.getState().scopes[SCOPE].viewport.scale).toBeLessThan(1);
    expect(screen.getByTestId("board-overview")).toHaveTextContent("Exit overview");
    fireEvent.click(screen.getByTestId("board-overview"));
    expect(store.getState().scopes[SCOPE].viewport).toEqual({ panX: 0, panY: 0, scale: 1 });
  });

  it("saves and applies a named preset from the toolbar", () => {
    renderBoard();
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
    fireEvent.click(screen.getByTestId("board-reset"));
    expect(screen.getByTestId("board-panel-preview")).toBeInTheDocument();
  });
});

describe("board toggle (B2 default OFF)", () => {
  it("useBoardEnabled defaults to false until the user turns it on", () => {
    expect(store.getState().enabledByUser[USER]).toBeUndefined();
    store.getState().setBoardEnabled(USER, true);
    expect(store.getState().enabledByUser[USER]).toBe(true);
  });
});
