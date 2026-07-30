import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

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
  voiceTransportConnected: false,
  voiceMicrophoneOn: false,
  voiceHealth: { configured: false, tokenService: "unknown" as const, available: false },
};

vi.mock("../hooks/useConnectionSummary", () => ({
  useConnectionSummary: () => ({ capabilities: mockCapabilities, loading: false }),
}));

// Mock model store
vi.mock("../stores/useStudioModelStore", () => ({
  useStudioModelStore: (selector: (s: { selectedModel: unknown; fallbackNotice: string | null; providerHealth: Record<string, string> }) => unknown) =>
    selector({
      selectedModel: { id: "auto", label: "Auto Best", provider: "auto", category: "auto", model: "", apiProvider: "" },
      fallbackNotice: null,
      providerHealth: {},
    }),
}));

// Mock Clerk UserButton
vi.mock("@clerk/nextjs", () => ({
  UserButton: () => <div data-testid="user-button" />,
}));

import CommandStudioHeader from "./CommandStudioHeader";

describe("CommandStudioHeader — Phase 1.1 truthful status", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does not say 'Workspace ready' when only AI is connected (no project)", () => {
    render(
      <CommandStudioHeader
        onPreview={vi.fn()}
        onOpenActivity={vi.fn()}
        projectReady={false}
        capabilities={mockCapabilities}
      />,
    );
    // Should say "Project setup required" not "Workspace ready"
    expect(screen.queryByText("Workspace ready")).toBeNull();
    expect(screen.getByText("Project setup required")).toBeTruthy();
  });

  it("Deploy button is disabled (no handler wired in Phase 1)", () => {
    render(
      <CommandStudioHeader
        onPreview={vi.fn()}
        onOpenActivity={vi.fn()}
        projectReady={false}
        capabilities={mockCapabilities}
      />,
    );
    const deployBtn = screen.getByRole("button", { name: /deploy/i });
    expect(deployBtn).toBeTruthy();
    expect(deployBtn.hasAttribute("disabled")).toBe(true);
  });

  it("Preview button calls onPreview (not onOpenActivity)", () => {
    const onPreview = vi.fn();
    const onOpenActivity = vi.fn();
    render(
      <CommandStudioHeader
        onPreview={onPreview}
        onOpenActivity={onOpenActivity}
        projectReady={true}
        capabilities={mockCapabilities}
      />,
    );
    const previewBtn = screen.getByRole("button", { name: /preview/i });
    previewBtn.click();
    expect(onPreview).toHaveBeenCalledTimes(1);
    expect(onOpenActivity).not.toHaveBeenCalled();
  });

  it("Activity button calls onOpenActivity", () => {
    const onOpenActivity = vi.fn();
    render(
      <CommandStudioHeader
        onPreview={vi.fn()}
        onOpenActivity={onOpenActivity}
        projectReady={false}
        capabilities={mockCapabilities}
      />,
    );
    const activityBtn = screen.getByRole("button", { name: /activity/i });
    activityBtn.click();
    expect(onOpenActivity).toHaveBeenCalledTimes(1);
  });

  it("does not render a project selector slot", () => {
    const { container } = render(
      <CommandStudioHeader
        onPreview={vi.fn()}
        onOpenActivity={vi.fn()}
        projectReady={false}
        capabilities={mockCapabilities}
      />,
    );
    // No project selector should be present — it was removed in Phase 1.1
    expect(container.querySelector("[data-testid='project-selector']")).toBeNull();
  });
});
