"use client";

import { useEffect, useState, Suspense, memo } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { useTheme, useCrtToggle } from "@/context/ThemeContext";
import { useClerkAuth } from "@/hooks/useClerkAuth";
import Link from "next/link";
import lazyLoad from "next/dynamic";
import { Monitor, Coins } from "lucide-react";
import StudioSidebar, { StudioTool } from "./components/StudioSidebar";
import { MEDIA_PROVIDERS } from "@/lib/media";

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
        LiTree Studio
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
        <StudioSidebar
          activeTool={activeTool}
          onToolChange={(t) =>
            router.push(`/studio?tool=${t}`, { scroll: false })
          }
        />

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

          {/* Tool content — canvas, GPU composited for smooth scroll */}
          {/* pb-14 md:pb-0 reserves space for mobile bottom tab bar */}
          <div
            className="flex-1 overflow-auto studio-scroll pb-14 md:pb-0"
            style={{ transform: "translateZ(0)", willChange: "transform" }}
          >
            <Suspense
              fallback={
                <div className="min-h-[600px] p-6 space-y-4 animate-pulse">
                  {/* Skeleton header */}
                  <div className="flex items-center gap-3 mb-6">
                    <div
                      className="w-8 h-8 rounded-md"
                      style={{ backgroundColor: T.accentColor + "15" }}
                    />
                    <div className="space-y-2">
                      <div
                        className="w-32 h-4 rounded"
                        style={{ backgroundColor: T.accentColor + "12" }}
                      />
                      <div
                        className="w-48 h-3 rounded"
                        style={{ backgroundColor: T.accentColor + "08" }}
                      />
                    </div>
                  </div>
                  {/* Skeleton cards */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div
                      className="h-40 rounded-xl"
                      style={{
                        backgroundColor: T.boxBg + "30",
                        border: `1px solid ${T.borderColor}10`,
                      }}
                    />
                    <div
                      className="h-40 rounded-xl"
                      style={{
                        backgroundColor: T.boxBg + "30",
                        border: `1px solid ${T.borderColor}10`,
                      }}
                    />
                    <div
                      className="h-40 rounded-xl"
                      style={{
                        backgroundColor: T.boxBg + "30",
                        border: `1px solid ${T.borderColor}10`,
                      }}
                    />
                    <div
                      className="h-40 rounded-xl"
                      style={{
                        backgroundColor: T.boxBg + "30",
                        border: `1px solid ${T.borderColor}10`,
                      }}
                    />
                  </div>
                  {/* Skeleton footer */}
                  <div className="flex gap-3 pt-4">
                    <div
                      className="w-24 h-8 rounded-lg"
                      style={{ backgroundColor: T.accentColor + "10" }}
                    />
                    <div
                      className="w-24 h-8 rounded-lg"
                      style={{ backgroundColor: T.accentColor + "10" }}
                    />
                  </div>
                </div>
              }
            >
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
  );
}
