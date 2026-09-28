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

vi.mock("./shell/StudioOperatorBar", () => ({
  default: () => <div data-testid="studio-operator-bar" />,
}));

vi.mock("@/components/media/MediaUtilityDock", () => ({
  MediaUtilityDock: () => <div data-testid="media-utility-dock-mock" />,
}));

// jsdom polyfill
if (!Element.prototype.scrollTo) {
  Element.prototype.scrollTo = vi.fn();
}

import CommandStudio from "./CommandStudio";

// ── Test viewport: 1600x900 desktop — the Studio destination renders the
// operating shell (rail + stage + inspector + LiTT command layer), NOT the
// classic panel dashboard and NOT the superseded floating-window canvas.
const DESKTOP_WIDTH = 1600;
const DESKTOP_HEIGHT = 900;

async function renderStudioShell() {
  const user = userEvent.setup();
  const view = render(<CommandStudio />);

  await waitFor(() => {
    if (!screen.queryByTestId("studio-shell")) {
      throw new Error("StudioShell has not mounted");
    }
  });

  return { user, ...view };
}

describe("StudioShell — desktop operating shell", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sendMock.mockResolvedValue({ accepted: true });
    capState.projectId = "project-1";
    capState.projectName = "Test Project";
    // Chat-dock prefs are localStorage-backed: isolate every test.
    localStorage.clear();

    globalThis.__TEST_VIEWPORT_WIDTH__ = DESKTOP_WIDTH;
    window.innerWidth = DESKTOP_WIDTH;
    window.innerHeight = DESKTOP_HEIGHT;
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

  it("mounts rail + stage + inspector + left chat dock by default", async () => {
    await renderStudioShell();
    expect(screen.getByTestId("studio-shell")).toBeTruthy();
    expect(screen.getByTestId("studio-workspace-rail")).toBeTruthy();
    expect(screen.getByTestId("studio-stage")).toBeTruthy();
    expect(screen.getByTestId("studio-context-inspector")).toBeTruthy();
    // First-run default is the expanded left dock (owner invariant), not the
    // bottom command layer.
    const panel = screen.getByTestId("litt-panel");
    expect(panel).toHaveAttribute("data-overlay", "false");
    expect(panel).toHaveAttribute("data-collapsed", "false");
    expect(screen.queryByTestId("litt-command-layer")).toBeNull();
  });

  it("mounts rail + stage + inspector + LiTT command layer in bottom-dock mode", async () => {
    // Bottom mode preserves the pre-dock default exactly: set the stored
    // preference and the legacy assertions below hold verbatim.
    localStorage.setItem("littree:studio:chat-dock", "bottom");
    await renderStudioShell();
    expect(screen.getByTestId("studio-shell")).toBeTruthy();
    expect(screen.getByTestId("studio-workspace-rail")).toBeTruthy();
    expect(screen.getByTestId("studio-stage")).toBeTruthy();
    expect(screen.getByTestId("studio-context-inspector")).toBeTruthy();
    expect(screen.getByTestId("litt-command-layer")).toBeTruthy();
  });

  it("does not render the classic workspace tabs or bottom dock", async () => {
    await renderStudioShell();
    expect(screen.queryByTestId("workspace-tab-preview")).toBeNull();
    expect(screen.queryByTestId("studio-dock")).toBeNull();
    // And no floating-window launcher from the superseded compositor.
    expect(screen.queryByTestId("studio-canvas-open-tool")).toBeNull();
  });

  it("renders the Preview surface on the stage by default", async () => {
    await renderStudioShell();
    await waitFor(() => {
      expect(screen.getByTestId("stage-surface-preview")).toHaveAttribute("data-active", "true");
      expect(screen.getByTestId("studio-preview-panel")).toBeTruthy();
    });
  });

  it("rail switches the stage surface and keeps visited surfaces mounted", async () => {
    const { user } = await renderStudioShell();
    await waitFor(() => screen.getByTestId("studio-preview-panel"));
    await user.click(screen.getByTestId("workspace-rail-design"));
    await waitFor(() => {
      expect(screen.getByTestId("stage-surface-design")).toHaveAttribute("data-active", "true");
      expect(screen.getByTestId("visual-canvas-builder")).toBeTruthy();
    });
    // Preview stays mounted (hidden) — iframe/scroll state survives.
    const previewSurface = screen.getByTestId("stage-surface-preview");
    expect(previewSurface).toHaveAttribute("data-active", "false");
    expect(previewSurface.querySelector("[data-testid='studio-preview-panel']")).toBeTruthy();
  });

  it("LiTT command layer expands to the transcript and collapses back to the bar", async () => {
    // Bottom-dock mode: the command layer behaves exactly as before the
    // dock feature (first-run default is now the left dock).
    localStorage.setItem("littree:studio:chat-dock", "bottom");
    const { user } = await renderStudioShell();
    // Collapsed: composer bar present, transcript hidden.
    expect(screen.getByTestId("litt-command-layer")).toBeTruthy();
    expect(screen.queryByTestId("litt-layer-transcript")).toBeNull();

    await user.click(screen.getByTestId("litt-layer-toggle"));
    await waitFor(() => {
      expect(screen.getByTestId("litt-layer-transcript")).toBeTruthy();
    });

    await user.click(screen.getByTestId("litt-layer-collapse"));
    await waitFor(() => {
      expect(screen.queryByTestId("litt-layer-transcript")).toBeNull();
    });
  });

  it("Esc collapses the expanded LiTT layer", async () => {
    localStorage.setItem("littree:studio:chat-dock", "bottom");
    const { user } = await renderStudioShell();
    await user.click(screen.getByTestId("litt-layer-toggle"));
    await waitFor(() => screen.getByTestId("litt-layer-transcript"));
    await user.keyboard("{Escape}");
    await waitFor(() => {
      expect(screen.queryByTestId("litt-layer-transcript")).toBeNull();
    });
  });

  it("an element selection surfaces the contextual inspector with an Ask-LiTT action", async () => {
    localStorage.setItem("littree:studio:chat-dock", "bottom");
    await renderStudioShell();
    const sel = {
      kind: "preview-element",
      label: "Hero heading",
      selector: "h1.hero",
      tagName: "h1",
      sourceFile: "app/page.tsx",
      route: "/",
      projectId: "project-1",
      timestamp: Date.now(),
    };
    act(() => {
      window.dispatchEvent(new CustomEvent("studio:ask-litt", { detail: { selection: sel } }));
    });
    await waitFor(() => {
      // The selection renders the real element editor (resolves the
      // source file; shows its own identity + Ask-LiTT affordance).
      expect(screen.getByTestId("element-inspector-panel")).toBeTruthy();
      expect(screen.getByTestId("inspector-ask-litt")).toBeTruthy();
      // Ask LiTT expanded the command layer for the pinned context.
      expect(screen.getByTestId("litt-layer-transcript")).toBeTruthy();
    });
  });
});