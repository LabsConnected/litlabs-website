import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
    settleResumedRun: vi.fn(),
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
  // Phase 0 tests flip this to drive conversation.busy edges (run starts)
  // through the mocked conversation hook. Defaults to false, which is what
  // every pre-existing test in this file observed.
  busy: false,
}));

vi.mock("../hooks/useCanonicalConversation", () => ({
  useCanonicalConversation: () => ({
    messages: [],
    busy: convState.busy,
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
  // useWorktabBadges calls this once per worktab — with no server tasks
  // it never runs, which is why the stub could be missing until a test
  // served a real task. "idle" is the real function's answer for a tab
  // with no live execution snapshot.
  return { useExecutionStore, deriveWorktabBadge: () => "idle" as const, approvalForConversation: (approval: { conversationId?: string } | null, conversationId?: string | null) => (approval && approval.conversationId && approval.conversationId !== conversationId ? null : approval) };
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
import { useBoardLayoutStore } from "../stores/useBoardLayoutStore";

// ── Test viewport: 1600x900 desktop — the Studio destination renders the
// operating shell (rail + stage + inspector + LiTT command layer), NOT the
// classic panel dashboard and NOT the superseded floating-window canvas.
const DESKTOP_WIDTH = 1600;
const DESKTOP_HEIGHT = 900;

async function renderStudioShell() {
  const user = userEvent.setup();
  const view = render(<CommandStudio />);

  await waitFor(() => {
    if (!screen.queryByTestId("studio-board-shell")) {
      throw new Error("board shell has not mounted");
    }
  });

  return { user, ...view };
}

describe("Board-only shell — the full-window board", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sendMock.mockResolvedValue({ accepted: true });
    capState.projectId = "project-1";
    capState.projectName = "Test Project";
    window.localStorage.removeItem("litt-studio-board-layout-v1");
    window.localStorage.removeItem("litt-studio-layout");
    useBoardLayoutStore.setState({ enabledByUser: {}, scopes: {} });

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

  afterEach(() => {
    useBoardLayoutStore.setState({ enabledByUser: {}, scopes: {} });
    window.localStorage.removeItem("litt-studio-board-layout-v1");
  });

  it("opens on the full-window board — no stage rail, no second nav rail, no Developer bar, no fixed chat column, no board toggle", async () => {
    await renderStudioShell();
    expect(screen.getByTestId("studio-board-shell")).toBeTruthy();
    expect(screen.getByTestId("studio-board")).toBeTruthy();
    // The retired shell chrome is gone from the Studio view.
    expect(screen.queryByTestId("studio-shell")).toBeNull();
    expect(screen.queryByTestId("studio-workspace-rail")).toBeNull();
    expect(screen.queryByTestId("studio-stage")).toBeNull();
    expect(screen.queryByTestId("stage-surface-preview")).toBeNull();
    expect(screen.queryByTestId("studio-dock")).toBeNull();
    expect(screen.queryByTestId("litt-panel")).toBeNull();
    expect(screen.queryByTestId("studio-context-inspector")).toBeNull();
    expect(screen.queryByTestId("dock-board-toggle")).toBeNull();
    expect(screen.queryByTestId("dock-preview-toggle")).toBeNull();
  });

  it("the default panels bind the real systems; chat is a movable board panel with New Chat inside it and exactly one composer", async () => {
    await renderStudioShell();
    await waitFor(() => expect(screen.getByTestId("board-panel-chat")).toBeTruthy());
    expect(screen.getByTestId("board-binding-chat")).toBeTruthy();
    expect(screen.getByTestId("board-chat-panel")).toBeTruthy();
    expect(screen.getByTestId("board-chat-new-chat")).toBeTruthy();
    // Exactly one composer in the whole Studio, inside the chat panel.
    expect(screen.getAllByTestId("studio-command-composer")).toHaveLength(1);
    expect(
      screen.getByTestId("board-panel-chat").contains(screen.getByTestId("studio-command-composer")),
    ).toBe(true);
    // The mockup default arrangement, bound to the real systems.
    expect(screen.getByTestId("board-binding-preview")).toBeTruthy();
    expect(await screen.findByTestId("studio-preview-panel")).toBeTruthy();
    expect(screen.getByTestId("board-binding-media")).toBeTruthy();
    expect(screen.getByTestId("board-media-panel")).toBeTruthy();
    // Closed-by-default panels stay closed until summoned.
    expect(screen.queryByTestId("board-panel-code")).toBeNull();
    expect(screen.queryByTestId("board-panel-inspector")).toBeNull();
    expect(screen.queryByTestId("board-panel-deploy")).toBeNull();
    // The Terminal is closed until requested (Studio Finish Spec,
    // Larry 2026-11-14): no terminal binding mounts by default, and
    // summoning it binds the real terminal drawer.
    expect(screen.queryByTestId("board-panel-terminal")).toBeNull();
    expect(screen.queryByTestId("board-binding-terminal")).toBeNull();
    fireEvent.click(screen.getByTestId("board-summon-terminal"));
    await waitFor(() => expect(screen.getByTestId("board-binding-terminal")).toBeTruthy());
    expect(await screen.findByTestId("terminal-drawer")).toBeTruthy();
  });

  it("Files on the board is the ONLY StudioProjectFiles instance — the single-mount rule holds", async () => {
    const { user } = await renderStudioShell();
    await waitFor(() => expect(screen.getByTestId("board-panel-files")).toBeTruthy());
    await waitFor(() => expect(screen.getAllByTestId("studio-project-files")).toHaveLength(1));
    expect(
      screen.getByTestId("board-panel-files").contains(screen.getAllByTestId("studio-project-files")[0]),
    ).toBe(true);
    // Summoning the already-open panel brings it to front — it must not
    // mount a second instance either.
    await user.click(screen.getByTestId("board-summon-files"));
    expect(screen.getAllByTestId("studio-project-files")).toHaveLength(1);
  });

  it("Checks, Deploy and Activity summon as real board bindings; MissionCards ride inside Activity exactly once", async () => {
    const { user } = await renderStudioShell();
    await waitFor(() => expect(screen.getByTestId("studio-board")).toBeTruthy());

    // The Inspector board panel is retired (Studio layout build,
    // 2026-11-17): the board offers no Inspector summon at all and no
    // binding ever renders — its keepers (approvals / changes / plans)
    // live in the chat panel's Jobs tab and inside the Code box.
    expect(screen.queryByTestId("board-summon-inspector")).toBeNull();
    expect(screen.queryByTestId("board-binding-inspector")).toBeNull();
    expect(screen.queryByTestId("studio-context-inspector")).toBeNull();

    await user.click(screen.getByTestId("board-summon-health"));
    await waitFor(() => expect(screen.getByTestId("board-binding-health")).toBeTruthy());

    await user.click(screen.getByTestId("board-summon-deploy"));
    await waitFor(() => expect(screen.getByTestId("board-binding-deploy")).toBeTruthy());

    // Activity summons from the board toolbar's Layout menu.
    await user.click(screen.getByTestId("board-layout-menu"));
    await user.click(screen.getByTestId("board-summon-activity"));
    await waitFor(() => expect(screen.getByTestId("board-binding-activity")).toBeTruthy());
    expect(screen.getAllByTestId("mission-cards")).toHaveLength(1);
  });

  it("the chat panel's second tab is Jobs, not Files — Files keeps its single board home", async () => {
    const { user } = await renderStudioShell();
    await waitFor(() => expect(screen.getByTestId("board-chat-panel")).toBeTruthy());
    // Spec Amendments 1/3 (2026-11-16): the Files tab was removed from
    // the chat panel and replaced by the Jobs tab (plan, live steps,
    // checks summary, approvals, changes). Files lives in the board
    // Files panel and inside the Code box — still exactly one
    // StudioProjectFiles instance on the board.
    expect(screen.queryByTestId("board-chat-tab-files")).toBeNull();
    expect(screen.getAllByTestId("studio-project-files")).toHaveLength(1);
    await user.click(screen.getByTestId("board-chat-tab-jobs"));
    expect(screen.getByTestId("board-chat-jobs")).toBeTruthy();
    expect(screen.getByTestId("board-chat-jobs-plan")).toBeTruthy();
    expect(screen.getByTestId("board-chat-jobs-checks")).toBeTruthy();
    // The Open Checks action renders only when CommandStudio wires
    // onOpenChecks (Jobs props wiring) — it summons the ONE board
    // Checks (health) panel, never a second checks instance.
    await user.click(screen.getByTestId("board-chat-jobs-open-checks"));
    await waitFor(() => expect(screen.getByTestId("board-binding-health")).toBeTruthy());
    expect(screen.getAllByTestId("studio-project-files")).toHaveLength(1);
  });
});

describe("Board entry — no project bound yet (Studio entry fix, Larry 2026-11-18)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sendMock.mockResolvedValue({ accepted: true });
    capState.projectId = null;
    capState.projectName = null;
    window.localStorage.removeItem("litt-studio-board-layout-v1");
    window.localStorage.removeItem("litt-studio-layout");
    useBoardLayoutStore.setState({ enabledByUser: {}, scopes: {} });
    globalThis.__TEST_VIEWPORT_WIDTH__ = DESKTOP_WIDTH;
    window.innerWidth = DESKTOP_WIDTH;
    window.innerHeight = DESKTOP_HEIGHT;
  });

  afterEach(() => {
    useBoardLayoutStore.setState({ enabledByUser: {}, scopes: {} });
  });

  it("renders the board skeleton with chat in its panel slot — never the centered standalone chat", async () => {
    await renderStudioShell();
    // The binding-state board occupies the board geometry…
    expect(screen.getByTestId("studio-board-shell-binding")).toBeTruthy();
    expect(screen.getByTestId("studio-entry-panel-preview")).toBeTruthy();
    // …the retired centered max-w-xl chat-only column is gone…
    expect(screen.queryByTestId("studio-board-shell-noproject")).toBeNull();
    // …the real StudioBoard has not mounted (no project yet)…
    expect(screen.queryByTestId("studio-board")).toBeNull();
    // …and the one real composer already lives inside the chat
    // panel's normal board slot, so it does not move or disappear
    // when the project binds.
    const chatPanel = screen.getByTestId("studio-entry-chat-panel");
    expect(screen.getAllByTestId("studio-command-composer")).toHaveLength(1);
    expect(
      chatPanel.contains(screen.getByTestId("studio-command-composer")),
    ).toBe(true);
    expect(chatPanel.className).not.toContain("max-w-xl");
  });
});

describe("MissionCards — classic desktop dock", () => {
  beforeEach(() => {
    // Force the classic desktop layout (the only layout that renders the
    // bottom StudioDock); the shell layout is covered above.
    window.localStorage.setItem("litt:studio:layout-mode", "classic");
  });
  afterEach(() => {
    window.localStorage.removeItem("litt:studio:layout-mode");
  });

  async function renderClassicStudio() {
    const user = userEvent.setup();
    render(<CommandStudio />);
    await waitFor(() => {
      if (!screen.queryByTestId("studio-dock")) {
        throw new Error("StudioDock has not mounted");
      }
    });
    return { user };
  }

  it("dock Activity tab renders the mission cards (classic desktop topology)", async () => {
    const { user } = await renderClassicStudio();
    await user.click(screen.getByTestId("dock-collapsed-toggle"));
    await user.click(screen.getByTestId("dock-tab-activity"));
    const activityContent = await screen.findByTestId("dock-content-activity");
    // The dock Activity tab is the mission home in the classic desktop
    // topology: it renders both the activity feed and the mission cards.
    expect(
      activityContent.querySelector('[data-testid="mission-cards"]'),
    ).toBeTruthy();
    expect(activityContent.querySelector('[data-testid="studio-activity-panel"]')).toBeTruthy();
  });
});

describe("Board-only — ?tool=design deep link", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sendMock.mockResolvedValue({ accepted: true });
    capState.projectId = "project-1";
    capState.projectName = "Test Project";
    stableSearchParams.set("tool", "design");
    window.localStorage.removeItem("litt-studio-board-layout-v1");
    useBoardLayoutStore.setState({ enabledByUser: {}, scopes: {} });
    globalThis.__TEST_VIEWPORT_WIDTH__ = DESKTOP_WIDTH;
    window.innerWidth = DESKTOP_WIDTH;
    window.innerHeight = DESKTOP_HEIGHT;
  });

  afterEach(() => {
    stableSearchParams.set("tool", "chat");
    useBoardLayoutStore.setState({ enabledByUser: {}, scopes: {} });
  });

  it("summons the Code panel — Canvas & Design lives inside the Code box now, never the retired DesignCanvas", async () => {
    await renderStudioShell();
    // Amendment 4: the standalone Canvas board panel is retired; the
    // ?tool=design deep link summons the Code panel, inside which the
    // Canvas & Design stage is a view.
    await waitFor(() => expect(screen.getByTestId("board-panel-code")).toBeTruthy());
    expect(screen.getByTestId("board-binding-code")).toBeTruthy();
    expect(screen.queryByTestId("board-panel-canvas")).toBeNull();
    expect(screen.queryByTestId("board-binding-canvas")).toBeNull();
    expect(screen.queryByTestId("design-canvas")).toBeNull();
  });
});

// ── Phase 0 (chat-first redesign, Larry 2026-11-14): the bottom dock NEVER
// auto-opens. A chat send / run start (the conversation.busy edge) and agent
// STUDIO_EVENT_OPEN_DOCK intents must leave a closed dock closed in BOTH
// layouts; agent intents only preselect the tab. The dock opens solely by
// the user's hand (collapsed-strip toggle, header toggle, Cmd/Ctrl+J, Esc,
// explicit drawer deep links).
function dispatchAgentOpenDock(tab: string) {
  act(() => {
    window.dispatchEvent(new CustomEvent("studio:open-dock", { detail: { tab } }));
  });
}

describe("Phase 0 — board: agent intents never open panels on their own", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sendMock.mockResolvedValue({ accepted: true });
    capState.projectId = "project-1";
    capState.projectName = "Test Project";
    convState.busy = false;
    window.localStorage.removeItem("litt:studio:layout-mode");
    window.localStorage.removeItem("litt-studio-board-layout-v1");
    useBoardLayoutStore.setState({ enabledByUser: {}, scopes: {} });
    globalThis.__TEST_VIEWPORT_WIDTH__ = DESKTOP_WIDTH;
    window.innerWidth = DESKTOP_WIDTH;
    window.innerHeight = DESKTOP_HEIGHT;
  });

  afterEach(() => {
    convState.busy = false;
    useBoardLayoutStore.setState({ enabledByUser: {}, scopes: {} });
  });

  it("a run start (busy edge) leaves the default panel set untouched — twice", async () => {
    const { rerender } = await renderStudioShell();
    await waitFor(() => expect(screen.getByTestId("studio-board")).toBeTruthy());
    expect(screen.queryByTestId("board-panel-deploy")).toBeNull();
    expect(screen.queryByTestId("board-panel-inspector")).toBeNull();

    convState.busy = true;
    rerender(<CommandStudio />);
    expect(screen.queryByTestId("board-panel-deploy")).toBeNull();
    expect(screen.queryByTestId("board-panel-inspector")).toBeNull();

    convState.busy = false;
    rerender(<CommandStudio />);
    convState.busy = true;
    rerender(<CommandStudio />);
    expect(screen.queryByTestId("board-panel-deploy")).toBeNull();
    expect(screen.queryByTestId("board-panel-inspector")).toBeNull();
    // And there is no bottom dock for anything to auto-open anymore.
    expect(screen.queryByTestId("studio-dock")).toBeNull();
  });

  it("an agent open-dock event summons no board panel", async () => {
    await renderStudioShell();
    await waitFor(() => expect(screen.getByTestId("studio-board")).toBeTruthy());
    dispatchAgentOpenDock("inspector");
    dispatchAgentOpenDock("media");
    expect(screen.queryByTestId("board-panel-inspector")).toBeNull();
    expect(screen.queryByTestId("board-panel-deploy")).toBeNull();
    expect(screen.queryByTestId("studio-dock")).toBeNull();
  });
});

describe("Phase 0 — classic layout: the dock never auto-opens", () => {
  beforeEach(() => {
    // Force the classic layout (the mobile base body and the desktop
    // escape hatch); the shell layout is covered above.
    window.localStorage.setItem("litt:studio:layout-mode", "classic");
    // Classic dockOpen restores sessionStorage "studio-dock-open" — start
    // from the user-closed state so only this test's actions can open it.
    window.sessionStorage.removeItem("studio-dock-open");
    convState.busy = false;
  });
  afterEach(() => {
    window.localStorage.removeItem("litt:studio:layout-mode");
    window.sessionStorage.removeItem("studio-dock-open");
    convState.busy = false;
  });

  async function renderClassicStudio() {
    const user = userEvent.setup();
    const view = render(<CommandStudio />);
    await waitFor(() => {
      if (!screen.queryByTestId("studio-dock")) {
        throw new Error("StudioDock has not mounted");
      }
    });
    return { user, ...view };
  }

  it("a run start (busy edge) leaves a closed dock closed", async () => {
    const { rerender } = await renderClassicStudio();
    expect(screen.queryByTestId("dock-content-activity")).toBeNull();

    convState.busy = true;
    rerender(<CommandStudio />);
    expect(screen.queryByTestId("dock-content-activity")).toBeNull();
    expect(screen.getByTestId("dock-collapsed-toggle")).toBeTruthy();
  });

  it("an agent open-dock event preselects the tab without opening; the user's strip toggle then reveals that tab", async () => {
    const { user } = await renderClassicStudio();
    dispatchAgentOpenDock("media");
    expect(screen.queryByTestId("dock-content-media")).toBeNull();
    expect(screen.queryByTestId("dock-content-activity")).toBeNull();

    await user.click(screen.getByTestId("dock-collapsed-toggle"));
    const media = await screen.findByTestId("dock-content-media");
    expect(media.style.display).not.toBe("none");
    expect(screen.getByTestId("dock-tab-media")).toHaveAttribute("aria-selected", "true");
    expect(screen.getByTestId("dock-content-activity").style.display).toBe("none");
  });
});
