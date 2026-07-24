"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import dynamic from "next/dynamic";
import { useTheme } from "@/context/ThemeContext";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import StudioSidebar, { type StudioTool } from "./StudioSidebar";
import StudioTopBar from "./StudioTopBar";
import { VoiceSessionProvider } from "../context/VoiceSessionContext";
import { useStudioAgentStore } from "../stores/useStudioAgentStore";
import { useVoiceStore } from "@/features/voice/store/useVoiceStore";
import { MobileStudio } from "./MobileStudio";

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
    return "home";
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
      return;
    }
    const params = new URLSearchParams(searchParams.toString());
    if (activeTool !== "home" && activeTool !== "chat") params.set("tool", activeTool);
    else params.delete("tool");
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
  const isChatOrHome = activeTool === "chat" || activeTool === "home";
  const WorkspaceComponent = isChatOrHome ? null : TOOL_COMPONENTS[activeTool];

  return (
    <VoiceSessionProvider>
      <AgentVoiceSync />

      {/* Mobile: unified MobileStudio */}
      <div className="md:hidden">
        <MobileStudio
          onRouteTool={handleCommandRoute}
        />
      </div>

      {/* Desktop: 3-column grid layout */}
      <div
        className="hidden md:grid h-[100dvh] w-full overflow-hidden"
        style={{
          gridTemplateRows: "auto minmax(0, 1fr)",
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

        {/* 3-column grid: ToolRail | Workspace | ChatPanel */}
        <div
          className="grid min-h-0 overflow-hidden"
          style={{
            gridTemplateColumns: "48px minmax(520px, 1fr) clamp(320px, 26vw, 420px)",
          }}
        >
          <StudioSidebar
            activeTool={activeTool}
            onToolChange={handleToolChange}
            search={search}
          />

          {/* Center workspace — renders active tool directly, no overlay */}
          <main className="relative flex min-w-0 min-h-0 flex-col overflow-hidden">
            {isChatOrHome ? (
              <WelcomeWorkspace T={T} onToolChange={handleToolChange} />
            ) : WorkspaceComponent ? (
              <div className="studio-tool-surface min-h-0 min-w-0 flex-1 overflow-auto">
                <WorkspaceComponent />
              </div>
            ) : null}
          </main>

          {/* Persistent right chat panel — desktop only */}
          <aside
            className="hidden md:flex shrink-0 min-w-0 min-h-0 flex-col border-l overflow-hidden"
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
                Conversation
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

/* ── Welcome / Empty workspace state ─────────────────────────────── */
function WelcomeWorkspace({
  T,
  onToolChange,
}: {
  T: ReturnType<typeof useTheme>["resolvedColors"];
  onToolChange: (tool: StudioTool) => void;
}) {
  const actions = [
    {
      tool: "code" as StudioTool,
      label: "Start Blank",
      desc: "Open the code editor",
      icon: "📝",
      accent: T.accentColor,
    },
    {
      tool: "code" as StudioTool,
      label: "Connect Project",
      desc: "Link a Git repository",
      icon: "🔗",
      accent: "#67e8f9",
    },
    {
      tool: "code" as StudioTool,
      label: "Upload Files",
      desc: "Import existing code",
      icon: "📤",
      accent: "#a855f7",
    },
    {
      tool: "code" as StudioTool,
      label: "Generate",
      desc: "AI-generate from prompt",
      icon: "✨",
      accent: "#22c55e",
    },
  ];

  return (
    <div className="flex h-full w-full items-center justify-center overflow-auto p-6">
      <div className="flex max-w-2xl flex-col items-center text-center">
        <div
          className="mb-6 grid h-16 w-16 place-items-center rounded-2xl border"
          style={{
            borderColor: `${T.accentColor}30`,
            backgroundColor: `${T.accentColor}08`,
          }}
        >
          <span className="text-3xl">🚀</span>
        </div>
        <h1
          className="mb-2 text-2xl font-black tracking-tight"
          style={{ color: "rgba(255,255,255,0.9)" }}
        >
          Welcome to your workspace
        </h1>
        <p
          className="mb-8 text-sm"
          style={{ color: "rgba(255,255,255,0.45)" }}
        >
          Choose how you want to start building, or ask LiTT in the conversation panel.
        </p>
        <div className="grid w-full grid-cols-2 gap-3 sm:grid-cols-4">
          {actions.map((action) => (
            <button
              key={action.label}
              type="button"
              onClick={() => onToolChange(action.tool)}
              className="group flex flex-col items-center gap-2 rounded-2xl border p-4 transition-all hover:scale-[1.03]"
              style={{
                borderColor: "rgba(255,255,255,0.06)",
                backgroundColor: "rgba(255,255,255,0.02)",
              }}
            >
              <span
                className="grid h-10 w-10 place-items-center rounded-xl text-xl transition-transform group-hover:scale-110"
                style={{
                  backgroundColor: `${action.accent}12`,
                  border: `1px solid ${action.accent}30`,
                }}
              >
                {action.icon}
              </span>
              <span
                className="text-[11px] font-bold"
                style={{ color: "rgba(255,255,255,0.8)" }}
              >
                {action.label}
              </span>
              <span
                className="text-[9px]"
                style={{ color: "rgba(255,255,255,0.4)" }}
              >
                {action.desc}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
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
