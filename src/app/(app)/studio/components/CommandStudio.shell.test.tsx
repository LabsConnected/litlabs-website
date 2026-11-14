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
  // useWorktabBadges calls this once per worktab — with no server tasks
  // it never runs, which is why the stub could be missing until a test
  // served a real task. "idle" is the real function's answer for a tab
  // with no live execution snapshot.
  return { useExecutionStore, deriveWorktabBadge: () => "idle" as const };
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
    // Clear dock/layout/collapse residue so every test starts from the
    // owner default (left chat panel, expanded — Larry's rule,
    // 2026-11-12).
    window.localStorage.removeItem("littree:studio:chat-dock");
    window.localStorage.removeItem("littree:studio:chat-dock:explicit");
    window.localStorage.removeItem("litt-studio-layout");
    window.localStorage.removeItem("littree:studio:litt-dock-width");
    window.localStorage.removeItem("littree:studio:litt-collapsed");
    window.sessionStorage.removeItem("littree:studio:litt-collapsed");

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

  it("mounts rail + stage + collapsed inspector + expanded left LiTT chat dock by default", async () => {
    await renderStudioShell();
    expect(screen.getByTestId("studio-shell")).toBeTruthy();
    expect(screen.getByTestId("studio-workspace-rail")).toBeTruthy();
    expect(screen.getByTestId("studio-stage")).toBeTruthy();
    expect(screen.queryByTestId("studio-context-inspector")).toBeNull();
    expect(screen.getByTestId("studio-inspector-open")).toBeTruthy();
    expect(screen.getByTestId("dock-inspector-panel").style.width).toBe("20px");
    expect(screen.queryByTestId("dock-resize-inspector")).toBeNull();
    // Owner default (Larry's rule, 2026-11-12): Studio opens with the
    // chat panel ON THE LEFT, expanded, on the Chat tab — never hidden.
    // The bottom command layer is not mounted.
    const panel = screen.getByTestId("litt-panel");
    await waitFor(() => {
      expect(panel).toHaveAttribute("data-collapsed", "false");
    });
    expect(screen.getByTestId("litt-chat-panel")).toHaveAttribute("data-active", "true");
    // One chat surface only (Larry's rule, 2026-11-12): the bottom
    // command layer was removed entirely and no dock switcher exists.
    expect(screen.queryByTestId("chat-dock-left")).toBeNull();
    expect(screen.queryByTestId("chat-dock-bottom")).toBeNull();
    expect(screen.queryByTestId("litt-command-layer")).toBeNull();
  });

  it("a stored 'bottom' dock value is inert — the bottom chat is gone", async () => {
    // The chat-dock storage keys are legacy residue: the bottom command
    // layer was removed entirely (one-chat-surface rule, 2026-11-12),
    // so even a formerly explicit Bottom choice can no longer mount a
    // chat anywhere but the left panel.
    window.localStorage.setItem("littree:studio:chat-dock", "bottom");
    window.localStorage.setItem("littree:studio:chat-dock:explicit", "1");
    await renderStudioShell();
    expect(screen.getByTestId("litt-panel")).toBeTruthy();
    expect(screen.queryByTestId("litt-command-layer")).toBeNull();
  });

  it("opens and floats the inspector without hiding the docked chat", async () => {
    const { user } = await renderStudioShell();
    await user.click(screen.getByTestId("dock-float-toggle"));
    await waitFor(() => expect(screen.getByTestId("studio-context-inspector")).toBeTruthy());
    expect(screen.getByTestId("dock-inspector-panel").style.width).toBe("320px");

    await user.click(screen.getByTestId("dock-float-toggle"));
    expect(screen.getByTestId("floating-inspector")).toBeTruthy();
    expect(screen.getByTestId("litt-panel")).toBeTruthy();
    expect(screen.getByTestId("studio-left-panel").style.display).not.toBe("none");

    await user.click(screen.getByTestId("dock-float-toggle"));
    expect(screen.queryByTestId("floating-inspector")).toBeNull();
    expect(screen.getByTestId("studio-context-inspector")).toBeTruthy();
  });

  it("expands the stage while keeping side-panel contents mounted, then restores them", async () => {
    const { user } = await renderStudioShell();
    const shell = screen.getByTestId("studio-shell");
    const leftPanel = screen.getByTestId("studio-left-panel");
    const rail = screen.getByTestId("studio-rail-slot");

    await user.click(screen.getByTestId("studio-expand-toggle"));
    expect(shell).toHaveAttribute("data-layout-expanded", "true");
    expect(leftPanel.style.display).toBe("none");
    expect(rail.style.display).toBe("none");
    expect(screen.getByTestId("litt-panel")).toBeTruthy();
    expect(screen.getByTestId("studio-preview-panel")).toBeTruthy();

    await user.click(screen.getByTestId("studio-expand-toggle"));
    expect(shell).toHaveAttribute("data-layout-expanded", "false");
    expect(leftPanel.style.display).not.toBe("none");
    expect(rail.style.display).not.toBe("none");
  });

  it("does not render the classic workspace tabs; the Phase 2 bottom dock starts collapsed", async () => {
    await renderStudioShell();
    expect(screen.queryByTestId("workspace-tab-preview")).toBeNull();
    // Phase 2 (Directive §2): StudioShell gained a bottom-panel slot —
    // the StudioDock is present in shell mode too, starting collapsed
    // so it mounts no tab content until expanded.
    expect(screen.getByTestId("studio-dock")).toBeTruthy();
    expect(screen.getByTestId("dock-collapsed-toggle")).toBeTruthy();
    expect(screen.queryByTestId("dock-content-activity")).toBeNull();
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
    await user.click(screen.getByTestId("workspace-stage-canvas-design"));
    await waitFor(() => {
      expect(screen.getByTestId("stage-surface-design")).toHaveAttribute("data-active", "true");
      expect(screen.getByTestId("visual-canvas-builder")).toBeTruthy();
      expect(screen.getByTestId("litt-panel")).toHaveAttribute("data-collapsed", "true");
    });
    // Preview stays mounted (hidden) — iframe/scroll state survives.
    const previewSurface = screen.getByTestId("stage-surface-preview");
    expect(previewSurface).toHaveAttribute("data-active", "false");
    expect(previewSurface.querySelector("[data-testid='studio-preview-panel']")).toBeTruthy();
  });

  it("an element selection surfaces the contextual inspector with an Ask-LiTT action", async () => {
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
      // Ask LiTT reveals the left panel — the only chat surface — for
      // the pinned context: expanded, transcript inside the panel.
      expect(screen.getByTestId("litt-panel")).toHaveAttribute("data-collapsed", "false");
      expect(screen.getByTestId("litt-panel")).toContainElement(
        screen.getByTestId("litt-dock-transcript"),
      );
    });
  });
});

describe("StudioShell — left chat dock", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sendMock.mockResolvedValue({ accepted: true });
    capState.projectId = "project-1";
    capState.projectName = "Test Project";
    // The left panel is the only chat surface (the bottom layer and
    // the dock switcher were removed, 2026-11-12), so there is no dock
    // state to seed — just clear layout/collapse residue between cases.
    window.localStorage.removeItem("littree:studio:chat-dock");
    window.localStorage.removeItem("littree:studio:chat-dock:explicit");
    window.localStorage.removeItem("litt-studio-layout");
    window.localStorage.removeItem("littree:studio:litt-dock-width");
    window.localStorage.removeItem("littree:studio:litt-collapsed");
    // The collapse preference is session-scoped (a manual collapse sticks for
    // the session; a fresh entry restores Chat + Workspace). Clear it between
    // cases so one test's manual collapse cannot leak into the next.
    window.sessionStorage.removeItem("littree:studio:litt-collapsed");
    window.sessionStorage.removeItem("littree:studio:mobile-litt-open");

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

  it("renders the left dock expanded at 360px on first run", async () => {
    await renderStudioShell();
    const panel = screen.getByTestId("litt-panel");
    // First-run default: the persistent left dock opens expanded (the
    // stored-preference effect flips the collapsed initial state).
    await waitFor(() => {
      expect(panel).toHaveAttribute("data-collapsed", "false");
    });
    expect(panel).toHaveAttribute("data-overlay", "false");
    // 360px default width (expandedMaxWidth="500px" keeps the 26vw legacy
    // clamp from capping it at 1600px).
    expect(panel.style.width).toContain("360px");
    expect(screen.getByTestId("studio-left-panel").style.width).toBe("360px");
    expect(screen.getAllByTestId("litt-dock-resize")).toHaveLength(1);
    expect(screen.queryByTestId("dock-resize-left")).toBeNull();
    // Bottom layer is not mounted in left-dock mode.
    expect(screen.queryByTestId("litt-command-layer")).toBeNull();
  });

  it("mounts exactly one composer in left-dock mode", async () => {
    await renderStudioShell();
    expect(screen.getAllByTestId("studio-command-composer")).toHaveLength(1);
    // The composer lives inside the left dock's pinned composer region.
    expect(screen.getByTestId("litt-dock-composer")).toContainElement(
      screen.getByTestId("studio-command-composer"),
    );
  });

  it("mounts exactly one composer — in the left panel — even with a stored bottom preference", async () => {
    // The bottom chat presentation was removed entirely: a stored
    // bottom preference is inert and cannot mount a composer anywhere
    // else (Larry's one-chat-surface rule, 2026-11-12).
    window.localStorage.setItem("littree:studio:chat-dock", "bottom");
    window.localStorage.setItem("littree:studio:chat-dock:explicit", "1");
    await renderStudioShell();
    expect(screen.getAllByTestId("studio-command-composer")).toHaveLength(1);
    expect(screen.getByTestId("litt-dock-composer")).toContainElement(
      screen.getByTestId("studio-command-composer"),
    );
    expect(screen.queryByTestId("litt-command-layer")).toBeNull();
  });

  it("the operator bar moves with the chat into the left dock", async () => {
    await renderStudioShell();
    // StudioOperatorBar is mocked to a testid stub — it must render inside
    // the left panel, not the (absent) bottom layer.
    expect(screen.getByTestId("litt-panel")).toContainElement(
      screen.getByTestId("studio-operator-bar"),
    );
  });

  it("any stored dock value is ignored — the chat is always the left panel", async () => {
    window.localStorage.setItem("littree:studio:chat-dock", "sideways");
    await renderStudioShell();
    expect(screen.getByTestId("litt-panel")).toBeTruthy();
    expect(screen.queryByTestId("litt-command-layer")).toBeNull();
  });

  it("a legacy localStorage collapsed value no longer pins the panel shut", async () => {
    // The pre-2026-11-12 behaviour wrote litt-collapsed to localStorage
    // automatically, so a stored "true" there is residue, not a choice.
    // Larry's always-show rule: a fresh visit starts expanded anyway.
    window.localStorage.setItem("littree:studio:litt-collapsed", "true");
    await renderStudioShell();
    await waitFor(() => {
      expect(screen.getByTestId("litt-panel")).toHaveAttribute("data-collapsed", "false");
    });
  });

  it("a session collapsed preference is honoured on an in-session reload", async () => {
    // Session-scoped storage is where a deliberate in-session choice
    // lives: a manual collapse earlier in this session survives reload.
    window.sessionStorage.setItem("littree:studio:litt-collapsed", "true");
    await renderStudioShell();
    expect(screen.getByTestId("litt-panel")).toHaveAttribute("data-collapsed", "true");
    expect(screen.getByTestId("studio-left-panel").style.width).toBe("64px");
  });

  it("a stored dock width is clamped to 300–500px", async () => {
    window.localStorage.setItem("littree:studio:litt-dock-width", "999");
    const { unmount } = await renderStudioShell();
    await waitFor(() => {
      expect(screen.getByTestId("litt-panel").style.width).toContain("500px");
    });
    unmount();
    window.localStorage.removeItem("littree:studio:litt-dock-width");
    window.localStorage.setItem("littree:studio:litt-dock-width", "50");
    await renderStudioShell();
    await waitFor(() => {
      expect(screen.getByTestId("litt-panel").style.width).toContain("300px");
    });
  });

  it("Esc collapses the left dock panel", async () => {
    const { user } = await renderStudioShell();
    expect(screen.getByTestId("litt-panel")).toHaveAttribute("data-collapsed", "false");
    await user.keyboard("{Escape}");
    await waitFor(() => {
      expect(screen.getByTestId("litt-panel")).toHaveAttribute("data-collapsed", "true");
    });
    // Content stays mounted while collapsed.
    expect(screen.getByTestId("studio-command-composer")).toBeInTheDocument();
  });

  it("dragging the resize handle resizes the dock within 300–500px", async () => {
    await renderStudioShell();
    const handle = screen.getByTestId("litt-dock-resize");
    const panel = () => screen.getByTestId("litt-panel");
    // Drag right by 100px → 460px.
    fireEvent.mouseDown(handle, { clientX: 360, button: 0 });
    fireEvent.mouseMove(document, { clientX: 460 });
    fireEvent.mouseUp(document);
    await waitFor(() => {
      expect(panel().style.width).toContain("460px");
    });
    expect(screen.getByTestId("studio-left-panel").style.width).toBe("460px");
    // Drag far left → clamped at 300px, and persisted (the hook persists
    // via rAF debounce, so poll for it).
    fireEvent.mouseDown(handle, { clientX: 460, button: 0 });
    fireEvent.mouseMove(document, { clientX: 0 });
    fireEvent.mouseUp(document);
    await waitFor(() => {
      expect(panel().style.width).toContain("300px");
    });
    expect(screen.getByTestId("studio-left-panel").style.width).toBe("300px");
    await waitFor(() => {
      expect(window.localStorage.getItem("littree:studio:litt-dock-width")).toBe("300");
    });
  });

  it("reset layout realigns the shared chat width and exits focus mode", async () => {
    window.localStorage.setItem("littree:studio:litt-dock-width", "440");
    window.localStorage.setItem(
      "litt-studio-layout",
      JSON.stringify({ inspector: 420, floating: "inspector", expanded: true }),
    );
    const { user } = await renderStudioShell();
    await waitFor(() => {
      expect(screen.getByTestId("studio-shell")).toHaveAttribute("data-layout-expanded", "true");
      expect(screen.getByTestId("studio-left-panel").style.width).toBe("440px");
    });

    await user.click(screen.getByTestId("dock-reset"));
    await waitFor(() => {
      expect(screen.getByTestId("studio-shell")).toHaveAttribute("data-layout-expanded", "false");
      expect(screen.getByTestId("studio-left-panel").style.width).toBe("360px");
    });
    expect(screen.getByTestId("litt-panel")).toHaveAttribute("data-collapsed", "false");
    expect(screen.getByTestId("dock-inspector-panel").style.width).toBe("20px");
  });

  it("P0: a fresh Studio entry shows LiTT Chat and a visible composer on desktop", async () => {
    await renderStudioShell();
    // The dock is expanded, not a collapsed rail.
    expect(screen.getByTestId("litt-panel")).toHaveAttribute("data-collapsed", "false");
    // The conversation composer is visible on initial load — this is the exact
    // regression that made Studio look empty to users.
    await expect(screen.getByTestId("studio-command-composer")).toBeVisible();
  });

  it("P0: a manual collapse is honoured for the rest of the session", async () => {
    const { user } = await renderStudioShell();
    await user.click(screen.getByTestId("litt-panel-collapse"));
    await waitFor(() => {
      expect(screen.getByTestId("litt-panel")).toHaveAttribute("data-collapsed", "true");
    });
    // Survives a reload within the session (refresh preserves state).
    expect(window.sessionStorage.getItem("littree:studio:litt-collapsed")).toBe("true");
  });

  it("P0: a legacy localStorage collapse value cannot hide the panel on a fresh visit", async () => {
    window.localStorage.setItem("littree:studio:litt-collapsed", "true");
    await renderStudioShell();
    // Larry's always-show rule (2026-11-12): hidden is never the
    // starting state on a fresh visit. A deliberate collapse is kept in
    // sessionStorage (honoured in-session, covered above); the
    // auto-written localStorage residue is not a deliberate choice and
    // must not resurrect the hidden start Larry reported.
    await waitFor(() => {
      expect(screen.getByTestId("litt-panel")).toHaveAttribute("data-collapsed", "false");
    });
  });

  it("restoring a task's remembered non-Preview surface on entry does not collapse the panel", async () => {
    // Regression (Larry's production walkthrough, 2026-11-14): on a
    // fresh open, the task-binding sync restores the active task's
    // lastOpenedSurface (here "design" — Larry's repo project). That
    // restore is not a user stage selection, so the workspace-first
    // auto-collapse must not fire on it: Studio opens with the left
    // chat panel EXPANDED (Larry's always-show rule, 2026-11-12), and
    // the collapse is never written to the session as if it were a
    // deliberate choice.
    const restoredTask = {
      id: "task-open-state",
      userId: "user-1",
      projectId: "project-1",
      title: "Roofing site",
      taskType: "build",
      status: "working",
      conversationId: "conv-open-state",
      activeActionRunId: null,
      latestActionRunId: null,
      browserSessionId: null,
      previewWorkspaceId: null,
      previewUrl: null,
      selectedArtifact: null,
      verificationState: {},
      metadata: {},
      lastOpenedSurface: "design",
      lastOpenedAt: "2026-11-14T00:00:00Z",
      archivedAt: null,
      createdAt: "2026-11-14T00:00:00Z",
      updatedAt: "2026-11-14T00:00:00Z",
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (String(url).includes("/api/studio/tasks")) {
          return {
            ok: true,
            json: async () => ({ tasks: [restoredTask], closedTasks: [] }),
          };
        }
        return { ok: false, json: async () => ({}) };
      }),
    );
    // A bare /studio URL: the harness default (?tool=chat) is an
    // explicit Preview deep link, which legitimately beats the
    // remembered surface on first sync and would mask the restore.
    stableSearchParams.delete("tool");
    try {
      await renderStudioShell();
      // The restore lands: Canvas & Design becomes the active surface…
      await waitFor(() => {
        expect(screen.getByTestId("stage-surface-design")).toHaveAttribute(
          "data-active",
          "true",
        );
      });
      // …and after the open has fully settled, the left chat panel is
      // STILL expanded, with no phantom collapse persisted to the
      // session. (The settle window matters: the defect's collapse
      // lands one effect pass after the restore, so an instant
      // assertion can race past it.)
      await new Promise((r) => setTimeout(r, 500));
      expect(screen.getByTestId("litt-panel")).toHaveAttribute(
        "data-collapsed",
        "false",
      );
      expect(
        window.sessionStorage.getItem("littree:studio:litt-collapsed"),
      ).not.toBe("true");
    } finally {
      vi.unstubAllGlobals();
      stableSearchParams.set("tool", "chat");
    }
  });

  it("Ask LiTT expands a collapsed left dock panel", async () => {
    const { user } = await renderStudioShell();
    await user.click(screen.getByTestId("litt-panel-collapse"));
    await waitFor(() => {
      expect(screen.getByTestId("litt-panel")).toHaveAttribute("data-collapsed", "true");
    });
    act(() => {
      window.dispatchEvent(new CustomEvent("studio:ask-litt", { detail: {} }));
    });
    await waitFor(() => {
      expect(screen.getByTestId("litt-panel")).toHaveAttribute("data-collapsed", "false");
    });
  });
});
describe("MissionCards — shell center activity stage surface", () => {
  it("renders the mission cards once in the center activity surface (the shell's Phase 2 bottom dock carries the activity feed, not a second MissionCards)", async () => {
    const { user } = await renderStudioShell();
    await user.click(screen.getByTestId("workspace-rail-activity"));
    await waitFor(() => {
      expect(screen.getByTestId("stage-surface-activity")).toHaveAttribute("data-active", "true");
    });
    // The center surface carries the single MissionCards instance in
    // this layout — the shell bottom dock's Activity tab deliberately
    // does not mount a second one.
    expect(screen.getAllByTestId("mission-cards")).toHaveLength(1);
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

describe("Phase 2 — Directive stages, Files sidebar, Preview dock, bottom dock", () => {
  it("rail presents all five Directive stages with Plan first; secondary surfaces and the terminal stay reachable", async () => {
    await renderStudioShell();
    for (const stage of ["plan", "canvas-design", "code", "preview", "media"]) {
      expect(screen.getByTestId(`workspace-stage-${stage}`)).toBeTruthy();
    }
    // Plan is the FIRST stage in the rail (Master Build Directive §2
    // order), ahead of Canvas & Design.
    const planButton = screen.getByTestId("workspace-stage-plan");
    const canvasButton = screen.getByTestId("workspace-stage-canvas-design");
    expect(
      planButton.compareDocumentPosition(canvasButton) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(screen.getByTestId("workspace-rail-terminal")).toBeTruthy();
    expect(screen.getByTestId("workspace-rail-activity")).toBeTruthy();
    expect(screen.getByTestId("workspace-rail-files")).toBeTruthy();
    expect(screen.getByTestId("workspace-rail-assets")).toBeTruthy();
  });

  it("Files sidebar renders beside chat by default and collapses from the layout toolbar", async () => {
    const { user } = await renderStudioShell();
    expect(screen.getByTestId("studio-files-panel")).toBeTruthy();
    // Chat stays mounted beside it (its expanded-on-open default is
    // pinned by the first test in this file — #937 behavior).
    expect(screen.getByTestId("litt-panel")).toBeTruthy();
    await user.click(screen.getByTestId("dock-files-toggle"));
    await waitFor(() => {
      expect(screen.queryByTestId("studio-files-panel")).toBeNull();
    });
  });

  it("Preview dock toggle mounts the live preview panel beside the stage", async () => {
    const { user } = await renderStudioShell();
    expect(screen.queryByTestId("studio-preview-dock-panel")).toBeNull();
    await user.click(screen.getByTestId("dock-preview-toggle"));
    await waitFor(() => {
      expect(screen.getByTestId("studio-preview-dock-panel")).toBeTruthy();
    });
    // The SAME StudioPreviewPanel as the Preview stage: the stage's
    // instance (mounted by default) plus the dock's — no second
    // preview implementation exists.
    expect(screen.getAllByTestId("studio-preview-panel")).toHaveLength(2);
  });

  it("Canvas & Design stage carries the Build/Design toggle; Design mode can be selected in-stage", async () => {
    const { user } = await renderStudioShell();
    await user.click(screen.getByTestId("workspace-stage-canvas-design"));
    await waitFor(() => {
      expect(screen.getByTestId("canvas-design-stage")).toBeTruthy();
    });
    expect(screen.getByTestId("canvas-design-mode-build")).toHaveAttribute("aria-selected", "true");
    await user.click(screen.getByTestId("canvas-design-mode-design"));
    await waitFor(() => {
      expect(screen.getByTestId("canvas-design-mode-design")).toHaveAttribute("aria-selected", "true");
    });
    // The retired floating DesignCanvas tool never renders.
    expect(screen.queryByTestId("design-canvas")).toBeNull();
  });

  it("Plan stage button runs the station contract: center homes on Preview and the inspector opens on its Plan tab", async () => {
    // The rail button was retired 2026-11-13 and restored 2026-11-14
    // (Larry's walkthrough: no Plan stage in the nav). Plan is not a
    // center station — selecting it homes the center on Preview and
    // opens the inspector, whose default tab is Plan (Mission /
    // Checkpoints / Next actions).
    const { user } = await renderStudioShell();
    expect(screen.queryByTestId("studio-context-inspector")).toBeNull();
    await user.click(screen.getByTestId("workspace-stage-plan"));
    await waitFor(() => {
      expect(screen.getByTestId("studio-context-inspector")).toBeTruthy();
    });
    expect(screen.getByTestId("stage-surface-preview")).toHaveAttribute("data-active", "true");
  });

  it("the shell bottom dock expands; its Terminal tab explains the jump to the terminal station", async () => {
    const { user } = await renderStudioShell();
    await user.click(screen.getByTestId("dock-collapsed-toggle"));
    await user.click(screen.getByTestId("dock-tab-terminal"));
    await waitFor(() => {
      expect(screen.getByTestId("dock-terminal-jump")).toBeTruthy();
    });
  });
});

describe("Phase 2 — ?tool=design deep link", () => {
  beforeEach(() => {
    stableSearchParams.set("tool", "design");
  });
  afterEach(() => {
    stableSearchParams.set("tool", "chat");
  });

  it("lands in the Canvas & Design stage with Design mode preselected, never the retired DesignCanvas", async () => {
    await renderStudioShell();
    await waitFor(() => {
      expect(screen.getByTestId("stage-surface-design")).toHaveAttribute("data-active", "true");
      expect(screen.getByTestId("canvas-design-mode-design")).toHaveAttribute("aria-selected", "true");
    });
    expect(screen.queryByTestId("design-canvas")).toBeNull();
  });
});
