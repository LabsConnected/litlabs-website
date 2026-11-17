import "@testing-library/jest-dom";
import { beforeEach, describe, expect, it } from "vitest";
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
