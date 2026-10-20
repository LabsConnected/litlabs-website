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
// R1b: records every submitApprovalAndPoll invocation and the cancel
// handle each call returned, so the handler's gate binding, re-entry
// guard, and cancel-handle retention are directly observable.
const pollState = vi.hoisted(() => ({
  calls: [] as Array<Record<string, unknown>>,
  cancels: [] as Array<ReturnType<typeof vi.fn>>,
}));
const execState = vi.hoisted(() => {
  const state: Record<string, unknown> = {
    events: [],
    phase: "idle",
    isRunning: false,
    currentStep: 0,
    pendingApproval: null,
    // Approval lifecycle fields (R1b): the fake mirrors the real store's
    // CURRENT (pre-R1b) action semantics — resolveApproval/failApproval act
    // on whatever gate is current, unconditionally. Gate matching at the
    // store level is pinned against the real store in
    // useExecutionStore.approval-binding.regression.test.ts; here the
    // CommandStudio handler's own binding/guard is what is under test.
    approvalPhase: "idle",
    approvalError: null,
    approvalRetryable: true,
    approvalExpired: false,
    resolvedPausedRunIds: [] as string[],
    checkpoint: null,
    toolCalls: [],
    changesSummary: null,
    previewPreparing: false,
    startRun: vi.fn(),
    endRun: vi.fn(() => { state.pendingApproval = null; }),
    addEvent: vi.fn(),
    setPhase: vi.fn(),
    setPendingApproval: vi.fn((approval: unknown) => {
      state.pendingApproval = approval;
      state.approvalPhase = "idle";
      state.approvalError = null;
      if (approval) state.phase = "awaiting_approval";
    }),
    resolveApproval: vi.fn(() => {
      const pending = state.pendingApproval as { pausedRunId?: string } | null;
      if (pending?.pausedRunId) {
        state.resolvedPausedRunIds = [
          ...(state.resolvedPausedRunIds as string[]),
          pending.pausedRunId,
        ];
      }
      state.pendingApproval = null;
      state.approvalPhase = "idle";
      state.phase = "editing";
    }),
    beginApprovalSubmit: vi.fn(() => {
      state.approvalPhase = "submitting";
      state.approvalError = null;
    }),
    approvalAccepted: vi.fn(() => {
      if (state.approvalPhase === "submitting") state.approvalPhase = "executing";
    }),
    failApproval: vi.fn((error: string, _retryable = true, opts?: { expired?: boolean; decisionRecorded?: boolean }) => {
      const gateActionable = opts?.expired === true || opts?.decisionRecorded !== true;
      state.approvalPhase = "failed";
      state.approvalError = error;
      if (!gateActionable) state.pendingApproval = null;
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
  submitApprovalAndPoll: (opts: Record<string, unknown>) => {
    pollState.calls.push(opts);
    const cancel = vi.fn();
    pollState.cancels.push(cancel);
    return cancel;
  },
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
  return { useExecutionStore, feedSSEEventToExecutionStore: vi.fn() };
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


// ── REPAIR R1b — approval decision binding in CommandStudio ─────────
// Diagnosis E1 F1/F2/F4:
//  F2 — a click must bind to the gate the CLICKED CARD rendered, never to
//       whatever gate is current in the store when the handler runs.
//  F1 — handleResolveApproval must no-op while a decision is already
//       submitting/executing (duplicate POSTs, Reject racing Approve), and
//       must retain submitApprovalAndPoll's cancel handle, invoking it
//       when the gate changes and on unmount.
//  F4 — applyApprovalOutcome must not let a late outcome for gate N
//       clear/fail gate N+1's card.
const GATE_A = { toolId: "files.write", reason: "Write A requires approval", pausedRunId: "gate-a", conversationId: "conv-1" };
const GATE_B = { toolId: "files.write", reason: "Write B requires approval", pausedRunId: "gate-b", conversationId: "conv-1" };

function resetApprovalState() {
  execState.state.pendingApproval = null;
  execState.state.approvalPhase = "idle";
  execState.state.approvalError = null;
  execState.state.approvalRetryable = true;
  execState.state.approvalExpired = false;
  execState.state.resolvedPausedRunIds = [];
  execState.state.phase = "idle";
  pollState.calls.length = 0;
  pollState.cancels.length = 0;
}

describe("CommandStudio — approval decision binding (R1b / E1 F1+F2+F4)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sendMock.mockResolvedValue({ accepted: true });
    capState.projectId = "project-1";
    capState.projectName = "Test Project";
    convState.selectedConversationId = "conv-1";
    resetApprovalState();
    window.localStorage.removeItem("littree:studio:chat-dock");
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
    resetApprovalState();
  });

  it("(a) a stale card's click does NOT post a decision against the gate now current", async () => {
    execState.state.pendingApproval = GATE_A;
    await renderStudioShell();
    // The store advances to gate B WITHOUT a re-render — the mounted card
    // still shows gate A (the rapid same-tool gate sequence from E1 F2).
    execState.state.pendingApproval = GATE_B;

    fireEvent.click(screen.getByTestId("approval-approve"));

    // No decision POST at all — and gate B stays pending, untouched.
    expect(pollState.calls).toHaveLength(0);
    expect((execState.state.pendingApproval as { pausedRunId?: string })?.pausedRunId).toBe("gate-b");
  });

  it("(a2) a click on the CURRENT gate's card posts exactly that gate", async () => {
    execState.state.pendingApproval = GATE_A;
    await renderStudioShell();

    fireEvent.click(screen.getByTestId("approval-approve"));

    expect(pollState.calls).toHaveLength(1);
    expect(pollState.calls[0].pausedRunId).toBe("gate-a");
    expect(pollState.calls[0].decision).toBe("approved");
  });

  it("(b) a second decision while the first is submitting fires NO second POST", async () => {
    execState.state.pendingApproval = GATE_A;
    await renderStudioShell();

    fireEvent.click(screen.getByTestId("approval-approve"));
    expect(pollState.calls).toHaveLength(1);
    expect(execState.state.approvalPhase).toBe("submitting");

    // Double-click / racing Reject from another surface — the handler must
    // no-op while the first decision is in flight.
    fireEvent.click(screen.getByTestId("approval-deny"));
    fireEvent.click(screen.getByTestId("approval-approve"));
    expect(pollState.calls).toHaveLength(1);
  });

  it("(c) a late COMPLETED outcome for gate A does not clear gate B's card", async () => {
    execState.state.pendingApproval = GATE_A;
    await renderStudioShell();
    fireEvent.click(screen.getByTestId("approval-approve"));
    expect(pollState.calls).toHaveLength(1);
    const submitOpts = pollState.calls[0] as {
      onCompleted?: (result: Record<string, unknown>) => void;
    };

    // Gate B mounts while gate A's resumed run is still in flight.
    execState.state.pendingApproval = GATE_B;
    execState.state.phase = "awaiting_approval";

    act(() => {
      submitOpts.onCompleted?.({
        finalText: "gate A finished",
        stepsUsed: 1,
        toolCalls: [],
        cancelled: false,
      });
    });

    expect((execState.state.pendingApproval as { pausedRunId?: string })?.pausedRunId).toBe("gate-b");
    expect(execState.state.phase).toBe("awaiting_approval");
  });

  it("(c2) a late FAILED outcome for gate A does not fail gate B's card", async () => {
    execState.state.pendingApproval = GATE_A;
    await renderStudioShell();
    fireEvent.click(screen.getByTestId("approval-approve"));
    const submitOpts = pollState.calls[0] as {
      onFailed?: (error: string, info?: { retryable: boolean; decisionRecorded?: boolean }) => void;
    };

    execState.state.pendingApproval = GATE_B;
    execState.state.approvalPhase = "idle";

    act(() => {
      submitOpts.onFailed?.("gate A run failed", { retryable: true, decisionRecorded: true });
    });

    expect((execState.state.pendingApproval as { pausedRunId?: string })?.pausedRunId).toBe("gate-b");
    expect(execState.state.approvalPhase).not.toBe("failed");
    expect(execState.state.approvalError).toBeNull();
  });

  it("(d) the retained poll cancel handle fires when the gate changes", async () => {
    execState.state.pendingApproval = GATE_A;
    const view = await renderStudioShell();
    fireEvent.click(screen.getByTestId("approval-approve"));
    expect(pollState.cancels).toHaveLength(1);
    const cancel = pollState.cancels[0];
    expect(cancel).not.toHaveBeenCalled();

    // The gate advances (re-pause on a new gate) — the superseded poll
    // for gate A must be cancelled, not left running against a dead gate.
    execState.state.pendingApproval = GATE_B;
    view.rerender(<CommandStudio />);

    expect(cancel).toHaveBeenCalled();
  });

  it("(d2) the retained poll cancel handle fires on unmount", async () => {
    execState.state.pendingApproval = GATE_A;
    const view = await renderStudioShell();
    fireEvent.click(screen.getByTestId("approval-approve"));
    expect(pollState.cancels).toHaveLength(1);
    const cancel = pollState.cancels[0];

    view.unmount();

    expect(cancel).toHaveBeenCalled();
  });
});
