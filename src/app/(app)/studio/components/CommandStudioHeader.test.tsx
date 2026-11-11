import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import {
  INITIAL_RUNTIME_STATE,
  HOST_EXECUTION_UNAVAILABLE_LABEL,
  HOST_EXECUTION_UNAVAILABLE_MESSAGE,
  HOST_EXECUTION_UNAVAILABLE_SHORT,
  type ProjectRuntimeState,
} from "@/lib/projects/runtime-state";

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

  it("keeps execution mode contextual while showing branding and dock toggle", () => {
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

    fireEvent.click(screen.getByRole("button", { name: /more actions/i }));
    // PLAN / ACT / AUTO stays available in the contextual menu, not the permanent toolbar.
    const segmented = screen.getByTestId("execution-mode-segmented");
    expect(segmented.textContent).toContain("PLAN");
    expect(segmented.textContent).toContain("ACT");
    expect(segmented.textContent).toContain("AUTO");
    // The permanent mode-description strip is gone (chrome-stacking fix)
    expect(screen.queryByTestId("execution-mode-guide")).toBeNull();
    // No brand block in the project header (Larry's directive,
    // 2026-11-10): projects, Global LiTT, repo workspace status only.
    expect(screen.queryByTestId("studio-brand")).toBeNull();
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

  it("switches execution mode from the contextual menu", () => {
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
    fireEvent.click(screen.getByRole("button", { name: /more actions/i }));
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

  it("names the host-execution blocker instead of a generic not-ready (wave-4)", () => {
    render(
      <CommandStudioHeader
        onPreviewAction={vi.fn()}
        runtime={{
          ...readyRuntime,
          phase: "workspace_not_ready",
          executionAvailable: false,
          terminalConnected: false,
          workspaceStatus: "failed",
          error: { code: "HOST_EXECUTION_DISABLED", message: HOST_EXECUTION_UNAVAILABLE_MESSAGE },
        }}
        runtimeLoading={false}
        capabilities={mockCapabilities}
      />,
    );

    const pill = screen.getByLabelText(HOST_EXECUTION_UNAVAILABLE_LABEL);
    expect(pill).toBeTruthy();
    expect(pill.textContent).toContain(HOST_EXECUTION_UNAVAILABLE_SHORT);
    expect(screen.queryByLabelText("Workspace not ready")).toBeNull();
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

  it("workspace status popover reports real per-provider health, not subsystem capabilities", () => {
    mockProviderHealth = {
      Auto: "available",
      gemini: "available",
      groq: "unavailable",
      openrouter: "unavailable",
      ollama: "unavailable",
    };
    render(
      <CommandStudioHeader
        onPreviewAction={vi.fn()}
        runtime={readyRuntime}
        runtimeLoading={false}
        capabilities={mockCapabilities}
      />,
    );
    fireEvent.click(screen.getByTestId("agent-status-pill"));
    const dialog = screen.getByRole("dialog", { name: /workspace status/i });
    // One of the four health-checked providers is usable — a real count
    // from the provider health map, not the selected-model boolean.
    expect(dialog.textContent).toContain("1 of 4 available");
    expect(dialog.textContent).toContain("Gemini");
    expect(dialog.textContent).toContain("OpenRouter");
    // The old row dressed a boolean as a count ("1 connected") and listed
    // workspace subsystem capabilities (the fixture's connectionSummary)
    // as if they were AI providers. Neither may appear.
    expect(dialog.textContent).not.toContain("1 connected");
    expect(dialog.textContent).not.toContain("AI connected");
  });

  it("workspace status popover says providers are still checking until health is verified", () => {
    mockProviderHealth = {};
    render(
      <CommandStudioHeader
        onPreviewAction={vi.fn()}
        runtime={readyRuntime}
        runtimeLoading={false}
        capabilities={mockCapabilities}
      />,
    );
    fireEvent.click(screen.getByTestId("agent-status-pill"));
    const dialog = screen.getByRole("dialog", { name: /workspace status/i });
    expect(dialog.textContent).toContain("AI Providers");
    expect(dialog.textContent).not.toContain("None connected");
    expect(dialog.textContent).not.toContain("AI connected");
  });
});

describe("CommandStudioHeader — failed run must not sit under a green Ready pill", () => {
  beforeEach(() => {
    mockProviderHealth = { auto: "available" };
  });

  it("shows the Ready pill when the runtime is verified and no run failed", () => {
    render(
      <CommandStudioHeader
        onPreviewAction={vi.fn()}
        runtime={readyRuntime}
        runtimeLoading={false}
        capabilities={mockCapabilities}
      />,
    );
    expect(screen.getByLabelText("Runtime verified")).toBeTruthy();
    expect(screen.getByTestId("agent-status-pill").textContent).toContain("Ready");
  });

  it("replaces the Ready pill with Last run failed after a failed run", () => {
    render(
      <CommandStudioHeader
        onPreviewAction={vi.fn()}
        runtime={readyRuntime}
        runtimeLoading={false}
        capabilities={mockCapabilities}
        lastRunFailed={true}
      />,
    );
    expect(screen.getByLabelText("Last run failed")).toBeTruthy();
    expect(screen.getByTestId("agent-status-pill").textContent).toContain("Failed");
    expect(screen.queryByLabelText("Runtime verified")).toBeNull();
  });

  it("approval and busy still outrank the failed-run pill", () => {
    render(
      <CommandStudioHeader
        onPreviewAction={vi.fn()}
        runtime={readyRuntime}
        runtimeLoading={false}
        capabilities={mockCapabilities}
        lastRunFailed={true}
        busy={true}
      />,
    );
    expect(screen.getByTestId("agent-status-pill").textContent).toContain("Working");
  });
});
