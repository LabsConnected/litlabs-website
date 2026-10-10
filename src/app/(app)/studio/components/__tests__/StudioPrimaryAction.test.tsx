/**
 * Phase 3B — StudioPrimaryAction regression tests.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import StudioPrimaryAction from "../StudioPrimaryAction";

describe("StudioPrimaryAction — one primary action per state", () => {
  it("building: shows progress and Cancel, no Go Live", () => {
    const onCancel = vi.fn();
    render(<StudioPrimaryAction state="building" onCancel={onCancel} />);

    const container = screen.getByTestId("primary-action");
    expect(container.getAttribute("data-state")).toBe("building");
    expect(screen.getByText("Building…")).toBeTruthy();
    expect(screen.getByTestId("primary-action-cancel")).toBeTruthy();
    expect(screen.queryByTestId("primary-action-go-live")).toBeNull();

    fireEvent.click(screen.getByTestId("primary-action-cancel"));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("approval_required: focuses canonical card, no duplicate Approve", () => {
    const onFocusApproval = vi.fn();
    const onApprove = vi.fn();
    render(
      <StudioPrimaryAction
        state="approval_required"
        onFocusApproval={onFocusApproval}
        onApprove={onApprove}
      />
    );

    const container = screen.getByTestId("primary-action");
    expect(container.getAttribute("data-state")).toBe("approval_required");
    expect(screen.getByTestId("primary-action-focus-approval")).toBeTruthy();
    expect(screen.getByText("Review Approval")).toBeTruthy();
    expect(screen.queryByText(/^Approve$/)).toBeNull();

    fireEvent.click(screen.getByTestId("primary-action-focus-approval"));
    expect(onFocusApproval).toHaveBeenCalledTimes(1);
    expect(onApprove).not.toHaveBeenCalled();
  });

  it("ready_to_deploy: shows Go Live, invokes onDeploy", () => {
    const onDeploy = vi.fn();
    render(<StudioPrimaryAction state="ready_to_deploy" onDeploy={onDeploy} />);

    const container = screen.getByTestId("primary-action");
    expect(container.getAttribute("data-state")).toBe("ready_to_deploy");
    expect(screen.getByTestId("primary-action-go-live")).toBeTruthy();
    expect(screen.getByText("Go Live")).toBeTruthy();

    fireEvent.click(screen.getByTestId("primary-action-go-live"));
    expect(onDeploy).toHaveBeenCalledTimes(1);
  });

  it("publishing: shows progress, no deployment action", () => {
    render(<StudioPrimaryAction state="publishing" onDeploy={vi.fn()} />);

    const container = screen.getByTestId("primary-action");
    expect(container.getAttribute("data-state")).toBe("publishing");
    expect(screen.getByText("Publishing…")).toBeTruthy();
    expect(screen.queryByTestId("primary-action-go-live")).toBeNull();
  });

  it("live: shows Open Live with verified publicUrl", () => {
    render(<StudioPrimaryAction state="live" publicUrl="https://example.com" />);

    const container = screen.getByTestId("primary-action");
    expect(container.getAttribute("data-state")).toBe("live");
    const link = screen.getByTestId("primary-action-open-live");
    expect(link).toBeTruthy();
    expect(link.getAttribute("href")).toBe("https://example.com");
    expect(link.getAttribute("target")).toBe("_blank");
  });

  it("live: renders nothing without publicUrl", () => {
    const { container } = render(<StudioPrimaryAction state="live" publicUrl={null} />);
    expect(container.firstChild).toBeNull();
  });

  it("failed: shows recovery, never unauthorized Go Live", () => {
    const onRetry = vi.fn();
    const onDeploy = vi.fn();
    render(<StudioPrimaryAction state="failed" onRetry={onRetry} onDeploy={onDeploy} />);

    const container = screen.getByTestId("primary-action");
    expect(container.getAttribute("data-state")).toBe("failed");
    expect(screen.getByText("Build failed")).toBeTruthy();
    expect(screen.getByTestId("primary-action-retry")).toBeTruthy();
    expect(screen.queryByTestId("primary-action-go-live")).toBeNull();

    fireEvent.click(screen.getByTestId("primary-action-retry"));
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onDeploy).not.toHaveBeenCalled();
  });

  it("idle: renders nothing", () => {
    const { container } = render(<StudioPrimaryAction state="idle" />);
    expect(container.firstChild).toBeNull();
  });
});
