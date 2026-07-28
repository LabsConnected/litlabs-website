"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import dynamic from "next/dynamic";
import { useTheme } from "@/context/ThemeContext";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import StudioSidebar, { type StudioTool, MobileTabBar } from "./StudioSidebar";
import StudioTopBar from "./StudioTopBar";
import StudioOnboarding from "./StudioOnboarding";
import AutonomicLoopBanner from "@/components/dashboard/AutonomicLoopBanner";
import { VoiceSessionProvider } from "../context/VoiceSessionContext";
import { VoiceDiagnosticsDrawer } from "./VoiceDiagnosticsDrawer";
import { useStudioAgentStore } from "../stores/useStudioAgentStore";
import { useVoiceStore } from "@/features/voice/store/useVoiceStore";
import { useConnectionSummary } from "../hooks/useConnectionSummary";
import DemoBootstrap from "./DemoBootstrap";
import type { ArtifactAction } from "@/lib/canvas/types";

type DockPosition = "bottom-right" | "bottom-left" | "top-right" | "top-left" | "full";

const ChatTool = dynamic(() => import("../tools/ChatTool"), { ssr: false });
const CanvasPanel = dynamic(() => import("./canvas/CanvasPanel").then((m) => m.CanvasPanel), { ssr: false });
const ImageTool = dynamic(() => import("../tools/ImageTool"), { ssr: false });
const VideoTool = dynamic(() => import("../tools/VideoTool"), { ssr: false });
const AudioTool = dynamic(() => import("../tools/AudioTool"), { ssr: false });
const BuilderTool = dynamic(() => import("../tools/BuilderTool"), {
  ssr: false,
});
const CanvasTool = dynamic(() => import("../tools/CanvasTool"), { ssr: false });
const CoderWorkspace = dynamic(() => import("../tools/CoderWorkspace"), { ssr: false });
const AgentTool = dynamic(() => import("../tools/AgentTool"), { ssr: false });
const GalleryTool = dynamic(() => import("../tools/GalleryTool"), {
  ssr: false,
});
const TerminalTool = dynamic(() => import("../tools/AgentsTerminalTool"), {
  ssr: false,
});
const MissionForge = dynamic(() => import("../tools/MissionForge"), {
  ssr: false,
});
const CLIBridgeTool = dynamic(() => import("../tools/CLIBridgeTool"), {
  ssr: false,
});
const ColorByNumberTool = dynamic(() => import("../tools/ColorByNumberTool"), {
  ssr: false,
});
const SpaceTool = dynamic(() => import("../tools/SpaceTool"), { ssr: false });
const PluginsTool = dynamic(() => import("../tools/PluginsTool"), {
  ssr: false,
});
const CameraTool = dynamic(() => import("../tools/CameraTool"), { ssr: false });
const ScreenTool = dynamic(() => import("../tools/ScreenTool"), { ssr: false });
const HomeTool = dynamic(() => import("../tools/ChatTool"), { ssr: false });

const TOOL_COMPONENTS: Record<StudioTool, React.ComponentType> = {
  home: HomeTool,
  chat: ChatTool,
  image: ImageTool,
  video: VideoTool,
  audio: AudioTool,
  build: BuilderTool,
  code: CoderWorkspace,
  agents: AgentTool,
  assets: GalleryTool,
  plugins: PluginsTool,
  camera: CameraTool,
  screen: ScreenTool,
  terminal: TerminalTool,
  workflows: MissionForge,
  space: SpaceTool,
  clibridge: CLIBridgeTool,
  color: ColorByNumberTool,
};

const VALID_TOOLS = Object.keys(TOOL_COMPONENTS) as StudioTool[];

function AgentVoiceSync() {
  const activeAgentId = useStudioAgentStore((s) => s.activeAgentId);
  const setVoiceAgent = useVoiceStore((s) => s.setActiveAgent);

  useEffect(() => {
    setVoiceAgent(activeAgentId);
  }, [activeAgentId, setVoiceAgent]);

  return null;
}

export default function StudioOS({ isDemo = false }: { isDemo?: boolean } = {}) {
  const { theme, resolvedColors: T } = useTheme();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { capabilities, loading: connectionsLoading } = useConnectionSummary();
  const projectReady =
    capabilities.repository === "connected" ||
    capabilities.terminalExecution === "available";

  const DEFAULT_STUDIO_TOOL: StudioTool = "chat";
  const initialTool = (() => {
    const fromUrl = searchParams.get("tool");
    // Normalize legacy "pipeline" to "workflows"
    if (fromUrl === "pipeline") {
      return "workflows" as StudioTool;
    }
    if (fromUrl && VALID_TOOLS.includes(fromUrl as StudioTool)) {
      return fromUrl as StudioTool;
    }
    const fromStore =
      typeof window === "undefined"
        ? null
        : localStorage.getItem("littree:studio:tool");
    if (fromStore && VALID_TOOLS.includes(fromStore as StudioTool)) {
      return fromStore as StudioTool;
    }
    return DEFAULT_STUDIO_TOOL;
  })();

  const [activeTool, setActiveTool] = useState<StudioTool>(initialTool);
  const [search, setSearch] = useState("");
  const [pendingCommand, setPendingCommand] = useState("");
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [canvasOpen, setCanvasOpen] = useState(false);
  const [pendingCanvasAction, setPendingCanvasAction] = useState<ArtifactAction | null>(null);
  const [onboardingOpen, setOnboardingOpen] = useState(
    () => !searchParams.has("tool"),
  );
  const isInitialMount = useRef(true);
  const [cameraDock, setCameraDock] = useState<{
    open: boolean;
    pos: DockPosition;
  }>({ open: false, pos: "bottom-right" });
  const [screenDock, setScreenDock] = useState<{
    open: boolean;
    pos: DockPosition;
  }>({ open: false, pos: "bottom-left" });

  const handleStartBlank = useCallback(() => {
    setActiveTool("build");
    setOnboardingOpen(false);
  }, []);

  // Sync tool to localStorage immediately, and to URL only after the
  // user changes them (not on initial mount).
  useEffect(() => {
    try {
      localStorage.setItem("littree:studio:tool", activeTool);
    } catch {
      // ignore storage errors
    }
    if (isInitialMount.current) {
      isInitialMount.current = false;
      // On initial mount, ensure URL has the correct tool param
      const params = new URLSearchParams(searchParams.toString());
      params.set("tool", activeTool);
      const query = params.toString();
      router.replace(`${pathname}${query ? `?${query}` : ""}`, { scroll: false });
      return;
    }
    const params = new URLSearchParams(searchParams.toString());
    params.set("tool", activeTool);
    const query = params.toString();
    router.replace(`${pathname}${query ? `?${query}` : ""}`, { scroll: false });
  }, [activeTool, pathname, router, searchParams]);

  // Handle tool switches emitted from inside workspaces.
  useEffect(() => {
    const handler = (e: Event) => {
      const custom = e as CustomEvent<string>;
      const tool = custom.detail;
      if (tool && VALID_TOOLS.includes(tool as StudioTool)) {
        setActiveTool(tool as StudioTool);
        setOnboardingOpen(false);
      }
    };
    window.addEventListener("studio:switch-tool", handler);
    return () => window.removeEventListener("studio:switch-tool", handler);
  }, []);

  // Handle canvas action execution from chat action chips.
  // When a chip is clicked, ChatShell dispatches "canvas:execute-action"
  // with the ArtifactAction. We open the Canvas panel and pass the action.
  useEffect(() => {
    const handler = (e: Event) => {
      const custom = e as CustomEvent<ArtifactAction>;
      if (custom.detail) {
        setPendingCanvasAction(custom.detail);
        setCanvasOpen(true);
      }
    };
    window.addEventListener("canvas:execute-action", handler);
    return () => window.removeEventListener("canvas:execute-action", handler);
  }, []);

  const handleToolChange = useCallback(
    (tool: StudioTool) => {
      if (tool === "home" && !projectReady) {
        setOnboardingOpen(true);
        setActiveTool("home");
        return;
      }
      setOnboardingOpen(false);
      setActiveTool(tool);
    },
    [projectReady],
  );

  const handleCommandRoute = useCallback(
    (tool: StudioTool, command = "") => {
      if (tool === "camera") {
        setCameraDock((v) => ({ ...v, open: true }));
        return;
      }
      if (tool === "screen") {
        setScreenDock((v) => ({ ...v, open: true }));
        return;
      }
      setPendingCommand(command);
      setOnboardingOpen(false);
      setActiveTool(tool);
    },
    [],
  );

  // Determine which component to render in the center workspace.
  // ?legacy=code preserves the original CanvasTool for comparison during the rebuild.
  const isChat = activeTool === "chat";
  const useLegacyCode =
    activeTool === "code" && searchParams.get("legacy") === "code";
  const WorkspaceComponent = isChat
    ? null
    : useLegacyCode
      ? CanvasTool
      : TOOL_COMPONENTS[activeTool];

  return (
    <VoiceSessionProvider>
      <AgentVoiceSync />
      <VoiceDiagnosticsDrawer />

      {/* Unified Studio shell — responsive, one layout for mobile + desktop */}
      <div
        className={`studio-shell flex h-dvh w-full flex-col overflow-hidden ${isDemo ? "pt-9" : ""}`}
        data-layout={theme.layoutStyle}
        style={{
          backgroundColor: theme.layoutStyle === "glass" ? `${T.bgColor}d9` : T.bgColor,
          color: T.textColor,
        }}
      >
        {/* Autonomic banner — shrink-0 so it takes its natural height
            without pushing the composer below the viewport. Previously
            this was rendered in studio/layout.tsx OUTSIDE the h-dvh
            shell, which clipped the bottom ~36px (the composer). */}
        <div className="shrink-0">
          <AutonomicLoopBanner />
        </div>

        <StudioTopBar
          search={search}
          onSearchChange={setSearch}
          selectedModel=""
          onModelChange={() => {}}
          projectReady={projectReady}
          T={T}
        />

        {/* Main content area: 1-col on mobile (full-screen tool), 3-col on desktop */}
        <div
          className="grid min-h-0 min-w-0 flex-1 overflow-hidden studio-grid-responsive pb-[calc(56px+env(safe-area-inset-bottom))] md:pb-0"
        >
          {/* Tool rail — hidden on mobile, MobileTabBar at bottom handles tool switching */}
          <div className="hidden md:block">
            <StudioSidebar
              activeTool={activeTool}
              onToolChange={handleToolChange}
              search={search}
              projectReady={projectReady}
            />
          </div>

          {/* Center workspace — renders active tool full-screen on mobile.
              Chat is ALWAYS available (voice + text chat don't require a
              project). The onboarding wall only shows for build tools. */}
          <main className="relative flex h-full min-w-0 min-h-0 flex-col overflow-hidden overflow-x-hidden">
            {isChat ? (
              <>
                <ChatTool
                  onRouteTool={handleCommandRoute}
                  requestedTool={activeTool}
                  pendingCommand={pendingCommand}
                />
                <button
                  onClick={() => setCanvasOpen((v) => !v)}
                  className="absolute bottom-4 right-4 z-40 flex items-center gap-2 rounded-full border border-violet-300/25 bg-[#0a0c13]/95 px-3 py-2 text-[10px] font-bold text-violet-100 shadow-xl backdrop-blur-xl transition hover:border-violet-300/50 hover:bg-violet-300/10"
                  title="Toggle Canvas panel"
                >
                  <span className="h-1.5 w-1.5 rounded-full bg-violet-300" />
                  {canvasOpen ? "Hide" : "Canvas"}
                </button>
              </>
            ) : !connectionsLoading && !projectReady && onboardingOpen ? (
              <StudioOnboarding onToolChange={handleToolChange} onStartBlank={handleStartBlank} />
            ) : WorkspaceComponent ? (
              <div className="studio-tool-surface min-h-0 min-w-0 flex-1 overflow-auto">
                <WorkspaceComponent />
              </div>
            ) : null}
            {projectReady && !isChat && (
              <div className="absolute bottom-4 right-4 z-40 flex flex-col items-end gap-2">
                <button
                  onClick={() => setCanvasOpen((v) => !v)}
                  className="flex items-center gap-2 rounded-full border border-violet-300/25 bg-[#0a0c13]/95 px-4 py-3 text-xs font-black text-violet-100 shadow-2xl backdrop-blur-xl transition hover:border-violet-300/50 hover:bg-violet-300/10"
                >
                  <span className="h-2 w-2 rounded-full bg-violet-300 shadow-[0_0_8px_#c4b5fd]" />
                  {canvasOpen ? "Hide Canvas" : "Canvas"}
                </button>
                <button
                  onClick={() => setAssistantOpen(true)}
                  className="flex items-center gap-2 rounded-full border border-cyan-300/25 bg-[#0a0c13]/95 px-4 py-3 text-xs font-black text-cyan-100 shadow-2xl backdrop-blur-xl transition hover:border-cyan-300/50 hover:bg-cyan-300/10"
                >
                  <span className="h-2 w-2 rounded-full bg-emerald-300 shadow-[0_0_8px_#6ee7b7]" />
                  Ask LiTT
                </button>
              </div>
            )}
          </main>

          {/* LiTT assistant drawer — closed by default so tools keep the full workspace */}
          {assistantOpen && projectReady && !isChat && <aside
            className="fixed bottom-0 right-0 top-12 z-10010 flex w-full max-w-95 min-w-0 flex-col overflow-hidden border-l shadow-[-24px_0_70px_rgba(0,0,0,.6)] litt-panel litt-panel--overlay"
            style={{
              backgroundColor: "rgba(8,9,13,0.96)",
              borderColor: "rgba(255,255,255,0.06)",
            }}
          >
            <div
              className="flex h-9 shrink-0 items-center justify-between px-3 border-b"
              style={{ borderColor: "rgba(255,255,255,0.06)" }}
            >
              <span className="text-[10px] font-black uppercase tracking-[0.18em] text-white/60">
                LiTT
              </span>
              <button
                onClick={() => setAssistantOpen(false)}
                className="grid h-7 w-7 place-items-center rounded-lg text-white/45 hover:bg-white/8 hover:text-white"
                aria-label="Close LiTT drawer"
              >
                ✕
              </button>
            </div>
            <div className="min-h-0 min-w-0 flex-1 overflow-hidden">
              <ChatTool
                onRouteTool={handleCommandRoute}
                requestedTool={activeTool}
                pendingCommand={pendingCommand}
              />
            </div>
          </aside>}

          {/* Canvas panel — bottom sheet on mobile, split-pane on desktop.
              Opens when a canvas action is executed from chat. */}
          {canvasOpen && (
            <>
              {/* Backdrop — mobile only */}
              <button
                aria-label="Close Canvas"
                className="fixed inset-0 z-10008 bg-black/60 md:hidden"
                onClick={() => setCanvasOpen(false)}
              />
              <aside
                className="fixed z-10009 flex flex-col overflow-hidden border shadow-2xl md:bottom-0 md:right-0 md:top-12 md:w-full md:max-w-[520px] md:min-w-0 md:border-l md:shadow-[-24px_0_70px_rgba(0,0,0,.6)] bottom-0 left-0 right-0 top-auto h-[80dvh] rounded-t-2xl border-t animate-in slide-in-from-bottom-4 md:animate-none md:rounded-none md:border-t-0"
                style={{
                  backgroundColor: "rgba(8,9,13,0.97)",
                  borderColor: "rgba(255,255,255,0.06)",
                }}
              >
                {/* Drag handle — mobile only */}
                <div className="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-white/20 md:hidden" />
                <div
                  className="flex h-9 shrink-0 items-center justify-between px-3 border-b"
                  style={{ borderColor: "rgba(255,255,255,0.06)" }}
                >
                  <span className="text-[10px] font-black uppercase tracking-[0.18em] text-white/60">
                    Canvas
                  </span>
                  <button
                    onClick={() => setCanvasOpen(false)}
                    className="grid h-7 w-7 place-items-center rounded-lg text-white/45 hover:bg-white/8 hover:text-white"
                    aria-label="Close Canvas panel"
                  >
                    ✕
                  </button>
                </div>
                <div className="min-h-0 min-w-0 flex-1 overflow-hidden">
                  <CanvasPanel
                    pendingAction={pendingCanvasAction}
                    onActionExecuted={() => setPendingCanvasAction(null)}
                  />
                </div>
              </aside>
            </>
          )}
        </div>

        {/* Mobile bottom tab bar — tool switching */}
        <div className="md:hidden">
          <MobileTabBar activeTool={activeTool} onToolChange={handleToolChange} T={T} />
        </div>
      </div>

      {/* Persistent media overlays */}
      <MediaOverlayHost
        cameraDock={cameraDock}
        screenDock={screenDock}
        onCameraClose={() => setCameraDock((v) => ({ ...v, open: false }))}
        onScreenClose={() => setScreenDock((v) => ({ ...v, open: false }))}
        onCameraPosChange={(pos) => setCameraDock((v) => ({ ...v, pos }))}
        onScreenPosChange={(pos) => setScreenDock((v) => ({ ...v, pos }))}
      />

      {isDemo ? <DemoBootstrap /> : null}
    </VoiceSessionProvider>
  );
}


function DockBadge({ label, onClose, onMove }: { label: string; onClose: () => void; onMove: () => void }) {
  const { resolvedColors: T } = useTheme();
  return (
    <div
      className="flex items-center gap-1 rounded-full border px-2 py-1 text-[9px] font-black uppercase tracking-wider"
      style={{
        backgroundColor: T.boxBg + "70",
        borderColor: T.borderColor + "30",
        color: T.textColor,
        backdropFilter: "blur(12px)",
      }}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-red-500 animate-pulse" />
      <span className="mr-1">{label}</span>
      <button
        type="button"
        onClick={onMove}
        className="grid h-7 w-7 place-items-center rounded-md hover:bg-white/10"
        style={{ color: T.textMuted }}
        aria-label="Move dock"
        title="Move dock"
      >
        ⇮
      </button>
      <button
        type="button"
        onClick={onClose}
        className="grid h-7 w-7 place-items-center rounded-md hover:bg-white/10"
        style={{ color: T.textMuted }}
        aria-label="Close dock"
        title="Close dock"
      >
        ✕
      </button>
    </div>
  );
}

function MediaOverlayHost({
  cameraDock,
  screenDock,
  onCameraClose,
  onScreenClose,
  onCameraPosChange,
  onScreenPosChange,
}: {
  cameraDock: { open: boolean; pos: DockPosition };
  screenDock: { open: boolean; pos: DockPosition };
  onCameraClose: () => void;
  onScreenClose: () => void;
  onCameraPosChange: (pos: DockPosition) => void;
  onScreenPosChange: (pos: DockPosition) => void;
}) {
  const cycle = (current: DockPosition): DockPosition => {
    const order: DockPosition[] = [
      "bottom-right",
      "bottom-left",
      "top-right",
      "top-left",
      "full",
    ];
    const i = order.indexOf(current);
    return order[(i + 1) % order.length];
  };

  const posClass = (pos: DockPosition): string => {
    switch (pos) {
      case "bottom-right":
        return "bottom-3 right-3";
      case "bottom-left":
        return "bottom-3 left-3";
      case "top-right":
        return "top-3 right-3";
      case "top-left":
        return "top-3 left-3";
      case "full":
        return "inset-3";
      default:
        return "bottom-3 right-3";
    }
  };

  return (
    <>
      {cameraDock.open && (
        <div
          className={`fixed z-1100 flex flex-col gap-2 ${posClass(cameraDock.pos)}`}
          style={{ width: 320, maxWidth: "calc(100% - 1.5rem)" }}
        >
          <CameraTool />
          <DockBadge
            label={`Camera · ${cameraDock.pos.replace("-", " ")}`}
            onClose={onCameraClose}
            onMove={() => onCameraPosChange(cycle(cameraDock.pos))}
          />
        </div>
      )}

      {screenDock.open && (
        <div
          className={`fixed z-1100 flex flex-col gap-2 ${posClass(screenDock.pos)}`}
          style={{ width: 360, maxWidth: "calc(100% - 1.5rem)" }}
        >
          <ScreenTool />
          <DockBadge
            label={`Screen · ${screenDock.pos.replace("-", " ")}`}
            onClose={onScreenClose}
            onMove={() => onScreenPosChange(cycle(screenDock.pos))}
          />
        </div>
      )}
    </>
  );
}
