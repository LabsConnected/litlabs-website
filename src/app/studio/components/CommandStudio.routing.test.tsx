import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";

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

    it("Files button remains independently toggleable", () => {
      render(<CommandStudio />);
      const filesBtn = screen.getByRole("button", { name: "Files" });
      expect(filesBtn).toBeTruthy();
      // Files should not be active by default
      expect(filesBtn.className).not.toContain("glass-active");
      // Toggle it on
      act(() => {
        fireEvent.click(filesBtn);
      });
      expect(filesBtn.className).toContain("glass-active");
    });
  });
});
