"use client";

export const dynamic = "force-dynamic";

import { Suspense, memo, useEffect, useState } from "react";
import nextDynamic from "next/dynamic";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useTheme } from "@/context/ThemeContext";
import { useClerkAuth } from "@/hooks/useClerkAuth";

import { type StudioTool } from "./components/StudioSidebar";
import StudioTopRuntimeBar from "./components/StudioTopRuntimeBar";
import StudioIconRail from "./components/StudioIconRail";
import StudioInspectorPanel from "./components/StudioInspectorPanel";
import StudioInspector from "./components/StudioInspector";

import { Sparkles, X, Coins, Settings, Bot, ArrowRight } from "lucide-react";
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
      return <ChatTool />;
  }
});

const CANONICAL_TOOL: Partial<Record<StudioTool, StudioTool>> = {
  image: "chat",
  agents: "chat",
  builder: "chat",
  terminal: "chat",
  clibridge: "chat",
  pipeline: "chat",
  canvas: "chat",
};

function StudioCommandCenter() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { resolvedColors: T } = useTheme();
  const { isLoaded, isSignedIn } = useClerkAuth();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // Top-level state
  const [activeTool, setActiveTool] = useState<StudioTool>("chat");
  const [selectedModel, setSelectedModel] = useState("adaptive");

  // Mobile inspector sheet
  const [mobileInspector, setMobileInspector] = useState(false);

  const { balance, isLoading: walletLoading } = useWallet();

  // URL → tool (deep-link sync; the prev-comparison prevents redundant
  // re-renders that would otherwise fire on every router push).

  useEffect(() => {
    const toolParam = searchParams.get("tool") as StudioTool | null;
    if (toolParam) {
      const next = CANONICAL_TOOL[toolParam] ?? toolParam;
      setActiveTool((prev) => (prev === next ? prev : next));
      if (next !== toolParam) {
        router.replace(`/studio?tool=${next}`, { scroll: false });
      }
    }
  }, [router, searchParams]);

  const handleToolChange = (t: StudioTool) => {
    const next = CANONICAL_TOOL[t] ?? t;
    setActiveTool(next);
    router.push(`/studio?tool=${next}`, { scroll: false });
  };

  if (!mounted || !isLoaded) {
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
      <div
        className="grid min-h-[calc(100vh-64px)] place-items-center px-4"
        style={{
          background: `radial-gradient(circle at 50% 0%, ${T.accentColor}18, transparent 34%), ${T.bgColor}`,
          color: T.textColor,
        }}
      >
        <div className="w-full max-w-3xl text-center">
          <div
            className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-2xl border"
            style={{
              backgroundColor: T.boxBg,
              borderColor: T.borderColor + "35",
              boxShadow: `0 0 32px ${T.accentColor}22`,
            }}
          >
            <Bot size={28} style={{ color: T.accentColor }} />
          </div>
          <p
            className="mb-3 text-xs font-black uppercase tracking-[0.28em]"
            style={{ color: T.accentColor }}
          >
            LiTTree Agent
          </p>
          <h1
            className="mx-auto mb-4 max-w-2xl text-3xl font-black tracking-tight sm:text-5xl"
            style={{ color: T.headerColor }}
          >
            One command box for images, apps, agents, and deploys.
          </h1>
          <p
            className="mx-auto mb-7 max-w-xl text-sm leading-relaxed sm:text-base"
            style={{ color: T.textMuted }}
          >
            The old Image Studio now routes into LiTTree Agent. Type a prompt like
            “generate a hero image” and the image comes back inside the same chat.
          </p>
          <div className="mb-7 flex flex-wrap justify-center gap-2">
            {[
              "Generate image",
              "Build app",
              "Fix code",
              "Create agent",
              "Open terminal",
            ].map((label) => (
              <span
                key={label}
                className="rounded-full border px-3 py-1.5 text-xs font-bold"
                style={{
                  backgroundColor: T.boxBg + "aa",
                  borderColor: T.borderColor + "30",
                  color: T.textColor,
                }}
              >
                {label}
              </span>
            ))}
          </div>
          <Link
            href="/sign-in?redirect_url=/studio?tool=chat"
            className="inline-flex items-center gap-2 rounded-xl px-5 py-3 text-sm font-black text-black transition-transform hover:scale-[1.02]"
            style={{ backgroundColor: T.accentColor }}
          >
            Sign in to launch Studio <ArrowRight size={16} />
          </Link>
        </div>
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
        <StudioTopRuntimeBar
          selectedModel={selectedModel}
          onModelChange={setSelectedModel}
          onMenuToggle={() => {}}
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
        <StudioIconRail
          activeTool={activeTool as string}
          onToolChange={(tool) => handleToolChange(tool as StudioTool)}
        />

        <main className="flex-1 min-w-0 flex flex-col overflow-hidden">
          {/* Active tool fills center canvas */}
          <div className="flex-1 min-h-0 overflow-hidden">
            <ToolRouter tool={activeTool} />
          </div>
        </main>

        {/* Desktop inspector — hidden on mobile and collapsible */}
        <div className="hidden lg:block">
          <StudioInspectorPanel />
        </div>
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
