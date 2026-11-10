import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import StudioOperatorBar from "./StudioOperatorBar";
import { useExecutionStore } from "../../stores/useExecutionStore";

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
