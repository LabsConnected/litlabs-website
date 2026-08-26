import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

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
      providerHealth: {},
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

describe("CommandStudioHeader — Phase 1.1 truthful status", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does not say 'Workspace ready' when only AI is connected (no project)", () => {
    render(
      <CommandStudioHeader
        onPreviewAction={vi.fn()}
        onOpenActivityAction={vi.fn()}
        projectReady={false}
        capabilities={mockCapabilities}
      />,
    );
    // The status label is now a compact dot with title tooltip — no text.
    // "Workspace ready" should never appear without a project.
    expect(screen.queryByText("Workspace ready")).toBeNull();
    // The status dot is rendered with an aria-label for accessibility.
    const statusDot = screen.getByLabelText("Chat ready");
    expect(statusDot).toBeTruthy();
  });

  it("Deploy button is disabled when no project is ready", () => {
    render(
      <CommandStudioHeader
        onPreviewAction={vi.fn()}
        onOpenActivityAction={vi.fn()}
        projectReady={false}
        capabilities={mockCapabilities}
      />,
    );
    // Deploy is now a visible button in the header (not in overflow menu)
    const deployBtn = screen.getByRole("button", { name: /deploy/i });
    expect(deployBtn).toBeTruthy();
    expect(deployBtn.hasAttribute("disabled")).toBe(true);
  });

  it("Preview button calls onPreview (lives in overflow menu)", () => {
    const onPreview = vi.fn();
    const onOpenActivity = vi.fn();
    render(
      <CommandStudioHeader
        onPreviewAction={onPreview}
        onOpenActivityAction={onOpenActivity}
        projectReady={true}
        capabilities={mockCapabilities}
      />,
    );
    // Preview now lives behind the overflow menu — open it first.
    fireEvent.click(screen.getByRole("button", { name: /more actions/i }));
    const previewBtn = screen.getByRole("button", { name: /preview/i });
    fireEvent.click(previewBtn);
    expect(onPreview).toHaveBeenCalledTimes(1);
    expect(onOpenActivity).not.toHaveBeenCalled();
  });

  it("Activity button calls onOpenActivity", () => {
    const onOpenActivity = vi.fn();
    render(
      <CommandStudioHeader
        onPreviewAction={vi.fn()}
        onOpenActivityAction={onOpenActivity}
        projectReady={false}
        capabilities={mockCapabilities}
      />,
    );
    const activityBtn = screen.getByRole("button", { name: /activity/i });
    activityBtn.click();
    expect(onOpenActivity).toHaveBeenCalledTimes(1);
  });

  it("opens the terminal drawer from overflow menu when PTY is disconnected", () => {
    const onOpenTerminal = vi.fn();
    render(
      <CommandStudioHeader
        onPreviewAction={vi.fn()}
        onOpenActivityAction={vi.fn()}
        onOpenTerminalAction={onOpenTerminal}
        projectReady={false}
        capabilities={mockCapabilities}
      />,
    );
    // Terminal access is now in the overflow menu (⋯) — the workspace
    // status popover was removed to simplify the top bar.
    fireEvent.click(screen.getByRole("button", { name: /more actions/i }));
    const terminalBtn = screen.getByRole("button", { name: /terminal/i });
    fireEvent.click(terminalBtn);
    expect(onOpenTerminal).toHaveBeenCalledTimes(1);
  });

  it("does not render a project selector slot", () => {
    const { container } = render(
      <CommandStudioHeader
        onPreviewAction={vi.fn()}
        onOpenActivityAction={vi.fn()}
        projectReady={false}
        capabilities={mockCapabilities}
      />,
    );
    // No project selector should be present — it was removed in Phase 1.1
    expect(container.querySelector("[data-testid='project-selector']")).toBeNull();
  });
});
