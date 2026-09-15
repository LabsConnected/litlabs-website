import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import {
  StudioEmptyState,
  StudioErrorState,
  StudioLoadingState,
} from "./StudioStates";

describe("StudioEmptyState", () => {
  it("renders with the default test id", () => {
    render(<StudioEmptyState title="Nothing here yet" />);
    expect(screen.getByTestId("studio-empty-state")).toBeTruthy();
  });

  it("renders title and description", () => {
    render(
      <StudioEmptyState
        title="No runs yet"
        description="Start a run and results will appear here."
      />
    );
    expect(screen.getByText("No runs yet")).toBeTruthy();
    expect(screen.getByText("Start a run and results will appear here.")).toBeTruthy();
  });

  it("renders the action slot when provided", () => {
    render(
      <StudioEmptyState
        title="No runs yet"
        action={<button type="button">Start run</button>}
      />
    );
    expect(screen.getByText("Start run")).toBeTruthy();
  });

  it("honours a custom testId", () => {
    render(<StudioEmptyState title="Nothing here" testId="custom-empty" />);
    expect(screen.getByTestId("custom-empty")).toBeTruthy();
    expect(screen.queryByTestId("studio-empty-state")).toBeNull();
  });
});

describe("StudioErrorState", () => {
  it("renders title and reason", () => {
    render(
      <StudioErrorState
        title="Preview failed"
        reason="The dev server exited before the health check passed."
      />
    );
    expect(screen.getByTestId("studio-error-state")).toBeTruthy();
    expect(screen.getByText("Preview failed")).toBeTruthy();
    expect(
      screen.getByText("The dev server exited before the health check passed.")
    ).toBeTruthy();
  });

  it("calls onRetry when the Retry button is clicked", () => {
    const onRetry = vi.fn();
    render(<StudioErrorState title="Failed" onRetry={onRetry} />);
    const retry = screen.getByTestId("studio-error-retry");
    expect(retry.textContent).toBe("Retry");
    fireEvent.click(retry);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("renders View logs only when onViewLogs is provided", () => {
    const onViewLogs = vi.fn();
    const { rerender } = render(<StudioErrorState title="Failed" />);
    expect(screen.queryByTestId("studio-error-view-logs")).toBeNull();

    rerender(
      <StudioErrorState title="Failed" onViewLogs={onViewLogs} />
    );
    const logsButton = screen.getByTestId("studio-error-view-logs");
    fireEvent.click(logsButton);
    expect(onViewLogs).toHaveBeenCalledTimes(1);
  });

  it("renders no buttons when no handlers are provided", () => {
    render(<StudioErrorState title="Failed" reason="Something broke." />);
    expect(screen.queryByTestId("studio-error-retry")).toBeNull();
    expect(screen.queryByTestId("studio-error-view-logs")).toBeNull();
  });
});

describe("StudioLoadingState", () => {
  it("renders the spinner and label when no steps are provided", () => {
    render(<StudioLoadingState label="Starting workspace…" />);
    expect(screen.getByTestId("studio-loading-state")).toBeTruthy();
    expect(screen.getByText("Starting workspace…")).toBeTruthy();
  });

  it("highlights the current step and marks completed steps", () => {
    render(
      <StudioLoadingState
        steps={[
          "Provisioning workspace",
          "Starting dev server",
          "Health check",
        ]}
        currentStep={1}
      />
    );
    const stepEls = screen.getAllByTestId("studio-loading-step");
    expect(stepEls).toHaveLength(3);
    expect(stepEls[0].getAttribute("data-step-state")).toBe("done");
    expect(stepEls[1].getAttribute("data-step-state")).toBe("current");
    expect(stepEls[2].getAttribute("data-step-state")).toBe("todo");
  });

  it("treats steps after the last as done when currentStep exceeds the list", () => {
    render(
      <StudioLoadingState
        steps={["Provisioning workspace", "Starting dev server"]}
        currentStep={5}
      />
    );
    const stepEls = screen.getAllByTestId("studio-loading-step");
    expect(stepEls[0].getAttribute("data-step-state")).toBe("done");
    expect(stepEls[1].getAttribute("data-step-state")).toBe("done");
  });
});
