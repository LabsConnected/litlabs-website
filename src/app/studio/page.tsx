"use client";

import { useEffect, useState, Suspense, memo } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { useTheme, useCrtToggle } from "@/context/ThemeContext";
import { useClerkAuth } from "@/hooks/useClerkAuth";
import Link from "next/link";
import lazyLoad from "next/dynamic";
import { Monitor, Coins, Sparkles, Image, Film, Music, Bot, LayoutGrid } from "lucide-react";
import StudioSidebar, { StudioTool } from "./components/StudioSidebar";
import { MEDIA_PROVIDERS } from "@/lib/media";
import ModelPicker from "@/components/ModelPicker";
import KeyManager from "@/components/KeyManager";
import PromptComposer from "@/components/PromptComposer";
import AssetLibrary from "@/components/AssetLibrary";
import VersionHistory from "@/components/VersionHistory";
import TemplateLibrary from "@/components/TemplateLibrary";
import StylePresets from "@/components/StylePresets";
import DragDropCanvas from "@/components/DragDropCanvas";
import ErrorBoundary from "@/components/ErrorBoundary";

/* Lazy-load tools to keep bundle reasonable */
const ImageTool = lazyLoad(() => import("./tools/ImageTool"), { ssr: false });
const VideoTool = lazyLoad(() => import("./tools/VideoTool"), { ssr: false });
const AudioTool = lazyLoad(() => import("./tools/AudioTool"), { ssr: false });
const AgentTool = lazyLoad(() => import("./tools/AgentTool"), { ssr: false });
const AgentsTerminalTool = lazyLoad(
  () => import("./tools/AgentsTerminalTool"),
  { ssr: false },
);
const CLIBridgeTool = lazyLoad(() => import("./tools/CLIBridgeTool"), {
  ssr: false,
});
const GalleryTool = lazyLoad(() => import("./tools/GalleryTool"), {
  ssr: false,
});
const SpaceTool = lazyLoad(() => import("./tools/SpaceTool"), { ssr: false });
const PipelineTool = lazyLoad(() => import("./tools/PipelineTool"), {
  ssr: false,
});

/* ------------------------------------------------------------------ */
/*  Model Badge — shows active provider per tool                        */
/* ------------------------------------------------------------------ */
const STATIC_MODEL_MAP: Record<
  StudioTool,
  { provider: string; color: string }
> = {
  image: { provider: "Gemini Imagen 3", color: "#6366f1" },
  video: { provider: "Wan 2.1", color: "#ff6b6b" },
  clibridge: { provider: "Local CLI", color: "#00f0ff" },
  audio: { provider: "TTS / Music", color: "#9b59b6" },
  agents: { provider: "Gemini 2.5 Flash", color: "#ffff00" },
  terminal: { provider: "Gemini 2.5 Flash", color: "#00ffff" },
  pipeline: { provider: "Gemini Orchestrator", color: "#d946ef" },
  gallery: { provider: "Asset Bucket", color: "#d2a8ff" },
  space: { provider: "MiniMax Space", color: "#ff6b35" },
};

function ModelBadge({ tool }: { tool: StudioTool }) {
  const info = STATIC_MODEL_MAP[tool];
  const [providerLabel, setProviderLabel] = useState(info.provider);
  const [label, setLabel] = useState(info.provider);

  useEffect(() => {
    const id = requestAnimationFrame(() => {
      // Only agent/terminal tools need dynamic provider from server health
      if (tool !== "agents" && tool !== "terminal") {
        setLabel(
          tool === "image"
            ? (MEDIA_PROVIDERS.find((p) => p.id === "gemini")?.label.split(
                " ",
              )[0] ?? "Gemini")
            : tool === "video"
              ? "Wan 2.1"
              : tool === "audio"
                ? "TTS / Music"
                : tool === "pipeline"
                  ? "Gemini Orchestrator"
                  : tool === "gallery"
                    ? "Asset Bucket"
                    : tool === "space"
                      ? "MiniMax Space"
                      : info.provider,
        );
        return;
      }
      // Fetch real health from server (env vars are server-side only)
      fetch("/api/llm/health")
        .then((r) => r.json())
        .then(
          (health: {
            gemini?: { available: boolean; model: string };
            openrouter?: { available: boolean; model: string };
            freeModels?: {
              id: string;
              name: string;
              provider: string;
              task: string;
            }[];
            hasGemini?: boolean;
            hasOpenRouter?: boolean;
          }) => {
            const gemini = health?.gemini;
            const orouter = health?.openrouter;
            const freeModels = health?.freeModels ?? [];
            if (gemini?.available) {
              setProviderLabel("Google Gemini");
              setLabel(
                (gemini?.model || "gemini-2.5-flash").replace(
                  "gemini-",
                  "Gemini ",
                ),
              );
            } else if (orouter?.available && freeModels.length > 0) {
              // Show the best free model for the task
              const taskMatch = freeModels.find(
                (m) => m.task === (tool === "terminal" ? "code" : "chat"),
              );
              const fallback = freeModels[0];
              const model = taskMatch || fallback;
              setProviderLabel(model.provider);
              setLabel(model.name);
            } else if (freeModels.length > 0) {
              // No keys but free models listed — show first free one
              setProviderLabel("OpenRouter Free");
              setLabel(freeModels[0].name);
            } else {
              setProviderLabel("No API Key");
              setLabel("Add Gemini or OpenRouter");
            }
          },
        )
        .catch(() => {
          setProviderLabel("Google Gemini");
          setLabel("Gemini 2.5 Flash");
        });
    });
    return () => cancelAnimationFrame(id);
  }, [tool, info.provider]);

  return (
    <div
      className="flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[9px] font-bold"
      style={{
        backgroundColor: info.color + "12",
        border: `1px solid ${info.color}25`,
        color: info.color,
      }}
    >
      <span
        className="w-1.5 h-1.5 rounded-full animate-pulse"
        style={{ backgroundColor: info.color }}
      />
      {providerLabel} · {label}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Status Bar (bottom)                                                */
/* ------------------------------------------------------------------ */
function StatusBar({
  T,
}: {
  T: ReturnType<typeof useTheme>["resolvedColors"];
}) {
  return (
    <div
      className="w-full flex shrink-0 h-9 md:h-7 items-center justify-center gap-3 px-3"
      style={{
        borderTop: `1px solid ${T.borderColor}15`,
        backgroundColor: T.bgColor + "60",
      }}
    >
      <span
        className="text-xs md:text-[9px] font-bold uppercase tracking-wider opacity-40"
        style={{ color: T.accentColor }}
      >
        LiTTree LabStudios Studio
      </span>
      <span className="text-xs md:text-[9px] opacity-20">·</span>
      <span
        className="text-xs md:text-[9px] opacity-30"
        style={{ color: T.textMuted }}
      >
        Image · Video · Audio · Agents
      </span>
      <span className="text-xs md:text-[9px] opacity-20">·</span>
      <span
        className="text-xs md:text-[9px] opacity-30"
        style={{ color: T.textMuted }}
      >
        v1.0
      </span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Tool Router — memoized so switching CRT etc doesn't remount tools  */
/* ------------------------------------------------------------------ */
const ToolRouter = memo(function ToolRouter({ tool }: { tool: StudioTool }) {
  switch (tool) {
    case "image":
      return <ImageTool />;
    case "video":
      return <VideoTool />;
    case "audio":
      return <AudioTool />;
    case "agents":
      return <AgentTool />;
    case "terminal":
      return <AgentsTerminalTool />;
    case "clibridge":
      return <CLIBridgeTool />;
    case "pipeline":
      return <PipelineTool />;
    case "gallery":
      return <GalleryTool />;
    case "space":
      return <SpaceTool />;
    default:
      return <ImageTool />;
  }
});

/* ------------------------------------------------------------------ */
/*  Main Page                                                          */
/* ------------------------------------------------------------------ */
function StudioInner() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { resolvedColors: T } = useTheme();
  const { isLoaded, isSignedIn } = useClerkAuth();
  const { crtEnabled, toggleCrt } = useCrtToggle();
  const [litcoins] = useState(() => {
    if (typeof window === "undefined") return 500;
    try {
      const raw = localStorage.getItem("litcoins");
      return raw ? Number(raw) : 500;
    } catch {
      return 500;
    }
  });
  const [selectedModel, setSelectedModel] = useState("adaptive");
  const [recentModels, setRecentModels] = useState<string[]>(["gemini-2.5-flash", "gpt-4o"]);
  const [showKeyManager, setShowKeyManager] = useState(false);
  const [showProTools, setShowProTools] = useState(false);
  const [studioTab, setStudioTab] = useState<"canvas" | "prompt" | "assets" | "templates" | "styles" | "history">("canvas");
  const [promptValue, setPromptValue] = useState("");
  const [canvasItems, setCanvasItems] = useState<any[]>([]);

  const toolParam = searchParams.get("tool") as StudioTool | null;
  const activeTool: StudioTool =
    toolParam &&
    [
      "image",
      "video",
      "audio",
      "agents",
      "terminal",
      "pipeline",
      "gallery",
      "space",
    ].includes(toolParam)
      ? toolParam
      : "image";

  /* Keyboard shortcuts */
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey) {
        const map: Record<string, StudioTool> = {
          "1": "image",
          "2": "video",
          "3": "audio",
          "4": "agents",
          "5": "terminal",
          "6": "pipeline",
          "7": "gallery",
          "8": "space",
        };
        if (map[e.key]) {
          e.preventDefault();
          router.push(`/studio?tool=${map[e.key]}`, { scroll: false });
        }
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [router]);

  useEffect(() => {
    if (isLoaded && !isSignedIn) {
      router.push("/sign-in?redirect_url=/studio");
    }
  }, [isLoaded, isSignedIn, router]);

  if (!isLoaded) {
    return (
      <div
        className="min-h-screen flex items-center justify-center font-mono"
        style={{ backgroundColor: T.bgColor, color: T.accentColor }}
      >
        <div className="text-center">
          <div className="text-3xl mb-4 animate-pulse">⚡</div>
          <div>Loading Studio...</div>
        </div>
      </div>
    );
  }

  if (!isSignedIn) {
    return (
      <div className="min-h-[60vh] flex flex-col items-center justify-center gap-4">
        <p className="text-sm opacity-60">Please sign in to use the Studio.</p>
        <Link
          href="/sign-in?redirect_url=/studio"
          className="px-4 py-2 rounded-lg text-sm font-bold"
          style={{ backgroundColor: "#6366f1", color: "#fff" }}
        >
          Sign In
        </Link>
      </div>
    );
  }

  return (
    <div
      className="flex flex-col min-h-[calc(100vh-4rem)] overflow-hidden"
      style={{
        backgroundColor: T.bgColor,
        color: T.textColor,
        fontFamily: "monospace",
      }}
    >
      {/* CRT overlay */}
      {crtEnabled && (
        <div
          className="fixed inset-0 pointer-events-none z-40 opacity-[0.05]"
          style={{
            background:
              "repeating-linear-gradient(0deg, rgba(0,0,0,0.12), rgba(0,0,0,0.12) 1px, transparent 1px, transparent 2px)",
            boxShadow: "inset 0 0 100px rgba(0,255,0,0.15)",
          }}
        />
      )}

      {/* Main workspace */}
      <div className="flex flex-1 overflow-hidden relative">
        {/* Desktop: StudioSidebar */}
        <div className="hidden md:block">
          <StudioSidebar
            activeTool={activeTool}
            onToolChange={(t) =>
              router.push(`/studio?tool=${t}`, { scroll: false })
            }
          />
        </div>

        {/* Mobile: Tool selector bar */}
        <div className="md:hidden fixed top-0 left-0 right-0 z-30 border-b"
          style={{ backgroundColor: T.bgColor + "f0", borderColor: T.borderColor + "30" }}>
          <div className="flex items-center overflow-x-auto px-2 py-2 gap-2 scrollbar-hide">
            {[
              { id: "image", label: "Image", icon: Image },
              { id: "video", label: "Video", icon: Film },
              { id: "audio", label: "Audio", icon: Music },
              { id: "agents", label: "Agents", icon: Bot },
              { id: "gallery", label: "Gallery", icon: LayoutGrid },
            ].map((tool) => {
              const Icon = tool.icon;
              const isActive = activeTool === tool.id;
              return (
                <button
                  key={tool.id}
                  onClick={() => router.push(`/studio?tool=${tool.id}`, { scroll: false })}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold whitespace-nowrap transition-all"
                  style={{
                    backgroundColor: isActive ? T.accentColor + "15" : T.boxBg + "40",
                    border: isActive ? `1px solid ${T.accentColor}30` : `1px solid ${T.borderColor}20`,
                    color: isActive ? T.accentColor : T.textMuted,
                  }}
                >
                  <Icon size={14} />
                  {tool.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Key Manager Panel - Right Sidebar */}
        {showKeyManager && (
          <div className="w-80 border-l overflow-y-auto shrink-0"
            style={{ borderColor: T.borderColor + "20", backgroundColor: T.boxBg + "80" }}>
            <div className="p-4">
              <div className="flex items-center justify-between mb-4">
                <div className="text-sm font-black" style={{ color: T.textColor }}>
                  API Keys
                </div>
                <button
                  onClick={() => setShowKeyManager(false)}
                  className="p-1 rounded-lg transition-all hover:scale-110"
                  style={{ color: T.textMuted }}
                >
                  ×
                </button>
              </div>
              <KeyManager />
            </div>
          </div>
        )}

        {/* Pro Tools Panel - Right Sidebar (Desktop) / Bottom Sheet (Mobile) */}
        {showProTools && (
          <>
            {/* Mobile Bottom Sheet */}
            <div className="sm:hidden fixed inset-0 z-50 flex flex-col"
              style={{ backgroundColor: T.bgColor + "95" }}>
              <div className="flex items-center justify-between p-4 border-b"
                style={{ borderColor: T.borderColor + "20" }}>
                <div className="text-sm font-black" style={{ color: T.textColor }}>
                  Pro Tools
                </div>
                <button
                  onClick={() => setShowProTools(false)}
                  className="p-2 rounded-lg"
                  style={{ color: T.textMuted }}
                >
                  ×
                </button>
              </div>
              <div className="flex-1 overflow-y-auto p-4 space-y-4">
                {/* Mobile Model Picker */}
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-widest mb-2" style={{ color: T.textMuted }}>
                    Model
                  </div>
                  <ModelPicker 
                    selectedModel={selectedModel} 
                    onModelChange={(id) => { setSelectedModel(id); setRecentModels([id, ...recentModels.slice(0, 4)]); }}
                    recentModels={recentModels}
                  />
                </div>
                
                {/* Quick Actions */}
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-widest mb-2" style={{ color: T.textMuted }}>
                    Quick Actions
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      onClick={() => setStudioTab("canvas")}
                      className="flex flex-col items-center gap-2 p-3 rounded-xl text-center"
                      style={{ backgroundColor: studioTab === "canvas" ? T.accentColor + "15" : T.boxBg + "40", border: studioTab === "canvas" ? "1px solid " + T.accentColor + "30" : "1px solid " + T.borderColor + "30" }}
                    >
                      <span className="text-2xl">🎨</span>
                      <span className="text-[10px] font-bold" style={{ color: studioTab === "canvas" ? T.accentColor : T.textMuted }}>Canvas</span>
                    </button>
                    <button
                      onClick={() => setStudioTab("prompt")}
                      className="flex flex-col items-center gap-2 p-3 rounded-xl text-center"
                      style={{ backgroundColor: studioTab === "prompt" ? T.accentColor + "15" : T.boxBg + "40", border: studioTab === "prompt" ? "1px solid " + T.accentColor + "30" : "1px solid " + T.borderColor + "30" }}
                    >
                      <span className="text-2xl">✨</span>
                      <span className="text-[10px] font-bold" style={{ color: studioTab === "prompt" ? T.accentColor : T.textMuted }}>Prompt</span>
                    </button>
                    <button
                      onClick={() => setStudioTab("assets")}
                      className="flex flex-col items-center gap-2 p-3 rounded-xl text-center"
                      style={{ backgroundColor: studioTab === "assets" ? T.accentColor + "15" : T.boxBg + "40", border: studioTab === "assets" ? "1px solid " + T.accentColor + "30" : "1px solid " + T.borderColor + "30" }}
                    >
                      <span className="text-2xl">📁</span>
                      <span className="text-[10px] font-bold" style={{ color: studioTab === "assets" ? T.accentColor : T.textMuted }}>Assets</span>
                    </button>
                    <button
                      onClick={() => setStudioTab("templates")}
                      className="flex flex-col items-center gap-2 p-3 rounded-xl text-center"
                      style={{ backgroundColor: studioTab === "templates" ? T.accentColor + "15" : T.boxBg + "40", border: studioTab === "templates" ? "1px solid " + T.accentColor + "30" : "1px solid " + T.borderColor + "30" }}
                    >
                      <span className="text-2xl">📋</span>
                      <span className="text-[10px] font-bold" style={{ color: studioTab === "templates" ? T.accentColor : T.textMuted }}>Templates</span>
                    </button>
                    <button
                      onClick={() => setStudioTab("styles")}
                      className="flex flex-col items-center gap-2 p-3 rounded-xl text-center"
                      style={{ backgroundColor: studioTab === "styles" ? T.accentColor + "15" : T.boxBg + "40", border: studioTab === "styles" ? "1px solid " + T.accentColor + "30" : "1px solid " + T.borderColor + "30" }}
                    >
                      <span className="text-2xl">🎭</span>
                      <span className="text-[10px] font-bold" style={{ color: studioTab === "styles" ? T.accentColor : T.textMuted }}>Styles</span>
                    </button>
                    <button
                      onClick={() => setStudioTab("history")}
                      className="flex flex-col items-center gap-2 p-3 rounded-xl text-center"
                      style={{ backgroundColor: studioTab === "history" ? T.accentColor + "15" : T.boxBg + "40", border: studioTab === "history" ? "1px solid " + T.accentColor + "30" : "1px solid " + T.borderColor + "30" }}
                    >
                      <span className="text-2xl">📜</span>
                      <span className="text-[10px] font-bold" style={{ color: studioTab === "history" ? T.accentColor : T.textMuted }}>History</span>
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/* Desktop Sidebar */}
            <div className="hidden sm:block w-80 border-l overflow-y-auto shrink-0"
              style={{ borderColor: T.borderColor + "20", backgroundColor: T.boxBg + "80" }}>
              <div className="p-4">
                <div className="flex items-center justify-between mb-4">
                  <div className="text-sm font-black" style={{ color: T.textColor }}>
                    Pro Tools
                  </div>
                  <button
                    onClick={() => setShowProTools(false)}
                    className="p-1 rounded-lg transition-all hover:scale-110"
                    style={{ color: T.textMuted }}
                  >
                    ×
                  </button>
                </div>
                <div className="space-y-4">
                  <div>
                    <div className="text-[10px] font-bold uppercase tracking-widest mb-2" style={{ color: T.textMuted }}>
                      Quick Actions
                    </div>
                    <div className="space-y-2">
                      <button
                        onClick={() => setStudioTab("canvas")}
                        className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-bold transition-all hover:scale-105 text-left"
                        style={{ backgroundColor: studioTab === "canvas" ? T.accentColor + "15" : T.boxBg + "40", color: studioTab === "canvas" ? T.accentColor : T.textMuted }}
                      >
                        <span>🎨</span> Canvas
                      </button>
                      <button
                        onClick={() => setStudioTab("prompt")}
                        className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-bold transition-all hover:scale-105 text-left"
                        style={{ backgroundColor: studioTab === "prompt" ? T.accentColor + "15" : T.boxBg + "40", color: studioTab === "prompt" ? T.accentColor : T.textMuted }}
                      >
                        <span>✨</span> Prompt Composer
                      </button>
                      <button
                        onClick={() => setStudioTab("assets")}
                        className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-bold transition-all hover:scale-105 text-left"
                        style={{ backgroundColor: studioTab === "assets" ? T.accentColor + "15" : T.boxBg + "40", color: studioTab === "assets" ? T.accentColor : T.textMuted }}
                      >
                        <span>📁</span> Asset Library
                      </button>
                      <button
                        onClick={() => setStudioTab("templates")}
                        className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-bold transition-all hover:scale-105 text-left"
                        style={{ backgroundColor: studioTab === "templates" ? T.accentColor + "15" : T.boxBg + "40", color: studioTab === "templates" ? T.accentColor : T.textMuted }}
                      >
                        <span>📋</span> Templates
                      </button>
                      <button
                        onClick={() => setStudioTab("styles")}
                        className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-bold transition-all hover:scale-105 text-left"
                        style={{ backgroundColor: studioTab === "styles" ? T.accentColor + "15" : T.boxBg + "40", color: studioTab === "styles" ? T.accentColor : T.textMuted }}
                      >
                        <span>🎭</span> Style Presets
                      </button>
                      <button
                        onClick={() => setStudioTab("history")}
                        className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-bold transition-all hover:scale-105 text-left"
                        style={{ backgroundColor: studioTab === "history" ? T.accentColor + "15" : T.boxBg + "40", color: studioTab === "history" ? T.accentColor : T.textMuted }}
                      >
                        <span>📜</span> Version History
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </>
        )}

        {/* Content area — full width on mobile, beside sidebar on desktop */}
        <main
          className="flex-1 overflow-hidden flex flex-col w-full"
          style={{ backgroundColor: T.bgColor, willChange: "transform" }}
        >
          {/* Studio top bar */}
          <div
            className="flex items-center justify-between px-3 h-11 md:h-9 shrink-0"
            style={{
              borderBottom: `1px solid ${T.borderColor}12`,
              backgroundColor: T.boxBg + "40",
            }}
          >
            {/* Left: breadcrumb — "Workspace /" hidden on xs */}
            <div className="flex items-center gap-1.5 shrink-0 min-w-0">
              <span
                className="hidden sm:inline text-[10px] font-bold uppercase tracking-[0.12em] opacity-40 whitespace-nowrap"
                style={{ color: T.textMuted }}
              >
                Workspace
              </span>
              <span
                className="hidden sm:inline text-[10px] opacity-20"
                style={{ color: T.textMuted }}
              >
                /
              </span>
              <span
                className="text-[11px] md:text-[10px] font-black uppercase tracking-[0.12em] truncate"
                style={{ color: T.accentColor }}
              >
                {activeTool}
              </span>
              {/* Model badge inline on mobile */}
              <div className="ml-2">
                <ModelBadge tool={activeTool} />
              </div>
            </div>

            {/* Right: actions */}
            <div className="flex items-center gap-1.5 shrink-0">
              {/* Model Picker - Full width on mobile */}
              <div className="hidden sm:block">
                <ModelPicker 
                  selectedModel={selectedModel} 
                  onModelChange={(id) => { setSelectedModel(id); setRecentModels([id, ...recentModels.slice(0, 4)]); }}
                  recentModels={recentModels}
                />
              </div>
              
              {/* Mobile Model Picker Button */}
              <button
                onClick={() => setShowProTools(!showProTools)}
                className="sm:hidden p-2 rounded-lg"
                style={{ backgroundColor: T.boxBg + "40", color: T.textMuted }}
              >
                <Sparkles size={16} />
              </button>
              
              {/* Pro Tools Toggle */}
              <button
                onClick={() => setShowProTools(!showProTools)}
                className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all hover:scale-105"
                style={{
                  backgroundColor: showProTools ? T.accentColor + "15" : T.boxBg + "40",
                  color: showProTools ? T.accentColor : T.textMuted,
                  border: showProTools ? "1px solid " + T.accentColor + "30" : "1px solid " + T.borderColor + "30",
                }}
              >
                <Sparkles size={12} />
                Pro Tools
              </button>
              
              {/* Key Manager Toggle */}
              <button
                onClick={() => setShowKeyManager(!showKeyManager)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all hover:scale-105"
                style={{
                  backgroundColor: showKeyManager ? T.accentColor + "15" : T.boxBg + "40",
                  color: showKeyManager ? T.accentColor : T.textMuted,
                  border: showKeyManager ? "1px solid " + T.accentColor + "30" : "1px solid " + T.borderColor + "30",
                }}
              >
                <Monitor size={12} />
                Keys
              </button>
              
              {/* Coin balance */}
              <div
                className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] md:text-[9px] font-bold whitespace-nowrap"
                style={{
                  backgroundColor: T.accentColor + "10",
                  color: T.accentColor,
                }}
              >
                <Coins size={11} />
                <span>{litcoins.toLocaleString()}</span>
                <span className="opacity-60 hidden sm:inline">LiTBit</span>
              </div>

              {/* CRT toggle — icon-only on xs, label on sm+ */}
              <button
                onClick={() => toggleCrt()}
                className="flex items-center gap-1 text-[10px] md:text-[9px] font-bold uppercase px-2 py-0.5 rounded transition-all hover:opacity-80"
                style={{
                  backgroundColor: crtEnabled ? T.accentColor + "12" : "transparent",
                  color: crtEnabled ? T.accentColor : T.textMuted + "60",
                  border: `1px solid ${crtEnabled ? T.accentColor + "30" : T.borderColor + "15"}`,
                }}
              >
                <Monitor size={11} />
                <span className="hidden sm:inline">CRT</span>
              </button>
            </div>
          </div>

          {/* Tool content */}
          <div className="flex-1 overflow-auto studio-scroll pt-12 md:pt-0 pb-20 md:pb-0"
            style={{ transform: "translateZ(0)", willChange: "transform" }}
          >
            <Suspense fallback={<div className="p-6">Loading...</div>}>
              <ToolRouter tool={activeTool} />
            </Suspense>
          </div>

          {/* Bottom status bar */}
          <StatusBar T={T} />
        </main>
      </div>
    </div>
  );
}

/* Wrap in Suspense for useSearchParams */
export default function StudioPage() {
  return (
    <ErrorBoundary>
      <Suspense
        fallback={
          <div className="min-h-screen flex items-center justify-center font-mono bg-black text-cyan-400">
            <div className="text-center">
              <div className="text-3xl mb-4 animate-pulse">⚡</div>
              <div>Initializing Studio...</div>
            </div>
          </div>
        }
      >
        <StudioInner />
      </Suspense>
    </ErrorBoundary>
  );
}
