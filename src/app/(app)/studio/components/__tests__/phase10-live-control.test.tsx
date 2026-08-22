/**
 * Phase 10.9 — LiTT Live Control Surface Tests
 *
 * Verifies the browser control surface renders correctly:
 * - Disconnected state
 * - Connected state with viewport
 * - Action stream
 * - Console/network errors
 * - Pending approval
 * - Stop button
 * - Human control toggle
 * - URL navigation
 * - Screenshot capture
 * - Mode badge (PLAN/ACT)
 *
 * Phase 10.9 — LiTT Live Control Surface
 */

import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import {
  StudioLiveControlSurface,
  type BrowserState,
  type BrowserAction,
} from "../shell/StudioLiveControlSurface";

// ─── Helpers ─────────────────────────────────────────────────────

function makeBrowserState(overrides: Partial<BrowserState> = {}): BrowserState {
  return {
    sessionId: "session-1",
    status: "connected",
    url: "http://localhost:3000/studio",
    title: "Studio",
    screenshotUrl: null,
    consoleErrors: [],
    networkErrors: [],
    ...overrides,
  };
}

function makeAction(overrides: Partial<BrowserAction> = {}): BrowserAction {
  return {
    id: `action-${Math.random().toString(36).slice(2, 8)}`,
    type: "navigate",
    summary: "Navigated to /studio",
    status: "success",
    timestamp: Date.now(),
    durationMs: 500,
    ...overrides,
  };
}

// ─── Tests ───────────────────────────────────────────────────────

describe("Phase 10.9 — LiTT Live Control Surface", () => {
  describe("disconnected state", () => {
    it("shows empty state when disconnected", () => {
      const { getByTestId } = render(
        <StudioLiveControlSurface
          browserState={makeBrowserState({ status: "disconnected", sessionId: null })}
          actions={[]}
          isActing={false}
          mode="PLAN"
        />,
      );
      expect(getByTestId("live-control-disconnected")).toBeDefined();
    });
  });

  describe("connected state", () => {
    it("renders toolbar with URL input", () => {
      const { getByTestId } = render(
        <StudioLiveControlSurface
          browserState={makeBrowserState()}
          actions={[]}
          isActing={false}
          mode="ACT"
        />,
      );
      expect(getByTestId("studio-live-control-surface")).toBeDefined();
      expect(getByTestId("live-control-url-input")).toBeDefined();
    });

    it("shows browser viewport when screenshot is available", () => {
      const { getByTestId } = render(
        <StudioLiveControlSurface
          browserState={makeBrowserState({ screenshotUrl: "data:image/png;base64,abc" })}
          actions={[]}
          isActing={false}
          mode="ACT"
        />,
      );
      expect(getByTestId("live-control-viewport")).toBeDefined();
      expect(getByTestId("live-control-viewport-screenshot")).toBeDefined();
    });

    it("shows mode badge", () => {
      const { getByTestId } = render(
        <StudioLiveControlSurface
          browserState={makeBrowserState()}
          actions={[]}
          isActing={false}
          mode="ACT"
        />,
      );
      const surface = getByTestId("studio-live-control-surface");
      expect(surface.textContent).toContain("ACT");
    });

    it("shows PLAN mode badge", () => {
      const { getByTestId } = render(
        <StudioLiveControlSurface
          browserState={makeBrowserState()}
          actions={[]}
          isActing={false}
          mode="PLAN"
        />,
      );
      const surface = getByTestId("studio-live-control-surface");
      expect(surface.textContent).toContain("PLAN");
    });
  });

  describe("action stream", () => {
    it("renders browser actions", () => {
      const actions = [
        makeAction({ id: "1", type: "navigate", summary: "Opened localhost:3000" }),
        makeAction({ id: "2", type: "click", summary: "Clicked #hero" }),
        makeAction({ id: "3", type: "screenshot", summary: "Screenshot captured" }),
      ];
      const { getByTestId } = render(
        <StudioLiveControlSurface
          browserState={makeBrowserState()}
          actions={actions}
          isActing={false}
          mode="ACT"
        />,
      );
      expect(getByTestId("browser-action-1")).toBeDefined();
      expect(getByTestId("browser-action-2")).toBeDefined();
      expect(getByTestId("browser-action-3")).toBeDefined();
    });

    it("shows empty action stream message when no actions", () => {
      const { getByTestId } = render(
        <StudioLiveControlSurface
          browserState={makeBrowserState()}
          actions={[]}
          isActing={false}
          mode="ACT"
        />,
      );
      expect(getByTestId("live-control-actions").textContent).toContain("No browser actions yet");
    });

    it("shows failed action with error", () => {
      const actions = [
        makeAction({ id: "1", status: "failed", error: "Element not found" }),
      ];
      const { getByTestId } = render(
        <StudioLiveControlSurface
          browserState={makeBrowserState()}
          actions={actions}
          isActing={false}
          mode="ACT"
        />,
      );
      expect(getByTestId("browser-action-1").textContent).toContain("Element not found");
    });

    it("shows running action with spinner", () => {
      const actions = [
        makeAction({ id: "1", status: "running", summary: "Clicking button" }),
      ];
      const { container } = render(
        <StudioLiveControlSurface
          browserState={makeBrowserState()}
          actions={actions}
          isActing={true}
          mode="ACT"
        />,
      );
      const spinner = container.querySelector('[style*="studio-spin"]');
      expect(spinner).not.toBeNull();
    });

    it("shows screenshot in action item when available", () => {
      const actions = [
        makeAction({ id: "1", type: "screenshot", screenshotUrl: "data:image/png;base64,abc" }),
      ];
      const { getByTestId } = render(
        <StudioLiveControlSurface
          browserState={makeBrowserState()}
          actions={actions}
          isActing={false}
          mode="ACT"
        />,
      );
      expect(getByTestId("browser-action-screenshot-1")).toBeDefined();
    });
  });

  describe("console/network errors", () => {
    it("shows console errors", () => {
      const { getByTestId } = render(
        <StudioLiveControlSurface
          browserState={makeBrowserState({ consoleErrors: ["TypeError: undefined is not a function"] })}
          actions={[]}
          isActing={false}
          mode="ACT"
        />,
      );
      expect(getByTestId("live-control-errors").textContent).toContain("TypeError");
    });

    it("shows network errors", () => {
      const { getByTestId } = render(
        <StudioLiveControlSurface
          browserState={makeBrowserState({ networkErrors: ["Failed to load resource: 404"] })}
          actions={[]}
          isActing={false}
          mode="ACT"
        />,
      );
      expect(getByTestId("live-control-errors").textContent).toContain("404");
    });

    it("does not show errors section when no errors", () => {
      const { queryByTestId } = render(
        <StudioLiveControlSurface
          browserState={makeBrowserState({ consoleErrors: [], networkErrors: [] })}
          actions={[]}
          isActing={false}
          mode="ACT"
        />,
      );
      expect(queryByTestId("live-control-errors")).toBeNull();
    });
  });

  describe("pending approval", () => {
    it("shows pending approval banner", () => {
      const { getByTestId } = render(
        <StudioLiveControlSurface
          browserState={makeBrowserState()}
          actions={[]}
          isActing={false}
          mode="ACT"
          pendingApproval={{ toolId: "browser.navigate", reason: "Navigate to external URL" }}
        />,
      );
      expect(getByTestId("live-control-pending-approval")).toBeDefined();
      expect(getByTestId("live-control-pending-approval").textContent).toContain("Navigate to external URL");
    });

    it("does not show approval banner when no pending approval", () => {
      const { queryByTestId } = render(
        <StudioLiveControlSurface
          browserState={makeBrowserState()}
          actions={[]}
          isActing={false}
          mode="ACT"
        />,
      );
      expect(queryByTestId("live-control-pending-approval")).toBeNull();
    });
  });

  describe("stop button", () => {
    it("shows stop button when LiTT is acting", () => {
      const onStop = vi.fn();
      const { getByTestId } = render(
        <StudioLiveControlSurface
          browserState={makeBrowserState()}
          actions={[]}
          isActing={true}
          mode="ACT"
          onStop={onStop}
        />,
      );
      const btn = getByTestId("live-control-stop");
      expect(btn.textContent).toContain("Stop");
      fireEvent.click(btn);
      expect(onStop).toHaveBeenCalled();
    });

    it("does not show stop button when not acting", () => {
      const { queryByTestId } = render(
        <StudioLiveControlSurface
          browserState={makeBrowserState()}
          actions={[]}
          isActing={false}
          mode="ACT"
          onStop={() => {}}
        />,
      );
      expect(queryByTestId("live-control-stop")).toBeNull();
    });
  });

  describe("human control", () => {
    it("shows take control button when connected and not in human control", () => {
      const onTakeControl = vi.fn();
      const { getByTestId } = render(
        <StudioLiveControlSurface
          browserState={makeBrowserState({ status: "connected" })}
          actions={[]}
          isActing={false}
          mode="ACT"
          onTakeControl={onTakeControl}
        />,
      );
      fireEvent.click(getByTestId("live-control-take-control"));
      expect(onTakeControl).toHaveBeenCalled();
    });

    it("shows return control button when in human control", () => {
      const onReturnControl = vi.fn();
      const { getByTestId } = render(
        <StudioLiveControlSurface
          browserState={makeBrowserState({ status: "human_control" })}
          actions={[]}
          isActing={false}
          mode="ACT"
          onReturnControl={onReturnControl}
        />,
      );
      fireEvent.click(getByTestId("live-control-return-control"));
      expect(onReturnControl).toHaveBeenCalled();
    });

    it("disables URL input when in human control", () => {
      const { getByTestId } = render(
        <StudioLiveControlSurface
          browserState={makeBrowserState({ status: "human_control" })}
          actions={[]}
          isActing={false}
          mode="ACT"
        />,
      );
      const input = getByTestId("live-control-url-input") as HTMLInputElement;
      expect(input.disabled).toBe(true);
    });
  });

  describe("toolbar actions", () => {
    it("calls onRefresh when refresh button is clicked", () => {
      const onRefresh = vi.fn();
      const { getByTestId } = render(
        <StudioLiveControlSurface
          browserState={makeBrowserState()}
          actions={[]}
          isActing={false}
          mode="ACT"
          onRefresh={onRefresh}
        />,
      );
      fireEvent.click(getByTestId("live-control-refresh"));
      expect(onRefresh).toHaveBeenCalled();
    });

    it("calls onScreenshot when screenshot button is clicked", () => {
      const onScreenshot = vi.fn();
      const { getByTestId } = render(
        <StudioLiveControlSurface
          browserState={makeBrowserState()}
          actions={[]}
          isActing={false}
          mode="ACT"
          onScreenshot={onScreenshot}
        />,
      );
      fireEvent.click(getByTestId("live-control-screenshot"));
      expect(onScreenshot).toHaveBeenCalled();
    });
  });

  describe("loading state", () => {
    it("shows skeleton when loading", () => {
      const { container } = render(
        <StudioLiveControlSurface
          browserState={makeBrowserState()}
          actions={[]}
          isActing={false}
          mode="ACT"
          loading={true}
        />,
      );
      const skeletons = container.querySelectorAll('[data-testid="studio-skeleton"]');
      expect(skeletons.length).toBeGreaterThan(0);
    });
  });

  describe("LiTT operating indicator", () => {
    it("shows 'LiTT is operating' badge when acting with viewport", () => {
      const { getByTestId } = render(
        <StudioLiveControlSurface
          browserState={makeBrowserState({ screenshotUrl: "data:image/png;base64,abc" })}
          actions={[]}
          isActing={true}
          mode="ACT"
        />,
      );
      expect(getByTestId("live-control-viewport").textContent).toContain("LiTT is operating");
    });
  });
});
