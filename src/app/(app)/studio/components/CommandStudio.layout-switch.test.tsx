// Amendment 8 (Larry, 2026-11-17) introduced the crossbreed switch;
// Larry's 2026-11-22 ruling superseded its default and presentation:
// Regular is the default layout, the Board is opt-in via Settings
// ("Enable advanced workspace"), and the header carries no layout
// switch. These tests drive the choice through the settings store —
// the same write the Settings toggle makes — and assert the body
// branch swaps in place. Same mock harness as
// CommandStudio.preview-singleton.test.tsx, with the preview stub
// recording its refreshKey prop and the two Jobs feed components
// stubbed so the wiring assertions stay exact.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
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
  default: (props: { refreshKey?: number }) => (
    <div
      data-testid="studio-preview-panel"
      data-refresh-key={props.refreshKey ?? "none"}
    />
  ),
}));

// Other dynamic children that would be pulled in by the lazy passthrough
// are stubbed so this suite stays focused on the preview mount graph.
vi.mock("./ActionRunStatusPanel", () => ({
  ActionRunStatusPanel: ({ conversationId }: { conversationId: string }) => (
    <div data-testid="action-run-status-panel" data-conversation-id={conversationId} />
  ),
}));

vi.mock("./RunChangesPanel", () => ({
  default: ({ projectId }: { projectId: string }) => (
    <div data-testid="run-changes-panel" data-project-id={projectId} />
  ),
}));

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
import { useBoardSettingsStore } from "../stores/useBoardSettingsStore";

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

describe("CommandStudio — layout choice (Regular default, Board opt-in)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sendMock.mockResolvedValue({ accepted: true });
    window.innerHeight = 844;
    try { localStorage.clear(); } catch { /* jsdom without storage */ }
    useBoardSettingsStore.getState().resetBoardSettings();
    capState.projectId = null;
    capState.projectName = null;
    convState.selectedConversationId = null;
    execState.state.isRunning = false;
    globalThis.__TEST_VIEWPORT_WIDTH__ = 1600;
    Object.defineProperty(window, "visualViewport", {
      value: {
        width: 1600,
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

  afterEach(() => {
    try { localStorage.clear(); } catch { /* jsdom without storage */ }
    useBoardSettingsStore.getState().resetBoardSettings();
    capState.projectId = null;
    capState.projectName = null;
    convState.selectedConversationId = null;
    execState.state.isRunning = false;
  });

  it("defaults to the Regular layout, with no layout switch in the header", async () => {
    await renderCommandStudio();
    await settle();
    // Regular (classic) body: LiTT panel + workspace + dock, no board.
    expect(screen.queryByTestId("studio-board-shell")).toBeNull();
    expect(screen.getByTestId("studio-dock")).toBeTruthy();
    // Board demotion: the header carries no equal layout switch.
    expect(screen.queryByTestId("studio-layout-switch")).toBeNull();
    expect(useBoardSettingsStore.getState().layoutMode).toBeNull();
  });

  it("the legacy escape hatch still lands in the regular layout", async () => {
    localStorage.setItem("litt:studio:layout-mode", "classic");
    await renderCommandStudio();
    await settle();
    expect(screen.queryByTestId("studio-board-shell")).toBeNull();
    expect(screen.getByTestId("studio-dock")).toBeTruthy();
  });

  it("flips Regular → Board → Regular in place; the choice persists and the composer never leaves", async () => {
    capState.projectId = "project-1";
    capState.projectName = "Test Project";
    await renderCommandStudio();
    await settle();
    expect(screen.queryByTestId("studio-board-shell")).toBeNull();
    expect(screen.getByTestId("studio-command-composer")).toBeTruthy();

    // The Settings "Enable advanced workspace" toggle writes the
    // settings store — the same write path the Board Settings menu
    // uses. Drive the flip through it.
    act(() => {
      useBoardSettingsStore.getState().setLayoutMode("board");
    });
    await settle();
    expect(screen.getByTestId("studio-board-shell")).toBeTruthy();
    // The conversation surface (same composer element tree) is still
    // mounted — CommandStudio never unmounted, so the open
    // conversation and project survive the flip.
    expect(screen.getByTestId("studio-command-composer")).toBeTruthy();
    expect(useBoardSettingsStore.getState().layoutMode).toBe("board");

    act(() => {
      useBoardSettingsStore.getState().setLayoutMode("classic");
    });
    await settle();
    expect(screen.queryByTestId("studio-board-shell")).toBeNull();
    expect(screen.getByTestId("studio-dock")).toBeTruthy();
    expect(screen.getByTestId("studio-command-composer")).toBeTruthy();
    expect(useBoardSettingsStore.getState().layoutMode).toBe("classic");
  });

  it("a persisted Board choice survives a remount without the legacy key", async () => {
    const first = await renderCommandStudio();
    await settle();
    act(() => {
      useBoardSettingsStore.getState().setLayoutMode("board");
    });
    await settle();
    expect(useBoardSettingsStore.getState().layoutMode).toBe("board");
    first.unmount();
    // Remove the legacy key: the settings store alone must carry it.
    localStorage.removeItem("litt:studio:layout-mode");
    await renderCommandStudio();
    await settle();
    // Saved Board users keep their Board.
    expect(screen.getByTestId("studio-board-shell")).toBeTruthy();
  });
});

describe("CommandStudio — regular layout's smarter right side (Amendment 8)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sendMock.mockResolvedValue({ accepted: true });
    window.innerHeight = 844;
    try { localStorage.clear(); } catch { /* jsdom without storage */ }
    useBoardSettingsStore.getState().resetBoardSettings();
    // The regular (classic) layout, via the surviving escape hatch.
    localStorage.setItem("litt:studio:layout-mode", "classic");
    capState.projectId = "project-1";
    capState.projectName = "Test Project";
    convState.selectedConversationId = null;
    execState.state.isRunning = false;
    globalThis.__TEST_VIEWPORT_WIDTH__ = 1600;
    Object.defineProperty(window, "visualViewport", {
      value: {
        width: 1600,
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

  afterEach(() => {
    try { localStorage.clear(); } catch { /* jsdom without storage */ }
    useBoardSettingsStore.getState().resetBoardSettings();
    capState.projectId = null;
    capState.projectName = null;
    convState.selectedConversationId = null;
    execState.state.isRunning = false;
  });

  it("the Preview tab renders the ONE shared preview element (it carries the refresh key)", async () => {
    await renderCommandStudio();
    await settle();
    const panels = previewPanels();
    expect(panels).toHaveLength(1);
    // The shared previewContent element is the only StudioPreviewPanel
    // that receives CommandStudio's previewRefreshKey; the separate
    // instance this tab used to mount received none ("none").
    expect(panels[0].getAttribute("data-refresh-key")).toBe("0");
    expect(
      screen.getByTestId("studio-center-workspace").contains(panels[0]),
    ).toBe(true);
  });

  it("keeps exactly one preview across Preview → Code → Preview, the shared element in both homes", async () => {
    const { user } = await renderCommandStudio();
    await settle();
    await user.click(screen.getByTestId("workspace-tab-code"));
    // CodeWorkspace is lazy-loaded; wait for its preview region.
    await waitFor(() => expect(previewPanels()).toHaveLength(1));
    expect(previewPanels()[0].getAttribute("data-refresh-key")).toBe("0");
    await user.click(screen.getByTestId("workspace-tab-preview"));
    await settle();
    expect(previewPanels()).toHaveLength(1);
    expect(previewPanels()[0].getAttribute("data-refresh-key")).toBe("0");
  });

  it("shows the run changes on the right side while a run is active — and only then; the runtime strip stays Jobs-only", async () => {
    convState.selectedConversationId = "conv-1";
    const { rerender } = await renderCommandStudio();
    await settle();
    // Idle: no live region — the right side is the workspace alone.
    expect(screen.queryByTestId("classic-live-run")).toBeNull();

    execState.state.isRunning = true;
    rerender(<CommandStudio />);
    await settle();
    const region = screen.getByTestId("classic-live-run");
    expect(region).toBeTruthy();
    // The changes panel is wired to the open project. The runtime
    // strip (action-run-status-panel) does NOT render here — Larry
    // ruled 2026-11-18 that it lives ONLY in the Jobs tab, so the
    // live region carries the header + file changes and nothing else
    // from the strip.
    expect(region.querySelector("[data-testid='action-run-status-panel']")).toBeNull();
    expect(
      region.querySelector("[data-testid='run-changes-panel']")?.getAttribute("data-project-id"),
    ).toBe("project-1");

    execState.state.isRunning = false;
    rerender(<CommandStudio />);
    await settle();
    expect(screen.queryByTestId("classic-live-run")).toBeNull();
  });
});
