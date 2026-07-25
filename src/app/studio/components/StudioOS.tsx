"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import dynamic from "next/dynamic";
import { useTheme } from "@/context/ThemeContext";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import StudioSidebar, { type StudioTool, MobileTabBar } from "./StudioSidebar";
import StudioTopBar from "./StudioTopBar";
import { VoiceSessionProvider } from "../context/VoiceSessionContext";
import { useStudioAgentStore } from "../stores/useStudioAgentStore";
import { useVoiceStore } from "@/features/voice/store/useVoiceStore";

type DockPosition = "bottom-right" | "bottom-left" | "top-right" | "top-left" | "full";

const ChatTool = dynamic(() => import("../tools/ChatTool"), { ssr: false });
const ImageTool = dynamic(() => import("../tools/ImageTool"), { ssr: false });
const VideoTool = dynamic(() => import("../tools/VideoTool"), { ssr: false });
const AudioTool = dynamic(() => import("../tools/AudioTool"), { ssr: false });
const BuilderTool = dynamic(() => import("../tools/BuilderTool"), {
  ssr: false,
});
const CanvasTool = dynamic(() => import("../tools/CanvasTool"), { ssr: false });
const AgentTool = dynamic(() => import("../tools/AgentTool"), { ssr: false });
const GalleryTool = dynamic(() => import("../tools/GalleryTool"), {
  ssr: false,
});
const TerminalTool = dynamic(() => import("../tools/AgentsTerminalTool"), {
  ssr: false,
});
const PipelineTool = dynamic(() => import("../tools/PipelineTool"), {
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
  code: CanvasTool,
  agents: AgentTool,
  assets: GalleryTool,
  plugins: PluginsTool,
  camera: CameraTool,
  screen: ScreenTool,
  terminal: TerminalTool,
  pipeline: PipelineTool,
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

export default function StudioOS() {
  const { resolvedColors: T } = useTheme();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const DEFAULT_STUDIO_TOOL: StudioTool = "chat";
  const initialTool = (() => {
    const fromUrl = searchParams.get("tool");
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
  const isInitialMount = useRef(true);
  const [cameraDock, setCameraDock] = useState<{
    open: boolean;
    pos: DockPosition;
  }>({ open: false, pos: "bottom-right" });
  const [screenDock, setScreenDock] = useState<{
    open: boolean;
    pos: DockPosition;
  }>({ open: false, pos: "bottom-left" });
  const [littPanelWidth, setLittPanelWidth] = useState(() => {
    if (typeof window === "undefined") return 340;
    const stored = localStorage.getItem("litlabs:studio:panel-width");
    return stored ? Math.max(280, Math.min(600, Number(stored))) : 340;
  });
  const [isResizing, setIsResizing] = useState(false);

  const startResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
    const startX = e.clientX;
    const startWidth = littPanelWidth;
    const onMove = (ev: MouseEvent) => {
      const delta = startX - ev.clientX;
      const newWidth = Math.max(280, Math.min(600, startWidth + delta));
      setLittPanelWidth(newWidth);
    };
    const onUp = () => {
      setIsResizing(false);
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      try {
        localStorage.setItem("litlabs:studio:panel-width", String(littPanelWidth));
      } catch {
        // ignore
      }
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }, [littPanelWidth]);

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
      }
    };
    window.addEventListener("studio:switch-tool", handler);
    return () => window.removeEventListener("studio:switch-tool", handler);
  }, []);

  const handleToolChange = useCallback(
    (tool: StudioTool) => {
      setActiveTool(tool);
    },
    [setActiveTool],
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
      setActiveTool(tool);
    },
    [],
  );

  // Determine which component to render in the center workspace
  const isChat = activeTool === "chat";
  const WorkspaceComponent = isChat ? null : TOOL_COMPONENTS[activeTool];

  return (
    <VoiceSessionProvider>
      <AgentVoiceSync />

      {/* Unified Studio shell — responsive, one layout for mobile + desktop */}
      <div
        className="flex h-dvh w-full flex-col overflow-hidden"
        style={{
          backgroundColor: "#06070b",
          color: T.textColor,
        }}
      >
        <StudioTopBar
          search={search}
          onSearchChange={setSearch}
          selectedModel=""
          onModelChange={() => {}}
          T={T}
        />

        {/* Main content area: 1-col on mobile, 3-col on desktop */}
        <div
          className="grid min-h-0 min-w-0 flex-1 overflow-hidden studio-grid-responsive pb-[calc(56px+env(safe-area-inset-bottom))] md:pb-0"
          style={{ ["--litt-panel-width" as string]: `${littPanelWidth}px` }}
        >
          {/* Tool rail — hidden on mobile, MobileTabBar at bottom handles tool switching */}
          <div className="hidden md:block">
            <StudioSidebar
              activeTool={activeTool}
              onToolChange={handleToolChange}
              search={search}
            />
          </div>

          {/* Center workspace — renders active tool */}
          <main className="relative flex min-w-0 min-h-0 flex-col overflow-hidden">
            {isChat ? (
              <ChatTool
                onRouteTool={handleCommandRoute}
                requestedTool={activeTool}
                pendingCommand={pendingCommand}
              />
            ) : WorkspaceComponent ? (
              <div className="studio-tool-surface min-h-0 min-w-0 flex-1 overflow-auto">
                <WorkspaceComponent />
              </div>
            ) : null}
          </main>

          {/* Draggable resizer between workspace and LiTT panel — desktop only */}
          <div
            className={`hidden md:flex w-1 shrink-0 cursor-col-resize items-center justify-center transition-colors ${isResizing ? "bg-cyan-300/30" : "bg-white/4 hover:bg-white/10"}`}
            onMouseDown={startResize}
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize chat panel"
            title="Drag to resize"
          >
            <div className="h-8 w-0.5 rounded-full bg-white/15" />
          </div>

          {/* Persistent right LiTT panel — desktop only */}
          <aside
            className="hidden md:flex shrink-0 min-w-0 min-h-0 flex-col border-l overflow-hidden litt-panel"
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
              <span
                className="w-1.5 h-1.5 rounded-full"
                style={{
                  backgroundColor: T.success,
                  boxShadow: `0 0 4px ${T.success}`,
                }}
                aria-hidden
              />
            </div>
            <div className="min-h-0 min-w-0 flex-1 overflow-hidden">
              <ChatTool
                onRouteTool={handleCommandRoute}
                requestedTool={activeTool}
                pendingCommand={pendingCommand}
              />
            </div>
          </aside>
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
          className={`fixed z-[1100] flex flex-col gap-2 ${posClass(cameraDock.pos)}`}
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
          className={`fixed z-[1100] flex flex-col gap-2 ${posClass(screenDock.pos)}`}
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
