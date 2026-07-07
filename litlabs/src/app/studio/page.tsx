"use client";

export const dynamic = "force-dynamic";

import { Suspense, memo, useEffect, useMemo, useState } from "react";
import nextDynamic from "next/dynamic";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useTheme } from "@/context/ThemeContext";
import { useClerkAuth } from "@/hooks/useClerkAuth";

import StudioSidebar, { type StudioTool } from "./components/StudioSidebar";
import StudioTopBar from "./components/StudioTopBar";
import StudioInspector from "./components/StudioInspector";
import StudioCommandDock, {
  type DockAction,
} from "./components/StudioCommandDock";
import type { StudioMode } from "./components/StudioModeSwitcher";
import { Sparkles, X, Image as ImageIcon, Film, Music, Zap, Coins, Settings } from "lucide-react";
import { useWallet } from "@/context/WalletContext";

const ImageTool = nextDynamic(() => import("./tools/ImageTool"), {
  ssr: false,
});
const VideoTool = nextDynamic(() => import("./tools/VideoTool"), {
  ssr: false,
});
const AudioTool = nextDynamic(() => import("./tools/AudioTool"), {
  ssr: false,
});
const AgentTool = nextDynamic(() => import("./tools/AgentTool"), {
  ssr: false,
});
const AgentsTerminalTool = nextDynamic(
  () => import("./tools/AgentsTerminalTool"),
  { ssr: false },
);
const CLIBridgeTool = nextDynamic(() => import("./tools/CLIBridgeTool"), {
  ssr: false,
});
const GalleryTool = nextDynamic(() => import("./tools/GalleryTool"), {
  ssr: false,
});
const SpaceTool = nextDynamic(() => import("./tools/SpaceTool"), {
  ssr: false,
});
const ColorByNumberTool = nextDynamic(
  () => import("./tools/ColorByNumberTool"),
  { ssr: false },
);
const PipelineTool = nextDynamic(() => import("./tools/PipelineTool"), {
  ssr: false,
});
const CanvasTool = nextDynamic(() => import("./tools/CanvasTool"), {
  ssr: false,
});
const ChatTool = nextDynamic(() => import("./tools/ChatTool"), {
  ssr: false,
});
const BuilderTool = nextDynamic(() => import("./tools/BuilderTool"), {
  ssr: false,
});

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
    case "color":
      return <ColorByNumberTool />;
    case "canvas":
      return <CanvasTool />;
    case "chat":
      return <ChatTool />;
    case "builder":
      return <BuilderTool />;
    default:
      return <ImageTool />;
  }
});

const CANONICAL_TOOL: Partial<Record<StudioTool, StudioTool>> = {
  agents: "chat",
  builder: "chat",
  terminal: "chat",
  clibridge: "chat",
  pipeline: "chat",
  canvas: "chat",
};

const FOCUSED_TOOLS: StudioTool[] = ["chat"];

const MODE_HEADLINE: Record<StudioMode, { title: string; subtitle: string }> = {
  command: {
    title: "Start Creating",
    subtitle:
      "Chat, code, generate, and ship — every tool is one click away.",
  },
  media: {
    title: "Media Studio",
    subtitle: "Image, video, audio, color, and exports for creators.",
  },
  research: {
    title: "Research Desk",
    subtitle: "Sources, citations, notes, and answers you can trust.",
  },
  agent: {
    title: "Agent Ops",
    subtitle: "Agents, queues, runs, cost, health, and logs.",
  },
  minimal: {
    title: "Minimal Pro",
    subtitle: "Less chrome, more work. Ship fast.",
  },
};

const MODE_QUICKSTART: Record<StudioMode, DockAction[]> = {
  command: [
    {
      id: "qs-chat",
      label: "Open AI chat",
      icon: Sparkles,
      tool: "chat",
    },
    {
      id: "qs-gen",
      label: "Generate an image",
      icon: Sparkles,
      tool: "image",
      prompt: "Generate an image of ",
    },
    {
      id: "qs-build",
      label: "Build an app",
      icon: Sparkles,
      tool: "builder",
      prompt: "Build a ",
    },
    {
      id: "qs-scan",
      label: "Scan code for issues",
      icon: Sparkles,
      tool: "terminal",
    },
  ],
  media: [
    { id: "qs-img", label: "New image", icon: Sparkles, tool: "image" },
    { id: "qs-vid", label: "New video", icon: Sparkles, tool: "video" },
    { id: "qs-aud", label: "New audio", icon: Sparkles, tool: "audio" },
    { id: "qs-color", label: "Color by number", icon: Sparkles, tool: "color" },
  ],
  research: [
    { id: "qs-gal", label: "Browse gallery", icon: Sparkles, tool: "gallery" },
    { id: "qs-space", label: "Generate skybox", icon: Sparkles, tool: "space" },
    { id: "qs-chat", label: "Ask a question", icon: Sparkles, tool: "agents" },
  ],
  agent: [
    { id: "qs-agents", label: "List agents", icon: Sparkles, tool: "agents" },
    { id: "qs-term", label: "Open terminal", icon: Sparkles, tool: "terminal" },
    { id: "qs-pipe", label: "Open pipeline", icon: Sparkles, tool: "pipeline" },
  ],
  minimal: [
    { id: "qs-min-img", label: "Quick image", icon: Sparkles, tool: "image" },
    { id: "qs-min-chat", label: "Quick chat", icon: Sparkles, tool: "agents" },
  ],
};

function StudioCommandCenter() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { resolvedColors: T } = useTheme();
  const { isLoaded, isSignedIn } = useClerkAuth();

  // Top-level state
  const mode: StudioMode = "command";
  const [activeTool, setActiveTool] = useState<StudioTool>("chat");
  const [selectedModel, setSelectedModel] = useState("adaptive");
  const [search, setSearch] = useState("");
  const [prompt, setPrompt] = useState("");
  const [recentActions, setRecentActions] = useState<
    { tool: StudioTool; label: string }[]
  >([]);

  // Mobile inspector sheet
  const [mobileInspector, setMobileInspector] = useState(false);
  // Desktop inspector visibility
  const [desktopInspectorOpen, setDesktopInspectorOpen] = useState(true);

  const { balance, isLoading: walletLoading } = useWallet();

  // URL → tool (deep-link sync; the prev-comparison prevents redundant
  // re-renders that would otherwise fire on every router push).

  useEffect(() => {
    const toolParam = searchParams.get("tool") as StudioTool | null;
    if (toolParam) {
      const next = CANONICAL_TOOL[toolParam] ?? toolParam;
      setActiveTool((prev) => (prev === next ? prev : next));
    }
  }, [searchParams]);

  // Auth gate
  useEffect(() => {
    if (isLoaded && !isSignedIn) router.push("/sign-in?redirect_url=/studio");
  }, [isLoaded, isSignedIn, router]);

  const handleToolChange = (t: StudioTool) => {
    const next = CANONICAL_TOOL[t] ?? t;
    setActiveTool(next);
    router.push(`/studio?tool=${next}`, { scroll: false });
  };

  const routePromptToTool = (text: string): StudioTool => {
    const t = text.toLowerCase();
    if (/\b(build|website|web app|app|component|dashboard|landing page|fix code|code|react|nextjs|tailwind)\b/.test(t)) return "chat";
    if (/\b(video|film|clip|movie|reel|animate)\b/.test(t)) return "video";
    if (/\b(audio|music|song|sound|beat|track|voice)\b/.test(t)) return "audio";
    if (/\b(color|colour|colou?ring|palette|sketch)\b/.test(t)) return "color";
    if (/\b(terminal|run|bash|shell|command|exec|npm|git|cli)\b/.test(t)) return "chat";
    if (/\b(pipeline|flow|automat|workflow|chain)\b/.test(t)) return "chat";
    if (/\b(gallery|saved|history|past|my images)\b/.test(t)) return "gallery";
    if (/\b(agent|agents|forge|worker|assistant team)\b/.test(t)) return "chat";
    if (/\b(chat|ask|talk|help|assist|question)\b/.test(t)) return "chat";
    if (/\b(space|sky|skybox|3d|environment)\b/.test(t)) return "space";
    if (/\b(image|photo|picture|generate|create|make|draw|render|art)\b/.test(t)) return "image";
    return activeTool;
  };

  const handlePromptSubmit = () => {
    const text = prompt.trim();
    if (!text) return;
    const routed = routePromptToTool(text);
    if (routed !== activeTool) handleToolChange(routed);
    setRecentActions((prev) =>
      [{ tool: routed, label: text.slice(0, 24) }, ...prev].slice(0, 5),
    );
    setPrompt("");
  };

  const handleAction = (a: DockAction) => {
    if (a.tool) handleToolChange(a.tool);
    if (a.prompt) setPrompt(a.prompt);
  };

  const headline = useMemo(() => MODE_HEADLINE[mode], [mode]);
  const quickstart = useMemo(() => MODE_QUICKSTART[mode], [mode]);
  const focusedTool = FOCUSED_TOOLS.includes(activeTool);

  if (!isLoaded) {
    return (
      <div
        className="min-h-screen grid place-items-center"
        style={{ backgroundColor: T.bgColor, color: T.accentColor }}
      >
        Loading Studio…
      </div>
    );
  }
  if (!isSignedIn) {
    return (
      <div className="min-h-[60vh] grid place-items-center">
        <Link
          href="/sign-in?redirect_url=/studio"
          className="rounded-xl px-4 py-2 font-bold text-white"
          style={{ backgroundColor: T.accentColor }}
        >
          Sign in to continue
        </Link>
      </div>
    );
  }

  return (
    <div
      className="flex h-full min-h-0 flex-col overflow-hidden"
      style={{
        background: `radial-gradient(circle at top, ${T.accentColor}14, transparent 30%), linear-gradient(180deg, ${T.bgColor} 0%, ${T.boxBg} 100%)`,
        color: T.textColor,
      }}
    >
      {/* Desktop top bar */}
      <div className="hidden md:block shrink-0">
        <StudioTopBar
          search={search}
          onSearchChange={setSearch}
          selectedModel={selectedModel}
          onModelChange={setSelectedModel}
          onInspectorToggle={() => setMobileInspector(true)}
          onDesktopInspectorToggle={() => setDesktopInspectorOpen((v) => !v)}
          desktopInspectorOpen={desktopInspectorOpen}
          T={T}
        />
      </div>

      {/* Mobile compact top bar */}
      <div
        className="md:hidden flex items-center gap-2 px-3 h-11 shrink-0"
        style={{
          backgroundColor: T.boxBg + "d0",
          borderBottom: `1px solid ${T.borderColor}20`,
          backdropFilter: "blur(14px) saturate(180%)",
        }}
      >
        <div className="flex items-center gap-1.5">
          <div
            className="w-5 h-5 rounded-md flex items-center justify-center"
            style={{ background: `linear-gradient(135deg, ${T.accentColor}, ${T.linkColor})` }}
          >
            <Sparkles size={10} className="text-white" />
          </div>
          <span className="text-[11px] font-black uppercase tracking-[0.15em]" style={{ color: T.headerColor }}>
            Studio
          </span>
        </div>
        <div className="flex-1" />
        <div
          className="flex items-center gap-1 rounded-lg border px-2 py-0.5 text-[10px] font-bold"
          style={{ backgroundColor: T.bgColor + "60", borderColor: T.borderColor + "20", color: T.accentColor }}
        >
          <Coins size={10} />
          {walletLoading ? "—" : balance.toLocaleString()}
          <span className="opacity-50 text-[8px] uppercase">LBC</span>
        </div>
        <Link href="/settings" className="rounded-lg p-1.5 hover:bg-white/10" style={{ color: T.textMuted }}>
          <Settings size={14} />
        </Link>
      </div>

      <div className="flex-1 min-h-0 flex">
        <StudioSidebar
          activeTool={activeTool}
          onToolChange={handleToolChange}
        />

        <main className="flex-1 min-w-0 flex flex-col">
          {/* Workspace header — hidden for focused tools with their own command surface */}
          <div
            className={`items-center justify-between gap-3 px-4 sm:px-6 h-14 shrink-0 ${focusedTool ? "hidden" : "flex"}`}
            style={{
              backgroundColor: T.boxBg + "60",
              borderBottom: `1px solid ${T.borderColor}18`,
            }}
          >
            <div className="min-w-0">
              <div
                className="text-[10px] uppercase tracking-[0.25em]"
                style={{ color: T.textMuted }}
              >
                {mode === "command" ? "Default" : "Mode"} · {activeTool}
              </div>
              <div
                className="text-[14px] font-black truncate"
                style={{ color: T.headerColor }}
              >
                {headline.title}
              </div>
            </div>
            <div className="hidden md:block shrink-0">
              <button
                onClick={() => handleToolChange("chat")}
                className="rounded-lg border px-3 py-1.5 text-[11px] font-black uppercase tracking-[0.18em]"
                style={{ backgroundColor: T.bgColor + "65", borderColor: T.borderColor + "25", color: T.accentColor }}
              >
                Ask Studio
              </button>
            </div>
          </div>

          {/* Quick starts — hidden for focused tools with their own command surface */}
          <div
            className={`px-4 sm:px-6 py-2.5 shrink-0 items-center gap-2.5 overflow-x-auto ${focusedTool ? "hidden" : "flex"}`}
            style={{ borderBottom: `1px solid ${T.borderColor}10` }}
          >
            {recentActions.length > 0 ? (
              <>
                <span className="text-[10px] uppercase tracking-[0.2em] shrink-0" style={{ color: T.textMuted }}>Recent</span>
                {recentActions.map((a, i) => (
                  <button
                    key={i}
                    onClick={() => handleToolChange(a.tool)}
                    className="shrink-0 flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] font-bold transition-all hover:scale-[1.02]"
                    style={{ backgroundColor: T.bgColor + "65", borderColor: T.borderColor + "25", color: T.textColor }}
                  >
                    {a.tool === "image" ? <ImageIcon size={11} style={{ color: T.accentColor }} /> :
                     a.tool === "video" ? <Film size={11} style={{ color: "#ff6b6b" }} /> :
                     a.tool === "audio" ? <Music size={11} style={{ color: "#9b59b6" }} /> :
                     <Zap size={11} style={{ color: T.accentColor }} />}
                    {a.label}
                  </button>
                ))}
                <div className="w-px h-5 shrink-0" style={{ backgroundColor: T.borderColor + "30" }} />
              </>
            ) : null}
            {quickstart.map((q) => (
              <button
                key={q.id}
                onClick={() => handleAction(q)}
                className="shrink-0 flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] font-bold transition-all hover:scale-[1.02]"
                style={{ backgroundColor: T.bgColor + "65", borderColor: T.borderColor + "25", color: T.textColor }}
              >
                <Sparkles size={11} style={{ color: T.accentColor }} />
                {q.label}
              </button>
            ))}
          </div>

          {/* Active tool */}
          <div
            className={focusedTool ? "flex-1 min-h-0 overflow-hidden md:pb-0 pb-14" : "flex-1 min-h-0 overflow-auto p-4 sm:p-6 pb-[calc(0.75rem+56px)] md:pb-6"}
            style={{ color: T.textColor }}
          >
            <ToolRouter tool={activeTool} />
          </div>

          {/* Bottom command dock — only for tools without their own primary input */}
          {!focusedTool && (
          <div className="hidden md:block">
          <StudioCommandDock
            prompt={prompt}
            onPromptChange={setPrompt}
            onSubmit={handlePromptSubmit}
            activeTool={activeTool}
            onToolChange={handleToolChange}
            recentActions={recentActions}
            onAction={handleAction}
            T={T}
          />
          </div>
          )}
        </main>

        {/* Desktop inspector — hidden on mobile and collapsible */}
        {desktopInspectorOpen && (
          <div className="hidden lg:block">
            <StudioInspector T={T} />
          </div>
        )}
      </div>

      {/* Mobile inspector sheet */}
      {mobileInspector && (
        <div className="md:hidden fixed inset-0 z-50 flex flex-col justify-end">
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => setMobileInspector(false)}
          />
          <div
            className="relative rounded-t-3xl border-t shadow-2xl"
            style={{
              backgroundColor: T.boxBg,
              borderColor: T.borderColor + "30",
              boxShadow: `0 -12px 40px rgba(0,0,0,0.6)`,
            }}
          >
            <div
              className="flex items-center justify-between px-4 py-3"
              style={{ borderBottom: `1px solid ${T.borderColor}18` }}
            >
              <span
                className="text-[10px] font-black uppercase tracking-[0.18em]"
                style={{ color: T.headerColor }}
              >
                Inspector
              </span>
              <button
                onClick={() => setMobileInspector(false)}
                className="rounded-lg p-1.5 hover:bg-white/10"
                style={{ color: T.textMuted }}
                aria-label="Close inspector"
                title="Close"
              >
                <X size={16} />
              </button>
            </div>
            <StudioInspector
              variant="sheet"
              onClose={() => setMobileInspector(false)}
              T={T}
            />
          </div>
        </div>
      )}
    </div>
  );
}

export default function StudioPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen grid place-items-center">
          Loading Studio…
        </div>
      }
    >
      <StudioCommandCenter />
    </Suspense>
  );
}
