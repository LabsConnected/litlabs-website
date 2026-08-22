/**
 * Phase 10.6 — State Completeness Tests
 *
 * Verifies all required operational states render correctly
 * with the right title, description, and action.
 *
 * Phase 10.6 — Studio Control Plane V1
 */

import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { StudioStateSurface, type StudioState } from "../shell/StudioStateSurface";

const allStates: StudioState[] = [
  "no_project",
  "project_loading",
  "runtime_connecting",
  "runtime_unavailable",
  "empty_conversation",
  "plan_draft",
  "plan_approved",
  "act_running",
  "awaiting_approval",
  "check_running",
  "check_failing",
  "check_passing",
  "evidence_stale",
  "acceptance_incomplete",
  "acceptance_complete",
  "ready_for_review",
  "changes_requested",
  "approved",
  "preview_unavailable",
  "general_error",
];

describe("Phase 10.6 — State Completeness", () => {
  describe("all states render", () => {
    it.each(allStates)("renders state: %s", (state) => {
      const { getByTestId } = render(<StudioStateSurface state={state} />);
      expect(getByTestId(`state-surface-${state}`)).toBeDefined();
    });
  });

  describe("full-screen states", () => {
    it("no_project shows title and description", () => {
      const { getByTestId } = render(<StudioStateSurface state="no_project" />);
      const text = getByTestId("state-surface-no_project").textContent;
      expect(text).toContain("No project selected");
      expect(text).toContain("Select a project");
    });

    it("project_loading shows skeleton", () => {
      const { getByTestId } = render(<StudioStateSurface state="project_loading" />);
      const container = getByTestId("state-surface-project_loading");
      const skeletons = container.querySelectorAll('[data-testid="studio-skeleton"]');
      expect(skeletons.length).toBeGreaterThan(0);
    });

    it("runtime_connecting shows skeleton", () => {
      const { getByTestId } = render(<StudioStateSurface state="runtime_connecting" />);
      const container = getByTestId("state-surface-runtime_connecting");
      const skeletons = container.querySelectorAll('[data-testid="studio-skeleton"]');
      expect(skeletons.length).toBeGreaterThan(0);
    });

    it("runtime_unavailable shows error state", () => {
      const { getByTestId } = render(<StudioStateSurface state="runtime_unavailable" />);
      expect(getByTestId("state-surface-runtime_unavailable").textContent).toContain("Runtime unavailable");
    });

    it("general_error shows error state", () => {
      const { getByTestId } = render(<StudioStateSurface state="general_error" />);
      expect(getByTestId("state-surface-general_error").textContent).toContain("Something went wrong");
    });

    it("preview_unavailable shows warning state", () => {
      const { getByTestId } = render(<StudioStateSurface state="preview_unavailable" />);
      expect(getByTestId("state-surface-preview_unavailable").textContent).toContain("Preview unavailable");
    });
  });

  describe("states with children", () => {
    it("empty_conversation renders children with header", () => {
      const { getByTestId } = render(
        <StudioStateSurface state="empty_conversation">
          <div data-testid="child-content">Hello</div>
        </StudioStateSurface>,
      );
      expect(getByTestId("state-surface-empty_conversation")).toBeDefined();
      expect(getByTestId("child-content")).toBeDefined();
    });

    it("act_running renders children with status header", () => {
      const { getByTestId } = render(
        <StudioStateSurface state="act_running">
          <div data-testid="child-content">Working</div>
        </StudioStateSurface>,
      );
      expect(getByTestId("state-surface-act_running").textContent).toContain("LiTT is working");
      expect(getByTestId("child-content")).toBeDefined();
    });

    it("ready_for_review renders children with header", () => {
      const { getByTestId } = render(
        <StudioStateSurface state="ready_for_review">
          <div data-testid="child-content">Review</div>
        </StudioStateSurface>,
      );
      expect(getByTestId("state-surface-ready_for_review").textContent).toContain("Ready for review");
    });

    it("approved renders children with success header", () => {
      const { getByTestId } = render(
        <StudioStateSurface state="approved">
          <div data-testid="child-content">Done</div>
        </StudioStateSurface>,
      );
      expect(getByTestId("state-surface-approved").textContent).toContain("Approved");
    });
  });

  describe("custom message", () => {
    it("overrides description with custom message", () => {
      const { getByTestId } = render(
        <StudioStateSurface state="general_error" message="Custom error message" />,
      );
      expect(getByTestId("state-surface-general_error").textContent).toContain("Custom error message");
    });
  });

  describe("action button", () => {
    it("renders action button when provided", () => {
      const onAction = vi.fn();
      const { getByTestId } = render(
        <StudioStateSurface
          state="runtime_unavailable"
          onAction={onAction}
          actionLabel="Retry"
        />,
      );
      const btn = getByTestId("state-action-btn");
      expect(btn.textContent).toContain("Retry");
      fireEvent.click(btn);
      expect(onAction).toHaveBeenCalled();
    });

    it("does not render action button when not provided", () => {
      const { queryByTestId } = render(<StudioStateSurface state="no_project" />);
      expect(queryByTestId("state-action-btn")).toBeNull();
    });
  });

  describe("loading animation", () => {
    it("project_loading has spinning icon", () => {
      const { container } = render(<StudioStateSurface state="project_loading" />);
      const animatedDiv = container.querySelector('[style*="studio-spin"]');
      expect(animatedDiv).not.toBeNull();
    });

    it("no_project does not have spinning icon", () => {
      const { container } = render(<StudioStateSurface state="no_project" />);
      const animatedDiv = container.querySelector('[style*="studio-spin"]');
      expect(animatedDiv).toBeNull();
    });
  });
});
