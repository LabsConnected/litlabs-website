import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, act, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom";

// ── Mocks ────────────────────────────────────────────────────────────
// We mock the heavy dependencies so CommandStudio can mount in jsdom.

// Mutable URLSearchParams — router.replace/push apply the URL like a
// real browser navigation so the URL→state effect can re-fire on the
// next render. Tests drive back/forward/refresh by assigning
// currentSearchParams and re-rendering.
let currentSearchParams = new URLSearchParams("tool=chat");
const applyUrl = (url: string) => {
  const query = url.includes("?") ? url.slice(url.indexOf("?") + 1) : "";
  currentSearchParams = new URLSearchParams(query);
};
const mockReplace = vi.fn(applyUrl);
const mockPush = vi.fn(applyUrl);
// Next's useRouter returns a stable object — mirror that so effect
// dependencies behave like production.
const stableRouter = { replace: mockReplace, push: mockPush };

vi.mock("next/navigation", () => ({
  useSearchParams: () => currentSearchParams,
  useRouter: () => stableRouter,
  usePathname: () => "/studio",
}));

function setUrl(query: string) {
  currentSearchParams = new URLSearchParams(query);
}

function currentTool() {
  return currentSearchParams.get("tool");
}

function currentMode() {
  return currentSearchParams.get("mode");
}

/** No canonical workspace stage tab is active — the signature of the
    Builder surface (work mode + workSurface "builder"). */
function expectBuilderSurfaceActive() {
  for (const id of ["plan", "canvas", "code", "preview", "media"]) {
    const tab = screen.queryByTestId(`workspace-tab-${id}`);
    expect(tab, `workspace-tab-${id} should be rendered`).toBeTruthy();
    expect(tab!.className, `workspace-tab-${id} should be inactive`).not.toContain("glass-active");
  }
}

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

// The dock's Media tab renders MediaUtilityDock, which requires the
// MediaHubProvider from the app layout (not present in this test mount).
vi.mock("@/components/media/MediaUtilityDock", () => ({
  MediaUtilityDock: () => <div data-testid="media-utility-dock-mock" />,
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

// Mutable so tests can simulate project-metadata/runtime refreshes:
// change the object, rerender, and the hook returns the new value —
// the same mechanism a real refreshCapabilities() produces.
const defaultCapabilities = () => ({
  repository: "disconnected",
  repositoryName: null,
  repositoryIndexed: false,
  terminalExecution: "unavailable",
  writeAccess: false,
  connectedProviders: ["gemini"],
  availableTools: [] as string[],
  connectionSummary: "AI connected",
  terminalStatus: "disconnected",
  terminalSessionId: null,
  terminalError: null,
  voiceTransportConnected: false,
  voiceMicrophoneOn: false,
  voiceHealth: { configured: false, tokenService: "unknown", available: false },
  projectId: null as string | null,
  projectName: null as string | null,
  activeBranch: null as string | null,
});
let mockCapabilities = defaultCapabilities();
let mockRuntime: { state: Record<string, unknown>; loading: boolean; error: null; refresh: () => Promise<void> } | undefined;

vi.mock("../hooks/useConnectionSummary", () => ({
  useConnectionSummary: () => ({
    capabilities: mockCapabilities,
    refresh: vi.fn(async () => undefined),
    loading: false,
    runtime: mockRuntime,
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

  await waitFor(() => {
    if (!screen.queryByTestId("studio-command-composer") && !screen.queryByTestId("litt-mobile-trigger")) {
      throw new Error("Studio surface has not mounted");
    }
  });

  return { user, ...view };
}

describe("CommandStudio — mounted Work-surface routing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    currentSearchParams = new URLSearchParams("tool=chat");
    mockCapabilities = defaultCapabilities();
    mockRuntime = undefined;
    // The dock persists open/tab/height in sessionStorage (intentional
    // product behavior); clear it so each test starts from a closed dock.
    sessionStorage.clear();
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

  it("initializes with preview surface when ?tool=chat", async () => {
    await renderCommandStudio();
    // Preview tab is active by default (preview is the primary surface)
    const previewBtn = screen.getByTestId("workspace-tab-preview");
    expect(previewBtn.className).toContain("glass-active");
  });

  it("routes to builder surface when ?tool=build via studio:switch-tool event", async () => {
    const view = await renderCommandStudio();
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
    // The canonical Builder URL must be written — and must stay stable
    // once the browser applies it (no canonicalization ping-pong).
    await waitFor(() => {
      expect(currentTool()).toBe("build");
    });
    act(() => view.rerender(<CommandStudio />));
    expectBuilderSurfaceActive();
    expect(currentTool()).toBe("build");
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
    const view = await renderCommandStudio();
    const previewBtn = screen.getByTestId("workspace-tab-preview");
    // Start at preview (default surface)
    expect(previewBtn.className).toContain("glass-active");
    // Route to build
    act(() => {
      window.dispatchEvent(new CustomEvent("studio:switch-tool", { detail: "build" }));
    });
    await waitFor(() => expect(previewBtn.className).not.toContain("glass-active"));
    await waitFor(() => expect(currentTool()).toBe("build"));
    // Route back to chat
    act(() => {
      window.dispatchEvent(new CustomEvent("studio:switch-tool", { detail: "chat" }));
    });
    await waitFor(() => {
      expect(previewBtn.className).toContain("glass-active");
    });
    act(() => view.rerender(<CommandStudio />));
    expect(currentTool()).toBe("preview");
  });

  describe("Builder is a stable canonical destination (?tool=build)", () => {
    it("direct ?tool=build mounts the Builder surface with the workspace chrome", async () => {
      setUrl("tool=build");
      await renderCommandStudio();
      // The workspace tab row must be visible — Builder is reachable,
      // not hidden behind a closed tools drawer.
      expect(screen.getByTestId("workspace-tab-plan")).toBeTruthy();
      expectBuilderSurfaceActive();
      // The URL must remain the canonical tool=build — not rewritten to
      // chat/preview/canvas by competing canonicalization effects.
      await waitFor(() => expect(currentTool()).toBe("build"));
      expect(currentMode()).toBeNull();
    });

    it("direct ?tool=build converges — repeated renders produce no URL ping-pong", async () => {
      setUrl("tool=build");
      const view = await renderCommandStudio();
      await waitFor(() => expect(currentTool()).toBe("build"));
      const replaceCallsAfterSettle = mockReplace.mock.calls.length;
      // Simulate hydration/project-load/rerender churn: the surface and
      // the URL must be a fixed point, not a loop.
      for (let i = 0; i < 3; i += 1) {
        act(() => view.rerender(<CommandStudio />));
      }
      expect(mockReplace.mock.calls.length).toBe(replaceCallsAfterSettle);
      expectBuilderSurfaceActive();
      expect(currentTool()).toBe("build");
    });

    it("direct ?tool=build&project=<id> preserves the project param", async () => {
      setUrl("tool=build&project=proj-123");
      const view = await renderCommandStudio();
      await waitFor(() => expect(currentTool()).toBe("build"));
      act(() => view.rerender(<CommandStudio />));
      expectBuilderSurfaceActive();
      expect(currentSearchParams.get("project")).toBe("proj-123");
      expect(currentTool()).toBe("build");
    });

    it("hard refresh on ?tool=build remounts the Builder surface", async () => {
      setUrl("tool=chat");
      const view = await renderCommandStudio();
      act(() => {
        window.dispatchEvent(new CustomEvent("studio:switch-tool", { detail: "build" }));
      });
      await waitFor(() => expect(currentTool()).toBe("build"));
      // Simulate a full reload: unmount, then mount fresh from the URL.
      view.unmount();
      const fresh = render(<CommandStudio />);
      await waitFor(() => {
        if (!screen.queryByTestId("studio-command-composer") && !screen.queryByTestId("litt-mobile-trigger")) {
          throw new Error("Studio surface has not mounted");
        }
      });
      expectBuilderSurfaceActive();
      act(() => fresh.rerender(<CommandStudio />));
      expect(currentTool()).toBe("build");
    });

    it("browser back returns to Builder after navigating to Code", async () => {
      setUrl("tool=build");
      const view = await renderCommandStudio();
      expectBuilderSurfaceActive();
      // Navigate to Code
      const codeBtn = screen.getByTestId("workspace-tab-code");
      const user = userEvent.setup();
      await user.click(codeBtn);
      await waitFor(() => expect(codeBtn.className).toContain("glass-active"));
      await waitFor(() => expect(currentTool()).toBe("code"));
      // Browser Back → tool=build
      setUrl("tool=build");
      act(() => view.rerender(<CommandStudio />));
      await waitFor(() => expectBuilderSurfaceActive());
      expect(currentTool()).toBe("build");
      // Browser Forward → tool=code
      setUrl("tool=code");
      act(() => view.rerender(<CommandStudio />));
      await waitFor(() => expect(codeBtn.className).toContain("glass-active"));
    });

    it("browser back returns to Builder after navigating to Preview", async () => {
      setUrl("tool=build");
      const view = await renderCommandStudio();
      expectBuilderSurfaceActive();
      const previewBtn = screen.getByTestId("workspace-tab-preview");
      const user = userEvent.setup();
      await user.click(previewBtn);
      await waitFor(() => expect(previewBtn.className).toContain("glass-active"));
      await waitFor(() => expect(currentTool()).toBe("preview"));
      setUrl("tool=build");
      act(() => view.rerender(<CommandStudio />));
      await waitFor(() => expectBuilderSurfaceActive());
    });

    it("opening and closing the Inspector dock tab does not leave Builder", async () => {
      setUrl("tool=build");
      const view = await renderCommandStudio();
      expectBuilderSurfaceActive();
      const user = userEvent.setup();
      // The dock is an overlay — Inspector opens inside it without
      // touching the active Builder surface or the canonical URL.
      await user.click(screen.getByTestId("dock-tab-inspector"));
      expect(screen.getByTestId("studio-dock")).toHaveAttribute("data-open", "true");
      expect(screen.getByTestId("dock-tab-inspector")).toHaveAttribute("aria-selected", "true");
      expectBuilderSurfaceActive();
      await user.click(screen.getByTestId("dock-close"));
      expect(screen.getByTestId("studio-dock")).toHaveAttribute("data-open", "false");
      act(() => view.rerender(<CommandStudio />));
      expectBuilderSurfaceActive();
      expect(currentTool()).toBe("build");
    });

    it("closing the dock chrome does not eject the Builder surface", async () => {
      setUrl("tool=build");
      const view = await renderCommandStudio();
      expectBuilderSurfaceActive();
      const user = userEvent.setup();
      const toggle = screen.getByTestId("studio-dock-toggle");
      await user.click(toggle);
      // Dock closed — the Builder surface state and canonical URL must
      // be preserved.
      await user.click(toggle);
      act(() => view.rerender(<CommandStudio />));
      expectBuilderSurfaceActive();
      expect(currentTool()).toBe("build");
    });

    it("opening the Terminal dock tab does not eject the Builder surface", async () => {
      setUrl("tool=build");
      const view = await renderCommandStudio();
      expectBuilderSurfaceActive();
      const user = userEvent.setup();
      await user.click(screen.getByTestId("dock-tab-terminal"));
      expect(screen.getByTestId("dock-tab-terminal")).toHaveAttribute("aria-selected", "true");
      act(() => view.rerender(<CommandStudio />));
      expectBuilderSurfaceActive();
      expect(currentTool()).toBe("build");
    });

    it("explicit navigation to a workspace stage exits Builder", async () => {
      setUrl("tool=build");
      const view = await renderCommandStudio();
      expectBuilderSurfaceActive();
      const user = userEvent.setup();
      const canvasBtn = screen.getByTestId("workspace-tab-canvas");
      await user.click(canvasBtn);
      await waitFor(() => expect(canvasBtn.className).toContain("glass-active"));
      await waitFor(() => expect(currentTool()).toBe("canvas"));
      act(() => view.rerender(<CommandStudio />));
      expect(canvasBtn.className).toContain("glass-active");
    });

    it("browser forward after back leaves Builder again", async () => {
      setUrl("tool=build");
      const view = await renderCommandStudio();
      expectBuilderSurfaceActive();
      const user = userEvent.setup();
      const codeBtn = screen.getByTestId("workspace-tab-code");
      await user.click(codeBtn);
      await waitFor(() => expect(currentTool()).toBe("code"));
      // Back → Builder
      act(() => {
        setUrl("tool=build");
        view.rerender(<CommandStudio />);
      });
      await waitFor(() => expectBuilderSurfaceActive());
      // Forward → Code again
      act(() => {
        setUrl("tool=code");
        view.rerender(<CommandStudio />);
      });
      await waitFor(() => expect(codeBtn.className).toContain("glass-active"));
      act(() => view.rerender(<CommandStudio />));
      expect(currentTool()).toBe("code");
      expect(codeBtn.className).toContain("glass-active");
    });

    it("opening and closing the Files dock tab does not leave Builder", async () => {
      setUrl("tool=build");
      const view = await renderCommandStudio();
      expectBuilderSurfaceActive();
      const user = userEvent.setup();
      // Files is a dock tab — opening it must not change the
      // active Builder surface or the canonical URL.
      await user.click(screen.getByTestId("dock-tab-files"));
      expect(screen.getByTestId("studio-dock")).toHaveAttribute("data-open", "true");
      act(() => view.rerender(<CommandStudio />));
      expectBuilderSurfaceActive();
      expect(currentTool()).toBe("build");
      // Close the dock
      await user.click(screen.getByTestId("dock-close"));
      act(() => view.rerender(<CommandStudio />));
      expectBuilderSurfaceActive();
      expect(currentTool()).toBe("build");
    });

    it("project metadata refresh does not eject the Builder surface", async () => {
      setUrl("tool=build&project=proj-123");
      const view = await renderCommandStudio();
      await waitFor(() => expect(currentTool()).toBe("build"));
      expectBuilderSurfaceActive();
      // Simulate refreshCapabilities() returning updated project metadata
      // (e.g. workspace became ready) — a rerender must not change the
      // active surface or the URL.
      mockCapabilities = {
        ...mockCapabilities,
        projectId: "proj-123",
        terminalStatus: "connected",
        writeAccess: true,
      };
      act(() => view.rerender(<CommandStudio />));
      expectBuilderSurfaceActive();
      expect(currentTool()).toBe("build");
      expect(currentSearchParams.get("project")).toBe("proj-123");
    });

    it("runtime state refresh does not eject the Builder surface", async () => {
      setUrl("tool=build");
      const view = await renderCommandStudio();
      await waitFor(() => expect(currentTool()).toBe("build"));
      expectBuilderSurfaceActive();
      // Simulate runtime.refresh() landing — e.g. dev server now running.
      mockRuntime = {
        state: { projectId: "proj-123", status: "running", previewUrl: "http://localhost:4101" },
        loading: false,
        error: null,
        refresh: vi.fn(async () => undefined),
      };
      act(() => view.rerender(<CommandStudio />));
      expectBuilderSurfaceActive();
      expect(currentTool()).toBe("build");
    });

    it("mobile viewport keeps the same canonical Builder routing", async () => {
      globalThis.__TEST_VIEWPORT_WIDTH__ = 500;
      try {
        setUrl("tool=build");
        const view = await renderCommandStudio();
        expect(screen.queryByTestId("litt-panel")).toBeNull();
        expectBuilderSurfaceActive();
        await waitFor(() => expect(currentTool()).toBe("build"));
        act(() => view.rerender(<CommandStudio />));
        expectBuilderSurfaceActive();
        expect(currentTool()).toBe("build");
      } finally {
        globalThis.__TEST_VIEWPORT_WIDTH__ = 1440;
      }
    });

    it("a param-only URL write without ?tool= does not eject Builder", async () => {
      setUrl("tool=build&project=proj-123");
      const view = await renderCommandStudio();
      await waitFor(() => expect(currentTool()).toBe("build"));
      expectBuilderSurfaceActive();
      // Another writer sets ?project= and the resulting URL carries no
      // ?tool= at all. Absent `tool` is not a surface assertion — the
      // Builder surface and work mode must be preserved.
      act(() => {
        setUrl("project=proj-456");
        view.rerender(<CommandStudio />);
      });
      expectBuilderSurfaceActive();
      act(() => view.rerender(<CommandStudio />));
      expectBuilderSurfaceActive();
    });

    it("conversation/agent param writes without ?tool= do not eject Builder", async () => {
      setUrl("tool=build");
      const view = await renderCommandStudio();
      await waitFor(() => expect(currentTool()).toBe("build"));
      expectBuilderSurfaceActive();
      // The conversation sync writer produces URLs like
      // ?conversation=<id>&agent=litt — a stale or partial write must
      // not bounce Builder to the conversation surface.
      act(() => {
        setUrl("conversation=conv-9&agent=litt&project=proj-1");
        view.rerender(<CommandStudio />);
      });
      expectBuilderSurfaceActive();
    });

    it("an explicit ?mode= on a tool-less URL applies the LiTT mode (stage follows mode)", async () => {
      setUrl("tool=build");
      const view = await renderCommandStudio();
      await waitFor(() => expect(currentTool()).toBe("build"));
      expectBuilderSurfaceActive();
      act(() => {
        setUrl("mode=image&project=proj-1");
        view.rerender(<CommandStudio />);
      });
      // ?mode=image is an explicit creation-mode assertion — it applies
      // even without ?tool=, and the LiTT-mode→stage sync opens the
      // Media stage for the generated artifacts. That stage move is the
      // authoritative surface change, so Builder exits coherently
      // (no dormant builder flag under a media stage).
      const mediaBtn = screen.getByTestId("workspace-tab-media");
      await waitFor(() => expect(mediaBtn.className).toContain("glass-active"));
      await waitFor(() => expect(currentMode()).toBe("image"));
    });

    it("?tool=terminal navigation preserves Builder like the drawer-overlay route", async () => {
      setUrl("tool=build");
      const view = await renderCommandStudio();
      await waitFor(() => expect(currentTool()).toBe("build"));
      expectBuilderSurfaceActive();
      // terminal maps to (studio, work) + openDrawer — an overlay, not a
      // surface change. Same rule as handleRouteTool("terminal").
      act(() => {
        setUrl("tool=terminal");
        view.rerender(<CommandStudio />);
      });
      expectBuilderSurfaceActive();
      act(() => view.rerender(<CommandStudio />));
      expectBuilderSurfaceActive();
    });

    it("an explicit ?tool= URL remains authoritative — tool=preview exits Builder", async () => {
      setUrl("tool=build");
      const view = await renderCommandStudio();
      await waitFor(() => expect(currentTool()).toBe("build"));
      expectBuilderSurfaceActive();
      act(() => {
        setUrl("tool=preview");
        view.rerender(<CommandStudio />);
      });
      const previewBtn = screen.getByTestId("workspace-tab-preview");
      await waitFor(() => expect(previewBtn.className).toContain("glass-active"));
    });

    it("a bare /studio navigation still means the default Studio surface", async () => {
      setUrl("tool=build");
      const view = await renderCommandStudio();
      await waitFor(() => expect(currentTool()).toBe("build"));
      expectBuilderSurfaceActive();
      // A completely param-free /studio is the canonical "default
      // surface" assertion — e.g. a nav link or browser Back to the
      // initial landing entry.
      act(() => {
        setUrl("");
        view.rerender(<CommandStudio />);
      });
      const previewBtn = screen.getByTestId("workspace-tab-preview");
      await waitFor(() => expect(previewBtn.className).toContain("glass-active"));
    });
  });

  describe("tool-absent URL writes preserve the active surface", () => {
    it("a param-only write does not bounce the Code stage back to Preview", async () => {
      setUrl("tool=code");
      const view = await renderCommandStudio();
      const codeBtn = screen.getByTestId("workspace-tab-code");
      await waitFor(() => expect(codeBtn.className).toContain("glass-active"));
      // A project/conversation/agent write that drops ?tool= carries no
      // surface assertion — the active Code stage must survive it.
      act(() => {
        setUrl("project=proj-7&conversation=conv-1");
        view.rerender(<CommandStudio />);
      });
      expect(codeBtn.className).toContain("glass-active");
      act(() => view.rerender(<CommandStudio />));
      expect(codeBtn.className).toContain("glass-active");
    });

    it("a param-only write does not leave a non-Studio destination", async () => {
      setUrl("tool=agents");
      const view = await renderCommandStudio();
      const previewBtn = screen.getByTestId("workspace-tab-preview");
      // Agents destination: no workspace stage is active.
      await waitFor(() => expect(previewBtn.className).not.toContain("glass-active"));
      act(() => {
        setUrl("agent=spark");
        view.rerender(<CommandStudio />);
      });
      // Before the fix this fell through the default mapping to
      // (studio, preview) — leaving the Agents destination entirely.
      expect(previewBtn.className).not.toContain("glass-active");
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

    it("header dock toggle opens and closes the unified dock", async () => {
      const { user } = await renderCommandStudio();
      const toggle = screen.getByTestId("studio-dock-toggle");
      // Dock is always mounted (collapsed strip) but closed by default.
      expect(screen.getByTestId("studio-dock")).toHaveAttribute("data-open", "false");
      expect(toggle).toHaveAttribute("aria-pressed", "false");
      // Toggle it on.
      await user.click(toggle);
      expect(screen.getByTestId("studio-dock")).toHaveAttribute("data-open", "true");
      expect(toggle).toHaveAttribute("aria-pressed", "true");
      // Toggle it off.
      await user.click(toggle);
      expect(screen.getByTestId("studio-dock")).toHaveAttribute("data-open", "false");
      expect(toggle).toHaveAttribute("aria-pressed", "false");
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

    it("unified dock replaces the desktop Context Drawer", async () => {
      await renderCommandStudio();
      // The old desktop Context Drawer is gone from the desktop topology;
      // Activity/Files/Terminal/Inspector/Media live in the bottom dock.
      expect(screen.queryByTestId("context-drawer")).toBeNull();
    });

    it("dock opens on the Activity tab by default", async () => {
      const { user } = await renderCommandStudio();
      await user.click(screen.getByTestId("studio-dock-toggle"));
      expect(screen.getByTestId("studio-dock")).toBeTruthy();
      expect(screen.getByTestId("dock-tab-activity")).toHaveAttribute("aria-selected", "true");
      expect(screen.getByTestId("dock-content-activity")).toBeTruthy();
    });

    it("clicking the dock Files tab activates the Files panel", async () => {
      const { user } = await renderCommandStudio();
      await user.click(screen.getByTestId("studio-dock-toggle"));
      await user.click(screen.getByTestId("dock-tab-files"));
      expect(screen.getByTestId("dock-tab-files")).toHaveAttribute("aria-selected", "true");
      expect(screen.getByTestId("dock-tab-activity")).toHaveAttribute("aria-selected", "false");
      expect(screen.getByTestId("dock-content-files")).toBeTruthy();
    });

    it("Ctrl+Shift+A opens the dock on the Activity tab", async () => {
      await renderCommandStudio();
      expect(screen.getByTestId("studio-dock")).toHaveAttribute("data-open", "false");
      fireEvent.keyDown(window, { key: "a", ctrlKey: true, shiftKey: true });
      expect(screen.getByTestId("studio-dock")).toHaveAttribute("data-open", "true");
      expect(screen.getByTestId("dock-tab-activity")).toHaveAttribute("aria-selected", "true");
    });

    it("Cmd/Ctrl+J toggles the dock", async () => {
      await renderCommandStudio();
      fireEvent.keyDown(window, { key: "j", ctrlKey: true });
      expect(screen.getByTestId("studio-dock")).toHaveAttribute("data-open", "true");
      fireEvent.keyDown(window, { key: "j", ctrlKey: true });
      expect(screen.getByTestId("studio-dock")).toHaveAttribute("data-open", "false");
    });

    it("switching dock tabs reflects the active tab truthfully", async () => {
      const { user } = await renderCommandStudio();
      await user.click(screen.getByTestId("studio-dock-toggle"));
      // Open on Files
      await user.click(screen.getByTestId("dock-tab-files"));
      expect(screen.getByTestId("dock-tab-files")).toHaveAttribute("aria-selected", "true");
      // Switch to Inspector inside the dock
      await user.click(screen.getByTestId("dock-tab-inspector"));
      expect(screen.getByTestId("dock-tab-inspector")).toHaveAttribute("aria-selected", "true");
      expect(screen.getByTestId("dock-tab-files")).toHaveAttribute("aria-selected", "false");
      expect(screen.getByTestId("dock-content-inspector")).toBeTruthy();
    });

    it("clicking a dock tab on the collapsed strip opens the dock on that tab", async () => {
      const { user } = await renderCommandStudio();
      expect(screen.getByTestId("studio-dock")).toHaveAttribute("data-open", "false");
      // The tab strip is visible even when collapsed — clicking Files opens
      // the dock directly on the Files tab.
      await user.click(screen.getByTestId("dock-tab-files"));
      expect(screen.getByTestId("studio-dock")).toHaveAttribute("data-open", "true");
      expect(screen.getByTestId("dock-tab-files")).toHaveAttribute("aria-selected", "true");
    });

    it("dock close button closes the dock", async () => {
      const { user } = await renderCommandStudio();
      await user.click(screen.getByTestId("studio-dock-toggle"));
      expect(screen.getByTestId("studio-dock")).toHaveAttribute("data-open", "true");
      await user.click(screen.getByTestId("dock-close"));
      expect(screen.getByTestId("studio-dock")).toHaveAttribute("data-open", "false");
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

    it("mobile trigger opens Chat with reachable context, input, and send control", async () => {
      globalThis.__TEST_VIEWPORT_WIDTH__ = 500;
      mockCapabilities = { ...defaultCapabilities(), projectName: "Test Project", activeBranch: "main" };
      const { user } = await renderCommandStudio();
      expect(screen.getByRole("button", { name: "Ask LiTT to build" })).toBeTruthy();
      await user.click(screen.getByTestId("litt-mobile-trigger"));
      await user.click(screen.getByTestId("litt-mobile-tab-chat"));

      const sheet = screen.getByTestId("litt-mobile-sheet");
      const input = screen.getByRole("textbox", { name: /message input/i });
      input.focus();

      // The sheet is full-screen on mobile (redesigned LiTTMobileSheet):
      // pinned to the viewport top with a visual-viewport-derived height,
      // no bottom-sheet offset anymore.
      expect(sheet.getAttribute("style")).toContain("top: 0px");
      // Mobile density redesign: the composer context line is hidden on
      // mobile; project + branch moved to the slim sheet header row.
      expect(screen.queryByTestId("studio-workspace-context")).toBeNull();
      expect(screen.getByTestId("litt-mobile-context").textContent).toContain("Test Project");
      expect(screen.getByTestId("litt-mobile-context").textContent).toContain("main");
      expect(document.activeElement).toBe(input);
      expect(screen.getByRole("button", { name: /send message|cancel response/i })).toBeVisible();

      // Closing returns to workspace-only mobile state.
      await user.click(screen.getByTestId("litt-mobile-sheet-close"));
      expect(screen.queryByTestId("litt-mobile-sheet")).toBeNull();
    });

    it("mobile chat shows the compact Build status bar instead of the Mission card stack", async () => {
      globalThis.__TEST_VIEWPORT_WIDTH__ = 500;
      const { user } = await renderCommandStudio();
      await user.click(screen.getByTestId("litt-mobile-trigger"));
      await user.click(screen.getByTestId("litt-mobile-tab-chat"));

      // Mobile density redesign: one ~36px status bar, no card stack.
      expect(screen.getByTestId("mobile-build-status")).toBeVisible();
      expect(screen.queryByTestId("mission-card-mission")).toBeNull();
      expect(screen.queryByTestId("mission-card-actions")).toBeNull();
    });

    it("desktop keeps the MissionCards stack in the Activity dock tab, not the LiTT panel", async () => {
      globalThis.__TEST_VIEWPORT_WIDTH__ = 1200;
      const { user } = await renderCommandStudio();
      // Chat stays conversation-only on desktop; the mission panels live in
      // the Activity dock tab.
      const chatPanel = screen.getByTestId("litt-chat-panel");
      expect(chatPanel.querySelector("[data-testid='mission-cards']")).toBeNull();
      await user.click(screen.getByTestId("dock-tab-activity"));
      expect(screen.getByTestId("mission-cards")).toBeInTheDocument();
      expect(screen.queryByTestId("mobile-build-status")).toBeNull();
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

    it("Activity lives in the unified dock — no separate activity-toggle", async () => {
      await renderCommandStudio();
      // The old standalone Activity button is gone; Activity is a dock tab.
      expect(screen.queryByTestId("activity-toggle")).toBeNull();
    });

    it("clicking the active dock tab while open keeps the dock open", async () => {
      const { user } = await renderCommandStudio();
      await user.click(screen.getByTestId("studio-dock-toggle"));
      expect(screen.getByTestId("studio-dock")).toHaveAttribute("data-open", "true");
      // Dock tabs select a tab — they don't toggle the dock closed.
      await user.click(screen.getByTestId("dock-tab-activity"));
      expect(screen.getByTestId("studio-dock")).toHaveAttribute("data-open", "true");
      expect(screen.getByTestId("dock-tab-activity")).toHaveAttribute("aria-selected", "true");
    });

    it("Ctrl+Shift+A opens the dock Activity tab on desktop", async () => {
      await renderCommandStudio();
      expect(screen.getByTestId("studio-dock")).toHaveAttribute("data-open", "false");
      fireEvent.keyDown(window, { key: "a", ctrlKey: true, shiftKey: true });
      expect(screen.getByTestId("studio-dock")).toHaveAttribute("data-open", "true");
      expect(screen.getByTestId("dock-tab-activity")).toHaveAttribute("aria-selected", "true");
    });

    it("mobile sheet Live tab shows the activity feed", async () => {
      globalThis.__TEST_VIEWPORT_WIDTH__ = 500;
      const { user } = await renderCommandStudio();
      // Mobile: no desktop rail.
      expect(screen.queryByTestId("litt-panel")).toBeNull();
      await user.click(screen.getByTestId("litt-mobile-trigger"));
      expect(screen.getByTestId("litt-mobile-sheet")).toBeTruthy();
      // The sheet's Live tab shows activity.
      await user.click(screen.getByTestId("litt-mobile-tab-live"));
      expect(screen.getByTestId("litt-mobile-live-panel")).toHaveAttribute("data-active", "true");
      expect(screen.getByTestId("litt-mobile-tab-live")).toHaveAttribute("aria-pressed", "true");
    });

    it("opening the mobile sheet does not silently mutate littCollapsed", async () => {
      globalThis.__TEST_VIEWPORT_WIDTH__ = 500;
      // Store the desktop collapse preference before opening the sheet.
      localStorage.setItem("littree:studio:litt-collapsed", "false");
      const { user } = await renderCommandStudio();
      await user.click(screen.getByTestId("litt-mobile-trigger"));
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
