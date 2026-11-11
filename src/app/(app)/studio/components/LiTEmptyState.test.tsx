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
        phase: "terminal_unreachable",
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
    // Workspace ready + provider available: terminal execution being
    // unavailable must not replace the ready surface with a "Connect" gate.
    // It renders exactly like the fully ready case — silent, straight
    // into chat (the #892 empty-state contract).
    name: "terminal unreachable but workspace ready",
    expected: null,
    ready: true,
    input: {
      runtime: runtime({
        ...project,
        phase: "terminal_unreachable",
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
    // Larry's no-welcome directive (2026-11-10): a ready launchpad
    // renders NO notice and NO primary action — the conversation
    // simply opens (chips + composer). The old design's subtle
    // "Look over my project first" action is superseded.
    name: "fully ready",
    expected: null,
    ready: true,
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
      } else if ("ready" in testCase && testCase.ready) {
        // Ready = silent: no notice, no action, straight into chat.
        expect(screen.queryByTestId("first-mission-notice")).not.toBeInTheDocument();
        expect(screen.getByTestId("first-mission-starter-chips")).toBeInTheDocument();
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
      runtime: runtime({
        ...project,
        phase: "workspace_not_ready",
        workspaceId: "workspace-1",
        workspaceStatus: "failed",
        error: { code: "WORKSPACE_NOT_READY", message: "Clone failed" },
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
    fireEvent.click(screen.getByRole("button", { name: /try again/i }));

    expect(onPrimaryAction).toHaveBeenCalledOnce();
    expect(onPrimaryAction).toHaveBeenCalledWith("retry_workspace");
  });

  it("renders no welcome hero — the welcome screen is removed", () => {
    // Superseded by Larry's directive (2026-11-10): the hero
    // presence + greeting headline WERE the welcome screen.
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

    expect(screen.queryByTestId("litt-presence")).not.toBeInTheDocument();
    expect(screen.queryByRole("heading")).not.toBeInTheDocument();
  });
});

describe("LiTEmptyState direct conversation open (no welcome screen)", () => {
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

  it("opens direct when ready: no headline, no notice — chips and composer only", () => {
    renderReady();
    expect(screen.queryByRole("heading")).not.toBeInTheDocument();
    expect(screen.queryByTestId("first-mission-notice")).not.toBeInTheDocument();
    expect(screen.queryByTestId("first-mission-status")).not.toBeInTheDocument();
    expect(screen.getByTestId("first-mission-starter-chips")).toBeInTheDocument();
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

  it("keeps the setup checks collapsed behind the status line while not ready", () => {
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

  it("does not gate the chat behind the describe-your-business funnel", () => {
    // The describe-once box was part of the removed welcome screen;
    // describing happens in the composer itself now.
    renderReady();
    expect(screen.queryByTestId("first-mission-describe-box")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Describe your business")).not.toBeInTheDocument();
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
    expect(screen.getByTestId("first-mission-notice")).toBeInTheDocument();
    expect(screen.getByText("Something needs attention")).toBeInTheDocument();
  });

  it("tells the truth that choosing only fills the chat box", () => {
    renderReady();
    expect(
      screen.getByText(/choosing one fills in the chat box — nothing runs until you send it/i),
    ).toBeInTheDocument();
  });
});
