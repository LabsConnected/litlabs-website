import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import "@testing-library/jest-dom";
import { AdvancedWorkspaceCard } from "./AdvancedWorkspaceCard";
import { ThemeProvider } from "@/context/ThemeContext";
import {
  BOARD_SETTINGS_STORAGE_KEY,
  useBoardSettingsStore,
} from "@/app/(app)/studio/stores/useBoardSettingsStore";
import { STUDIO_LAYOUT_MODE_LEGACY_KEY } from "@/app/(app)/studio/stores/useStudioLayoutMode";

// The Board demotion (Larry, 2026-11-22): Regular is the default and
// the Board is opt-in from Settings as "Enable advanced workspace",
// with a preview of both arrangements. The toggle writes the shared
// persisted layout choice, so enabling it here is the same choice
// the Board Settings menu sees — and saved Board users keep Board.

function renderCard() {
  return render(
    <ThemeProvider>
      <AdvancedWorkspaceCard />
    </ThemeProvider>,
  );
}

function workspaceSwitch(): HTMLElement {
  const label = screen.getByText("Enable advanced workspace").closest("label");
  if (!label) throw new Error("No settings row found for the advanced workspace toggle");
  return within(label as HTMLElement).getByRole("switch");
}

describe("AdvancedWorkspaceCard — Board opt-in", () => {
  beforeEach(() => {
    window.localStorage.clear();
    useBoardSettingsStore.getState().resetBoardSettings();
  });

  it("shows both layout previews and starts off (Regular is the default)", () => {
    renderCard();
    expect(screen.getByTestId("advanced-workspace-card")).toBeTruthy();
    expect(screen.getByText("Regular — the standard layout")).toBeTruthy();
    expect(screen.getByText("Board — the advanced workspace")).toBeTruthy();
    expect(workspaceSwitch()).toHaveAttribute("aria-checked", "false");
    expect(useBoardSettingsStore.getState().layoutMode).toBeNull();
  });

  it("enabling it persists the Board choice (and syncs the legacy key)", () => {
    renderCard();
    fireEvent.click(workspaceSwitch());
    expect(workspaceSwitch()).toHaveAttribute("aria-checked", "true");
    expect(useBoardSettingsStore.getState().layoutMode).toBe("board");
    expect(window.localStorage.getItem(STUDIO_LAYOUT_MODE_LEGACY_KEY)).toBeNull();
    const persisted = JSON.parse(
      window.localStorage.getItem(BOARD_SETTINGS_STORAGE_KEY) as string,
    );
    expect(persisted.state.layoutMode).toBe("board");
  });

  it("a saved Board choice renders on, and turning it off returns to Regular", () => {
    useBoardSettingsStore.getState().setLayoutMode("board");
    renderCard();
    expect(workspaceSwitch()).toHaveAttribute("aria-checked", "true");
    fireEvent.click(workspaceSwitch());
    expect(workspaceSwitch()).toHaveAttribute("aria-checked", "false");
    expect(useBoardSettingsStore.getState().layoutMode).toBe("classic");
    expect(window.localStorage.getItem(STUDIO_LAYOUT_MODE_LEGACY_KEY)).toBe("classic");
  });
});
