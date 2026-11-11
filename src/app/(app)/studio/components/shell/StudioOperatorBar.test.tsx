import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import StudioOperatorBar from "./StudioOperatorBar";
import { useExecutionStore } from "../../stores/useExecutionStore";

// StudioOperatorBar is theme-token driven (useTheme) — provide fixed
// tokens so this suite stays a pure behavior suite. Theme compliance
// itself is covered by shell-chrome-theme.test.tsx.
vi.mock("@/context/ThemeContext", () => ({
  useTheme: () => ({
    tokens: {
      background: "#000000",
      surface: "#111111",
      surfaceElevated: "#1a1a1a",
      border: "#333333",
      text: "#ffffff",
      textMuted: "#888888",
      textInverse: "#000000",
      primary: "#72f238",
      secondary: "#9b4dff",
      success: "#25e08a",
      warning: "#f5b544",
      danger: "#f85149",
      focus: "#72f238",
    },
  }),
}));

describe("StudioOperatorBar — settled run outcome", () => {
  beforeEach(() => {
    useExecutionStore.getState().reset();
  });

  it("shows Idle when no run has settled", () => {
    render(<StudioOperatorBar terminalStatus="Terminal ready" modelLabel="LiTT Auto" />);
    expect(screen.getByText("Idle")).toBeTruthy();
  });

  it("shows Last run failed instead of Idle after a failed run (post-reload)", () => {
    render(
      <StudioOperatorBar
        terminalStatus="Terminal error"
        modelLabel="LiTT Auto"
        lastRunFailed={true}
      />,
    );
    expect(screen.getByText("Last run failed")).toBeTruthy();
    expect(screen.queryByText("Idle")).toBeNull();
  });
});
