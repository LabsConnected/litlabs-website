import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom";

// ── Mocks ────────────────────────────────────────────────────────────
// Integration coverage for the real "New project" journey: project
// switcher → New project → name dialog → POST /api/studio-projects →
// the new project id lands in the URL and the dialog closes. This is the
// exact path that silently did nothing on staging.
//
// Mock harness mirrors CommandStudio.shell.test.tsx: next/dynamic
// resolves via React.lazy + Suspense so the real mounted-component graph
// (header → picker → dialog) is observable.

const stableSearchParams = new URLSearchParams("tool=chat");
const routerReplace = vi.hoisted(() => vi.fn());
const routerPush = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({
  useSearchParams: () => stableSearchParams,
  useRouter: () => ({ replace: routerReplace, push: routerPush }),
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
  resetForProject: vi.fn(),
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
        resetForProject: convState.resetForProject,
      }),
    {
      getState: () => ({
        conversations: [],
        selectedConversationId: null,
        selectConversation: vi.fn(),
        resetForProject: convState.resetForProject,
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

const DESKTOP_WIDTH = 1600;
const DESKTOP_HEIGHT = 900;

const PROJECT_LIST = {
  projects: [
    { id: "project-1", name: "Test Project", sourceType: "litt-managed" },
    { id: "project-2", name: "Another Project", sourceType: "litt-managed" },
  ],
  legacyOnly: [],
};

function installFetchMock(create?: () => Response | Promise<Response>) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    const method = (init as RequestInit | undefined)?.method ?? "GET";
    if (url.includes("/api/studio-projects") && method === "POST") {
      return (
        (await create?.()) ??
        new Response(
          JSON.stringify({ project: { id: "proj-created", name: "Landing revamp" } }),
          { status: 201 },
        )
      );
    }
    if (url.includes("/api/studio-projects")) {
      return new Response(JSON.stringify(PROJECT_LIST), { status: 200 });
    }
    // Every other client fetch (notifications count, tasks, runtime …)
    // resolves to an inert payload — only the create path is under test.
    return new Response(JSON.stringify({}), { status: 200 });
  });
}

async function openPickerToNewProject() {
  const user = userEvent.setup();
  render(<CommandStudio />);
  await waitFor(() => {
    if (!screen.queryByTitle("Switch active project")) {
      throw new Error("Studio header not mounted");
    }
  });
  await user.click(screen.getByTitle("Switch active project"));
  await waitFor(() => expect(screen.getByText("Another Project")).toBeTruthy());
  await user.click(screen.getByText("New project"));
  await waitFor(() => expect(screen.getByRole("dialog")).toBeTruthy());
  return user;
}

describe("CommandStudio — New project journey", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    routerReplace.mockClear();
    routerPush.mockClear();
    capState.projectId = "project-1";
    capState.projectName = "Test Project";
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

  it("creates the project, pins its id in the URL, and closes the dialog", async () => {
    const fetchMock = installFetchMock();
    const user = await openPickerToNewProject();

    await user.clear(screen.getByLabelText("Project name"));
    await user.type(screen.getByLabelText("Project name"), "Landing revamp");
    await user.click(screen.getByRole("button", { name: /create project/i }));

    await waitFor(() => {
      const posts = fetchMock.mock.calls.filter(
        ([input, init]) =>
          String(input instanceof Request ? input.url : String(input)) === "/api/studio-projects" &&
          (init as RequestInit | undefined)?.method === "POST",
      );
      expect(posts).toHaveLength(1);
      const body = JSON.parse((posts[0][1] as RequestInit).body as string);
      expect(body).toMatchObject({
        sourceType: "blank",
        name: "Landing revamp",
        templateId: "blank-static",
      });
      expect(typeof body.idempotencyKey).toBe("string");
      expect(body.idempotencyKey.length).toBeGreaterThan(0);
    });

    await waitFor(() => {
      // The create path itself writes ?project=<new id> — a later
      // URL-sync effect may normalize params again, so assert on the
      // call that carried the new project rather than the last write.
      expect(
        routerReplace.mock.calls.some(([url]) =>
          new URL(`http://localhost${url as string}`).searchParams.get("project") === "proj-created",
        ),
      ).toBe(true);
    });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    // The conversation rebinds to the new project so the next message
    // cannot land in the previous project's chat.
    expect(convState.resetForProject).toHaveBeenCalled();
  });

  it("keeps the dialog open with a visible error when the create fails", async () => {
    installFetchMock(() =>
      new Response(JSON.stringify({ error: "quota exceeded" }), { status: 402 }),
    );
    const user = await openPickerToNewProject();

    await user.click(screen.getByRole("button", { name: /create project/i }));

    await waitFor(() => {
      // projectCreateError surfaces in the dialog AND the chat error
      // banner — scope the assertion to the still-open dialog.
      const { getByText } = within(screen.getByRole("dialog"));
      expect(getByText("quota exceeded")).toBeTruthy();
    });
    // The URL must never be rewritten to a project that was not created.
    expect(
      routerReplace.mock.calls.some(([url]) =>
        new URL(`http://localhost${url as string}`).searchParams.get("project") === "proj-created",
      ),
    ).toBe(false);
  });

  it("issues a single create POST on rapid double submit", async () => {
    let resolveCreate: ((r: Response) => void) | undefined;
    const fetchMock = installFetchMock(
      () =>
        new Promise<Response>((resolve) => {
          resolveCreate = resolve;
        }),
    );
    const user = await openPickerToNewProject();

    const submit = screen.getByRole("button", { name: /create project/i });
    await user.click(submit);
    await user.click(submit);

    await waitFor(() => {
      const posts = fetchMock.mock.calls.filter(
        ([input, init]) =>
          String(input instanceof Request ? input.url : String(input)) === "/api/studio-projects" &&
          (init as RequestInit | undefined)?.method === "POST",
      );
      expect(posts).toHaveLength(1);
    });
    resolveCreate?.(
      new Response(JSON.stringify({ project: { id: "proj-created", name: "X" } }), { status: 201 }),
    );
    await waitFor(() => expect(routerReplace).toHaveBeenCalled());
  });
});
