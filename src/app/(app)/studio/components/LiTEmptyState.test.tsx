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

const readyRuntime = runtime({
  ...project,
  phase: "ready",
  workspaceId: "workspace-1",
  workspaceStatus: "ready",
  workspaceProvisioned: true,
  terminalConnected: true,
  executionAvailable: true,
  readAccess: true,
});

const renderCases = [
  {
    name: "no project",
    expected: "Get started",
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
    expected: "Try again",
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
    expected: "Connect AI",
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
    expected: "Connect",
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
    expected: "Look over my project first",
    input: {
      runtime: readyRuntime,
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
        expect(screen.getAllByText(/still getting set up/i).length).toBeGreaterThan(0);
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
      runtime: readyRuntime,
      runtimeLoading: false,
      providerHealth: "available",
    });

    render(
      <LiTEmptyState
        launchpadState={launchpadState}
        onPrimaryAction={onPrimaryAction}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Look over my project first" }));

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

describe("LiTEmptyState first-run first screen", () => {
  function renderReady() {
    return render(
      <LiTEmptyState
        launchpadState={state({
          runtime: readyRuntime,
          runtimeLoading: false,
          providerHealth: "available",
        })}
        onPrimaryAction={vi.fn()}
      />,
    );
  }

  it("leads with the vision headline, not infrastructure", () => {
    renderReady();
    expect(
      screen.getByRole("heading", { name: /what do you want LiTT to do\?/i }),
    ).toBeInTheDocument();
  });

  it("renders all five starter chips", () => {
    renderReady();
    const group = screen.getByTestId("first-mission-starter-chips");
    expect(group).toBeInTheDocument();
    for (const label of [
      "Build my business website",
      "Fix something broken",
      "Make my site look better",
      "Create something new",
      "Surprise me",
    ]) {
      expect(screen.getByRole("button", { name: label })).toBeInTheDocument();
    }
  });

  it("keeps the setup checks collapsed behind the status line by default", () => {
    renderReady();
    expect(screen.getByTestId("first-mission-status")).toHaveTextContent(/you're all set/i);
    expect(screen.queryByTestId("first-mission-facts")).not.toBeInTheDocument();
    expect(screen.queryByText("AI provider")).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("first-mission-status"));
    expect(screen.getByTestId("first-mission-facts")).toBeInTheDocument();
    expect(screen.getByText("AI provider")).toBeInTheDocument();
  });

  it("shows a jargon-free getting-ready status while checking", () => {
    render(
      <LiTEmptyState
        launchpadState={state({
          runtime: runtime({ phase: "resolving" }),
          runtimeLoading: false,
          providerHealth: undefined,
        })}
        onPrimaryAction={vi.fn()}
      />,
    );
    expect(screen.getByTestId("first-mission-status")).toHaveTextContent(/getting things ready/i);
  });

  it("primes the composer through studio:ask-litt without submitting", () => {
    const onPrimaryAction = vi.fn();
    const dispatchSpy = vi.spyOn(window, "dispatchEvent");
    render(
      <LiTEmptyState
        launchpadState={state({
          runtime: readyRuntime,
          runtimeLoading: false,
          providerHealth: "available",
        })}
        onPrimaryAction={onPrimaryAction}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Surprise me" }));

    expect(onPrimaryAction).not.toHaveBeenCalled();
    expect(dispatchSpy).toHaveBeenCalledOnce();
    const event = dispatchSpy.mock.calls[0][0] as CustomEvent;
    expect(event.type).toBe("studio:ask-litt");
    expect(event.detail.prompt).toBe("Surprise me — build something cool");
    dispatchSpy.mockRestore();
  });

  it("transplants the describe-once box onto the first screen", () => {
    renderReady();
    expect(screen.getByTestId("first-mission-describe-box")).toBeInTheDocument();
    expect(screen.getByLabelText("Describe your business")).toBeInTheDocument();
  });

  it("keeps infrastructure nouns out of the default first screen", () => {
    renderReady();
    const root = screen.getByTestId("empty-state");
    expect(root.textContent).not.toMatch(/AI provider/i);
    // "Terminal"/"Deployment"/"Workspace" only live behind the collapsed checks.
    expect(screen.queryByText("Terminal")).not.toBeInTheDocument();
    expect(screen.queryByText("Deployment")).not.toBeInTheDocument();
  });

  it("hides starter chips and shows the blocker message when blocked", () => {
    render(
      <LiTEmptyState
        launchpadState={state({
          runtime: runtime({ phase: "idle" }),
          runtimeLoading: false,
          runtimeError: "boom",
          providerHealth: "available",
        })}
        onPrimaryAction={vi.fn()}
      />,
    );
    expect(screen.queryByTestId("first-mission-starter-chips")).not.toBeInTheDocument();
    expect(screen.queryByTestId("first-mission-describe-box")).not.toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Something needs attention" }),
    ).toBeInTheDocument();
  });

  it("tells the truth that choosing only fills the chat box", () => {
    renderReady();
    expect(
      screen.getByText(/choosing one fills in the chat box — nothing runs until you send it/i),
    ).toBeInTheDocument();
  });
});
