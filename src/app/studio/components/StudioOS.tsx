"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import dynamic from "next/dynamic";
import { useTheme } from "@/context/ThemeContext";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import StudioSidebar, { type StudioTool } from "./StudioSidebar";
import StudioTopBar from "./StudioTopBar";
import { VoiceSessionProvider } from "../context/VoiceSessionContext";

type DockPosition = "bottom-right" | "bottom-left" | "top-right" | "top-left" | "full";

const StudioInspector = dynamic(() => import("./StudioInspector"), {
  ssr: false,
});
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
const DRAWER_TOOLS: StudioTool[] = [
  "image",
  "video",
  "audio",
  "build",
  "code",
  "agents",
  "assets",
  "plugins",
  "pipeline",
  "space",
  "clibridge",
  "color",
];
const MODEL_PREF_KEY = "littree:studio:model";
const TOOL_META: Partial<Record<StudioTool, { title: string; eyebrow: string }>> = {
  image: { title: "Image Forge", eyebrow: "Create, remix, and save original visuals" },
  video: { title: "Motion Studio", eyebrow: "Turn prompts and images into cinematic scenes" },
  audio: { title: "Sound Lab", eyebrow: "Give LiTT a voice or create music and sound" },
  build: { title: "Build Command", eyebrow: "Plan locally now, connect a repository when ready" },
  code: { title: "Code Canvas", eyebrow: "Describe it, generate it, refine it, and ship it" },
  agents: { title: "Crew Room", eyebrow: "Direct LiTT, Spark, and specialist agents" },
  assets: { title: "Asset Vault", eyebrow: "Keep every image, video, file, and creation together" },
  plugins: { title: "Connection Bay", eyebrow: "Add capabilities when your services are ready" },
  pipeline: { title: "Workflow Forge", eyebrow: "Connect repeatable steps into a reusable flow" },
  space: { title: "World Builder", eyebrow: "Build immersive spaces and 360° experiences" },
  clibridge: { title: "CLI Bridge", eyebrow: "Connect local tools without leaving the Studio" },
  color: { title: "Color Lab", eyebrow: "Create, play, and explore color" },
};

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

  const initialModel = (() => {
    const fromUrl = searchParams.get("model");
    if (fromUrl) return fromUrl;
    const fromStore =
      typeof window === "undefined"
        ? null
        : localStorage.getItem(MODEL_PREF_KEY);
    return fromStore || "adaptive";
  })();

  const [activeTool, setActiveTool] = useState<StudioTool>(initialTool);
  const [search, setSearch] = useState("");
  const [model, setModel] = useState(initialModel);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [pendingCommand, setPendingCommand] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const isInitialMount = useRef(true);
  const [cameraDock, setCameraDock] = useState<{
    open: boolean;
    pos: DockPosition;
  }>({ open: false, pos: "bottom-right" });
  const [screenDock, setScreenDock] = useState<{
    open: boolean;
    pos: DockPosition;
  }>({ open: false, pos: "bottom-left" });

  // Restore and persist scroll position per tool.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const saved = sessionStorage.getItem(`littree:studio:scroll:${activeTool}`);
    if (saved) {
      el.scrollTop = Number(saved);
    }
    const onScroll = () => {
      sessionStorage.setItem(
        `littree:studio:scroll:${activeTool}`,
        String(el.scrollTop),
      );
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [activeTool]);

  // Sync tool/model to localStorage immediately, and to URL only after the
  // user changes them (not on initial mount). This avoids Chrome marking the
  // history entry as skippable on page load.
  useEffect(() => {
    try {
      localStorage.setItem("littree:studio:tool", activeTool);
      localStorage.setItem(MODEL_PREF_KEY, model);
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
    if (model !== "adaptive") params.set("model", model);
    else params.delete("model");
    const query = params.toString();
    router.replace(`${pathname}${query ? `?${query}` : ""}`, { scroll: false });
  }, [activeTool, model, pathname, router, searchParams]);

  // Handle tool switches emitted from inside workspaces, e.g. BuilderTool ->
  // Code.
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

  const drawerTool = DRAWER_TOOLS.includes(activeTool) ? activeTool : null;
  const DrawerComponent = drawerTool ? TOOL_COMPONENTS[drawerTool] : null;
  const drawerMeta = drawerTool ? TOOL_META[drawerTool] : null;

  return (
    <VoiceSessionProvider>
      <div
        className="flex h-[100dvh] w-full flex-col overflow-hidden md:h-full"
        style={{ backgroundColor: T.bgColor + "d0", color: T.textColor }}
      >
        <StudioTopBar
          search={search}
          onSearchChange={setSearch}
          selectedModel={model}
          onModelChange={setModel}
          onInspectorToggle={() => setInspectorOpen((v) => !v)}
          T={T}
        />

        <div className="flex flex-1 min-h-0">
          <StudioSidebar
            activeTool={activeTool}
            onToolChange={handleToolChange}
            search={search}
          />

          <main className="relative flex min-w-0 flex-1 flex-col overflow-hidden">
            <div
              ref={scrollRef}
              className="min-h-0 flex-1 overflow-hidden p-2 pb-[calc(3.5rem+env(safe-area-inset-bottom))] sm:p-3 md:pb-2"
            >
              <ChatTool
                selectedModel={model}
                onRouteTool={handleCommandRoute}
                requestedTool={activeTool}
                pendingCommand={pendingCommand}
              />
            </div>

            {DrawerComponent && drawerTool && (
              <section className="absolute inset-0 z-50 flex justify-end">
                <div
                  className="relative flex h-full w-full flex-col overflow-hidden"
                  style={{
                    backgroundColor: T.bgColor + "ee",
                  }}
                >
                  <div className="relative flex min-h-16 shrink-0 items-center justify-between overflow-hidden border-b border-white/10 px-4 sm:px-6">
                    <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_15%_0%,rgba(103,232,249,.11),transparent_38%),radial-gradient(circle_at_90%_0%,rgba(168,85,247,.12),transparent_38%)]" />
                    <div className="flex items-center gap-2">
                      <span className={`h-2 w-2 rounded-full ${drawerTool === "image" ? "bg-cyan-300 shadow-[0_0_12px_#67e8f9]" : "bg-violet-300 shadow-[0_0_12px_#c4b5fd]"}`} />
                      <div>
                        <strong className="block text-sm font-black tracking-tight">{drawerMeta?.title || `${drawerTool} creator`}</strong>
                        <span className="hidden text-[9px] font-medium text-white/40 sm:block">{drawerMeta?.eyebrow || "Your conversation stays open"}</span>
                      </div>
                    </div>
                    <button
                      onClick={() => setActiveTool("home")}
                      className="grid h-8 w-8 place-items-center rounded-xl border border-white/10 text-sm text-white/55 transition hover:bg-white/10 hover:text-white"
                      aria-label={`Close ${drawerTool} creator`}
                    >
                      ✕
                    </button>
                  </div>
                  <div className="studio-tool-surface min-h-0 flex-1 overflow-auto px-2 py-3 sm:px-5 sm:py-5">
                    <div className="mx-auto w-full max-w-[1380px]">
                      <DrawerComponent />
                    </div>
                  </div>
                </div>
              </section>
            )}
          </main>

          {!drawerTool && <StudioInspector variant="aside" T={T} activeTool={activeTool} />}
        </div>

        {inspectorOpen && (
          <div className="fixed inset-0 z-10000 md:hidden">
            <button
              className="absolute inset-0 w-full h-full bg-black/60 cursor-default"
              onClick={() => setInspectorOpen(false)}
              aria-label="Close inspector"
            />
            <div className="absolute right-0 top-0 h-full w-[280px]">
              <StudioInspector
                variant="sheet"
                onClose={() => setInspectorOpen(false)}
                T={T}
                activeTool={activeTool}
              />
            </div>
          </div>
        )}
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
        onClick={onMove}
        className="rounded-md hover:bg-white/10"
        style={{ color: T.textMuted }}
        aria-label="Move dock"
        title="Move dock"
      >
        ⇮
      </button>
      <button
        onClick={onClose}
        className="rounded-md hover:bg-white/10"
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
