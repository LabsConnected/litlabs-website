"use client";

import { useEffect, Suspense, memo, useMemo } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { useTheme } from "@/context/ThemeContext";
import { useAuth, RedirectToSignIn } from "@clerk/nextjs";
import dynamic from "next/dynamic";
import { Zap, Command, Monitor, Coins } from "lucide-react";
import StudioSidebar, { StudioTool } from "./components/StudioSidebar";
import { llmHealth } from "@/lib/llm";
import { MEDIA_PROVIDERS } from "@/lib/media";
import { useCrtToggle } from "@/context/ThemeContext";

/* Lazy-load tools to keep bundle reasonable */
const ImageTool  = dynamic(() => import("./tools/ImageTool"), { ssr: false });
const VideoTool  = dynamic(() => import("./tools/VideoTool"), { ssr: false });
const AudioTool  = dynamic(() => import("./tools/AudioTool"), { ssr: false });
const AgentTool  = dynamic(() => import("./tools/AgentTool"), { ssr: false });
const AgentsTerminalTool = dynamic(() => import("./tools/AgentsTerminalTool"), { ssr: false });
const GalleryTool = dynamic(() => import("./tools/GalleryTool"), { ssr: false });
const SpaceTool  = dynamic(() => import("./tools/SpaceTool"), { ssr: false });

/* ------------------------------------------------------------------ */
/*  Model Badge — shows active provider per tool                        */
/* ------------------------------------------------------------------ */
const STATIC_MODEL_MAP: Record<StudioTool, { provider: string; color: string }> = {
  image:   { provider: "FLUX Schnell", color: "#00ff41" },
  video:   { provider: "Wan 2.1", color: "#ff6b6b" },
  audio:   { provider: "TTS / Music", color: "#9b59b6" },
  agents:  { provider: "Gemini 2.5 Flash", color: "#ffff00" },
  terminal:{ provider: "Gemini 2.5 Flash", color: "#00ffff" },
  gallery: { provider: "Asset Bucket", color: "#d2a8ff" },
  space:   { provider: "MiniMax Space", color: "#ff6b35" },
};

function ModelBadge({ tool, T }: { tool: StudioTool; T: ReturnType<typeof useTheme>["resolvedColors"] }) {
  const info = STATIC_MODEL_MAP[tool];
  const health = useMemo(() => llmHealth(), []);
  // Dynamic label: use real model from llm.ts health check for agent tools
  const label = (tool === "agents" || tool === "terminal")
    ? health.gemini.model.replace("gemini-", "Gemini ").replace("openrouter/", "OR ")
    : tool === "image"   ? MEDIA_PROVIDERS.find(p => p.id === "together")?.label.split(" ")[0] ?? "FLUX" + " Schnell"
    : tool === "video"   ? "Wan 2.1"
    : tool === "audio"   ? "TTS / Music"
    : tool === "gallery" ? "Asset Bucket"
    : tool === "space"   ? "MiniMax Space"
    : info.provider;
  // Dynamic provider name for agents/terminal from health check
  const providerLabel = (tool === "agents" || tool === "terminal")
    ? health.gemini.available ? "Google Gemini" : health.openrouter.available ? "OpenRouter" : "Unavailable"
    : info.provider;
  return (
    <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[9px] font-bold" style={{ backgroundColor: info.color + "12", border: `1px solid ${info.color}25`, color: info.color }}>
      <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ backgroundColor: info.color }} />
      {providerLabel} · {label}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Status Ticker (bottom bar)                                         */
/* ------------------------------------------------------------------ */
function StatusTicker({ T }: { T: ReturnType<typeof useTheme>["resolvedColors"] }) {
  return (
    <div
      className="w-full overflow-hidden flex shrink-0 h-7 items-center"
      style={{ borderTop: `1px solid ${T.borderColor}15`, backgroundColor: T.bgColor + "80" }}
    >
      <div className="whitespace-nowrap animate-marquee flex gap-12 font-bold uppercase tracking-wider text-[9px] opacity-50">
        <span style={{ color: T.accentColor }}>POLLINATIONS AI STUDIO</span>
        <span style={{ color: T.linkColor }}>IMAGE · VIDEO · AUDIO · AGENTS · GALLERY · SPACE</span>
        <span style={{ color: T.accentColor }}>FLUX · GEMINI · MINIMAX · POLLINATIONS AI</span>
        <span style={{ color: T.linkColor }}>MULTI-MODAL GENERATION WORKSPACE</span>
        <span style={{ color: T.accentColor }}>POLLINATIONS AI STUDIO</span>
        <span style={{ color: T.linkColor }}>IMAGE · VIDEO · AUDIO · AGENTS · GALLERY · SPACE</span>
        <span style={{ color: T.accentColor }}>FLUX · GEMINI · MINIMAX · POLLINATIONS AI</span>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Tool Router — memoized so switching CRT etc doesn't remount tools  */
/* ------------------------------------------------------------------ */
const ToolRouter = memo(function ToolRouter({ tool }: { tool: StudioTool }) {
  switch (tool) {
    case "image":    return <ImageTool />;
    case "video":    return <VideoTool />;
    case "audio":    return <AudioTool />;
    case "agents":   return <AgentTool />;
    case "terminal": return <AgentsTerminalTool />;
    case "gallery":  return <GalleryTool />;
    case "space":    return <SpaceTool />;
    default:         return <ImageTool />;
  }
});

/* ------------------------------------------------------------------ */
/*  Main Page                                                          */
/* ------------------------------------------------------------------ */
function StudioInner() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { resolvedColors: T } = useTheme();
  const { isLoaded, isSignedIn } = useAuth();
  const { crtEnabled, toggleCrt } = useCrtToggle();

  const toolParam = searchParams.get("tool") as StudioTool | null;
  const activeTool: StudioTool =
    toolParam && ["image", "video", "audio", "agents", "terminal", "gallery", "space"].includes(toolParam)
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
          "6": "gallery",
          "7": "space",
        };
        if (map[e.key]) {
          e.preventDefault();
          router.push(`/studio?tool=${map[e.key]}`);
        }
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [router]);

  if (!isLoaded) {
    return (
      <div className="min-h-screen flex items-center justify-center font-mono" style={{ backgroundColor: T.bgColor, color: T.accentColor }}>
        <div className="text-center">
          <div className="text-3xl mb-4 animate-pulse">⚡</div>
          <div>Loading Studio...</div>
        </div>
      </div>
    );
  }

  if (!isSignedIn) {
    return <RedirectToSignIn />;
  }

  const crtStyle = useMemo(() => ({
    background: "repeating-linear-gradient(0deg, rgba(0,0,0,0.12), rgba(0,0,0,0.12) 1px, transparent 1px, transparent 2px)",
    boxShadow: "inset 0 0 100px rgba(0,255,0,0.15)",
  }), []);

  return (
    <div className="flex flex-col h-screen overflow-hidden" style={{ backgroundColor: T.bgColor, color: T.textColor, fontFamily: "monospace" }}>
      {/* CRT overlay */}
      {crtEnabled && (
        <div className="fixed inset-0 pointer-events-none z-40 opacity-[0.05]" style={crtStyle} />
      )}

      {/* Main workspace */}
      <div className="flex flex-1 overflow-hidden">
        <StudioSidebar activeTool={activeTool} onToolChange={(t) => router.push(`/studio?tool=${t}`)} />

        {/* Content area — compositor layer for smooth scroll */}
        <main className="flex-1 overflow-hidden flex flex-col" style={{ backgroundColor: T.bgColor, willChange: "transform" }}>
          {/* Zed-style top bar */}
          <div
            className="flex items-center justify-between px-3 h-9 shrink-0"
            style={{ borderBottom: `1px solid ${T.borderColor}12`, backgroundColor: T.boxBg + "40" }}
          >
            {/* Left: breadcrumb */}
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-bold uppercase tracking-[0.12em] opacity-40" style={{ color: T.textMuted }}>
                Workspace
              </span>
              <span className="text-[10px] opacity-20" style={{ color: T.textMuted }}>/</span>
              <span className="text-[10px] font-bold uppercase tracking-[0.12em]" style={{ color: T.accentColor }}>
                {activeTool}
              </span>
            </div>

            {/* Center: model badge */}
            <ModelBadge tool={activeTool} T={T} />

            {/* Right: actions */}
            <div className="flex items-center gap-2">
              {/* Coin balance */}
              <div className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-bold" style={{ backgroundColor: T.accentColor + "10", color: T.accentColor }}>
                <Coins size={10} /> 500
              </div>

              {/* CRT toggle */}
              <button
                onClick={() => toggleCrt()}
                className="flex items-center gap-1 text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded transition-all hover:opacity-80"
                style={{
                  backgroundColor: crtEnabled ? T.accentColor + "12" : "transparent",
                  color: crtEnabled ? T.accentColor : T.textMuted + "60",
                  border: `1px solid ${crtEnabled ? T.accentColor + "30" : T.borderColor + "15"}`,
                }}
              >
                <Monitor size={10} /> {crtEnabled ? "CRT" : "CRT"}
              </button>
            </div>
          </div>

          {/* Tool content — canvas, GPU composited for smooth scroll */}
          <div className="flex-1 overflow-auto studio-scroll" style={{ transform: "translateZ(0)", willChange: "transform" }}>
            <Suspense fallback={
              <div className="flex items-center justify-center h-full">
                <div className="text-center">
                  <div className="relative w-8 h-8 mx-auto mb-2">
                    <div className="absolute inset-0 rounded-full border-2 animate-spin" style={{ borderColor: T.accentColor + "40", borderTopColor: T.accentColor }} />
                  </div>
                  <div className="text-xs opacity-60" style={{ color: T.accentColor }}>Loading...</div>
                </div>
              </div>
            }>
              <ToolRouter tool={activeTool} />
            </Suspense>
          </div>

          {/* Bottom ticker */}
          <StatusTicker T={T} />
        </main>
      </div>
    </div>
  );
}

/* Wrap in Suspense for useSearchParams */
export default function StudioPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center font-mono bg-black text-cyan-400">
        <div className="text-center">
          <div className="text-3xl mb-4 animate-pulse">⚡</div>
          <div>Initializing Studio...</div>
        </div>
      </div>
    }>
      <StudioInner />
    </Suspense>
  );
}
