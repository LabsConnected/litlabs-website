import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, act, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom";

// ── Mocks ────────────────────────────────────────────────────────────
// Same harness as CommandStudio.routing.test.tsx, EXCEPT next/dynamic:
// here dynamic() actually resolves via React.lazy + Suspense so the
// mounted-component graph is real — this suite counts mounted
// StudioPreviewPanel instances, which requires the lazy boundaries to
// resolve.

const stableSearchParams = new URLSearchParams("tool=chat");

vi.mock("next/navigation", () => ({
  useSearchParams: () => stableSearchParams,
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => "/studio",
}));

// next/dynamic → lazy + Suspense passthrough. Loaders resolve either a
// module namespace (use .default) or a component directly (when the
// loader already does `.then((m) => m.Named)`).
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

// StudioPreviewPanel is the unit under observation — stub it with a
// stable testid so mounted instances can be counted.
vi.mock("./StudioPreviewPanel", () => ({
  default: ({ onToggleSplitPreview }: { onToggleSplitPreview?: () => void }) => (
    <div data-testid="studio-preview-panel">
      {onToggleSplitPreview && (
        <button type="button" data-testid="preview-split-toggle" onClick={onToggleSplitPreview} />
      )}
    </div>
  ),
}));

// Other dynamic children that would be pulled in by the lazy passthrough
// are stubbed so this suite stays focused on the preview mount graph.
vi.mock("./StudioPlanSurface", () => ({
  default: () => <div data-testid="studio-plan-surface" />,
}));
vi.mock("./StudioTerminalDrawer", () => ({
  default: () => <div data-testid="terminal-drawer" />,
}));
vi.mock("./LiveVoiceOverlay", () => ({
  default: () => <div data-testid="live-voice-overlay" />,
}));
vi.mock("./canvas/builder/VisualCanvasBuilder", () => ({
  VisualCanvasBuilder: () => <div data-testid="visual-canvas-builder" />,
}));
vi.mock("./StudioFilePreview", () => ({
  StudioFilePreview: () => <div data-testid="studio-file-preview" />,
}));
vi.mock("@monaco-editor/react", () => ({
  default: () => <div data-testid="monaco-editor" />,
}));
vi.mock("../tools/MusicTool", () => ({ default: () => <div data-testid="music-tool" /> }));
vi.mock("../tools/DesignCanvas", () => ({ default: () => <div data-testid="design-canvas" /> }));

vi.mock("@/context/ThemeContext", () => ({
  useTheme: () => ({
    theme: "dark",
    tokens: {
      background: "#000",
      surface: "#111",
      primary: "#72f238",
      text: "#fff",
      textMuted: "#888",
      border: "#333",
    },
    resolvedColors: {
      accentColor: "#72f238",
      background: "#000",
      surface: "#111",
      primary: "#72f238",
      text: "#fff",
      textMuted: "#888",
      border: "#333",
    },
  }),
}));

vi.mock("@/context/MusicPlayerContext", () => ({
  useMusicPlayer: () => ({
    currentTrack: null,
    isPlaying: false,
    queue: [],
    play: vi.fn(),
    pause: vi.fn(),
    next: vi.fn(),
    prev: vi.fn(),
    togglePlay: vi.fn(),
    seek: vi.fn(),
    setVolume: vi.fn(),
    clearQueue: vi.fn(),
    addToQueue: vi.fn(),
    removeFromQueue: vi.fn(),
  }),
  MusicPlayerProvider: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock("./PersistentMusicPlayer", () => ({
  default: () => <div data-testid="music-player" />,
}));

vi.mock("./context/AssetsPanel", () => ({
  default: () => <div data-testid="assets-panel-mock">Assets panel mock</div>,
}));

vi.mock("@/context/ProfileContext", () => ({
  useProfile: () => ({ profile: { displayName: "Test" } }),
}));

vi.mock("@/context/WalletContext", () => ({
  useWallet: () => ({ balance: 100, isLoading: false }),
}));

vi.mock("@clerk/nextjs", () => ({
  UserButton: () => <div data-testid="user-button" />,
  useAuth: () => ({ userId: "test-user-id", isLoaded: true, isSignedIn: true }),
}));

vi.mock("@/components/ModelPicker", () => ({
  default: ({ selectedModel }: { selectedModel: string }) => (
    <div data-testid="model-picker-mock">{selectedModel}</div>
  ),
}));

vi.mock("@/hooks/useClerkAuth", () => ({
  useClerkAuth: () => ({ userId: "test-user-id", isLoaded: true, isSignedIn: true }),
  useAppUser: () => ({ user: { id: "test-user-id", firstName: "Test", username: "test" } }),
}));

vi.mock("../context/VoiceSessionContext", () => ({
  useVoiceSession: () => ({
    voiceState: "idle",
    voiceInputState: "idle",
    voiceOutputState: "idle",
    isMuted: false,
    startVoice: vi.fn(),
    stopVoice: vi.fn(),
    interrupt: vi.fn(),
    toggleMute: vi.fn(),
    setOnTurn: vi.fn(),
    speakText: vi.fn(),
    stopSpeaking: vi.fn(),
    ttsEnabled: false,
    toggleTts: vi.fn(),
    autoSendEnabled: false,
    toggleAutoSend: vi.fn(),
    cancelRecording: vi.fn(),
    micLevel: 0,
    transcript: "",
    recordingSeconds: 0,
    errorMessage: null,
    setOnTranscriptComplete: vi.fn(),
    voiceTransportConnected: false,
  }),
  VoiceSessionProvider: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock("@/features/voice/store/useVoiceStore", () => ({
  useVoiceStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({
      status: "disconnected",
      sessionId: null,
      setActiveAgent: vi.fn(),
    }),
}));

const capState = vi.hoisted(() => ({
  projectId: null as string | null,
  projectName: null as string | null,
}));

vi.mock("../hooks/useConnectionSummary", () => ({
  useConnectionSummary: () => ({
    capabilities: {
      repository: "disconnected",
      repositoryName: null,
      repositoryIndexed: false,
      projectId: capState.projectId,
      projectName: capState.projectName,
      terminalExecution: "unavailable",
      writeAccess: false,
      connectedProviders: ["gemini"],
      availableTools: [],
      connectionSummary: "AI connected",
      terminalStatus: "disconnected",
      terminalSessionId: null,
      terminalError: null,
      voiceTransportConnected: false,
      voiceMicrophoneOn: false,
      voiceHealth: { configured: false, tokenService: "unknown", available: false },
    },
    loading: false,
    refresh: vi.fn(),
  }),
}));

vi.mock("../hooks/useBuilderSessions", () => ({
  useBuilderSessions: () => ({
    sessions: [],
    activeSession: null,
    create: vi.fn(),
    remove: vi.fn(),
    rename: vi.fn(),
  }),
}));

vi.mock("../stores/useStudioAgentStore", () => ({
  useStudioAgentStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({
      activeAgentId: "litt",
      activeAgentMode: "standard",
      activeAgentInstanceId: null,
      executionMode: "plan",
      setActiveAgent: vi.fn(),
      setActiveAgentMode: vi.fn(),
      setActiveAgentInstance: vi.fn(),
      setExecutionMode: vi.fn(),
    }),
  AGENT_META: {
    litt: { displayName: "LiTT", systemPrompt: "", avatar: "", role: "", tag: "", placeholder: "", minimumPlan: "free", description: "", starterActions: [], color: "#4dff62" },
    spark: { displayName: "Spark", systemPrompt: "", avatar: "", role: "", tag: "", placeholder: "", minimumPlan: "free", description: "", starterActions: [], color: "#9b4dff" },
  },
  STUDIO_AGENTS: [
    { displayName: "LiTT", systemPrompt: "", avatar: "" },
    { displayName: "Spark", systemPrompt: "", avatar: "" },
  ],
}));

const sendMock = vi.hoisted(() => vi.fn());
const execState = vi.hoisted(() => {
  const state: Record<string, unknown> = {
    events: [],
    phase: "idle",
    isRunning: false,
    currentStep: 0,
    pendingApproval: null,
    checkpoint: null,
    toolCalls: [],
    changesSummary: null,
    previewPreparing: false,
    startRun: vi.fn(),
    endRun: vi.fn(() => { state.pendingApproval = null; }),
    addEvent: vi.fn(),
    setPhase: vi.fn(),
    setPendingApproval: vi.fn((approval: unknown) => { state.pendingApproval = approval; }),
    resolveApproval: vi.fn(() => { state.pendingApproval = null; }),
    setCheckpoint: vi.fn(),
    collapseEvent: vi.fn(),
    collapseLowLevel: vi.fn(),
    clearEvents: vi.fn(),
    setPreviewPreparing: vi.fn(),
    reset: vi.fn(),
  };
  return { state };
});
const convState = vi.hoisted(() => ({
  selectedConversationId: null as string | null,
  loadMessages: vi.fn(async () => {}),
  reportSendError: vi.fn(),
}));
const approvalWatch = vi.hoisted(() => ({
  onSettled: null as null | ((outcome: unknown) => void),
}));

vi.mock("../hooks/useCanonicalConversation", () => ({
  useCanonicalConversation: () => ({
    messages: [],
    busy: false,
    send: sendMock,
    regenerate: vi.fn(),
    clear: vi.fn(),
    activeAgentId: "litt",
    fallbackNotice: null,
    initialPrompt: "",
    sessions: [],
    activeSessionId: "",
    selectSession: vi.fn(),
    newSession: vi.fn(),
    renameSession: vi.fn(),
    deleteSession: vi.fn(),
    deleteAllSessions: vi.fn(),
    switchAgent: vi.fn(),
    selectedConversationId: convState.selectedConversationId,
    loadMessages: convState.loadMessages,
    reportSendError: convState.reportSendError,
    conversations: [],
    loading: false,
  }),
}));

vi.mock("../lib/approval-polling", () => ({
  submitApprovalAndPoll: vi.fn(),
  watchApprovalResolution: vi.fn((opts: { onSettled?: (outcome: unknown) => void }) => {
    approvalWatch.onSettled = opts.onSettled ?? null;
    return vi.fn();
  }),
}));

vi.mock("../stores/useStudioModelStore", () => ({
  useStudioModelStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({
      selectedModel: { id: "auto", label: "Auto", provider: "auto", category: "auto", model: "", apiProvider: "" },
      fallbackNotice: null,
      setFallbackNotice: vi.fn(),
      providerHealth: {},
    }),
}));

vi.mock("../stores/useExecutionStore", () => {
  const useExecutionStore = Object.assign(
    (selector: (s: Record<string, unknown>) => unknown) => selector(execState.state),
    { getState: () => execState.state },
  );
  return { useExecutionStore };
});

vi.mock("../stores/useConversationStore", () => ({
  useConversationStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({
      conversations: [],
      selectedConversationId: null,
      selectConversation: vi.fn(),
    }),
}));

vi.mock("../lib/builder-command-router", () => ({
  parseBuilderLocalCommand: () => null,
}));

vi.mock("../lib/studio-intent", () => ({
  detectIntent: () => null,
  buildIntentResponseMessage: () => "",
}));

vi.mock("../lib/supabase", () => ({
  getSupabaseAdmin: () => ({}),
}));

vi.mock("./canvas/CanvasPanel", () => ({
  CanvasPanel: () => <div data-testid="canvas-panel" />,
}));

vi.mock("../tools/ImageTool", () => ({ default: () => <div data-testid="image-tool" /> }));
vi.mock("../tools/VideoTool", () => ({ default: () => <div data-testid="video-tool" /> }));
vi.mock("../tools/AudioTool", () => ({ default: () => <div data-testid="audio-tool" /> }));
vi.mock("../tools/BuilderTool", () => ({ default: () => <div data-testid="builder-tool" /> }));
vi.mock("../tools/CanvasTool", () => ({ default: () => <div data-testid="canvas-tool" /> }));
vi.mock("../tools/AgentTool", () => ({ default: () => <div data-testid="agent-tool" /> }));
vi.mock("../tools/GalleryTool", () => ({ default: () => <div data-testid="gallery-tool" /> }));
vi.mock("../tools/AgentsTerminalTool", () => ({ default: () => <div data-testid="terminal-tool" /> }));
vi.mock("../tools/MissionForge", () => ({ default: () => <div data-testid="mission-forge" /> }));
vi.mock("../tools/CLIBridgeTool", () => ({ default: () => <div data-testid="cli-bridge" /> }));
vi.mock("../tools/SpaceTool", () => ({ default: () => <div data-testid="space-tool" /> }));
vi.mock("../tools/PluginsTool", () => ({ default: () => <div data-testid="plugins-tool" /> }));
vi.mock("../tools/CameraTool", () => ({ default: () => <div data-testid="camera-tool" /> }));
vi.mock("../tools/ScreenTool", () => ({ default: () => <div data-testid="screen-tool" /> }));

vi.mock("@/lib/canvas/types", () => ({ ArtifactAction: {} }));
vi.mock("@/lib/litt-context", () => ({ parseJarvisActions: () => [] }));
vi.mock("./canvas/ActionChips", () => ({ ActionChips: () => null }));
vi.mock("@/components/chat/MessageAvatar", () => ({ UserMessageAvatar: () => <div /> }));

vi.mock("./shell/StudioOperatorBar", () => ({
  default: () => <div data-testid="studio-operator-bar" />,
}));

// The dock's Media tab renders MediaUtilityDock, which requires the
// MediaHubProvider from the app layout (not present in this test mount).
vi.mock("@/components/media/MediaUtilityDock", () => ({
  MediaUtilityDock: () => <div data-testid="media-utility-dock-mock" />,
}));

// jsdom polyfill
if (!Element.prototype.scrollTo) {
  Element.prototype.scrollTo = vi.fn();
}

import CommandStudio from "./CommandStudio";
import { CodeWorkspace } from "./code/CodeWorkspace";

async function renderCommandStudio() {
  const user = userEvent.setup();
  const view = render(<CommandStudio />);

  await waitFor(() => {
    if (!screen.queryByTestId("studio-command-composer") && !screen.queryByTestId("litt-mobile-trigger")) {
      throw new Error("Studio surface has not mounted");
    }
  });

  return { user, ...view };
}

async function openAdvancedTools(_user: ReturnType<typeof userEvent.setup>) {
  // Split preview is now explicit. The default desktop layout has no
  // reserved preview column; this helper opts into it for the tests that
  // verify the optional split behavior.
  await settle();
  const toggle = screen.queryByTestId("preview-split-toggle");
  if (!toggle) throw new Error("Preview split action did not mount");
  await _user.click(toggle);
}

function previewPanels() {
  return screen.queryAllByTestId("studio-preview-panel");
}

// Let lazy (Suspense) boundaries resolve before counting mounts.
async function settle() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 50));
  });
}

describe("CommandStudio — single active preview", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sendMock.mockResolvedValue({ accepted: true });
    window.innerHeight = 844;
    Object.defineProperty(window, "visualViewport", {
      value: {
        width: 390,
        height: 844,
        offsetTop: 0,
        offsetLeft: 0,
        scale: 1,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      },
      configurable: true,
    });
  });

  it("mounts exactly one preview when desktop split is explicitly enabled", async () => {
    globalThis.__TEST_VIEWPORT_WIDTH__ = 1600;
    const { user } = await renderCommandStudio();
    await openAdvancedTools(user);
    await waitFor(() => expect(screen.getByTestId("permanent-preview-column")).toBeTruthy());
    // The center workspace yields — it shows the Plan surface instead.
    await waitFor(() =>
      expect(screen.getByTestId("studio-center-workspace").querySelector("[data-testid='studio-plan-surface']")).toBeTruthy());
    // Regression: the center workspace preview used to mount alongside
    // the permanent right-column preview on desktop split.
    expect(previewPanels()).toHaveLength(1);
    const column = screen.getByTestId("permanent-preview-column");
    expect(column.querySelector("[data-testid='studio-preview-panel']")).toBeTruthy();
  });

  it("renders exactly one preview in the default layout (advanced tools closed)", async () => {
    globalThis.__TEST_VIEWPORT_WIDTH__ = 1600;
    await renderCommandStudio();
    await settle();
    expect(previewPanels()).toHaveLength(1);
    expect(screen.queryByTestId("permanent-preview-column")).toBeNull();
    // The single preview lives in the center workspace.
    expect(screen.getByTestId("studio-center-workspace").querySelector("[data-testid='studio-preview-panel']")).toBeTruthy();
  });

  it("keeps exactly one preview across split Preview → Code → Preview navigation", async () => {
    globalThis.__TEST_VIEWPORT_WIDTH__ = 1600;
    const { user } = await renderCommandStudio();
    await openAdvancedTools(user);
    await waitFor(() => expect(screen.getByTestId("permanent-preview-column")).toBeTruthy());

    await user.click(screen.getByTestId("workspace-tab-code"));
    await settle();
    expect(previewPanels()).toHaveLength(1);

    await user.click(screen.getByTestId("workspace-tab-preview"));
    await settle();
    expect(previewPanels()).toHaveLength(1);
    const column = screen.getByTestId("permanent-preview-column");
    expect(column.querySelector("[data-testid='studio-preview-panel']")).toBeTruthy();
  });

  it("keeps the preview as a single workspace tab on compact viewports", async () => {
    // 1200px — laptop tier, below the 1280px desktop-split threshold.
    globalThis.__TEST_VIEWPORT_WIDTH__ = 1200;
    const { user } = await renderCommandStudio();
    await openAdvancedTools(user);
    await settle();
    expect(screen.queryByTestId("permanent-preview-column")).toBeNull();
    expect(previewPanels()).toHaveLength(1);
    expect(screen.getByTestId("studio-center-workspace").querySelector("[data-testid='studio-preview-panel']")).toBeTruthy();
  });

  it("keeps the conversation surface in the center while split preview stays mounted", async () => {
    globalThis.__TEST_VIEWPORT_WIDTH__ = 1600;
    const { user } = await renderCommandStudio();
    await openAdvancedTools(user);
    await waitFor(() => expect(screen.getByTestId("permanent-preview-column")).toBeTruthy());
    await settle();
    expect(previewPanels()).toHaveLength(1);
    expect(screen.getByTestId("studio-center-workspace").querySelector("[data-testid='studio-plan-surface']")).toBeTruthy();
  });

  it("does NOT show a Done completion card when the run pauses for approval", async () => {
    globalThis.__TEST_VIEWPORT_WIDTH__ = 1600;
    // A send accepted into an approval gate is not completed work — the
    // production bug showed "Done · No files changed" while the run was
    // still waiting on the user.
    sendMock.mockResolvedValueOnce({
      accepted: true,
      persisted: true,
      reply: "I need approval to write files.",
      pendingApproval: {
        toolId: "files.write",
        reason: "Mutation requires approval in ACT mode",
        pausedRunId: "paused-1",
      },
    });
    const { user } = await renderCommandStudio();
    await settle();

    await user.type(screen.getByTestId("studio-command-input"), "build a page");
    await user.click(screen.getByTestId("studio-send-button"));
    await waitFor(() => expect(sendMock).toHaveBeenCalled());
    await settle();

    expect(screen.queryByTestId("studio-completion")).toBeNull();
  });
});

describe("CommandStudio — approval gate convergence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sendMock.mockResolvedValue({ accepted: true });
    convState.selectedConversationId = null;
    convState.loadMessages.mockClear();
    convState.reportSendError.mockClear();
    execState.state.pendingApproval = null;
    execState.state.isRunning = false;
    execState.state.events = [];
    approvalWatch.onSettled = null;
  });

  it("returns the LiTT panel to Chat when an approval gate settles without a local click", async () => {
    globalThis.__TEST_VIEWPORT_WIDTH__ = 1600;
    // A gate resolved outside this client — approved on another device, a
    // reload while the resumed run was executing, or the acceptance harness
    // approving through the server-authoritative endpoint — used to leave
    // the surface stuck on Live with the composer hidden.
    convState.selectedConversationId = "conv-1";
    execState.state.pendingApproval = {
      toolId: "project.deploy",
      reason: "Sensitive action — requires explicit approval",
      pausedRunId: "paused-1",
    };
    const { user } = await renderCommandStudio();
    await settle();

    const { watchApprovalResolution } = await import("../lib/approval-polling");
    expect(watchApprovalResolution).toHaveBeenCalledWith(
      expect.objectContaining({ conversationId: "conv-1", pausedRunId: "paused-1" }),
    );

    // The paused run surfaced Live (where the Approve/Reject card lives).
    await user.click(screen.getByTestId("litt-tab-live"));
    await settle();
    expect(screen.getByTestId("litt-live-panel")).toHaveAttribute("data-active", "true");
    expect(screen.getByTestId("litt-chat-panel")).toHaveAttribute("data-active", "false");

    act(() => {
      approvalWatch.onSettled?.({
        status: "approved",
        runStatus: "completed",
        runResult: { finalText: "Deployed", stepsUsed: 2, toolCalls: [], cancelled: false },
        runError: null,
      });
    });
    await settle();

    expect(execState.state.resolveApproval).toHaveBeenCalledWith("approved");
    expect(convState.loadMessages).toHaveBeenCalledWith("conv-1");
    expect(screen.getByTestId("litt-chat-panel")).toHaveAttribute("data-active", "true");
    expect(screen.getByTestId("litt-live-panel")).toHaveAttribute("data-active", "false");
  });

  it("stays on Live when the resumed run pauses on a nested gate", async () => {
    globalThis.__TEST_VIEWPORT_WIDTH__ = 1600;
    convState.selectedConversationId = "conv-1";
    execState.state.pendingApproval = {
      toolId: "project.deploy",
      reason: "Sensitive action",
      pausedRunId: "paused-1",
    };
    const { user } = await renderCommandStudio();
    await settle();

    await user.click(screen.getByTestId("litt-tab-live"));
    await settle();

    act(() => {
      approvalWatch.onSettled?.({
        status: "approved",
        runStatus: "completed",
        runResult: {
          finalText: "",
          stepsUsed: 2,
          toolCalls: [],
          cancelled: false,
          pendingApproval: {
            toolId: "files.delete",
            reason: "Deletion requires approval",
            pausedRunId: "paused-2",
          },
        },
        runError: null,
      });
    });
    await settle();

    // A new gate mounted — the user must see the fresh Approve/Reject card.
    expect(execState.state.setPendingApproval).toHaveBeenCalledWith(
      expect.objectContaining({ toolId: "files.delete", pausedRunId: "paused-2" }),
    );
    expect(screen.getByTestId("litt-live-panel")).toHaveAttribute("data-active", "true");
  });

  it("does NOT report 'could not be resumed' when the gate already settled before the click", async () => {
    globalThis.__TEST_VIEWPORT_WIDTH__ = 1600;
    // The detached resumed run completed and the watcher/store cleared
    // pendingApproval — but the rendered card is one frame stale when the
    // user clicks Approve. That click is a stale duplicate, not a failed
    // resume: no banner, no second submission.
    convState.selectedConversationId = "conv-1";
    execState.state.pendingApproval = {
      toolId: "project.deploy",
      reason: "Sensitive action",
      pausedRunId: "paused-1",
    };
    execState.state.events = [
      { id: "e1", seq: 0, ts: Date.now(), type: "approval_required", summary: "Approval needed: project deploy" },
    ];
    const { user } = await renderCommandStudio();
    await settle();

    await user.click(screen.getByTestId("litt-tab-live"));
    await settle();

    // Gate settles between render and click (mock store doesn't re-render,
    // so the card stays mounted — exactly the production race).
    execState.state.pendingApproval = null;

    await user.click(screen.getByRole("button", { name: /^approve$/i }));
    await settle();

    const { submitApprovalAndPoll } = await import("../lib/approval-polling");
    expect(convState.reportSendError).not.toHaveBeenCalled();
    expect(submitApprovalAndPoll).not.toHaveBeenCalled();
  });

  it("keeps the honest 'could not be resumed' error when the mounted gate has no pausedRunId", async () => {
    globalThis.__TEST_VIEWPORT_WIDTH__ = 1600;
    // A gate with no resume identity (server-side persist failed) is a
    // REAL dead end — the banner must stay truthful, not silently pass.
    convState.selectedConversationId = "conv-1";
    execState.state.pendingApproval = {
      toolId: "files.write",
      reason: "Mutation requires approval",
    };
    execState.state.events = [
      { id: "e1", seq: 0, ts: Date.now(), type: "approval_required", summary: "Approval needed: files write" },
    ];
    const { user } = await renderCommandStudio();
    await settle();

    await user.click(screen.getByTestId("litt-tab-live"));
    await settle();
    await user.click(screen.getByRole("button", { name: /^approve$/i }));
    await settle();

    const { submitApprovalAndPoll } = await import("../lib/approval-polling");
    expect(submitApprovalAndPoll).not.toHaveBeenCalled();
    expect(convState.reportSendError).toHaveBeenCalledWith(
      expect.stringContaining("could not be resumed"),
    );
  });
});

describe("CodeWorkspace — app-preview guard", () => {
  it("defers to the permanent preview instead of mounting a second panel", async () => {
    const user = userEvent.setup();
    render(
      <CodeWorkspace
        projectId="project-1"
        repositoryName="owner/repo"
        branch="main"
        workspaceStatus="ready"
        writeAccess={true}
        externalPreviewActive={true}
      />,
    );
    await user.click(screen.getByTitle("App"));
    await settle();
    expect(screen.getByTestId("app-preview-external-notice")).toBeTruthy();
    expect(previewPanels()).toHaveLength(0);
  });

  it("still mounts the app preview when no external preview is active", async () => {
    const user = userEvent.setup();
    render(
      <CodeWorkspace
        projectId="project-1"
        repositoryName="owner/repo"
        branch="main"
        workspaceStatus="ready"
        writeAccess={true}
      />,
    );
    await user.click(screen.getByTitle("App"));
    await settle();
    expect(previewPanels()).toHaveLength(1);
    expect(screen.queryByTestId("app-preview-external-notice")).toBeNull();
  });
});

describe("CommandStudio — mission panels live in the Activity dock", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sendMock.mockResolvedValue({ accepted: true });
    capState.projectId = "project-1";
    capState.projectName = "Roast Site";
    sessionStorage.clear();
    window.innerHeight = 844;
    Object.defineProperty(window, "visualViewport", {
      value: {
        width: 390,
        height: 844,
        offsetTop: 0,
        offsetLeft: 0,
        scale: 1,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      },
      configurable: true,
    });
  });

  it("renders Mission/Checkpoints/Next actions in Activity — not in the chat panel", async () => {
    globalThis.__TEST_VIEWPORT_WIDTH__ = 1600;
    const { user } = await renderCommandStudio();
    await settle();

    // Chat is conversation-only — the mission panels were relocated.
    const chatPanel = screen.getByTestId("litt-chat-panel");
    expect(chatPanel.querySelector("[data-testid='mission-cards']")).toBeNull();

    // Open the collapsed developer drawer, then select Activity.
    await user.click(screen.getByTestId("dock-collapsed-toggle"));
    await user.click(screen.getByTestId("dock-tab-activity"));
    const activity = screen.getByTestId("dock-content-activity");
    const cards = within(activity).getByTestId("mission-cards");
    expect(within(activity).getByTestId("mission-card-mission")).toBeTruthy();
    expect(within(activity).getByTestId("mission-card-checkpoints")).toBeTruthy();
    expect(within(activity).getByTestId("mission-card-actions")).toBeTruthy();

    // Exactly one mounted instance — nothing duplicated into chat.
    expect(screen.getAllByTestId("mission-cards")).toHaveLength(1);

    // Ordering: Workspace/Model header → mission cards → activity feed.
    // (StudioActivityTimeline renders null when it has no entries, so the
    // always-present feed empty-state marks the feed position instead.)
    const feedEmpty = within(activity).getByText("No conversation activity yet.");
    expect(
      cards.compareDocumentPosition(feedEmpty) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(activity.textContent).toContain("Roast Site");
  });

  it("keeps mission card collapse state across dock tab switches", async () => {
    globalThis.__TEST_VIEWPORT_WIDTH__ = 1600;
    const { user } = await renderCommandStudio();
    await user.click(screen.getByTestId("dock-collapsed-toggle"));
    await user.click(screen.getByTestId("dock-tab-activity"));

    // Collapse the Mission section.
    await user.click(screen.getByRole("button", { name: "Collapse Mission" }));
    expect(screen.queryByTestId("mission-card-body-mission")).toBeNull();

    // Switch to Files and back — all dock tab content stays mounted.
    await user.click(screen.getByTestId("dock-tab-files"));
    await user.click(screen.getByTestId("dock-tab-activity"));
    expect(screen.queryByTestId("mission-card-body-mission")).toBeNull();
    expect(screen.getByRole("button", { name: "Expand Mission" })).toBeTruthy();
  });
});
