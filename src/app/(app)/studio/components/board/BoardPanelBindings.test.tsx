import "@testing-library/jest-dom";
import { useState, type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ThemeProvider } from "@/context/ThemeContext";
import type { ConnectionCapabilities } from "../../hooks/useConnectionSummary";
import type { StudioInspectorData } from "../StudioWorkspaceFrame";
import type { PreviewSelection } from "../StudioPreviewPanel";
import BoardPanelBindings, { type BoardPanelBindingsProps } from "./BoardPanelBindings";
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

vi.mock("../StudioPreviewPanel", () => ({
  default: (props: {
    projectId: string | null;
    onSelectionChange?: (sel: PreviewSelection) => void;
  }) => (
    <div data-testid="studio-preview-panel" data-project-id={props.projectId ?? ""}>
      <button
        type="button"
        data-testid="preview-stub-select"
        onClick={() =>
          props.onSelectionChange?.({
            label: "Hero heading",
            selector: "#hero",
            tagName: "h1",
          } as PreviewSelection)
        }
      >
        select element
      </button>
    </div>
  ),
}));

vi.mock("../code/CodeWorkspace", () => ({
  CodeWorkspace: (props: { projectId: string | null; writeAccess?: boolean }) => (
    <div
      data-testid="code-workspace"
      data-project-id={props.projectId ?? ""}
      data-write-access={String(props.writeAccess)}
    />
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

vi.mock("../shell/ElementInspectorPanel", () => ({
  default: (props: { selection: { label?: string } }) => (
    <div data-testid="element-inspector" data-label={props.selection?.label ?? ""} />
  ),
}));

vi.mock("../StudioWorkspaceFrame", () => ({
  StudioInspector: (props: { activeTab: string; data?: unknown }) => (
    <div
      data-testid="studio-inspector"
      data-tab={props.activeTab}
      data-has-data={props.data ? "yes" : "no"}
    />
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
  it("preview binds the real StudioPreviewPanel for the active project", async () => {
    renderBinding("preview");
    expect(screen.getByTestId("board-binding-preview")).toBeInTheDocument();
    const panel = await screen.findByTestId("studio-preview-panel");
    expect(panel).toHaveAttribute("data-project-id", "project-1");
  });

  it("code binds the real CodeWorkspace with write access from capabilities", async () => {
    renderBinding("code");
    const ws = await screen.findByTestId("code-workspace");
    expect(ws).toHaveAttribute("data-project-id", "project-1");
    expect(ws).toHaveAttribute("data-write-access", "true");
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

  it("inspector binds the StudioInspector tab set when nothing is selected", () => {
    renderBinding("inspector");
    const inspector = screen.getByTestId("studio-inspector");
    expect(inspector).toHaveAttribute("data-tab", "plan");
    expect(inspector).toHaveAttribute("data-has-data", "yes");
    expect(screen.queryByTestId("element-inspector")).toBeNull();
  });

  it("inspector binds ElementInspectorPanel when a preview element is selected", () => {
    renderBinding("inspector", {
      previewSelection: { label: "Hero heading", selector: "#hero", tagName: "h1" } as PreviewSelection,
      showElementInspector: true,
    });
    expect(screen.getByTestId("element-inspector")).toHaveAttribute("data-label", "Hero heading");
    expect(screen.queryByTestId("studio-inspector")).toBeNull();
  });

  it("deploy binds StudioDeploySurface and forwards the deploy request", () => {
    const onDeployRequest = vi.fn();
    renderBinding("deploy", { onDeployRequest });
    expect(screen.getByTestId("deploy-surface")).toHaveAttribute("data-project-id", "project-1");
    fireEvent.click(screen.getByTestId("deploy-surface"));
    expect(onDeployRequest).toHaveBeenCalledWith("netlify");
  });

  it("media and world stay honest slots — no fake system is rendered", () => {
    for (const id of ["media", "world"] as const) {
      const { unmount } = renderBinding(id);
      const slot = screen.getByTestId(`board-panel-slot-${id}`);
      expect(slot).toBeInTheDocument();
      expect(slot.textContent?.length).toBeGreaterThan(0);
      unmount();
    }
  });

  it("Preview→Inspector link: a selection made in the Preview binding surfaces in the Inspector binding", async () => {
    // Mirrors CommandStudio's wiring: ONE selection state feeds the
    // Preview's onSelectionChange and the Inspector's selection props.
    function Harness() {
      const [selection, setSelection] = useState<PreviewSelection | null>(null);
      const shared: Partial<BoardPanelBindingsProps> = {
        onPreviewSelectionChange: (sel) => setSelection(sel),
        previewSelection: selection,
        showElementInspector: Boolean(selection),
      };
      return (
        <ThemeProvider>
          <BoardPanelBindings {...baseProps({ id: "preview", ...shared })} />
          <BoardPanelBindings {...baseProps({ id: "inspector", ...shared })} />
        </ThemeProvider>
      );
    }
    render(<Harness />);
    expect(screen.queryByTestId("element-inspector")).toBeNull();
    fireEvent.click(await screen.findByTestId("preview-stub-select"));
    const editor = await screen.findByTestId("element-inspector");
    expect(editor).toHaveAttribute("data-label", "Hero heading");
  });
});
