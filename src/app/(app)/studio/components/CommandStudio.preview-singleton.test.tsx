import { describe, it, expect, vi, beforeEach } from "vitest";
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
// stable testid so mounted instances can be counted.
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

vi.mock("../hooks/useConnectionSummary", () => ({
  useConnectionSummary: () => ({
    capabilities: {
      repository: "disconnected",
      repositoryName: null,
      repositoryIndexed: false,
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

vi.mock("../hooks/useCanonicalConversation", () => ({
  useCanonicalConversation: () => ({
    messages: [],
    busy: false,
    send: vi.fn().mockResolvedValue({ accepted: true }),
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
    selectedConversationId: null,
    conversations: [],
    loading: false,
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

vi.mock("../stores/useExecutionStore", () => ({
  useExecutionStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({
      events: [],
      phase: "idle",
      isRunning: false,
      currentStep: 0,
      pendingApproval: null,
      checkpoint: null,
      toolCalls: [],
      changesSummary: null,
      startRun: vi.fn(),
      endRun: vi.fn(),
      addEvent: vi.fn(),
      setPhase: vi.fn(),
      setPendingApproval: vi.fn(),
      resolveApproval: vi.fn(),
      setCheckpoint: vi.fn(),
      collapseEvent: vi.fn(),
      collapseLowLevel: vi.fn(),
      clearEvents: vi.fn(),
      reset: vi.fn(),
    }),
}));

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

async function openAdvancedTools(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: /open advanced tools/i }));
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

  it("mounts exactly one preview on desktop split with advanced tools open", async () => {
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

  it("keeps exactly one preview across Preview → Code → Preview navigation", async () => {
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

  it("shows the Plan surface in the center while the permanent preview stays mounted (Plan tab)", async () => {
    globalThis.__TEST_VIEWPORT_WIDTH__ = 1600;
    const { user } = await renderCommandStudio();
    await openAdvancedTools(user);
    await waitFor(() => expect(screen.getByTestId("permanent-preview-column")).toBeTruthy());
    await user.click(screen.getByTestId("workspace-tab-plan"));
    await settle();
    expect(previewPanels()).toHaveLength(1);
    expect(screen.getByTestId("studio-center-workspace").querySelector("[data-testid='studio-plan-surface']")).toBeTruthy();
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
