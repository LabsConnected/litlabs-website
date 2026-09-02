import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import LiTEmptyState from "./LiTEmptyState";
import {
  deriveFirstMissionLaunchpadState,
  type FirstMissionLaunchpadInput,
} from "../lib/first-mission-launchpad";
import {
  INITIAL_RUNTIME_STATE,
  type ProjectRuntimeState,
} from "@/lib/projects/runtime-state";

vi.mock("./LiTTPresence", () => ({
  default: ({ state, variant, size }: { state: string; variant: string; size: string }) => (
    <div
      data-testid="litt-presence"
      aria-label="LiTT Studio operator presence"
      data-state={state}
      data-variant={variant}
      data-size={size}
    />
  ),
}));

vi.mock("./RecentConversations", () => ({
  default: () => <div data-testid="recent-conversations" />,
}));

function runtime(overrides: Partial<ProjectRuntimeState>): ProjectRuntimeState {
  return {
    ...INITIAL_RUNTIME_STATE,
    lastCheckedAt: "2026-08-31T00:00:00.000Z",
    ...overrides,
  };
}

const project = {
  projectId: "project-1",
  projectName: "First project",
  sourceType: "blank" as const,
};

function state(input: FirstMissionLaunchpadInput) {
  return deriveFirstMissionLaunchpadState(input);
}

const renderCases = [
  {
    name: "no project",
    expected: "Start blank project",
    input: { runtime: runtime({ phase: "idle" }), runtimeLoading: false, providerHealth: "available" as const },
  },
  {
    name: "workspace preparing",
    expected: null,
    input: {
      runtime: runtime({
        ...project,
        phase: "workspace_not_ready",
        workspaceId: "workspace-1",
        workspaceStatus: "preparing",
      }),
      runtimeLoading: false,
      providerHealth: "available" as const,
    },
  },
  {
    name: "workspace failed",
    expected: "Retry workspace",
    input: {
      runtime: runtime({
        ...project,
        phase: "workspace_not_ready",
        workspaceId: "workspace-1",
        workspaceStatus: "failed",
        error: { code: "WORKSPACE_NOT_READY", message: "Clone failed" },
      }),
      runtimeLoading: false,
      providerHealth: "available" as const,
    },
  },
  {
    name: "provider unavailable",
    expected: "Configure provider",
    input: {
      runtime: runtime({
        ...project,
        phase: "terminal_disconnected",
        workspaceId: "workspace-1",
        workspaceStatus: "ready",
        workspaceProvisioned: true,
        readAccess: true,
      }),
      runtimeLoading: false,
      providerHealth: "unavailable" as const,
    },
  },
  {
    name: "terminal disconnected",
    expected: "Connect terminal",
    input: {
      runtime: runtime({
        ...project,
        phase: "terminal_disconnected",
        workspaceId: "workspace-1",
        workspaceStatus: "ready",
        workspaceProvisioned: true,
        readAccess: true,
      }),
      runtimeLoading: false,
      providerHealth: "available" as const,
    },
  },
  {
    name: "fully ready",
    expected: "Prepare read-only inspection",
    input: {
      runtime: runtime({
        ...project,
        phase: "ready",
        workspaceId: "workspace-1",
        workspaceStatus: "ready",
        workspaceProvisioned: true,
        terminalConnected: true,
        executionAvailable: true,
        readAccess: true,
      }),
      runtimeLoading: false,
      providerHealth: "available" as const,
    },
  },
];

describe("LiTEmptyState truthful launchpad", () => {
  for (const testCase of renderCases) {
    it(`renders exactly the valid primary action for ${testCase.name}`, () => {
      render(
        <LiTEmptyState
          launchpadState={state(testCase.input)}
          onPrimaryAction={vi.fn()}
        />,
      );

      const primaryActions = screen.queryAllByTestId("first-mission-primary-action");
      expect(primaryActions).toHaveLength(testCase.expected ? 1 : 0);
      if (testCase.expected) {
        expect(primaryActions[0]).toHaveTextContent(testCase.expected);
      } else {
        expect(screen.getAllByText(/remain unavailable until the workspace reports ready/i).length).toBeGreaterThan(0);
      }
    });
  }

  it("does not render unsupported readiness or action claims", () => {
    render(
      <LiTEmptyState
        launchpadState={state({
          runtime: runtime({ phase: "idle" }),
          runtimeLoading: false,
          providerHealth: "available",
        })}
        onPrimaryAction={vi.fn()}
      />,
    );

    expect(screen.queryByText(/workspace ready|workspace online|agents ready/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /deploy|terminal|typescript|artwork/i })).not.toBeInTheDocument();
  });

  it("dispatches the derived action without submitting a mission", () => {
    const onPrimaryAction = vi.fn();
    const launchpadState = state({
      runtime: runtime({
        ...project,
        phase: "ready",
        workspaceId: "workspace-1",
        workspaceStatus: "ready",
        workspaceProvisioned: true,
        terminalConnected: true,
        executionAvailable: true,
      }),
      runtimeLoading: false,
      providerHealth: "available",
    });

    render(
      <LiTEmptyState
        launchpadState={launchpadState}
        onPrimaryAction={onPrimaryAction}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Prepare read-only inspection" }));

    expect(onPrimaryAction).toHaveBeenCalledOnce();
    expect(onPrimaryAction).toHaveBeenCalledWith("prepare_inspection");
  });

  it("preserves LiTT operator presence", () => {
    render(
      <LiTEmptyState
        launchpadState={state({
          runtime: runtime({ phase: "idle" }),
          runtimeLoading: false,
          providerHealth: "available",
        })}
        onPrimaryAction={vi.fn()}
      />,
    );

    expect(screen.getByTestId("litt-presence")).toHaveAttribute("data-variant", "empty-state");
  });
});
