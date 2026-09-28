import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
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

// ── Test viewport: 390x844 — the responsive phone tier (<768px). The
// matchMedia polyfill in tests/setup.ts drives both useViewportTier and
// useIsPhone from `globalThis.__TEST_VIEWPORT_WIDTH__` (reset to 1440 by
// the setup's beforeEach), so each test sets 390 explicitly.
const MOBILE_WIDTH = 390;
const MOBILE_HEIGHT = 844;

async function renderPhoneCommandStudio() {
  const user = userEvent.setup();
  const view = render(<CommandStudio />);

  await waitFor(() => {
    if (!screen.queryByTestId("phone-bottom-nav")) {
      throw new Error("Phone Studio surface has not mounted");
    }
  });

  return { user, ...view };
}

function phoneNav() {
  return screen.getByRole("navigation", { name: "Studio surfaces" });
}

describe("Phone tier — responsive StudioShell (<768px)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sendMock.mockResolvedValue({ accepted: true });
    capState.projectId = "project-1";
    capState.projectName = "Test Project";

    globalThis.__TEST_VIEWPORT_WIDTH__ = MOBILE_WIDTH;
    window.innerWidth = MOBILE_WIDTH;
    window.innerHeight = MOBILE_HEIGHT;
    Object.defineProperty(window, "visualViewport", {
      value: {
        width: MOBILE_WIDTH,
        height: MOBILE_HEIGHT,
        offsetTop: 0,
        offsetLeft: 0,
        scale: 1,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      },
      configurable: true,
    });
  });

  it("renders the same StudioShell in phone mode with the bottom nav", async () => {
    await renderPhoneCommandStudio();
    expect(screen.getByTestId("studio-shell")).toHaveAttribute("data-phone", "true");
    const nav = within(phoneNav());
    for (const label of ["Chat", "Preview", "Files", "Activity", "More"]) {
      expect(nav.getByLabelText(label), `${label} nav item should be present`).toBeTruthy();
    }
    expect(nav.queryByLabelText("Agents")).toBeNull();
    expect(nav.queryByLabelText("Missions")).toBeNull();
  });

  it("keeps the WorktabBar and drops the desktop rail and inspector aside", async () => {
    await renderPhoneCommandStudio();
    expect(screen.getByTestId("worktab-bar")).toBeTruthy();
    expect(screen.queryByTestId("studio-workspace-rail")).toBeNull();
    expect(screen.queryByTestId("studio-context-inspector")).toBeNull();
  });

  it("keeps the real preview as the default stage surface", async () => {
    await renderPhoneCommandStudio();
    const preview = screen.getByTestId("stage-surface-preview");
    expect(preview).toHaveAttribute("data-active", "true");
    await waitFor(() => {
      expect(preview.querySelector("[data-testid='studio-preview-panel']")).toBeTruthy();
    });
    expect(within(phoneNav()).getByLabelText("Preview")).toHaveAttribute("aria-current", "page");
  });

  it("marks the active work surface with aria-current", async () => {
    const { user } = await renderPhoneCommandStudio();
    const nav = () => within(phoneNav());
    expect(nav().getByLabelText("Preview")).toHaveAttribute("aria-current", "page");
    await user.click(nav().getByLabelText("Activity"));
    await waitFor(() => {
      expect(nav().getByLabelText("Activity")).toHaveAttribute("aria-current", "page");
    });
    // The previous surface loses its marker; the stage follows.
    expect(nav().getByLabelText("Preview")).not.toHaveAttribute("aria-current");
    expect(screen.getByTestId("stage-surface-activity")).toHaveAttribute("data-active", "true");
    expect(screen.getByTestId("stage-surface-preview")).toHaveAttribute("data-active", "false");
  });

  it("keeps surfaces mounted when switching — never duplicates the preview", async () => {
    const { user } = await renderPhoneCommandStudio();
    await waitFor(() => {
      expect(
        screen.getByTestId("stage-surface-preview").querySelector("[data-testid='studio-preview-panel']"),
      ).toBeTruthy();
    });
    await user.click(within(phoneNav()).getByLabelText("Activity"));
    await waitFor(() => {
      expect(screen.getByTestId("stage-surface-activity")).toHaveAttribute("data-active", "true");
    });
    await user.click(within(phoneNav()).getByLabelText("Preview"));
    await waitFor(() => {
      expect(screen.getByTestId("stage-surface-preview")).toHaveAttribute("data-active", "true");
    });
    // Exactly one preview panel instance — switching surfaces mounts
    // lazily and never duplicates or remounts the stage.
    expect(screen.getAllByTestId("studio-preview-panel")).toHaveLength(1);
  });

  it("Chat expands the LiTT command layer instead of switching surfaces", async () => {
    const { user } = await renderPhoneCommandStudio();
    // The collapsed composer is always visible above the bottom nav.
    expect(screen.getByTestId("litt-command-layer")).toBeTruthy();
    await user.click(within(phoneNav()).getByLabelText("Chat"));
    await waitFor(() => {
      expect(within(phoneNav()).getByLabelText("Chat")).toHaveAttribute("aria-current", "page");
    });
    // Chat is not a stage surface — the stage surface is untouched.
    expect(screen.getByTestId("stage-surface-preview")).toHaveAttribute("data-active", "true");
  });

  it("More opens the sheet with the secondary stage surfaces", async () => {
    const { user } = await renderPhoneCommandStudio();
    await user.click(within(phoneNav()).getByLabelText("More"));
    const sheet = await screen.findByTestId("mobile-more-sheet");
    expect(sheet).toBeTruthy();
    // plan, design, browser, code, images, assets, deploy, terminal.
    expect(
      within(sheet).getAllByTestId(/^phone-more-(plan|design|browser|code|images|assets|deploy|terminal)$/),
    ).toHaveLength(8);
    // Selecting a surface drives the real stage and closes the sheet.
    await user.click(within(sheet).getByTestId("phone-more-terminal"));
    await waitFor(() => {
      expect(screen.queryByTestId("mobile-more-sheet")).toBeNull();
    });
    expect(screen.getByTestId("stage-surface-terminal")).toHaveAttribute("data-active", "true");
  });

  it("starts with the inspector sheet closed and no legacy mobile chrome", async () => {
    await renderPhoneCommandStudio();
    // The inspector is hidden by default on the phone tier.
    expect(screen.queryByTestId("mobile-inspector-sheet")).toBeNull();
    // The pre-simplification mobile chrome is suppressed on the phone
    // tier — the shell's bottom nav + command layer own those jobs now.
    expect(screen.queryByTestId("litt-mobile-trigger")).toBeNull();
    expect(screen.queryByTestId("mobile-surface-switcher")).toBeNull();
    expect(screen.queryByTestId("litt-mobile-sheet-mount")).toBeNull();
    expect(screen.queryByRole("navigation", { name: "Studio navigation" })).toBeNull();
  });
});
