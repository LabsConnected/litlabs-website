import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import "@testing-library/jest-dom";

// ── Mocks ────────────────────────────────────────────────────────────
// We mock the heavy dependencies so CommandStudio can mount in jsdom.

// Stable URLSearchParams — must be the same reference across re-renders
// so the useEffect([searchParams]) doesn't reset state on every render.
const stableSearchParams = new URLSearchParams("tool=chat");

vi.mock("next/navigation", () => ({
  useSearchParams: () => stableSearchParams,
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => "/studio",
}));

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

// Mock ModelPicker — it uses useTheme.resolvedColors which the test mock doesn't provide
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

// Shell components (Phase C2.1): LiTTAmbientHUD and ContextDrawer are
// intentionally NOT mocked here. The bugs this phase fixes were state
// ownership bugs inside those exact components (uncontrolled tab state,
// unmount-on-collapse, mic truthfulness) — mocking them away would hide
// regressions instead of catching them.
vi.mock("./shell/StudioOperatorBar", () => ({
  default: () => <div data-testid="studio-operator-bar" />,
}));

// jsdom polyfill
if (!Element.prototype.scrollTo) {
  Element.prototype.scrollTo = vi.fn();
}

import CommandStudio from "./CommandStudio";

describe("CommandStudio — mounted Work-surface routing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("initializes with conversation surface when ?tool=chat", () => {
    render(<CommandStudio />);
    // The transcript or empty state should be visible, not the Builder
    expect(screen.queryByTestId("builder-tool")).toBeNull();
  });

  it("renders Builder when routed to build via studio:switch-tool event", async () => {
    render(<CommandStudio />);
    // Dispatch the legacy switch-tool event for "build"
    act(() => {
      window.dispatchEvent(new CustomEvent("studio:switch-tool", { detail: "build" }));
    });
    await waitFor(() => {
      expect(screen.getByTestId("builder-tool")).toBeTruthy();
    });
  });

  it("returns to conversation when Work tab is clicked after Build", async () => {
    render(<CommandStudio />);
    // Route to build
    act(() => {
      window.dispatchEvent(new CustomEvent("studio:switch-tool", { detail: "build" }));
    });
    await waitFor(() => expect(screen.getByTestId("builder-tool")).toBeTruthy());
    // Route back to chat via the switch-tool event
    act(() => {
      window.dispatchEvent(new CustomEvent("studio:switch-tool", { detail: "chat" }));
    });
    await waitFor(() => {
      expect(screen.queryByTestId("builder-tool")).toBeNull();
    });
  });

  it("chat → build renders Builder, then build → chat renders conversation", async () => {
    render(<CommandStudio />);
    // Start at conversation
    expect(screen.queryByTestId("builder-tool")).toBeNull();
    // Route to build
    act(() => {
      window.dispatchEvent(new CustomEvent("studio:switch-tool", { detail: "build" }));
    });
    await waitFor(() => expect(screen.getByTestId("builder-tool")).toBeTruthy());
    // Route back to chat
    act(() => {
      window.dispatchEvent(new CustomEvent("studio:switch-tool", { detail: "chat" }));
    });
    await waitFor(() => {
      expect(screen.queryByTestId("builder-tool")).toBeNull();
    });
  });

  describe("canonical workspace tabs", () => {
    it("renders exactly four workspace tabs: Plan, Canvas, Code, Preview", () => {
      render(<CommandStudio />);
      expect(screen.getByTestId("workspace-tab-plan")).toBeTruthy();
      expect(screen.getByTestId("workspace-tab-canvas")).toBeTruthy();
      expect(screen.getByTestId("workspace-tab-code")).toBeTruthy();
      expect(screen.getByTestId("workspace-tab-preview")).toBeTruthy();
    });

    it("Plan tab is active when ?tool=chat (legacy work mode)", () => {
      render(<CommandStudio />);
      const planBtn = screen.getByTestId("workspace-tab-plan");
      expect(planBtn.className).toContain("glass-active");
    });

    it("clicking Canvas switches to canvas stage", async () => {
      render(<CommandStudio />);
      const canvasBtn = screen.getByTestId("workspace-tab-canvas");
      act(() => {
        fireEvent.click(canvasBtn);
      });
      await waitFor(() => {
        expect(canvasBtn.className).toContain("glass-active");
      });
    });

    it("clicking Code switches to code stage", async () => {
      render(<CommandStudio />);
      const codeBtn = screen.getByTestId("workspace-tab-code");
      act(() => {
        fireEvent.click(codeBtn);
      });
      await waitFor(() => {
        expect(codeBtn.className).toContain("glass-active");
      });
    });

    it("clicking Preview switches to preview stage", async () => {
      render(<CommandStudio />);
      const previewBtn = screen.getByTestId("workspace-tab-preview");
      act(() => {
        fireEvent.click(previewBtn);
      });
      await waitFor(() => {
        expect(previewBtn.className).toContain("glass-active");
      });
    });

    it("clicking Plan returns to plan stage from another stage", async () => {
      render(<CommandStudio />);
      // Go to Code first
      act(() => {
        fireEvent.click(screen.getByTestId("workspace-tab-code"));
      });
      // Then back to Plan
      const planBtn = screen.getByTestId("workspace-tab-plan");
      act(() => {
        fireEvent.click(planBtn);
      });
      await waitFor(() => {
        expect(planBtn.className).toContain("glass-active");
      });
    });

    it("Files button toggles Context Drawer", () => {
      render(<CommandStudio />);
      const filesBtn = screen.getByTestId("workspace-tab-files");
      expect(filesBtn).toBeTruthy();
      // Context drawer stays mounted (state-preserving) but closed by
      // default — `data-open` reflects the real open state.
      expect(screen.getByTestId("context-drawer")).toHaveAttribute("data-open", "false");
      // Toggle it on
      act(() => {
        fireEvent.click(filesBtn);
      });
      expect(filesBtn.className).toContain("glass-active");
      expect(screen.getByTestId("context-drawer")).toHaveAttribute("data-open", "true");
    });
  });

  describe("Ultra Vision shell topology (Phase C2)", () => {
    it("renders LiTT panel on the left side", () => {
      render(<CommandStudio />);
      const littPanel = screen.getByTestId("litt-panel");
      expect(littPanel).toBeTruthy();
    });

    it("renders only one LiTT panel", () => {
      render(<CommandStudio />);
      const littPanels = screen.getAllByTestId("litt-panel");
      expect(littPanels.length).toBe(1);
    });

    it("renders only one CommandComposer", () => {
      render(<CommandStudio />);
      // CommandComposer is inside the LiTT chat content
      // There should be at most one composer input
      const composers = screen.queryAllByTestId("model-picker-mock");
      // The model picker mock is used as a proxy — there should be at most 1
      expect(composers.length).toBeLessThanOrEqual(1);
    });

    it("renders Operator status bar at the bottom", () => {
      render(<CommandStudio />);
      expect(screen.getByTestId("studio-operator-bar")).toBeTruthy();
    });

    it("LiTT collapse button works", () => {
      render(<CommandStudio />);
      const collapseBtn = screen.getByTestId("litt-panel-collapse");
      expect(collapseBtn).toBeTruthy();
      act(() => {
        fireEvent.click(collapseBtn);
      });
      // After collapse, the ambient HUD chrome should be shown...
      expect(screen.getByTestId("litt-ambient-hud")).toBeTruthy();
      expect(screen.getByTestId("litt-panel-collapsed-chrome")).toHaveStyle({ display: "flex" });
      // ...and the expanded chrome/content stays MOUNTED (not removed),
      // just hidden — this is the Phase C2.1 state-preservation fix.
      expect(screen.getByTestId("litt-panel-expanded-chrome")).toHaveStyle({ display: "none" });
      // The single LiTT panel container itself is never removed.
      expect(screen.getByTestId("litt-panel")).toBeTruthy();
    });

    it("collapsed LiTT can be expanded again and preserves the active tab", () => {
      render(<CommandStudio />);
      // Switch to Live before collapsing
      act(() => {
        fireEvent.click(screen.getByTestId("litt-tab-live"));
      });
      expect(screen.getByTestId("litt-live-panel")).toHaveAttribute("data-active", "true");
      // Collapse
      act(() => {
        fireEvent.click(screen.getByTestId("litt-panel-collapse"));
      });
      expect(screen.getByTestId("litt-ambient-hud")).toBeTruthy();
      // Expand
      act(() => {
        fireEvent.click(screen.getByTestId("litt-hud-expand"));
      });
      expect(screen.getByTestId("litt-panel-expanded-chrome")).toHaveStyle({ display: "flex" });
      // Active tab (Live) survived the round trip because the content
      // was never unmounted.
      expect(screen.getByTestId("litt-live-panel")).toHaveAttribute("data-active", "true");
    });

    it("collapsed state does not remove workspace tabs", () => {
      render(<CommandStudio />);
      // Collapse LiTT
      act(() => {
        fireEvent.click(screen.getByTestId("litt-panel-collapse"));
      });
      // Workspace tabs should still be present
      expect(screen.getByTestId("workspace-tab-plan")).toBeTruthy();
      expect(screen.getByTestId("workspace-tab-canvas")).toBeTruthy();
      expect(screen.getByTestId("workspace-tab-code")).toBeTruthy();
      expect(screen.getByTestId("workspace-tab-preview")).toBeTruthy();
    });

    it("Context drawer opens and closes", () => {
      render(<CommandStudio />);
      // Closed by default — width 0, not interactable.
      expect(screen.getByTestId("context-drawer")).toHaveAttribute("data-open", "false");
      // Open via Files toggle
      act(() => {
        fireEvent.click(screen.getByTestId("workspace-tab-files"));
      });
      expect(screen.getByTestId("context-drawer")).toHaveAttribute("data-open", "true");
      // Close
      act(() => {
        fireEvent.click(screen.getByTestId("context-drawer-close"));
      });
      expect(screen.getByTestId("context-drawer")).toHaveAttribute("data-open", "false");
    });

    it("old left Files permanent panel is gone (no studio-files-panel)", () => {
      render(<CommandStudio />);
      // The old files panel testid should not exist
      expect(screen.queryByTestId("studio-files-panel")).toBeNull();
    });

    it("no Game placeholder is rendered", () => {
      render(<CommandStudio />);
      expect(screen.queryByText(/coming soon/i)).toBeNull();
      expect(screen.queryByTestId("game-creator")).toBeNull();
    });

    it("Files button opens the drawer on the Files tab", () => {
      render(<CommandStudio />);
      act(() => {
        fireEvent.click(screen.getByTestId("workspace-tab-files"));
      });
      expect(screen.getByTestId("context-drawer")).toHaveAttribute("data-open", "true");
      expect(screen.getByTestId("context-files-panel")).toHaveAttribute("data-active", "true");
      expect(screen.getByTestId("context-inspector-panel")).toHaveAttribute("data-active", "false");
    });

    it("Inspector header action opens the drawer on the Inspector tab", () => {
      render(<CommandStudio />);
      act(() => {
        fireEvent.click(screen.getByLabelText("Open workspace inspector"));
      });
      expect(screen.getByTestId("context-drawer")).toHaveAttribute("data-open", "true");
      expect(screen.getByTestId("context-inspector-panel")).toHaveAttribute("data-active", "true");
      expect(screen.getByTestId("context-files-panel")).toHaveAttribute("data-active", "false");
    });

    it("switching tabs inside the drawer updates parent state, not internal state", () => {
      render(<CommandStudio />);
      // Open on Files
      act(() => {
        fireEvent.click(screen.getByTestId("workspace-tab-files"));
      });
      expect(screen.getByTestId("context-tab-files")).toHaveAttribute("aria-pressed", "true");
      // Click Inspector tab inside the drawer
      act(() => {
        fireEvent.click(screen.getByTestId("context-tab-inspector"));
      });
      expect(screen.getByTestId("context-tab-inspector")).toHaveAttribute("aria-pressed", "true");
      expect(screen.getByTestId("context-inspector-panel")).toHaveAttribute("data-active", "true");
      // The Files workspace-tab button must no longer show as active —
      // it must reflect the REAL active tab, not a stale local one
      // (Phase C2.1 fix for the controlled-drawer bug).
      const filesBtn = screen.getByTestId("workspace-tab-files");
      expect(filesBtn.className).not.toContain("glass-active");
    });

    it("Files workspace-tab button is inactive while Inspector is showing", () => {
      render(<CommandStudio />);
      act(() => {
        fireEvent.click(screen.getByLabelText("Open workspace inspector"));
      });
      const filesBtn = screen.getByTestId("workspace-tab-files");
      expect(filesBtn.className).not.toContain("glass-active");
      expect(filesBtn).toHaveAttribute("aria-pressed", "false");
    });

    it("clicking Files while Inspector is open switches to Files without closing the drawer", () => {
      render(<CommandStudio />);
      act(() => {
        fireEvent.click(screen.getByLabelText("Open workspace inspector"));
      });
      expect(screen.getByTestId("context-drawer")).toHaveAttribute("data-open", "true");
      act(() => {
        fireEvent.click(screen.getByTestId("workspace-tab-files"));
      });
      expect(screen.getByTestId("context-drawer")).toHaveAttribute("data-open", "true");
      expect(screen.getByTestId("context-files-panel")).toHaveAttribute("data-active", "true");
    });

    it("clicking Files again while Files is active closes the drawer", () => {
      render(<CommandStudio />);
      act(() => {
        fireEvent.click(screen.getByTestId("workspace-tab-files"));
      });
      expect(screen.getByTestId("context-drawer")).toHaveAttribute("data-open", "true");
      act(() => {
        fireEvent.click(screen.getByTestId("workspace-tab-files"));
      });
      expect(screen.getByTestId("context-drawer")).toHaveAttribute("data-open", "false");
    });

    it("mic HUD is not shown ON when the microphone is inactive", () => {
      render(<CommandStudio />);
      act(() => {
        fireEvent.click(screen.getByTestId("litt-panel-collapse"));
      });
      // No live session in this test, so the mic indicator should not
      // render at all (voiceConnected is false), and definitely never
      // report mic-on merely because a session object exists.
      expect(screen.queryByTestId("litt-hud-mic-indicator")).toBeNull();
    });

    it("desktop tier renders the LiTT rail, not the mobile sheet", () => {
      render(<CommandStudio />);
      expect(screen.getByTestId("litt-panel")).toBeTruthy();
      expect(screen.queryByTestId("litt-mobile-trigger")).toBeNull();
      expect(screen.queryByTestId("litt-mobile-sheet")).toBeNull();
    });

    it("mobile tier does not render the desktop LiTT rail or a 64px HUD", () => {
      globalThis.__TEST_VIEWPORT_WIDTH__ = 500;
      render(<CommandStudio />);
      expect(screen.queryByTestId("litt-panel")).toBeNull();
      expect(screen.queryByTestId("litt-ambient-hud")).toBeNull();
      // Mobile access control must be present instead.
      expect(screen.getByTestId("litt-mobile-trigger")).toBeTruthy();
    });

    it("mobile trigger opens a real LiTT sheet with chat and composer", () => {
      globalThis.__TEST_VIEWPORT_WIDTH__ = 500;
      render(<CommandStudio />);
      act(() => {
        fireEvent.click(screen.getByTestId("litt-mobile-trigger"));
      });
      expect(screen.getByTestId("litt-mobile-sheet")).toBeTruthy();
      // Closing returns to workspace-only mobile state.
      act(() => {
        fireEvent.click(screen.getByTestId("litt-mobile-sheet-close"));
      });
      expect(screen.queryByTestId("litt-mobile-sheet")).toBeNull();
    });

    it("laptop tier defaults to expanded LiTT when no preference is stored", async () => {
      // LiTT now defaults expanded on ALL desktop/laptop tiers (>=1024px)
      // unless the user has an explicit persisted collapse preference.
      // The old laptop-only auto-collapse was removed because it hid the
      // chat behind a 64px strip for first-time users.
      globalThis.__TEST_VIEWPORT_WIDTH__ = 1200;
      render(<CommandStudio />);
      await waitFor(() => {
        expect(screen.getByTestId("litt-panel")).toHaveAttribute("data-collapsed", "false");
      });
    });

    it("laptop tier does not override an explicit stored preference", async () => {
      localStorage.setItem("littree:studio:litt-collapsed", "false");
      globalThis.__TEST_VIEWPORT_WIDTH__ = 1200;
      render(<CommandStudio />);
      await waitFor(() => {
        expect(screen.getByTestId("litt-panel")).toHaveAttribute("data-collapsed", "false");
      });
    });

    it("desktop tier (>=1440px) defaults to expanded LiTT when no preference is stored", async () => {
      globalThis.__TEST_VIEWPORT_WIDTH__ = 1600;
      render(<CommandStudio />);
      await waitFor(() => {
        expect(screen.getByTestId("litt-panel")).toHaveAttribute("data-collapsed", "false");
      });
    });

    // ─── Phase C2.2: Activity → LiTT Live semantics ───────────────────────
    //
    // Activity is now an OPEN action that targets LiTT → Live.
    // It must NOT collapse/expand the whole LiTT assistant, and its
    // visible (pressed) state must truthfully reflect whether Live is
    // actually on screen — not merely whether the LiTT rail is expanded.

    it("Activity button is present and is an open action (not a collapse toggle)", () => {
      render(<CommandStudio />);
      const activityBtn = screen.getByTestId("activity-toggle");
      expect(activityBtn).toBeTruthy();
      // Default desktop state: LiTT expanded on Chat → Live NOT visible.
      expect(activityBtn).toHaveAttribute("data-active", "false");
      expect(activityBtn).toHaveAttribute("aria-label", "Open Activity");
    });

    it("Activity opens Live on desktop when LiTT is expanded on Chat", () => {
      render(<CommandStudio />);
      // Default: Chat is active, Live is not.
      expect(screen.getByTestId("litt-live-panel")).toHaveAttribute("data-active", "false");
      act(() => {
        fireEvent.click(screen.getByTestId("activity-toggle"));
      });
      // Activity must switch the LiTT tab to Live.
      expect(screen.getByTestId("litt-live-panel")).toHaveAttribute("data-active", "true");
      // And the Activity button must now truthfully reflect Live visibility.
      expect(screen.getByTestId("activity-toggle")).toHaveAttribute("data-active", "true");
    });

    it("Activity expands a collapsed LiTT and activates Live (desktop)", () => {
      render(<CommandStudio />);
      // Collapse LiTT first.
      act(() => {
        fireEvent.click(screen.getByTestId("litt-panel-collapse"));
      });
      expect(screen.getByTestId("litt-ambient-hud")).toBeTruthy();
      // Activity must expand the rail AND switch to Live.
      act(() => {
        fireEvent.click(screen.getByTestId("activity-toggle"));
      });
      expect(screen.getByTestId("litt-panel-expanded-chrome")).toHaveStyle({ display: "flex" });
      expect(screen.getByTestId("litt-live-panel")).toHaveAttribute("data-active", "true");
      expect(screen.getByTestId("activity-toggle")).toHaveAttribute("data-active", "true");
    });

    it("Activity visible state is false while LiTT is expanded on Chat (not Live)", () => {
      render(<CommandStudio />);
      // LiTT is expanded (desktop default), but on Chat.
      expect(screen.getByTestId("litt-panel")).toHaveAttribute("data-collapsed", "false");
      expect(screen.getByTestId("litt-live-panel")).toHaveAttribute("data-active", "false");
      // The old `activityRailOpen = !littCollapsed` would have been TRUE here,
      // which was a lie. The new `activityVisible` must be FALSE.
      expect(screen.getByTestId("activity-toggle")).toHaveAttribute("data-active", "false");
    });

    it("Activity opens the mobile LiTT sheet and selects Live (mobile)", () => {
      globalThis.__TEST_VIEWPORT_WIDTH__ = 500;
      render(<CommandStudio />);
      // Mobile: no desktop rail.
      expect(screen.queryByTestId("litt-panel")).toBeNull();
      // Activity must open the mobile sheet, NOT mutate littCollapsed.
      act(() => {
        fireEvent.click(screen.getByTestId("activity-toggle"));
      });
      expect(screen.getByTestId("litt-mobile-sheet")).toBeTruthy();
      // And Live must be the active tab inside the sheet.
      expect(screen.getByTestId("litt-mobile-live-panel")).toHaveAttribute("data-active", "true");
      expect(screen.getByTestId("litt-mobile-tab-live")).toHaveAttribute("aria-pressed", "true");
      // Activity button reflects truthful Live visibility on mobile.
      expect(screen.getByTestId("activity-toggle")).toHaveAttribute("data-active", "true");
    });

    it("Activity does not silently mutate littCollapsed on mobile", () => {
      globalThis.__TEST_VIEWPORT_WIDTH__ = 500;
      // Store the desktop collapse preference before Activity.
      localStorage.setItem("littree:studio:litt-collapsed", "false");
      render(<CommandStudio />);
      act(() => {
        fireEvent.click(screen.getByTestId("activity-toggle"));
      });
      // The desktop-specific collapse preference must be untouched.
      expect(localStorage.getItem("littree:studio:litt-collapsed")).toBe("false");
    });

    it("exactly one LiTTLiveActivity instance is rendered", () => {
      render(<CommandStudio />);
      // The Live activity component is always mounted (preserved across
      // collapse); there must be exactly one instance in the DOM.
      const liveActivities = screen.getAllByTestId("litt-live-activity");
      expect(liveActivities.length).toBe(1);
    });

    it("no obsolete side-panel localStorage keys are written on mount", () => {
      localStorage.removeItem("littree:studio:side-panel");
      localStorage.removeItem("littree:studio:activity-rail-open");
      render(<CommandStudio />);
      expect(localStorage.getItem("littree:studio:side-panel")).toBeNull();
      expect(localStorage.getItem("littree:studio:activity-rail-open")).toBeNull();
    });
  });
});
