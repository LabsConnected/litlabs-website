import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { INITIAL_RUNTIME_STATE, type ProjectRuntimeState } from "@/lib/projects/runtime-state";

// Mock wallet
vi.mock("@/context/WalletContext", () => ({
  useWallet: () => ({ balance: 100, isLoading: false }),
}));

// Mock connection summary
const mockCapabilities = {
  connectedProviders: ["gemini"],
  repository: "disconnected" as const,
  repositoryName: null,
  repositoryIndexed: false,
  projectId: null,
  projectName: null,
  defaultBranch: null,
  activeBranch: null,
  sourceType: null,
  sourceKind: null,
  sourceLabel: null,
  sourceStatus: null,
  versionControl: "none" as const,
  githubConnected: false,
  workspaceStatus: null,
  githubInstalled: false,
  terminalExecution: "unavailable" as const,
  writeAccess: false,
  availableTools: [] as string[],
  connectionSummary: "AI connected",
  terminalStatus: "disconnected" as const,
  terminalSessionId: null,
  terminalError: null,
  terminalFailureStage: null,
  terminalCwd: null,
  terminalServerReachable: false,
  voiceTransportConnected: false,
  voiceMicrophoneOn: false,
  voiceHealth: { configured: false, tokenService: "unknown" as const, available: false },
};

const noProjectRuntime: ProjectRuntimeState = {
  ...INITIAL_RUNTIME_STATE,
  lastCheckedAt: "2026-08-31T00:00:00.000Z",
};

const readyRuntime: ProjectRuntimeState = {
  ...noProjectRuntime,
  phase: "ready",
  executionAvailable: true,
  workspaceProvisioned: true,
  terminalConnected: true,
  projectId: "project-1",
  projectName: "Project one",
  workspaceId: "workspace-1",
  workspaceStatus: "ready",
  readAccess: true,
};

let mockProviderHealth: Record<string, string> = {};

vi.mock("../hooks/useConnectionSummary", () => ({
  useConnectionSummary: () => ({ capabilities: mockCapabilities, loading: false }),
}));

// Mock model store
vi.mock("../stores/useStudioModelStore", () => ({
  useStudioModelStore: (selector: (s: { selectedModel: unknown; selectModel: unknown; fallbackNotice: string | null; providerHealth: Record<string, string> }) => unknown) =>
    selector({
      selectedModel: { id: "auto", label: "Auto Best", provider: "auto", category: "auto", model: "", apiProvider: "" },
      selectModel: vi.fn(),
      fallbackNotice: null,
      providerHealth: mockProviderHealth,
    }),
  MODELS: [{ id: "auto", label: "Auto Best", provider: "auto", category: "auto", model: "", apiProvider: "" }],
}));

// Mock Clerk UserButton + useAuth (StudioProjectPicker → useConfiguredAuth → useAuth)
vi.mock("@clerk/nextjs", () => ({
  UserButton: () => <div data-testid="user-button" />,
  useAuth: () => ({ userId: "test-user-id", isLoaded: true, isSignedIn: true }),
}));

// Mock ModelPicker — it uses useTheme which requires ThemeProvider
vi.mock("@/components/ModelPicker", () => ({
  default: ({ selectedModel }: { selectedModel: string }) => (
    <div data-testid="model-picker-mock">{selectedModel}</div>
  ),
}));

// Mock fetch so the notifications poll doesn't trigger async act warnings
vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) }));

import CommandStudioHeader from "./CommandStudioHeader";

describe("CommandStudioHeader — truthful status", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockProviderHealth = {};
  });

  it("shows the segmented mode control, branding, and dock toggle", () => {
    const onToggleDock = vi.fn();
    render(
      <CommandStudioHeader
        onPreviewAction={vi.fn()}
        onToggleDockAction={onToggleDock}
        runtime={noProjectRuntime}
        runtimeLoading={false}
        capabilities={mockCapabilities}
        executionMode="act"
        onExecutionModeChange={vi.fn()}
      />,
    );

    // Segmented PLAN / ACT / AUTO control replaces the old dropdown + guide strip
    const segmented = screen.getByTestId("execution-mode-segmented");
    expect(segmented.textContent).toContain("PLAN");
    expect(segmented.textContent).toContain("ACT");
    expect(segmented.textContent).toContain("AUTO");
    // The permanent mode-description strip is gone (chrome-stacking fix)
    expect(screen.queryByTestId("execution-mode-guide")).toBeNull();
    expect(screen.getByTestId("studio-brand")).toBeTruthy();
    fireEvent.click(screen.getByTestId("studio-dock-toggle"));
    expect(onToggleDock).toHaveBeenCalledTimes(1);
  });

  it("reports checking while runtime is loading", () => {
    render(
      <CommandStudioHeader
        onPreviewAction={vi.fn()}
        runtime={noProjectRuntime}
        runtimeLoading={true}
        capabilities={mockCapabilities}
      />,
    );
    expect(screen.getByLabelText("Runtime status checking")).toBeTruthy();
    expect(screen.queryByText("Workspace ready")).toBeNull();
  });

  it("does not expose Deploy before read-only inspection proof", () => {
    render(
      <CommandStudioHeader
        onPreviewAction={vi.fn()}
        runtime={noProjectRuntime}
        runtimeLoading={false}
        capabilities={mockCapabilities}
      />,
    );
    expect(screen.queryByRole("button", { name: /deploy/i })).toBeNull();
  });

  it("Preview button calls onPreview when runtime is verified", () => {
    mockProviderHealth = { auto: "available" };
    const onPreview = vi.fn();
    render(
      <CommandStudioHeader
        onPreviewAction={onPreview}
        runtime={readyRuntime}
        runtimeLoading={false}
        capabilities={mockCapabilities}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /more actions/i }));
    const previewBtn = screen.getByRole("button", { name: /preview/i });
    fireEvent.click(previewBtn);
    expect(onPreview).toHaveBeenCalledTimes(1);
  });

  it("switches execution mode from the segmented control", () => {
    const onModeChange = vi.fn();
    render(
      <CommandStudioHeader
        onPreviewAction={vi.fn()}
        onToggleDockAction={vi.fn()}
        runtime={noProjectRuntime}
        runtimeLoading={false}
        capabilities={mockCapabilities}
        executionMode="auto"
        onExecutionModeChange={onModeChange}
      />,
    );
    fireEvent.click(screen.getByTestId("execution-mode-plan"));
    expect(onModeChange).toHaveBeenCalledWith("plan");
  });

  it("shows an approval-needed pill when an approval gate is pending", () => {
    render(
      <CommandStudioHeader
        onPreviewAction={vi.fn()}
        onToggleDockAction={vi.fn()}
        runtime={readyRuntime}
        runtimeLoading={false}
        capabilities={mockCapabilities}
        approvalPending={true}
      />,
    );
    expect(screen.getByTestId("agent-status-pill").textContent).toContain("Approval");
  });

  it("shows a working pill while the agent is busy", () => {
    render(
      <CommandStudioHeader
        onPreviewAction={vi.fn()}
        onToggleDockAction={vi.fn()}
        runtime={readyRuntime}
        runtimeLoading={false}
        capabilities={mockCapabilities}
        busy={true}
      />,
    );
    expect(screen.getByTestId("agent-status-pill").textContent).toContain("Working");
  });

  it("opens the dock terminal tab from overflow menu when PTY is disconnected", () => {
    const onOpenDockTab = vi.fn();
    render(
      <CommandStudioHeader
        onPreviewAction={vi.fn()}
        onToggleDockAction={vi.fn()}
        onOpenDockTabAction={onOpenDockTab}
        runtime={noProjectRuntime}
        runtimeLoading={false}
        capabilities={mockCapabilities}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /more actions/i }));
    const terminalBtn = screen.getByRole("button", { name: /terminal/i });
    fireEvent.click(terminalBtn);
    expect(onOpenDockTab).toHaveBeenCalledWith("terminal");
  });

  it("does not render a project selector slot", () => {
    const { container } = render(
      <CommandStudioHeader
        onPreviewAction={vi.fn()}
        runtime={noProjectRuntime}
        runtimeLoading={false}
        capabilities={mockCapabilities}
      />,
    );
    expect(container.querySelector("[data-testid='project-selector']")).toBeNull();
  });

  it("reports canonical partial runtime state without implying readiness", () => {
    render(
      <CommandStudioHeader
        onPreviewAction={vi.fn()}
        runtime={{
          ...readyRuntime,
          phase: "workspace_not_ready",
          executionAvailable: false,
          terminalConnected: false,
          workspaceStatus: "preparing",
        }}
        runtimeLoading={false}
        capabilities={mockCapabilities}
      />,
    );

    expect(screen.getByLabelText("Workspace not ready")).toBeTruthy();
    expect(screen.queryByLabelText("Runtime verified")).toBeNull();
  });

  it("uses the strongest status only for canonical ready runtime and verified provider", () => {
    mockProviderHealth = { auto: "available" };
    render(
      <CommandStudioHeader
        onPreviewAction={vi.fn()}
        runtime={readyRuntime}
        runtimeLoading={false}
        capabilities={mockCapabilities}
      />,
    );

    expect(screen.getByLabelText("Runtime verified")).toBeTruthy();
  });

  it("does not report ready when the provider is unavailable", () => {
    mockProviderHealth = { auto: "unavailable" };
    render(
      <CommandStudioHeader
        onPreviewAction={vi.fn()}
        runtime={readyRuntime}
        runtimeLoading={false}
        capabilities={mockCapabilities}
      />,
    );

    expect(screen.getByLabelText("AI provider unavailable")).toBeTruthy();
    expect(screen.queryByLabelText("Runtime verified")).toBeNull();
  });
});

describe("CommandStudioHeader — mobile scroll affordance (Phase 1 #1)", () => {
  it("scrolls horizontally on small screens so right-end actions stay reachable", () => {
    render(
      <CommandStudioHeader
        onPreviewAction={vi.fn()}
        runtime={noProjectRuntime}
        runtimeLoading={false}
        capabilities={mockCapabilities}
      />,
    );
    const header = screen.getByTestId("studio-header");
    // Mobile: horizontal scroll with a hidden scrollbar; desktop keeps the
    // old clipped layout.
    expect(header.className).toContain("overflow-x-auto");
    expect(header.className).toContain("no-scrollbar");
    expect(header.className).toContain("sm:overflow-hidden");
  });

  it("keeps the dock toggle and overflow menu mounted in the header", () => {
    render(
      <CommandStudioHeader
        onPreviewAction={vi.fn()}
        runtime={noProjectRuntime}
        runtimeLoading={false}
        capabilities={mockCapabilities}
      />,
    );
    expect(screen.getByTestId("studio-dock-toggle")).toBeTruthy();
    expect(screen.getByLabelText("More actions")).toBeTruthy();
  });
});
