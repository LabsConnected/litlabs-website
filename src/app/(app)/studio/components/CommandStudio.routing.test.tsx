import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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

// Mock next/dynamic — pass-through that returns null (loading state).
// The 3 Builder routing tests are updated to verify the routing state
// change rather than the dynamic component rendering, since next/dynamic
// with ssr:false cannot be made synchronous in jsdom.
vi.mock("next/dynamic", () => ({
  default: (_loader: () => Promise<{ default: React.ComponentType }>) => {
    return () => null;
  },
}));

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

async function renderCommandStudio() {
  const user = userEvent.setup();
  const view = render(<CommandStudio />);

  await screen.findAllByTestId("assets-panel-mock");

  return { user, ...view };
}

describe("CommandStudio — mounted Work-surface routing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("initializes with preview surface when ?tool=chat", async () => {
    await renderCommandStudio();
    // Preview tab is active by default (preview is the primary surface)
    const previewBtn = screen.getByTestId("workspace-tab-preview");
    expect(previewBtn.className).toContain("glass-active");
  });

  it("routes to builder surface when ?tool=build via studio:switch-tool event", async () => {
    await renderCommandStudio();
    // Preview tab starts active (default surface)
    const previewBtn = screen.getByTestId("workspace-tab-preview");
    expect(previewBtn.className).toContain("glass-active");
    // Dispatch the legacy switch-tool event for "build"
    act(() => {
      window.dispatchEvent(new CustomEvent("studio:switch-tool", { detail: "build" }));
    });
    // When workSurface === "builder", isPlan is false, so Plan tab
    // loses its active state. The BuilderTool itself is loaded via
    // next/dynamic with ssr:false and cannot render in jsdom, but the
    // routing state change is verifiable via the Plan tab's active class.
    await waitFor(() => {
      expect(previewBtn.className).not.toContain("glass-active");
    });
  });

  it("returns to conversation when chat is routed after Build", async () => {
    await renderCommandStudio();
    const previewBtn = screen.getByTestId("workspace-tab-preview");
    // Route to build
    act(() => {
      window.dispatchEvent(new CustomEvent("studio:switch-tool", { detail: "build" }));
    });
    await waitFor(() => expect(previewBtn.className).not.toContain("glass-active"));
    // Route back to chat via the switch-tool event
    act(() => {
      window.dispatchEvent(new CustomEvent("studio:switch-tool", { detail: "chat" }));
    });
    await waitFor(() => {
      expect(previewBtn.className).toContain("glass-active");
    });
  });

  it("chat → build routes to builder, then build → chat returns to conversation", async () => {
    await renderCommandStudio();
    const previewBtn = screen.getByTestId("workspace-tab-preview");
    // Start at preview (default surface)
    expect(previewBtn.className).toContain("glass-active");
    // Route to build
    act(() => {
      window.dispatchEvent(new CustomEvent("studio:switch-tool", { detail: "build" }));
    });
    await waitFor(() => expect(previewBtn.className).not.toContain("glass-active"));
    // Route back to chat
    act(() => {
      window.dispatchEvent(new CustomEvent("studio:switch-tool", { detail: "chat" }));
    });
    await waitFor(() => {
      expect(previewBtn.className).toContain("glass-active");
    });
  });

  describe("canonical workspace tabs", () => {
    it("renders exactly four workspace tabs: Plan, Canvas, Code, Preview", async () => {
      await renderCommandStudio();
      expect(screen.getByTestId("workspace-tab-plan")).toBeTruthy();
      expect(screen.getByTestId("workspace-tab-canvas")).toBeTruthy();
      expect(screen.getByTestId("workspace-tab-code")).toBeTruthy();
      expect(screen.getByTestId("workspace-tab-preview")).toBeTruthy();
    });

    it("Preview tab is active by default (preview is primary surface)", async () => {
      await renderCommandStudio();
      const previewBtn = screen.getByTestId("workspace-tab-preview");
      expect(previewBtn.className).toContain("glass-active");
    });

    it("clicking Canvas switches to canvas stage", async () => {
      const { user } = await renderCommandStudio();
      const canvasBtn = screen.getByTestId("workspace-tab-canvas");
      await user.click(canvasBtn);
      await waitFor(() => {
        expect(canvasBtn.className).toContain("glass-active");
      });
    });

    it("clicking Code switches to code stage", async () => {
      const { user } = await renderCommandStudio();
      const codeBtn = screen.getByTestId("workspace-tab-code");
      await user.click(codeBtn);
      await waitFor(() => {
        expect(codeBtn.className).toContain("glass-active");
      });
    });

    it("clicking Preview switches to preview stage", async () => {
      const { user } = await renderCommandStudio();
      const previewBtn = screen.getByTestId("workspace-tab-preview");
      await user.click(previewBtn);
      await waitFor(() => {
        expect(previewBtn.className).toContain("glass-active");
      });
    });

    it("clicking Plan returns to plan stage from another stage", async () => {
      const { user } = await renderCommandStudio();
      // Go to Code first
      await user.click(screen.getByTestId("workspace-tab-code"));
      // Then back to Plan
      const planBtn = screen.getByTestId("workspace-tab-plan");
      await user.click(planBtn);
      await waitFor(() => {
        expect(planBtn.className).toContain("glass-active");
      });
    });

    it("Files button toggles Context Drawer", async () => {
      const { user } = await renderCommandStudio();
      const filesBtn = screen.getByTestId("workspace-tab-files");
      expect(filesBtn).toBeTruthy();
      // Context drawer stays mounted (state-preserving) but closed by
      // default — `data-open` reflects the real open state.
      expect(screen.getByTestId("context-drawer")).toHaveAttribute("data-open", "false");
      // Toggle it on
      await user.click(filesBtn);
      expect(filesBtn.className).toContain("glass-active");
      expect(screen.getByTestId("context-drawer")).toHaveAttribute("data-open", "true");
    });
  });

  describe("Ultra Vision shell topology (Phase C2)", () => {
    it("renders LiTT panel on the left side", async () => {
      await renderCommandStudio();
      const littPanel = screen.getByTestId("litt-panel");
      expect(littPanel).toBeTruthy();
    });

    it("renders only one LiTT panel", async () => {
      await renderCommandStudio();
      const littPanels = screen.getAllByTestId("litt-panel");
      expect(littPanels.length).toBe(1);
    });

    it("renders only one CommandComposer", async () => {
      await renderCommandStudio();
      // CommandComposer is inside the LiTT chat content
      // There should be at most one composer input
      const composers = screen.queryAllByTestId("model-picker-mock");
      // The model picker mock is used as a proxy — there should be at most 1
      expect(composers.length).toBeLessThanOrEqual(1);
    });

    it("renders Operator status bar at the bottom", async () => {
      await renderCommandStudio();
      expect(screen.getByTestId("studio-operator-bar")).toBeTruthy();
    });

    it("LiTT collapse button works", async () => {
      const { user } = await renderCommandStudio();
      const collapseBtn = screen.getByTestId("litt-panel-collapse");
      expect(collapseBtn).toBeTruthy();
      await user.click(collapseBtn);
      // After collapse, the ambient HUD chrome should be shown...
      expect(screen.getByTestId("litt-ambient-hud")).toBeTruthy();
      expect(screen.getByTestId("litt-panel-collapsed-chrome")).toHaveStyle({ display: "flex" });
      // ...and the expanded chrome/content stays MOUNTED (not removed),
      // just hidden — this is the Phase C2.1 state-preservation fix.
      expect(screen.getByTestId("litt-panel-expanded-chrome")).toHaveStyle({ display: "none" });
      // The single LiTT panel container itself is never removed.
      expect(screen.getByTestId("litt-panel")).toBeTruthy();
    });

    it("collapsed LiTT can be expanded again and preserves the active tab", async () => {
      const { user } = await renderCommandStudio();
      // Switch to Live before collapsing
      await user.click(screen.getByTestId("litt-tab-live"));
      expect(screen.getByTestId("litt-live-panel")).toHaveAttribute("data-active", "true");
      // Collapse
      await user.click(screen.getByTestId("litt-panel-collapse"));
      expect(screen.getByTestId("litt-ambient-hud")).toBeTruthy();
      // Expand
      await user.click(screen.getByTestId("litt-hud-expand"));
      expect(screen.getByTestId("litt-panel-expanded-chrome")).toHaveStyle({ display: "flex" });
      // Active tab (Live) survived the round trip because the content
      // was never unmounted.
      expect(screen.getByTestId("litt-live-panel")).toHaveAttribute("data-active", "true");
    });

    it("collapsed state does not remove workspace tabs", async () => {
      const { user } = await renderCommandStudio();
      // Collapse LiTT
      await user.click(screen.getByTestId("litt-panel-collapse"));
      // Workspace tabs should still be present
      expect(screen.getByTestId("workspace-tab-plan")).toBeTruthy();
      expect(screen.getByTestId("workspace-tab-canvas")).toBeTruthy();
      expect(screen.getByTestId("workspace-tab-code")).toBeTruthy();
      expect(screen.getByTestId("workspace-tab-preview")).toBeTruthy();
    });

    it("Context drawer opens and closes", async () => {
      const { user } = await renderCommandStudio();
      // Closed by default — width 0, not interactable.
      expect(screen.getByTestId("context-drawer")).toHaveAttribute("data-open", "false");
      // Open via Files toggle
      await user.click(screen.getByTestId("workspace-tab-files"));
      expect(screen.getByTestId("context-drawer")).toHaveAttribute("data-open", "true");
      // Close
      await user.click(screen.getByTestId("context-drawer-close"));
      expect(screen.getByTestId("context-drawer")).toHaveAttribute("data-open", "false");
    });

    it("old left Files permanent panel is gone (no studio-files-panel)", async () => {
      await renderCommandStudio();
      // The old files panel testid should not exist
      expect(screen.queryByTestId("studio-files-panel")).toBeNull();
    });

    it("no Game placeholder is rendered", async () => {
      await renderCommandStudio();
      expect(screen.queryByText(/coming soon/i)).toBeNull();
      expect(screen.queryByTestId("game-creator")).toBeNull();
    });

    it("Files button opens the drawer on the Files tab", async () => {
      const { user } = await renderCommandStudio();
      await user.click(screen.getByTestId("workspace-tab-files"));
      expect(screen.getByTestId("context-drawer")).toHaveAttribute("data-open", "true");
      expect(screen.getByTestId("context-files-panel")).toHaveAttribute("data-active", "true");
      expect(screen.getByTestId("context-inspector-panel")).toHaveAttribute("data-active", "false");
    });

    it("Inspector header action opens the drawer on the Inspector tab", async () => {
      const { user } = await renderCommandStudio();
      await user.click(screen.getByLabelText("Open workspace inspector"));
      expect(screen.getByTestId("context-drawer")).toHaveAttribute("data-open", "true");
      expect(screen.getByTestId("context-inspector-panel")).toHaveAttribute("data-active", "true");
      expect(screen.getByTestId("context-files-panel")).toHaveAttribute("data-active", "false");
    });

    it("switching tabs inside the drawer updates parent state, not internal state", async () => {
      const { user } = await renderCommandStudio();
      // Open on Files
      await user.click(screen.getByTestId("workspace-tab-files"));
      expect(screen.getByTestId("context-tab-files")).toHaveAttribute("aria-pressed", "true");
      // Click Inspector tab inside the drawer
      await user.click(screen.getByTestId("context-tab-inspector"));
      expect(screen.getByTestId("context-tab-inspector")).toHaveAttribute("aria-pressed", "true");
      expect(screen.getByTestId("context-inspector-panel")).toHaveAttribute("data-active", "true");
      // The Files workspace-tab button must no longer show as active —
      // it must reflect the REAL active tab, not a stale local one
      // (Phase C2.1 fix for the controlled-drawer bug).
      const filesBtn = screen.getByTestId("workspace-tab-files");
      expect(filesBtn.className).not.toContain("glass-active");
    });

    it("Files workspace-tab button is inactive while Inspector is showing", async () => {
      const { user } = await renderCommandStudio();
      await user.click(screen.getByLabelText("Open workspace inspector"));
      const filesBtn = screen.getByTestId("workspace-tab-files");
      expect(filesBtn.className).not.toContain("glass-active");
      expect(filesBtn).toHaveAttribute("aria-pressed", "false");
    });

    it("clicking Files while Inspector is open switches to Files without closing the drawer", async () => {
      const { user } = await renderCommandStudio();
      await user.click(screen.getByLabelText("Open workspace inspector"));
      expect(screen.getByTestId("context-drawer")).toHaveAttribute("data-open", "true");
      await user.click(screen.getByTestId("workspace-tab-files"));
      expect(screen.getByTestId("context-drawer")).toHaveAttribute("data-open", "true");
      expect(screen.getByTestId("context-files-panel")).toHaveAttribute("data-active", "true");
    });

    it("clicking Files again while Files is active closes the drawer", async () => {
      const { user } = await renderCommandStudio();
      await user.click(screen.getByTestId("workspace-tab-files"));
      expect(screen.getByTestId("context-drawer")).toHaveAttribute("data-open", "true");
      await user.click(screen.getByTestId("workspace-tab-files"));
      expect(screen.getByTestId("context-drawer")).toHaveAttribute("data-open", "false");
    });

    it("mic HUD is not shown ON when the microphone is inactive", async () => {
      const { user } = await renderCommandStudio();
      await user.click(screen.getByTestId("litt-panel-collapse"));
      // No live session in this test, so the mic indicator should not
      // render at all (voiceConnected is false), and definitely never
      // report mic-on merely because a session object exists.
      expect(screen.queryByTestId("litt-hud-mic-indicator")).toBeNull();
    });

    it("desktop tier renders the LiTT rail, not the mobile sheet", async () => {
      await renderCommandStudio();
      expect(screen.getByTestId("litt-panel")).toBeTruthy();
      expect(screen.queryByTestId("litt-mobile-trigger")).toBeNull();
      expect(screen.queryByTestId("litt-mobile-sheet")).toBeNull();
    });

    it("mobile tier does not render the desktop LiTT rail or a 64px HUD", async () => {
      globalThis.__TEST_VIEWPORT_WIDTH__ = 500;
      await renderCommandStudio();
      expect(screen.queryByTestId("litt-panel")).toBeNull();
      expect(screen.queryByTestId("litt-ambient-hud")).toBeNull();
      // Mobile access control must be present instead.
      expect(screen.getByTestId("litt-mobile-trigger")).toBeTruthy();
    });

    it("mobile trigger opens a real LiTT sheet with chat and composer", async () => {
      globalThis.__TEST_VIEWPORT_WIDTH__ = 500;
      const { user } = await renderCommandStudio();
      await user.click(screen.getByTestId("litt-mobile-trigger"));
      expect(screen.getByTestId("litt-mobile-sheet")).toBeTruthy();
      // Closing returns to workspace-only mobile state.
      await user.click(screen.getByTestId("litt-mobile-sheet-close"));
      expect(screen.queryByTestId("litt-mobile-sheet")).toBeNull();
    });

    it("laptop tier defaults to expanded LiTT when no preference is stored", async () => {
      // LiTT now defaults expanded on ALL desktop/laptop tiers (>=1024px)
      // unless the user has an explicit persisted collapse preference.
      // The old laptop-only auto-collapse was removed because it hid the
      // chat behind a 64px strip for first-time users.
      globalThis.__TEST_VIEWPORT_WIDTH__ = 1200;
      await renderCommandStudio();
      await waitFor(() => {
        expect(screen.getByTestId("litt-panel")).toHaveAttribute("data-collapsed", "false");
      });
    });

    it("laptop tier does not override an explicit stored preference", async () => {
      localStorage.setItem("littree:studio:litt-collapsed", "false");
      globalThis.__TEST_VIEWPORT_WIDTH__ = 1200;
      await renderCommandStudio();
      await waitFor(() => {
        expect(screen.getByTestId("litt-panel")).toHaveAttribute("data-collapsed", "false");
      });
    });

    it("desktop tier (>=1440px) defaults to expanded LiTT when no preference is stored", async () => {
      globalThis.__TEST_VIEWPORT_WIDTH__ = 1600;
      await renderCommandStudio();
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

    it("Activity button is present and is an open action (not a collapse toggle)", async () => {
      await renderCommandStudio();
      const activityBtn = screen.getByTestId("activity-toggle");
      expect(activityBtn).toBeTruthy();
      // Default desktop state: LiTT expanded on Chat → Live NOT visible.
      expect(activityBtn).toHaveAttribute("data-active", "false");
      expect(activityBtn).toHaveAttribute("aria-label", "Open Activity");
    });

    it("Activity opens Live on desktop when LiTT is expanded on Chat", async () => {
      const { user } = await renderCommandStudio();
      // Default: Chat is active, Live is not.
      expect(screen.getByTestId("litt-live-panel")).toHaveAttribute("data-active", "false");
      await user.click(screen.getByTestId("activity-toggle"));
      // Activity must switch the LiTT tab to Live.
      expect(screen.getByTestId("litt-live-panel")).toHaveAttribute("data-active", "true");
      // And the Activity button must now truthfully reflect Live visibility.
      expect(screen.getByTestId("activity-toggle")).toHaveAttribute("data-active", "true");
    });

    it("Activity expands a collapsed LiTT and activates Live (desktop)", async () => {
      const { user } = await renderCommandStudio();
      // Collapse LiTT first.
      await user.click(screen.getByTestId("litt-panel-collapse"));
      expect(screen.getByTestId("litt-ambient-hud")).toBeTruthy();
      // Activity must expand the rail AND switch to Live.
      await user.click(screen.getByTestId("activity-toggle"));
      expect(screen.getByTestId("litt-panel-expanded-chrome")).toHaveStyle({ display: "flex" });
      expect(screen.getByTestId("litt-live-panel")).toHaveAttribute("data-active", "true");
      expect(screen.getByTestId("activity-toggle")).toHaveAttribute("data-active", "true");
    });

    it("Activity visible state is false while LiTT is expanded on Chat (not Live)", async () => {
      await renderCommandStudio();
      // LiTT is expanded (desktop default), but on Chat.
      expect(screen.getByTestId("litt-panel")).toHaveAttribute("data-collapsed", "false");
      expect(screen.getByTestId("litt-live-panel")).toHaveAttribute("data-active", "false");
      // The old `activityRailOpen = !littCollapsed` would have been TRUE here,
      // which was a lie. The new `activityVisible` must be FALSE.
      expect(screen.getByTestId("activity-toggle")).toHaveAttribute("data-active", "false");
    });

    it("Activity opens the mobile LiTT sheet and selects Live (mobile)", async () => {
      globalThis.__TEST_VIEWPORT_WIDTH__ = 500;
      const { user } = await renderCommandStudio();
      // Mobile: no desktop rail.
      expect(screen.queryByTestId("litt-panel")).toBeNull();
      // Activity must open the mobile sheet, NOT mutate littCollapsed.
      await user.click(screen.getByTestId("activity-toggle"));
      expect(screen.getByTestId("litt-mobile-sheet")).toBeTruthy();
      // And Live must be the active tab inside the sheet.
      expect(screen.getByTestId("litt-mobile-live-panel")).toHaveAttribute("data-active", "true");
      expect(screen.getByTestId("litt-mobile-tab-live")).toHaveAttribute("aria-pressed", "true");
      // Activity button reflects truthful Live visibility on mobile.
      expect(screen.getByTestId("activity-toggle")).toHaveAttribute("data-active", "true");
    });

    it("Activity does not silently mutate littCollapsed on mobile", async () => {
      globalThis.__TEST_VIEWPORT_WIDTH__ = 500;
      // Store the desktop collapse preference before Activity.
      localStorage.setItem("littree:studio:litt-collapsed", "false");
      const { user } = await renderCommandStudio();
      await user.click(screen.getByTestId("activity-toggle"));
      // The desktop-specific collapse preference must be untouched.
      expect(localStorage.getItem("littree:studio:litt-collapsed")).toBe("false");
    });

    it("exactly one LiTTLiveActivity instance is rendered", async () => {
      await renderCommandStudio();
      // The Live activity component is always mounted in the LiTT panel
      // (preserved across collapse); there must be exactly one instance.
      // The Work tab in the ContextDrawer shows a lightweight summary
      // (LiTTWorkSummary), NOT a second LiTTLiveActivity instance.
      const liveActivities = screen.getAllByTestId("litt-live-activity");
      expect(liveActivities.length).toBe(1);
    });

    it("no obsolete side-panel localStorage keys are written on mount", async () => {
      localStorage.removeItem("littree:studio:side-panel");
      localStorage.removeItem("littree:studio:activity-rail-open");
      await renderCommandStudio();
      expect(localStorage.getItem("littree:studio:side-panel")).toBeNull();
      expect(localStorage.getItem("littree:studio:activity-rail-open")).toBeNull();
    });
  });
});
