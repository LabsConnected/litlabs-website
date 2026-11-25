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
// stable testid so mounted instances can be counted. Canvas-first layout:
// the preview has no split toggle anymore; it always consumes the full
// workspace width as the Preview tab.
vi.mock("./StudioPreviewPanel", () => ({
  default: () => <div data-testid="studio-preview-panel" />,
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
    // Mirrors the real store: a fresh gate always mounts at phase "idle"
    // (useExecutionStore.setPendingApproval resets approvalPhase) — without
    // this, a prior test's "executing" phase leaks into the next gate.
    setPendingApproval: vi.fn((approval: unknown) => { state.pendingApproval = approval; state.approvalPhase = "idle"; }),
    resolveApproval: vi.fn(() => { state.pendingApproval = null; }),
    settleResumedRun: vi.fn(),
    beginApprovalSubmit: vi.fn(() => { state.approvalPhase = "submitting"; }),
    approvalAccepted: vi.fn(() => { state.approvalPhase = "executing"; }),
    failApproval: vi.fn((error: string, retryable?: boolean, opts?: { expired?: boolean }) => {
      state.approvalPhase = "failed";
      state.approvalError = error;
      state.approvalRetryable = retryable ?? true;
      state.approvalExpired = opts?.expired ?? false;
    }),
    setCheckpoint: vi.fn(),
    collapseEvent: vi.fn(),
    collapseLowLevel: vi.fn(),
    clearEvents: vi.fn(),
    setPreviewPreparing: vi.fn(),
    setActiveTaskId: vi.fn(),
    setTaskConversationIndex: vi.fn(),
    taskConversationIndex: {},
    taskPhases: {},
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
  return { useExecutionStore, approvalForConversation: (approval: { conversationId?: string } | null, conversationId?: string | null) => (approval && approval.conversationId && approval.conversationId !== conversationId ? null : approval) };
});

vi.mock("../stores/useConversationStore", () => ({
  // The real store is a zustand store: getState() is always available and
  // component code (e.g. worktab binding) calls it outside render.
  useConversationStore: Object.assign(
    (selector: (s: Record<string, unknown>) => unknown) =>
      selector({
        conversations: [],
        selectedConversationId: null,
        selectConversation: vi.fn(),
      }),
    {
      getState: () => ({
        conversations: [],
        selectedConversationId: null,
        selectConversation: vi.fn(),
      }),
    },
  ),
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

function previewPanels() {
  return screen.queryAllByTestId("studio-preview-panel");
}

// Let lazy (Suspense) boundaries resolve before counting mounts.
async function settle() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 50));
  });
}

describe("CommandStudio — canvas-first 2-zone layout", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sendMock.mockResolvedValue({ accepted: true });
    window.innerHeight = 844;
    try { localStorage.clear(); } catch { /* jsdom without storage */ }
    // Classic shell — the default freeform canvas is a compositor without
    // mounted panels; these assertions target the classic topology.
    localStorage.setItem("litt:studio:layout-mode", "classic");
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

  it("has no permanent preview column on desktop — the Preview tab owns the full workspace width", async () => {
    globalThis.__TEST_VIEWPORT_WIDTH__ = 1600;
    await renderCommandStudio();
    await settle();
    // The permanent right-side preview column is gone for good: no column,
    // no split toggle, no resize handle reserving canvas width.
    expect(screen.queryByTestId("permanent-preview-column")).toBeNull();
    expect(screen.queryByTestId("preview-split-toggle")).toBeNull();
    expect(screen.queryByTestId("preview-resize-handle")).toBeNull();
    // Exactly one preview, living in the center workspace's Preview tab.
    expect(previewPanels()).toHaveLength(1);
    expect(screen.getByTestId("studio-center-workspace").querySelector("[data-testid='studio-preview-panel']")).toBeTruthy();
  });

  it("keeps exactly one preview across Preview → Code → Preview navigation", async () => {
    globalThis.__TEST_VIEWPORT_WIDTH__ = 1600;
    const { user } = await renderCommandStudio();
    await settle();

    await user.click(screen.getByTestId("workspace-tab-code"));
    await settle();
    expect(screen.queryByTestId("permanent-preview-column")).toBeNull();

    await user.click(screen.getByTestId("workspace-tab-preview"));
    await settle();
    expect(previewPanels()).toHaveLength(1);
    expect(screen.getByTestId("studio-center-workspace").querySelector("[data-testid='studio-preview-panel']")).toBeTruthy();
    expect(screen.queryByTestId("permanent-preview-column")).toBeNull();
  });

  it("keeps the preview as a single workspace tab on compact viewports", async () => {
    // 1200px — laptop tier.
    globalThis.__TEST_VIEWPORT_WIDTH__ = 1200;
    await renderCommandStudio();
    await settle();
    expect(screen.queryByTestId("permanent-preview-column")).toBeNull();
    expect(previewPanels()).toHaveLength(1);
    expect(screen.getByTestId("studio-center-workspace").querySelector("[data-testid='studio-preview-panel']")).toBeTruthy();
  });

  it("chat collapse/expand keeps the canvas mounted with no other column reservations", async () => {
    globalThis.__TEST_VIEWPORT_WIDTH__ = 1600;
    const { user } = await renderCommandStudio();
    await settle();

    // Drive to a known state: expanded. F1 workspace-first, as amended
    // by Larry's no-detached-pop-out ruling (2026-11-10): expanding LiTT
    // widens the IN-FLOW column — Slice B's floating overlay is retired,
    // so data-overlay stays "false" in both states.
    if (screen.getByTestId("litt-panel").getAttribute("data-collapsed") === "true") {
      await user.click(screen.getByTestId("litt-hud-expand"));
      await settle();
    }
    expect(screen.getByTestId("litt-panel")).toHaveAttribute("data-collapsed", "false");
    expect(screen.getByTestId("litt-panel")).toHaveAttribute("data-overlay", "false");

    // Collapse — the canvas must stay mounted and take all remaining
    // width; the 64px rail returns in flow.
    await user.click(screen.getByTestId("litt-panel-collapse"));
    await settle();
    expect(screen.getByTestId("litt-panel")).toHaveAttribute("data-collapsed", "true");
    expect(screen.getByTestId("litt-panel")).toHaveAttribute("data-overlay", "false");
    expect(screen.getByTestId("studio-center-workspace")).toBeTruthy();
    expect(screen.queryByTestId("permanent-preview-column")).toBeNull();

    // Expand again — in-flow column returns, canvas still mounted.
    await user.click(screen.getByTestId("litt-hud-expand"));
    await settle();
    expect(screen.getByTestId("litt-panel")).toHaveAttribute("data-collapsed", "false");
    expect(screen.getByTestId("litt-panel")).toHaveAttribute("data-overlay", "false");
    expect(screen.getByTestId("studio-center-workspace")).toBeTruthy();
  });

  it("mobile tool surfaces toggle without unmounting chat", async () => {
    globalThis.__TEST_VIEWPORT_WIDTH__ = 390;
    window.innerWidth = 390;
    const { user } = await renderCommandStudio();
    await settle();

    // Chat-first layout (2026-11-19 card): the chat sheet is the home
    // surface on entry and stays mounted (display-toggled) while tool
    // surfaces take over — drafts, SSE connections, scroll survive.
    const mount = screen.getByTestId("litt-mobile-sheet-mount");
    expect(mount.style.display).toBe("");
    expect(screen.getByTestId("studio-command-composer")).toBeTruthy();

    // Menu → Preview: the tool surface takes the phone, chat hides.
    await user.click(screen.getByTestId("mobile-studio-menu"));
    await waitFor(() => expect(screen.getByTestId("mobile-tools-dialog")).toBeTruthy());
    await user.click(screen.getByTestId("mobile-tool-preview"));
    await settle();
    expect(screen.getByTestId("litt-mobile-sheet-mount").style.display).toBe("none");
    expect(screen.getByTestId("studio-command-composer")).toBeTruthy();

    // Back to chat — the same composer instance returns.
    await user.click(screen.getByTestId("mobile-back-to-chat"));
    await settle();
    expect(screen.getByTestId("litt-mobile-sheet-mount").style.display).toBe("");
    expect(screen.getByTestId("studio-command-composer")).toBeTruthy();
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

  it("keeps the user on the Chat tab when a send pauses at an approval gate", async () => {
    globalThis.__TEST_VIEWPORT_WIDTH__ = 1600;
    // Larry's approve-in-chat directive (2026-11-11): the run pauses, the
    // actionable card lives IN the chat — the send flow must not yank the
    // user over to the Live/Activity tab to hunt the Approve button. (The
    // pre-fix flow switched to "live" with the comment "where the
    // Approve/Reject control lives".)
    sendMock.mockResolvedValueOnce({
      accepted: true,
      persisted: true,
      reply: "I need your approval to run image.stock.",
      pendingApproval: {
        toolId: "image.stock",
        reason: "Mutation requires approval in ACT mode",
        pausedRunId: "paused-gate-1",
        inputs: { projectId: "proj-1", query: "people enjoying food in a food court" },
      },
    });
    const { user } = await renderCommandStudio();
    await settle();

    await user.type(screen.getByTestId("studio-command-input"), "build a food court page");
    await user.click(screen.getByTestId("studio-send-button"));
    await waitFor(() => expect(sendMock).toHaveBeenCalled());
    await settle();

    expect(screen.getByTestId("litt-chat-panel")).toHaveAttribute("data-active", "true");
    // Mockup port (2026-11-18): the LiTT panel is Chat-only in the
    // Regular layout — there is no Live pane in the panel anymore;
    // the activity feed lives in the Code box's Run section (Activity).
    expect(screen.queryByTestId("litt-live-panel")).toBeNull();
    expect(screen.queryByTestId("studio-completion")).toBeNull();
  });

  it("does NOT show a Done completion card when the assistant asks a clarifying question", async () => {
    globalThis.__TEST_VIEWPORT_WIDTH__ = 1600;
    sendMock.mockResolvedValueOnce({
      accepted: true,
      persisted: true,
      reply: "Which project should I update?",
      awaitingInput: true,
    });

    const { user } = await renderCommandStudio();
    await user.type(screen.getByTestId("studio-command-input"), "Fix the dropdown");
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
    // Tests below mount gates by direct assignment, which in the real
    // store only ever happens alongside approvalPhase "idle" (a fresh
    // gate). Reset it so a prior test's submit/executing phase cannot
    // leak into the next gate and disable its buttons.
    execState.state.approvalPhase = "idle";
    execState.state.isRunning = false;
    execState.state.events = [];
    approvalWatch.onSettled = null;
    // Classic shell — approval behavior lives in the panel chat there.
    localStorage.setItem("litt:studio:layout-mode", "classic");
  });

  it("converges the gate when an approval settles without a local click", async () => {
    globalThis.__TEST_VIEWPORT_WIDTH__ = 1600;
    // A gate resolved outside this client — approved on another device, a
    // reload while the resumed run was executing, or the acceptance harness
    // approving through the server-authoritative endpoint — used to leave
    // the surface stuck on Live with the composer hidden. Mockup port
    // (2026-11-18): the LiTT panel is Chat-only in the Regular layout, so
    // the chat surface (composer included) can no longer be hidden behind
    // a panel tab at all; the activity feed the user inspects lives in
    // the Code box's Run section. The convergence contract is unchanged:
    // the watcher fires, the store resolves, the transcript reloads.
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

    // The user inspects the Activity feed while the gate is pending (the
    // actionable card itself lives in Chat since the approve-in-chat fix).
    // Rail consolidation (2026-11-25): the feed's Regular home is the
    // Code box's Run section, Activity tab.
    await user.click(screen.getByTestId("workspace-tab-code"));
    await user.click(await screen.findByTestId("code-box-view-run"));
    await user.click(screen.getByTestId("code-run-section-activity"));
    await settle();
    expect(screen.getByTestId("code-run-pane-activity")).toHaveAttribute("data-active", "true");
    expect(screen.getByTestId("litt-chat-panel")).toHaveAttribute("data-active", "true");

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
  });

  it("surfaces the fresh gate IN CHAT when the resumed run pauses on a nested gate", async () => {
    globalThis.__TEST_VIEWPORT_WIDTH__ = 1600;
    convState.selectedConversationId = "conv-1";
    execState.state.pendingApproval = {
      toolId: "project.deploy",
      reason: "Sensitive action",
      pausedRunId: "paused-1",
    };
    const { user } = await renderCommandStudio();
    await settle();

    // Watching the Activity feed (Code box Run section) when the gate settles.
    await user.click(screen.getByTestId("workspace-tab-code"));
    await user.click(await screen.findByTestId("code-box-view-run"));
    await user.click(screen.getByTestId("code-run-section-activity"));
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

    // A new gate mounted — the user must see the fresh Approve/Reject
    // card. CHANGED under Larry's approve-in-chat directive (2026-11-11):
    // this test previously pinned "stays on Live", the exact behavior
    // Larry rejected ("LiTT needs to have approve in chat"). The card
    // lives in the chat transcript now, so the surface follows it there.
    expect(execState.state.setPendingApproval).toHaveBeenCalledWith(
      expect.objectContaining({ toolId: "files.delete", pausedRunId: "paused-2" }),
    );
    expect(screen.getByTestId("litt-chat-panel")).toHaveAttribute("data-active", "true");
    expect(screen.queryByTestId("litt-live-panel")).toBeNull();
  });

  it("ends the execution phase when an approved resumed run finishes (PR #1114 Greptile thread 1)", async () => {
    globalThis.__TEST_VIEWPORT_WIDTH__ = 1600;
    convState.selectedConversationId = "conv-1";
    execState.state.pendingApproval = {
      toolId: "project.deploy",
      reason: "Sensitive action — requires explicit approval",
      pausedRunId: "paused-1",
    };
    await renderCommandStudio();
    await settle();

    act(() => {
      approvalWatch.onSettled?.({
        status: "approved",
        runStatus: "completed",
        runResult: { finalText: "Deployed", stepsUsed: 2, toolCalls: [], cancelled: false },
        runError: null,
      });
    });
    await settle();

    // resolveApproval alone leaves the phase at "editing" — the run
    // would show as working forever. The terminal outcome must settle it.
    // ACC-06a item 2: the settle also names the run's conversation so
    // the terminal phase lands on the OWNING worktab, not just the
    // active one.
    expect(execState.state.resolveApproval).toHaveBeenCalledWith("approved");
    expect(execState.state.settleResumedRun).toHaveBeenCalledWith("completed", "conv-1");
  });

  it("does NOT end the run when the approved outcome mounts a follow-up gate", async () => {
    globalThis.__TEST_VIEWPORT_WIDTH__ = 1600;
    convState.selectedConversationId = "conv-1";
    execState.state.pendingApproval = {
      toolId: "project.deploy",
      reason: "Sensitive action",
      pausedRunId: "paused-1",
    };
    await renderCommandStudio();
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

    expect(execState.state.setPendingApproval).toHaveBeenCalledWith(
      expect.objectContaining({ pausedRunId: "paused-2" }),
    );
    expect(execState.state.settleResumedRun).not.toHaveBeenCalled();
  });

  it("ends the execution phase when the gate outcome is a rejection", async () => {
    globalThis.__TEST_VIEWPORT_WIDTH__ = 1600;
    convState.selectedConversationId = "conv-1";
    execState.state.pendingApproval = {
      toolId: "project.deploy",
      reason: "Sensitive action — requires explicit approval",
      pausedRunId: "paused-1",
    };
    await renderCommandStudio();
    await settle();

    act(() => {
      approvalWatch.onSettled?.({
        status: "rejected",
        runStatus: null,
        runResult: null,
        runError: null,
      });
    });
    await settle();

    expect(execState.state.resolveApproval).toHaveBeenCalledWith("rejected");
    // ACC-06a item 2: rejection settles are conversation-attributed too.
    expect(execState.state.settleResumedRun).toHaveBeenCalledWith("rejected", "conv-1");
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

    // Rail consolidation (2026-11-25): the activity feed — and its
    // approval controls — live in the Code box's Run section,
    // Activity tab, in the Regular layout; the LiTT panel is
    // Chat-only. Open the run section so the feed's own Approve
    // control is the one under test.
    await user.click(screen.getByTestId("workspace-tab-code"));
    await user.click(await screen.findByTestId("code-box-view-run"));
    await user.click(screen.getByTestId("code-run-section-activity"));
    await settle();

    // Gate settles between render and click (mock store doesn't re-render,
    // so the card stays mounted — exactly the production race).
    execState.state.pendingApproval = null;

    await user.click(
      within(screen.getByTestId("code-run-pane-activity")).getByRole("button", { name: /^approve$/i }),
    );
    await settle();

    const { submitApprovalAndPoll } = await import("../lib/approval-polling");
    expect(convState.reportSendError).not.toHaveBeenCalled();
    expect(submitApprovalAndPoll).not.toHaveBeenCalled();
  });

  it("does NOT render or action another conversation's gate in this session (ACC-06a item 4)", async () => {
    globalThis.__TEST_VIEWPORT_WIDTH__ = 1600;
    // Superseded behavior: this scenario used to assert the gate
    // stayed actionable after switching conversations, posting to
    // the gate's own conversation to dodge the server's
    // "Conversation mismatch" 403. Larry's ACC-06a item 4 ruling
    // (Acceptance Run 1 on 8cd7728c — a bakery project's card
    // appeared inside another project's session) supersedes it:
    // approvals are scoped to the project + conversation that
    // requested them and must never render or be actionable in
    // another session. The gate stays pending for its OWN
    // conversation, where the own-conversation POST behavior still
    // applies (covered by the conv-1 tests in this file).
    convState.selectedConversationId = "conv-2";
    execState.state.pendingApproval = {
      toolId: "files.write",
      reason: "Mutation requires approval in ACT mode",
      pausedRunId: "paused-1",
      conversationId: "conv-1",
    };
    execState.state.events = [
      { id: "e1", seq: 0, ts: Date.now(), type: "approval_required", summary: "Approval needed: files write" },
    ];
    const { user } = await renderCommandStudio();
    await settle();

    // Open the run section's Activity pane — the surface whose
    // approval controls are under test.
    await user.click(screen.getByTestId("workspace-tab-code"));
    await user.click(await screen.findByTestId("code-box-view-run"));
    await user.click(screen.getByTestId("code-run-section-activity"));
    await settle();

    // No Approve control for conv-1's gate mounts in conv-2's
    // session, and nothing is ever posted.
    expect(
      within(screen.getByTestId("code-run-pane-activity")).queryByRole("button", { name: /^approve$/i }),
    ).toBeNull();
    const { submitApprovalAndPoll } = await import("../lib/approval-polling");
    expect(submitApprovalAndPoll).not.toHaveBeenCalled();
    // The gate itself is untouched — still pending for conv-1.
    expect((execState.state.pendingApproval as { pausedRunId?: string } | null)?.pausedRunId).toBe("paused-1");
  });

  it("falls back to the selected conversation for gates mounted before binding existed", async () => {
    globalThis.__TEST_VIEWPORT_WIDTH__ = 1600;
    // Legacy gates carry no conversationId — the selection is the only
    // identity available, so the previous behavior must hold for them.
    convState.selectedConversationId = "conv-1";
    execState.state.pendingApproval = {
      toolId: "files.write",
      reason: "Mutation requires approval",
      pausedRunId: "paused-1",
    };
    execState.state.events = [
      { id: "e1", seq: 0, ts: Date.now(), type: "approval_required", summary: "Approval needed: files write" },
    ];
    const { user } = await renderCommandStudio();
    await settle();

    // Mockup port (2026-11-18): the activity feed — and its approval
    // controls — live in the Code box's Run section, Activity tab,
    // in the Regular layout; the LiTT panel is Chat-only. Open the
    // run section so the
    // feed's own Approve control is the one under test.
    await user.click(screen.getByTestId("workspace-tab-code"));
    await user.click(await screen.findByTestId("code-box-view-run"));
    await user.click(screen.getByTestId("code-run-section-activity"));
    await settle();
    await user.click(
      within(screen.getByTestId("code-run-pane-activity")).getByRole("button", { name: /^approve$/i }),
    );
    await settle();

    const { submitApprovalAndPoll } = await import("../lib/approval-polling");
    expect(submitApprovalAndPoll).toHaveBeenCalledWith(
      expect.objectContaining({ conversationId: "conv-1", pausedRunId: "paused-1" }),
    );
  });

  it("watches the gate's OWN conversation even after the selection changes", async () => {
    globalThis.__TEST_VIEWPORT_WIDTH__ = 1600;
    // The server-authoritative watcher polls the paused run's status — it
    // must poll the gate's conversation, or a selection change silently
    // disarms convergence (404-ish GETs against the wrong conversation).
    convState.selectedConversationId = "conv-2";
    execState.state.pendingApproval = {
      toolId: "project.deploy",
      reason: "Sensitive action",
      pausedRunId: "paused-1",
      conversationId: "conv-1",
    };
    await renderCommandStudio();
    await settle();

    const { watchApprovalResolution } = await import("../lib/approval-polling");
    expect(watchApprovalResolution).toHaveBeenCalledWith(
      expect.objectContaining({ conversationId: "conv-1", pausedRunId: "paused-1" }),
    );
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

    // Mockup port (2026-11-18): the activity feed — and its approval
    // controls — live in the Code box's Run section, Activity tab,
    // in the Regular layout; the LiTT panel is Chat-only. Open the
    // run section so the
    // feed's own Approve control is the one under test.
    await user.click(screen.getByTestId("workspace-tab-code"));
    await user.click(await screen.findByTestId("code-box-view-run"));
    await user.click(screen.getByTestId("code-run-section-activity"));
    await settle();
    await user.click(
      within(screen.getByTestId("code-run-pane-activity")).getByRole("button", { name: /^approve$/i }),
    );
    await settle();

    const { submitApprovalAndPoll } = await import("../lib/approval-polling");
    expect(submitApprovalAndPoll).not.toHaveBeenCalled();
    expect(convState.reportSendError).toHaveBeenCalledWith(
      expect.stringContaining("could not be resumed"),
    );
  });
});

describe("CommandStudio — rail consolidation topology (2026-11-25)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sendMock.mockResolvedValue({ accepted: true });
    convState.selectedConversationId = null;
    execState.state.pendingApproval = null;
    execState.state.approvalPhase = "idle";
    execState.state.isRunning = false;
    sessionStorage.clear();
    localStorage.setItem("litt:studio:layout-mode", "classic");
  });

  it("no right rail; Files and the run section live in the Code box; exactly one LiTTLiveActivity", async () => {
    globalThis.__TEST_VIEWPORT_WIDTH__ = 1600;
    const { user } = await renderCommandStudio();
    await settle();

    // The permanent right rail is gone from Regular.
    expect(screen.queryByTestId("studio-right-rail")).toBeNull();
    expect(screen.queryByTestId("studio-rail-tab-files")).toBeNull();

    // The bottom dock offers launcher entries for Files / Checks /
    // Approvals — never dock tabs, never a second copy of any surface
    // (their one home is the Code box: Files view + Run section).
    await user.click(screen.getByTestId("studio-dock-toggle"));
    expect(screen.queryByTestId("dock-tab-files")).toBeNull();
    expect(screen.queryByTestId("dock-tab-checks")).toBeNull();
    expect(screen.queryByTestId("dock-tab-approvals")).toBeNull();
    expect(screen.getByTestId("dock-open-files")).toBeTruthy();
    expect(screen.getByTestId("dock-open-checks")).toBeTruthy();
    expect(screen.getByTestId("dock-open-approvals")).toBeTruthy();

    // The Files launcher lands in the Code box's Files view — Files'
    // one home.
    await user.click(screen.getByTestId("dock-open-files"));
    const filesView = await screen.findByTestId("code-box-files-view");
    expect(filesView).toHaveAttribute("data-active", "true");

    // The run section holds Plan · Checks · Approvals · Changes ·
    // Activity · Deploy, and the Activity feed is a singleton.
    await user.click(screen.getByTestId("code-box-view-run"));
    expect(screen.getByTestId("code-box-run-view")).toHaveAttribute("data-active", "true");
    expect(screen.getAllByTestId("litt-live-activity").length).toBe(1);
    await user.click(screen.getByTestId("code-run-section-activity"));
    expect(screen.getByTestId("code-run-pane-activity")).toHaveAttribute("data-active", "true");
    expect(screen.getAllByTestId("litt-live-activity").length).toBe(1);
    for (const section of ["plan", "checks", "approvals", "changes", "deploy"]) {
      expect(screen.getByTestId(`code-run-section-${section}`)).toBeTruthy();
    }
  });

  it("the Browser is reachable in Regular: header entry opens the side dock, closable", async () => {
    globalThis.__TEST_VIEWPORT_WIDTH__ = 1600;
    const { user } = await renderCommandStudio();
    await settle();

    expect(screen.queryByTestId("studio-browser-side-dock")).toBeNull();
    // Header overflow menu → Browser (the obvious entry point).
    await user.click(screen.getByRole("button", { name: "More actions" }));
    await user.click(await screen.findByTestId("header-open-browser"));
    const dock = await screen.findByTestId("studio-browser-side-dock");
    expect(dock).toHaveAttribute("data-side", "right");
    // Flip to the left side and back via the dock's own control.
    await user.click(screen.getByTestId("browser-dock-flip"));
    expect(screen.getByTestId("studio-browser-side-dock")).toHaveAttribute("data-side", "left");
    await user.click(screen.getByTestId("browser-dock-flip"));
    expect(screen.getByTestId("studio-browser-side-dock")).toHaveAttribute("data-side", "right");
    // Closable — on-demand, never a permanent rail.
    await user.click(screen.getByTestId("browser-dock-close"));
    await waitFor(() => expect(screen.queryByTestId("studio-browser-side-dock")).toBeNull());
  });
});

describe("CodeWorkspace — app preview", () => {
  it("renders the ONE shared preview element in its preview region — it never mounts its own preview", async () => {
    // Code-box build (mapping §1): the App view mode is gone. The live
    // preview is a permanent region of the one box, and it renders the
    // single shared element CommandStudio builds — CodeWorkspace must
    // not mount a StudioPreviewPanel of its own.
    const { default: StudioPreviewPanel } = await import("./StudioPreviewPanel");
    render(
      <CodeWorkspace
        projectId="project-1"
        repositoryName="owner/repo"
        branch="main"
        workspaceStatus="ready"
        writeAccess={true}
        previewContent={
          <StudioPreviewPanel
            projectId="project-1"
            projectName="Test Project"
            repositoryName="owner/repo"
            branch="main"
            workspaceStatus="ready"
          />
        }
      />,
    );
    await settle();
    expect(screen.queryByTitle("App")).toBeNull();
    expect(previewPanels()).toHaveLength(1);
    expect(
      screen.getByTestId("code-preview-region").contains(previewPanels()[0]),
    ).toBe(true);
  });

  it("mounts no preview at all when the shared element lives in the Preview panel", async () => {
    render(
      <CodeWorkspace
        projectId="project-1"
        repositoryName="owner/repo"
        branch="main"
        workspaceStatus="ready"
        writeAccess={true}
        previewPlaceholder={<div data-testid="preview-pointer-card" />}
      />,
    );
    await settle();
    expect(previewPanels()).toHaveLength(0);
    expect(screen.getByTestId("preview-pointer-card")).toBeTruthy();
  });
});

describe("CommandStudio — mission panels live in the Activity dock", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sendMock.mockResolvedValue({ accepted: true });
    capState.projectId = "project-1";
    capState.projectName = "Roast Site";
    sessionStorage.clear();
    localStorage.setItem("litt:studio:layout-mode", "classic");
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
    // always-present feed empty-state marks the feed position instead.
    // Item 5a: the feed is the run's persisted action_events — with no run
    // attached, the honest state is "No task run yet".)
    const feedEmpty = within(activity).getByText(/No task run yet/);
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

    // Switch to Media and back — all dock tab content stays mounted.
    await user.click(screen.getByTestId("dock-tab-media"));
    await user.click(screen.getByTestId("dock-tab-activity"));
    expect(screen.queryByTestId("mission-card-body-mission")).toBeNull();
    expect(screen.getByRole("button", { name: "Expand Mission" })).toBeTruthy();
  });
});
