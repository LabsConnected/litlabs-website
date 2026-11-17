import "@testing-library/jest-dom";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { ThemeProvider } from "@/context/ThemeContext";
import type { ConnectionCapabilities } from "../../hooks/useConnectionSummary";
import type { StudioInspectorData } from "../StudioWorkspaceFrame";
import BoardPanelBindings, {
  resetBoardPreviewHome,
  setBoardPreviewHome,
  type BoardPanelBindingsProps,
} from "./BoardPanelBindings";
import type { BoardPanelId } from "./board-types";

// ── Mocks ────────────────────────────────────────────────────────────
// Same next/dynamic passthrough harness as the CommandStudio shell
// tests: dynamic() resolves via React.lazy so the binding's chosen
// component is observable. The heavy surfaces themselves are stubbed —
// these tests pin the BINDING (which real component, with which props),
// not the surfaces' internals (covered by their own suites).

vi.mock("next/dynamic", async () => {
  const React = await import("react");
  return {
    default: (loader: () => Promise<unknown>) => {
      const Lazy = React.lazy(() =>
        loader().then((resolved) => {
          const mod = resolved as Record<string, unknown>;
          const Comp = (
            typeof resolved === "function" ? resolved : (mod.default ?? Object.values(mod)[0])
          ) as React.ComponentType<Record<string, unknown>>;
          return { default: Comp };
        }),
      );
      return function DynamicPassthrough(props: Record<string, unknown>) {
        return React.createElement(
          React.Suspense,
          { fallback: null },
          React.createElement(Lazy, props),
        );
      };
    },
  };
});

vi.mock("../code/CodeWorkspace", () => ({
  CodeWorkspace: (props: {
    projectId: string | null;
    writeAccess?: boolean;
    previewContent?: ReactNode;
    previewPlaceholder?: ReactNode;
    canvasContent?: ReactNode;
    planCapabilities?: unknown;
    onPreviewRefreshRequest?: () => void;
  }) => (
    <div
      data-testid="code-workspace"
      data-project-id={props.projectId ?? ""}
      data-write-access={String(props.writeAccess)}
      data-has-plan={props.planCapabilities ? "yes" : "no"}
      data-has-refresh-callback={props.onPreviewRefreshRequest ? "yes" : "no"}
    >
      {props.previewContent}
      {props.previewPlaceholder}
      {props.canvasContent}
    </div>
  ),
}));

vi.mock("../StudioTerminalDrawer", () => ({
  default: (props: { projectId: string | null; visible?: boolean }) => (
    <div
      data-testid="terminal-drawer"
      data-project-id={props.projectId ?? ""}
      data-visible={String(props.visible)}
    />
  ),
}));

vi.mock("../StudioHealthPanel", () => ({
  default: (props: { mode: string; projectId: string | null; refreshKey?: number; runTrigger?: number }) => (
    <div
      data-testid="studio-health-panel"
      data-mode={props.mode}
      data-project-id={props.projectId ?? ""}
      data-refresh-key={String(props.refreshKey)}
      data-run-trigger={String(props.runTrigger)}
    />
  ),
}));

vi.mock("../shell/StudioDeploySurface", () => ({
  default: (props: { projectId: string | null; onDeployRequest: (t: "litt" | "netlify") => void }) => (
    <button
      type="button"
      data-testid="deploy-surface"
      data-project-id={props.projectId ?? ""}
      onClick={() => props.onDeployRequest("netlify")}
    >
      deploy
    </button>
  ),
}));

vi.mock("../StudioWorkspaceFrame", () => ({
  StudioActivityPanel: (props: { runId: string | null; missionContent?: ReactNode }) => (
    <div data-testid="studio-activity-panel" data-run-id={props.runId ?? ""}>
      {props.missionContent}
    </div>
  ),
}));

vi.mock("../MissionCards", () => ({
  default: (props: { onOpenCode?: () => void }) => (
    <div data-testid="mission-cards">
      <button type="button" data-testid="mission-stub-open-code" onClick={() => props.onOpenCode?.()}>
        open code
      </button>
    </div>
  ),
}));

// ── Fixtures ─────────────────────────────────────────────────────────

const capabilities = {
  projectId: "project-1",
  projectName: "Test Project",
  repositoryName: "owner/repo",
  activeBranch: "main",
  defaultBranch: "main",
  sourceKind: "github",
  sourceStatus: "ready",
  versionControl: "git",
  workspaceStatus: "ready",
  writeAccess: true,
} as unknown as ConnectionCapabilities;

const inspectorData = { marker: "inspector-data" } as unknown as StudioInspectorData;

function baseProps(overrides: Partial<BoardPanelBindingsProps> = {}): BoardPanelBindingsProps {
  return {
    id: "preview",
    userId: "user-1",
    projectId: "project-1",
    capabilities,
    lastRunFailureNote: null,
    onPreviewSelectionChange: vi.fn(),
    filesContent: <div data-testid="studio-project-files" />,
    previewContent: <div data-testid="studio-preview-panel" data-project-id="project-1" />,
    workspaceRevision: 3,
    healthRunTrigger: 2,
    previewSelection: null,
    showElementInspector: false,
    onAskAboutSelection: vi.fn(),
    onClearSelection: vi.fn(),
    inspectorTab: "plan",
    onInspectorTabChange: vi.fn(),
    inspectorData,
    onDeployRequest: vi.fn(),
    chatContent: <div data-testid="board-chat-content" />,
    canvasContent: <div data-testid="board-canvas-content" />,
    summonPanel: vi.fn(),
    activityRunId: "run-1",
    activityBusy: false,
    activityModelLabel: "Test Model",
    activityTerminalStatus: "Connected",
    onRollback: vi.fn(),
    ...overrides,
  };
}

function renderBinding(id: BoardPanelId, overrides: Partial<BoardPanelBindingsProps> = {}) {
  return render(
    <ThemeProvider>
      <BoardPanelBindings {...baseProps({ id, ...overrides })} />
    </ThemeProvider>,
  );
}

describe("BoardPanelBindings (B3)", () => {
  beforeEach(() => {
    resetBoardPreviewHome();
  });

  it("preview renders the single shared previewContent element built by CommandStudio", async () => {
    renderBinding("preview");
    expect(screen.getByTestId("board-binding-preview")).toBeInTheDocument();
    const panel = await screen.findByTestId("studio-preview-panel");
    expect(panel).toHaveAttribute("data-project-id", "project-1");
    expect(screen.getAllByTestId("studio-preview-panel")).toHaveLength(1);
  });

  it("code binds the real CodeWorkspace with write access from capabilities", async () => {
    renderBinding("code");
    const ws = await screen.findByTestId("code-workspace");
    expect(ws).toHaveAttribute("data-project-id", "project-1");
    expect(ws).toHaveAttribute("data-write-access", "true");
  });

  it("code receives the canvas element, plan data and the preview refresh callback", async () => {
    renderBinding("code", { onPreviewRefreshRequest: vi.fn() });
    const ws = await screen.findByTestId("code-workspace");
    expect(ws).toHaveAttribute("data-has-plan", "yes");
    expect(ws).toHaveAttribute("data-has-refresh-callback", "yes");
    expect(screen.getByTestId("board-canvas-content")).toBeInTheDocument();
  });

  it("only one preview home renders the shared element at a time — Code home", async () => {
    act(() => setBoardPreviewHome("code"));
    render(
      <ThemeProvider>
        <BoardPanelBindings {...baseProps({ id: "preview" })} />
        <BoardPanelBindings {...baseProps({ id: "code" })} />
      </ThemeProvider>,
    );
    // Exactly one instance of the shared element across both panels.
    expect(await screen.findAllByTestId("studio-preview-panel")).toHaveLength(1);
    // The Preview panel shows the honest pointer card instead.
    expect(screen.getByTestId("board-preview-pointer-to-code")).toBeInTheDocument();
    expect(screen.getByTestId("board-preview-pointer-to-code").textContent).toContain(
      "Preview is showing in the Code panel",
    );
  });

  it("only one preview home renders the shared element at a time — Preview home", async () => {
    render(
      <ThemeProvider>
        <BoardPanelBindings {...baseProps({ id: "preview" })} />
        <BoardPanelBindings {...baseProps({ id: "code" })} />
      </ThemeProvider>,
    );
    expect(await screen.findAllByTestId("studio-preview-panel")).toHaveLength(1);
    // The Code box's preview region shows the reverse pointer card.
    expect(screen.getByTestId("code-preview-pointer-to-preview")).toBeInTheDocument();
    expect(screen.getByTestId("code-preview-pointer-to-preview").textContent).toContain(
      "Preview is showing in the Preview panel",
    );
  });

  it("the Code-side pointer card brings the preview here — home moves to Code", async () => {
    render(
      <ThemeProvider>
        <BoardPanelBindings {...baseProps({ id: "preview" })} />
        <BoardPanelBindings {...baseProps({ id: "code" })} />
      </ThemeProvider>,
    );
    await screen.findByTestId("code-workspace");
    // Preview starts in the Preview panel; the Code-side card offers to
    // bring it here. Clicking moves the ONE shared element into Code —
    // still exactly one mounted preview afterwards.
    fireEvent.click(screen.getByRole("button", { name: "Bring preview here" }));
    expect(await screen.findAllByTestId("studio-preview-panel")).toHaveLength(1);
    expect(screen.queryByTestId("code-preview-pointer-to-preview")).toBeNull();
    expect(screen.getByTestId("board-preview-pointer-to-code")).toBeInTheDocument();
    expect(
      screen.getByTestId("code-workspace").contains(screen.getByTestId("studio-preview-panel")),
    ).toBe(true);
  });

  it("the Preview-side pointer card brings the preview back — home moves to Preview", async () => {
    act(() => setBoardPreviewHome("code"));
    render(
      <ThemeProvider>
        <BoardPanelBindings {...baseProps({ id: "preview" })} />
        <BoardPanelBindings {...baseProps({ id: "code" })} />
      </ThemeProvider>,
    );
    await screen.findByTestId("code-workspace");
    fireEvent.click(screen.getByRole("button", { name: "Bring preview here" }));
    expect(await screen.findAllByTestId("studio-preview-panel")).toHaveLength(1);
    expect(screen.queryByTestId("board-preview-pointer-to-code")).toBeNull();
    expect(screen.getByTestId("code-preview-pointer-to-preview")).toBeInTheDocument();
    expect(
      screen.getByTestId("board-binding-preview").contains(screen.getByTestId("studio-preview-panel")),
    ).toBe(true);
  });

  it("files renders the single relocated Files element — exactly one instance", () => {
    renderBinding("files");
    const instances = screen.getAllByTestId("studio-project-files");
    expect(instances).toHaveLength(1);
    expect(screen.getByTestId("board-binding-files").contains(instances[0])).toBe(true);
  });

  it("terminal binds StudioTerminalDrawer as visible (board panels render only when open)", async () => {
    renderBinding("terminal");
    const drawer = await screen.findByTestId("terminal-drawer");
    expect(drawer).toHaveAttribute("data-project-id", "project-1");
    expect(drawer).toHaveAttribute("data-visible", "true");
  });

  it("health binds StudioHealthPanel in checks mode with the shared revision/trigger", () => {
    renderBinding("health");
    const panel = screen.getByTestId("studio-health-panel");
    expect(panel).toHaveAttribute("data-mode", "checks");
    expect(panel).toHaveAttribute("data-project-id", "project-1");
    expect(panel).toHaveAttribute("data-refresh-key", "3");
    expect(panel).toHaveAttribute("data-run-trigger", "2");
  });

  it("inspector is retired — no board binding renders for it", () => {
    const { container } = renderBinding("inspector" as BoardPanelId);
    expect(container.firstChild).toBeNull();
    expect(screen.queryByTestId("board-binding-inspector")).toBeNull();
  });

  it("plan is retired as a board panel — Plan lives inside the Code box", () => {
    const { container } = renderBinding("plan" as BoardPanelId);
    expect(container.firstChild).toBeNull();
    expect(screen.queryByTestId("board-binding-plan")).toBeNull();
  });

  it("canvas is retired as a board panel — Canvas / Design lives inside the Code box", () => {
    const { container } = renderBinding("canvas" as BoardPanelId);
    expect(container.firstChild).toBeNull();
    expect(screen.queryByTestId("board-binding-canvas")).toBeNull();
  });

  it("deploy binds StudioDeploySurface and forwards the deploy request", () => {
    const onDeployRequest = vi.fn();
    renderBinding("deploy", { onDeployRequest });
    expect(screen.getByTestId("deploy-surface")).toHaveAttribute("data-project-id", "project-1");
    fireEvent.click(screen.getByTestId("deploy-surface"));
    expect(onDeployRequest).toHaveBeenCalledWith("netlify");
  });

  it("world stays an honest slot — no fake system is rendered", () => {
    renderBinding("world");
    const slot = screen.getByTestId("board-panel-slot-world");
    expect(slot).toBeInTheDocument();
    expect(slot.textContent?.length).toBeGreaterThan(0);
  });

  it("chat binds the Command Center chat content built by CommandStudio", () => {
    renderBinding("chat");
    expect(screen.getByTestId("board-binding-chat")).toBeInTheDocument();
    expect(screen.getByTestId("board-chat-content")).toBeInTheDocument();
  });

  it("media binds the real BoardMediaPanel (Asset Lake tabs)", () => {
    renderBinding("media");
    expect(screen.getByTestId("board-binding-media")).toBeInTheDocument();
    expect(screen.getByTestId("board-media-panel")).toBeInTheDocument();
    expect(screen.getByTestId("board-media-tab-images")).toBeInTheDocument();
    expect(screen.getByTestId("board-media-tab-video")).toBeInTheDocument();
    expect(screen.getByTestId("board-media-tab-music")).toBeInTheDocument();
  });

  it("browser binds the real BoardBrowserPanel", () => {
    renderBinding("browser");
    expect(screen.getByTestId("board-binding-browser")).toBeInTheDocument();
    expect(screen.getByTestId("board-browser-panel")).toBeInTheDocument();
  });

  it("activity binds StudioActivityPanel with MissionCards, actions rewired to summons", () => {
    const summonPanel = vi.fn();
    renderBinding("activity", { summonPanel });
    const panel = screen.getByTestId("studio-activity-panel");
    expect(panel).toHaveAttribute("data-run-id", "run-1");
    fireEvent.click(screen.getByTestId("mission-stub-open-code"));
    expect(summonPanel).toHaveBeenCalledWith("code");
  });

});
