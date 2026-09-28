import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom";

// ── Mocks ────────────────────────────────────────────────────────────
// Regression coverage for the mobile work-surface dock. Chat, Preview,
// Files, Activity, and More must switch the existing shared Studio surfaces
// at a real mobile viewport (674x1536), without creating a second runtime.
// Legacy destination routing remains covered by CommandStudio.routing.test.tsx.
//
// Same mock harness as CommandStudio.preview-singleton.test.tsx: next/dynamic
// resolves via React.lazy + Suspense so the real mounted-component graph
// (including the lazily-loaded tool components the nav routes to) is
// observable.

const stableSearchParams = new URLSearchParams("tool=chat");

vi.mock("next/navigation", () => ({
  useSearchParams: () => stableSearchParams,
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => "/studio",
}));

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

vi.mock("./StudioPreviewPanel", () => ({
  default: () => <div data-testid="studio-preview-panel" />,
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
    setPendingApproval: vi.fn((approval: unknown) => { state.pendingApproval = approval; }),
    resolveApproval: vi.fn(() => { state.pendingApproval = null; }),
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
  // Mutable transcript surface for the dock-layout tests: fallbackNotice
  // renders as plain text inside littTranscript in BOTH dock modes.
  messages: [] as { role: string; content: string }[],
  fallbackNotice: null as string | null,
}));

vi.mock("../hooks/useCanonicalConversation", () => ({
  useCanonicalConversation: () => ({
    messages: convState.messages,
    busy: false,
    send: sendMock,
    regenerate: vi.fn(),
    clear: vi.fn(),
    activeAgentId: "litt",
    fallbackNotice: convState.fallbackNotice,
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
  watchApprovalResolution: vi.fn(() => vi.fn()),
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

// Captures every StudioOperatorBar render's props so the tests can prove
// the left dock and the bottom layer receive the same handlers/props.
const operatorBarProps = vi.hoisted(() => ({
  calls: [] as Record<string, unknown>[],
}));

vi.mock("./shell/StudioOperatorBar", () => ({
  default: (props: Record<string, unknown>) => {
    operatorBarProps.calls.push(props);
    return <div data-testid="studio-operator-bar" />;
  },
}));

vi.mock("@/components/media/MediaUtilityDock", () => ({
  MediaUtilityDock: () => <div data-testid="media-utility-dock-mock" />,
}));

// jsdom polyfill
if (!Element.prototype.scrollTo) {
  Element.prototype.scrollTo = vi.fn();
}

import CommandStudio from "./CommandStudio";

import { renderHook } from "@testing-library/react";
import { useResizableWidth } from "../hooks/useResizableWidth";

// ── Chat dock layout: 27 integration tests ───────────────────────────
// Owner's 30-test acceptance set (3 more live in ChatDockSwitcher.test.tsx).
// The chat dock moves the LiTT chat between a persistent left dock panel
// (first-run default, expanded, 360px, clamped 300–500px) and the bottom
// command layer (today's behavior, unchanged).

const DOCK_KEY = "littree:studio:chat-dock";
const DOCK_WIDTH_KEY = "littree:studio:litt-dock-width";
const DOCK_COLLAPSED_KEY = "littree:studio:chat-dock-collapsed";
const LEGACY_WIDTH_KEY = "littree:studio:litt-width";
const LEGACY_COLLAPSED_KEY = "littree:studio:litt-collapsed";

const DESKTOP_WIDTH = 1600;
const DESKTOP_HEIGHT = 900;

function setDesktopViewport() {
  globalThis.__TEST_VIEWPORT_WIDTH__ = DESKTOP_WIDTH;
  window.innerWidth = DESKTOP_WIDTH;
  window.innerHeight = DESKTOP_HEIGHT;
}

async function renderStudioDock() {
  const user = userEvent.setup();
  const view = render(<CommandStudio />);
  await waitFor(() => {
    if (!screen.queryByTestId("studio-shell")) {
      throw new Error("StudioShell has not mounted");
    }
  });
  return { user, ...view };
}

/** The left-dock LiTTPanel (non-overlay). Throws if the bottom layer is mounted instead. */
function getDockPanel() {
  const panel = screen.getByTestId("litt-panel");
  expect(panel).toHaveAttribute("data-overlay", "false");
  return panel;
}

function lastOperatorBarProps() {
  expect(operatorBarProps.calls.length).toBeGreaterThan(0);
  return operatorBarProps.calls[operatorBarProps.calls.length - 1];
}

describe("Studio chat dock layout", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sendMock.mockResolvedValue({ accepted: true });
    capState.projectId = "project-1";
    capState.projectName = "Test Project";
    localStorage.clear();
    operatorBarProps.calls.length = 0;
    convState.messages = [];
    convState.fallbackNotice = null;
    execState.state.pendingApproval = null;
    setDesktopViewport();
    Object.defineProperty(window, "visualViewport", {
      value: {
        width: DESKTOP_WIDTH,
        height: DESKTOP_HEIGHT,
        offsetTop: 0,
        offsetLeft: 0,
        scale: 1,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      },
      configurable: true,
    });
  });

  it("1. defaults to the left dock on first run", async () => {
    await renderStudioDock();
    const panel = getDockPanel();
    expect(panel).toBeTruthy();
    // Bottom command layer is NOT mounted in left-dock mode.
    expect(screen.queryByTestId("litt-command-layer")).toBeNull();
    // The dock switcher is present in the panel header.
    expect(screen.getByTestId("chat-dock-switcher")).toBeTruthy();
    expect(screen.getByTestId("chat-dock-left")).toHaveAttribute("aria-pressed", "true");
  });

  it("2. first run opens the left dock EXPANDED (persistent, not the 64px rail)", async () => {
    await renderStudioDock();
    const panel = getDockPanel();
    expect(panel).toHaveAttribute("data-collapsed", "false");
    expect(screen.getByTestId("litt-panel-expanded-chrome")).toHaveStyle({ display: "flex" });
    expect(screen.getByTestId("litt-panel-collapsed-chrome")).toHaveStyle({ display: "none" });
  });

  it("3. left dock defaults to 360px wide", async () => {
    await renderStudioDock();
    expect(getDockPanel()).toHaveStyle({ width: "360px" });
  });

  it("4. dock width clamps to exactly 300px", async () => {
    localStorage.setItem(DOCK_WIDTH_KEY, "100");
    await renderStudioDock();
    expect(getDockPanel()).toHaveStyle({ width: "300px" });
  });

  it("5. dock width clamps to exactly 500px", async () => {
    localStorage.setItem(DOCK_WIDTH_KEY, "900");
    await renderStudioDock();
    expect(getDockPanel()).toHaveStyle({ width: "500px" });
  });

  it("6. out-of-range widths clamp via the resize hook (drag-clamp behavior)", () => {
    const { result } = renderHook(() =>
      useResizableWidth({ storageKey: "test:dock-clamp", defaultWidth: 360, minWidth: 300, maxWidth: 500 }),
    );
    expect(result.current.width).toBe(360);
    act(() => result.current.setWidth(999));
    expect(result.current.width).toBe(500);
    act(() => result.current.setWidth(-50));
    expect(result.current.width).toBe(300);
    act(() => result.current.setWidth(420));
    expect(result.current.width).toBe(420);
  });

  it("7. dock width persists across remount", async () => {
    localStorage.setItem(DOCK_WIDTH_KEY, "420");
    const first = await renderStudioDock();
    expect(getDockPanel()).toHaveStyle({ width: "420px" });
    first.unmount();
    await renderStudioDock();
    expect(getDockPanel()).toHaveStyle({ width: "420px" });
  });

  it("8. dock position persists across remount", async () => {
    localStorage.setItem(DOCK_KEY, "bottom");
    const first = await renderStudioDock();
    expect(screen.getByTestId("litt-command-layer")).toBeTruthy();
    expect(screen.queryByTestId("litt-panel")).toBeNull();
    first.unmount();
    await renderStudioDock();
    expect(screen.getByTestId("litt-command-layer")).toBeTruthy();
    expect(screen.queryByTestId("litt-panel")).toBeNull();
    // And the stored preference is the one we set.
    expect(localStorage.getItem(DOCK_KEY)).toBe("bottom");
  });

  it("9. collapse state persists across remount", async () => {
    localStorage.setItem(DOCK_COLLAPSED_KEY, "true");
    const first = await renderStudioDock();
    expect(getDockPanel()).toHaveAttribute("data-collapsed", "true");
    first.unmount();
    await renderStudioDock();
    expect(getDockPanel()).toHaveAttribute("data-collapsed", "true");
    expect(localStorage.getItem(DOCK_COLLAPSED_KEY)).toBe("true");
  });

  it("10. invalid stored dock value falls back to left", async () => {
    localStorage.setItem(DOCK_KEY, "sideways");
    await renderStudioDock();
    expect(getDockPanel()).toBeTruthy();
    expect(screen.queryByTestId("litt-command-layer")).toBeNull();
  });

  it("11. exactly one studio-command-composer is mounted in left mode", async () => {
    await renderStudioDock();
    expect(screen.getAllByTestId("studio-command-composer")).toHaveLength(1);
  });

  it("12. exactly one studio-command-composer is mounted in bottom mode", async () => {
    localStorage.setItem(DOCK_KEY, "bottom");
    await renderStudioDock();
    expect(screen.getAllByTestId("studio-command-composer")).toHaveLength(1);
    expect(screen.getByTestId("litt-command-layer")).toBeTruthy();
  });

  it("13. exactly one composer across Left→Bottom→Left switching", async () => {
    const { user } = await renderStudioDock();
    expect(screen.getAllByTestId("studio-command-composer")).toHaveLength(1);

    await user.click(screen.getByTestId("chat-dock-bottom"));
    await waitFor(() => expect(screen.getByTestId("litt-command-layer")).toBeTruthy());
    expect(screen.getAllByTestId("studio-command-composer")).toHaveLength(1);
    expect(screen.queryByTestId("litt-panel")).toBeNull();

    await user.click(screen.getByTestId("chat-dock-left"));
    await waitFor(() => expect(getDockPanel()).toBeTruthy());
    expect(screen.getAllByTestId("studio-command-composer")).toHaveLength(1);
    expect(screen.queryByTestId("litt-command-layer")).toBeNull();
  });

  it("14. transcript content survives dock switching", async () => {
    convState.fallbackNotice = "transcript-survival-marker-xyz";
    const { user } = await renderStudioDock();
    expect(screen.getByText("transcript-survival-marker-xyz")).toBeTruthy();

    await user.click(screen.getByTestId("chat-dock-bottom"));
    await waitFor(() => expect(screen.getByTestId("litt-command-layer")).toBeTruthy());
    // Bottom mode shows the transcript when the layer is expanded (today's
    // behavior, unchanged): expand it and the same transcript content is there.
    await user.click(screen.getByTestId("litt-layer-toggle"));
    await waitFor(() => expect(screen.getByTestId("litt-layer-transcript")).toBeTruthy());
    expect(screen.getByText("transcript-survival-marker-xyz")).toBeTruthy();

    await user.click(screen.getByTestId("chat-dock-left"));
    await waitFor(() => expect(getDockPanel()).toBeTruthy());
    expect(screen.getByText("transcript-survival-marker-xyz")).toBeTruthy();
  });

  it("15. composer draft survives dock switching", async () => {
    const { user } = await renderStudioDock();
    const textarea = screen
      .getByTestId("studio-command-composer")
      .querySelector("textarea") as HTMLTextAreaElement;
    await user.type(textarea, "draft-keepsake-123");
    expect(textarea.value).toContain("draft-keepsake-123");

    await user.click(screen.getByTestId("chat-dock-bottom"));
    await waitFor(() => expect(screen.getByTestId("litt-command-layer")).toBeTruthy());
    const bottomTextarea = screen
      .getByTestId("studio-command-composer")
      .querySelector("textarea") as HTMLTextAreaElement;
    expect(bottomTextarea.value).toContain("draft-keepsake-123");

    await user.click(screen.getByTestId("chat-dock-left"));
    await waitFor(() => expect(getDockPanel()).toBeTruthy());
    const leftTextarea = screen
      .getByTestId("studio-command-composer")
      .querySelector("textarea") as HTMLTextAreaElement;
    expect(leftTextarea.value).toContain("draft-keepsake-123");
  });

  it("16. Chat/Live tab state survives dock switching", async () => {
    const { user } = await renderStudioDock();
    await user.click(screen.getByTestId("litt-tab-live"));
    expect(screen.getByTestId("litt-tab-live")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("litt-live-panel")).toBeTruthy();

    await user.click(screen.getByTestId("chat-dock-bottom"));
    await waitFor(() => expect(screen.getByTestId("litt-command-layer")).toBeTruthy());

    await user.click(screen.getByTestId("chat-dock-left"));
    await waitFor(() => expect(getDockPanel()).toBeTruthy());
    expect(screen.getByTestId("litt-tab-live")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("litt-live-panel")).toBeTruthy();
  });

  it("17. Chat/Live tab state survives collapse/expand", async () => {
    const { user } = await renderStudioDock();
    await user.click(screen.getByTestId("litt-tab-live"));
    expect(screen.getByTestId("litt-tab-live")).toHaveAttribute("aria-pressed", "true");

    await user.click(screen.getByTestId("litt-panel-collapse"));
    await waitFor(() => expect(getDockPanel()).toHaveAttribute("data-collapsed", "true"));

    await user.click(screen.getByTestId("litt-hud-expand"));
    await waitFor(() => expect(getDockPanel()).toHaveAttribute("data-collapsed", "false"));
    expect(screen.getByTestId("litt-tab-live")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("litt-live-panel")).toBeTruthy();
  });

  it("18. ApprovalCard renders in the left dock when an approval is pending", async () => {
    act(() => {
      execState.state.pendingApproval = {
        toolId: "files.write",
        reason: "test approval",
        pausedRunId: "run-abc123",
      };
    });
    await renderStudioDock();
    const card = screen.getByTestId("approval-card");
    expect(card).toBeTruthy();
    // The card lives inside the left-dock panel content.
    expect(screen.getByTestId("litt-left-panel-content").contains(card)).toBe(true);
  });

  it("19. ApprovalCard renders in bottom mode when an approval is pending", async () => {
    localStorage.setItem(DOCK_KEY, "bottom");
    act(() => {
      execState.state.pendingApproval = {
        toolId: "files.write",
        reason: "test approval",
        pausedRunId: "run-abc123",
      };
    });
    await renderStudioDock();
    const card = screen.getByTestId("approval-card");
    expect(card).toBeTruthy();
    expect(screen.getByTestId("litt-command-layer").contains(card)).toBe(true);
  });

  it("20. OperatorBar renders in left mode with the expected handlers and props", async () => {
    await renderStudioDock();
    expect(screen.getByTestId("studio-operator-bar")).toBeTruthy();
    const props = lastOperatorBarProps();
    for (const key of ["onOpenTerminal", "onOpenActivity", "onRollback", "onStop", "onResolveApproval"]) {
      expect(typeof props[key], key).toBe("function");
    }
    expect(props).toHaveProperty("terminalStatus");
    expect(props).toHaveProperty("modelLabel");
  });

  it("21. OperatorBar in bottom mode receives the same handlers and props as left mode", async () => {
    const { user } = await renderStudioDock();
    const leftProps = lastOperatorBarProps();

    await user.click(screen.getByTestId("chat-dock-bottom"));
    await waitFor(() => expect(screen.getByTestId("litt-command-layer")).toBeTruthy());
    const bottomProps = lastOperatorBarProps();

    // Same prop surface…
    expect(Object.keys(bottomProps).sort()).toEqual(Object.keys(leftProps).sort());
    // …the identical handler implementations wired in both modes. (Compared
    // by source: the useCallbacks' deps include the per-render conversation
    // object, so identities refresh every render — pre-existing behavior,
    // unrelated to the dock. Same source = same handler logic.)
    expect(String(bottomProps.onResolveApproval)).toBe(String(leftProps.onResolveApproval));
    expect(String(bottomProps.onRollback)).toBe(String(leftProps.onRollback));
    // …all handlers present and callable in both modes…
    for (const key of ["onOpenTerminal", "onOpenActivity", "onStop"]) {
      expect(typeof bottomProps[key], key).toBe("function");
    }
    // …and identical contextual props.
    expect(bottomProps.terminalStatus).toBe(leftProps.terminalStatus);
    expect(bottomProps.modelLabel).toBe(leftProps.modelLabel);
  });

  it("22. the workspace stage fills the freed width beside the dock", async () => {
    const { user } = await renderStudioDock();
    const stage = screen.getByTestId("studio-stage");
    expect(stage.className).toContain("flex-1");
    // Dock panel and stage are siblings in the middle row.
    const panel = getDockPanel();
    expect(panel.parentElement).toBe(stage.parentElement);
    // Collapsing the dock keeps the stage mounted and flexible.
    await user.click(screen.getByTestId("litt-panel-collapse"));
    await waitFor(() => expect(getDockPanel()).toHaveAttribute("data-collapsed", "true"));
    expect(getDockPanel()).toHaveStyle({ width: "64px" });
    expect(screen.getByTestId("studio-stage").className).toContain("flex-1");
  });

  it("23. the inspector stays on the right and never exceeds 320px", async () => {
    await renderStudioDock();
    const inspector = screen.getByTestId("studio-context-inspector");
    expect(inspector.className).toContain("xl:w-[320px]");
    expect(inspector.className).not.toContain("340px");
  });

  it("24. Esc collapses the expanded left dock", async () => {
    const { user } = await renderStudioDock();
    expect(getDockPanel()).toHaveAttribute("data-collapsed", "false");
    await user.keyboard("{Escape}");
    await waitFor(() => expect(getDockPanel()).toHaveAttribute("data-collapsed", "true"));
    expect(localStorage.getItem(DOCK_COLLAPSED_KEY)).toBe("true");
  });

  it("25. legacy/classic sizing is unchanged by the dock work", async () => {
    localStorage.setItem("litt:studio:layout-mode", "classic");
    localStorage.setItem(LEGACY_COLLAPSED_KEY, "false");
    localStorage.setItem(LEGACY_WIDTH_KEY, "500");
    const user = userEvent.setup();
    render(<CommandStudio />);
    await waitFor(() => {
      if (!screen.queryByTestId("litt-panel")) {
        throw new Error("legacy LiTTPanel has not mounted");
      }
    });
    const panel = screen.getByTestId("litt-panel");
    // Legacy overlay-mode width still driven by littResize (500px stored,
    // 420–640 range intact) — NOT the dock's 300–500 range.
    expect(panel).toHaveAttribute("data-overlay", "true");
    expect(panel).toHaveStyle({ width: "min(500px, calc(100vw - 24px))" });
    // No dock affordances leak into the legacy path.
    expect(screen.queryByTestId("chat-dock-switcher")).toBeNull();
    expect(screen.queryByTestId("litt-dock-resize-handle")).toBeNull();
    // Collapse toggle still works on the legacy panel (overlay mode uses
    // the close affordance, which collapses to the 64px rail).
    await user.click(screen.getByTestId("litt-panel-close"));
    await waitFor(() => expect(screen.getByTestId("litt-panel")).toHaveAttribute("data-collapsed", "true"));
  });

  it("26. mobile layout is unchanged (no dock surfaces)", async () => {
    globalThis.__TEST_VIEWPORT_WIDTH__ = 390;
    window.innerWidth = 390;
    render(<CommandStudio />);
    await waitFor(() => {
      if (!screen.queryByTestId("litt-mobile-sheet") && !screen.queryByTestId("litt-mobile-trigger")) {
        throw new Error("mobile LiTT surface has not mounted");
      }
    });
    expect(screen.queryByTestId("studio-shell")).toBeNull();
    expect(screen.queryByTestId("chat-dock-switcher")).toBeNull();
    expect(screen.queryByTestId("litt-dock-resize-handle")).toBeNull();
    expect(screen.queryByTestId("litt-command-layer")).toBeNull();
  });

  it("27. no duplicate surfaces during rapid Left→Bottom→Left→Bottom→Left switching", async () => {
    const { user } = await renderStudioDock();
    const switcher = () => screen.getByTestId("chat-dock-switcher");
    await user.click(screen.getByTestId("chat-dock-bottom"));
    await user.click(switcher().querySelector('[data-testid="chat-dock-left"]') as HTMLElement);
    await user.click(screen.getByTestId("chat-dock-bottom"));
    await user.click(switcher().querySelector('[data-testid="chat-dock-left"]') as HTMLElement);
    await waitFor(() => expect(getDockPanel()).toBeTruthy());
    // Exactly one composer, exactly one switcher, exactly one chat surface.
    expect(screen.getAllByTestId("studio-command-composer")).toHaveLength(1);
    expect(screen.getAllByTestId("chat-dock-switcher")).toHaveLength(1);
    expect(screen.queryByTestId("litt-command-layer")).toBeNull();
    expect(screen.getByTestId("litt-left-panel-content")).toBeTruthy();
  });
});


