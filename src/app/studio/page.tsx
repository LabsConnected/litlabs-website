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
import StudioModeSwitcher, {
  defaultToolForMode,
  type StudioMode,
} from "./components/StudioModeSwitcher";
import { Sparkles, X } from "lucide-react";

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
const ChatTool = nextDynamic(() => import("./tools/ChatTool"), { ssr: false });
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
const BuilderTool = nextDynamic(() => import("./tools/BuilderTool"), {
  ssr: false,
});

const ToolRouter = memo(function ToolRouter({ tool }: { tool: StudioTool }) {
  switch (tool) {
    case "chat":
      return <ChatTool />;
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
    case "builder":
      return <BuilderTool />;
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
    default:
      return <ImageTool />;
  }
});

const MODE_HEADLINE: Record<StudioMode, { title: string; subtitle: string }> = {
  command: {
    title: "Command Center",
    subtitle:
      "Talk, work, inspect status, and launch tools from one home base.",
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
      id: "qs-gen",
      label: "Generate an image",
      icon: Sparkles,
      tool: "image",
      prompt: "Generate an image of ",
    },
    { id: "qs-chat", label: "Open agent chat", icon: Sparkles, tool: "agents" },
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
  const [mode, setMode] = useState<StudioMode>("command");
  const [activeTool, setActiveTool] = useState<StudioTool>("image");
  const [selectedModel, setSelectedModel] = useState("adaptive");
  const [search, setSearch] = useState("");
  const [prompt, setPrompt] = useState("");
  const [recentActions, setRecentActions] = useState<
    { tool: StudioTool; label: string }[]
  >([]);

  // Mobile inspector sheet
  const [mobileInspector, setMobileInspector] = useState(false);

  // URL → tool (deep-link sync; the prev-comparison prevents redundant
  // re-renders that would otherwise fire on every router push).

  useEffect(() => {
    const toolParam = searchParams.get("tool") as StudioTool | null;
    if (toolParam) {
      setActiveTool((prev) => (prev === toolParam ? prev : toolParam));
    }
  }, [searchParams]);

  // Auth gate
  useEffect(() => {
    if (isLoaded && !isSignedIn) router.push("/sign-in?redirect_url=/studio");
  }, [isLoaded, isSignedIn, router]);

  const handleModeChange = (m: StudioMode) => {
    const tool = defaultToolForMode(m);
    setMode(m);
    setActiveTool(tool);
    router.push(`/studio?tool=${tool}`, { scroll: false });
  };

  const handleToolChange = (t: StudioTool) => {
    setActiveTool(t);
    router.push(`/studio?tool=${t}`, { scroll: false });
  };

  const handlePromptSubmit = () => {
    const text = prompt.trim();
    if (!text) return;
    setRecentActions((prev) =>
      [{ tool: activeTool, label: text.slice(0, 24) }, ...prev].slice(0, 5),
    );
    setPrompt("");
  };

  const handleAction = (a: DockAction) => {
    if (a.tool) handleToolChange(a.tool);
    if (a.prompt) setPrompt(a.prompt);
  };

  const headline = useMemo(() => MODE_HEADLINE[mode], [mode]);
  const quickstart = useMemo(() => MODE_QUICKSTART[mode], [mode]);

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
      className="h-[calc(100vh-4rem)] flex flex-col overflow-hidden"
      style={{
        background: `radial-gradient(circle at top, ${T.accentColor}14, transparent 30%), linear-gradient(180deg, ${T.bgColor} 0%, ${T.boxBg} 100%)`,
        color: T.textColor,
      }}
    >
      <StudioTopBar
        search={search}
        onSearchChange={setSearch}
        selectedModel={selectedModel}
        onModelChange={setSelectedModel}
        onInspectorToggle={() => setMobileInspector(true)}
        T={T}
      />

      <div className="flex-1 min-h-0 flex">
        <StudioSidebar
          activeTool={activeTool}
          onToolChange={handleToolChange}
        />

        <main className="flex-1 min-w-0 flex flex-col">
          {/* Mode header + switcher — hidden on mobile */}
          <div
            className="hidden md:flex items-center justify-between gap-2 px-3 sm:px-4 h-12 shrink-0"
            style={{
              backgroundColor: T.boxBg + "60",
              borderBottom: `1px solid ${T.borderColor}18`,
            }}
          >
            <div className="min-w-0">
              <div
                className="text-[9px] uppercase tracking-[0.25em]"
                style={{ color: T.textMuted }}
              >
                {mode === "command" ? "Default" : "Mode"} · {activeTool}
              </div>
              <div
                className="text-[12px] font-black truncate"
                style={{ color: T.headerColor }}
              >
                {headline.title}
              </div>
            </div>
            <div className="shrink-0">
              <StudioModeSwitcher
                active={mode}
                onChange={handleModeChange}
                T={T}
              />
            </div>
          </div>

          {/* Mobile mode switcher */}
          <div
            className="md:hidden px-3 py-2 flex items-center gap-2 overflow-x-auto"
            style={{ borderBottom: `1px solid ${T.borderColor}10` }}
          >
            <StudioModeSwitcher
              active={mode}
              onChange={handleModeChange}
              T={T}
            />
          </div>

          {/* Welcome strip (quickstart) — hidden on mobile to save space */}
          <div
            className="hidden sm:block px-3 sm:px-4 py-3 shrink-0"
            style={{ borderBottom: `1px solid ${T.borderColor}10` }}
          >
            <div className="flex items-end justify-between gap-3 mb-2">
              <div>
                <div
                  className="text-[9px] uppercase tracking-[0.25em]"
                  style={{ color: T.textMuted }}
                >
                  {headline.subtitle}
                </div>
                <div
                  className="text-[10px] font-bold mt-0.5"
                  style={{ color: T.textColor }}
                >
                  Quick start
                </div>
              </div>
            </div>
            <div className="flex gap-2 overflow-x-auto pb-0.5">
              {quickstart.map((q) => (
                <button
                  key={q.id}
                  onClick={() => handleAction(q)}
                  className="shrink-0 flex items-center gap-1.5 rounded-xl border px-2.5 py-1.5 text-[10px] font-bold transition-all hover:scale-[1.02]"
                  style={{
                    backgroundColor: T.bgColor + "65",
                    borderColor: T.borderColor + "25",
                    color: T.textColor,
                  }}
                >
                  <Sparkles size={10} style={{ color: T.accentColor }} />
                  {q.label}
                </button>
              ))}
            </div>
          </div>

          {/* Active tool */}
          <div
            className="flex-1 min-h-0 overflow-auto p-3 sm:p-4 pb-20 md:pb-4"
            style={{ color: T.textColor }}
          >
            <ToolRouter tool={activeTool} />
          </div>

          {/* Bottom command dock */}
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
        </main>

        {/* Desktop inspector */}
        <StudioInspector T={T} />
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
