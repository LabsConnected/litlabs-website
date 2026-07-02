"use client";

export const dynamic = "force-dynamic";

import {
  Suspense,
  memo,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import nextDynamic from "next/dynamic";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Activity,
  Bot,
  Monitor,
  PanelLeftClose,
  PanelRightClose,
  SquareTerminal,
  Sparkles,
  Workflow,
} from "lucide-react";
import { useTheme } from "@/context/ThemeContext";
import { useClerkAuth } from "@/hooks/useClerkAuth";
import { StudioTool } from "./components/StudioSidebar";
import ModelPicker from "@/components/ModelPicker";
import KeyManager from "@/components/KeyManager";
import { CHAT_ROOMS } from "@/lib/chatRooms";
import { THEMES } from "@/lib/themes";

const ImageTool = nextDynamic(() => import("./tools/ImageTool"), { ssr: false });
const VideoTool = nextDynamic(() => import("./tools/VideoTool"), { ssr: false });
const AudioTool = nextDynamic(() => import("./tools/AudioTool"), { ssr: false });
const AgentTool = nextDynamic(() => import("./tools/AgentTool"), { ssr: false });
const AgentsTerminalTool = nextDynamic(() => import("./tools/AgentsTerminalTool"), {
  ssr: false,
});
const CLIBridgeTool = nextDynamic(() => import("./tools/CLIBridgeTool"), {
  ssr: false,
});
const GalleryTool = nextDynamic(() => import("./tools/GalleryTool"), {
  ssr: false,
});
const SpaceTool = nextDynamic(() => import("./tools/SpaceTool"), { ssr: false });
const PipelineTool = nextDynamic(() => import("./tools/PipelineTool"), {
  ssr: false,
});

type WorkspaceTab = "agent" | "model" | "terminal" | "workflow" | "context";

const TOOL_TO_TAB: Record<StudioTool, WorkspaceTab> = {
  image: "model",
  video: "workflow",
  audio: "context",
  agents: "agent",
  terminal: "terminal",
  pipeline: "workflow",
  gallery: "context",
  space: "context",
  clibridge: "terminal",
};

const TAB_ICONS: Record<WorkspaceTab, ReactNode> = {
  agent: <Bot size={14} />,
  model: <Sparkles size={14} />,
  terminal: <SquareTerminal size={14} />,
  workflow: <Workflow size={14} />,
  context: <Activity size={14} />,
};

const CREATIVE_TEMPLATES = [
  {
    title: "Color by Number",
    desc: "Build printable paint-by-number pages with bold regions and simple palettes.",
    badge: "Art + Print",
    action: "Open Image Tool",
    tool: "image" as StudioTool,
  },
  {
    title: "Mini Game Kit",
    desc: "Start a clicker, memory match, quiz, or arcade idea from a game prompt.",
    badge: "Games",
    action: "Open Pipeline",
    tool: "pipeline" as StudioTool,
  },
  {
    title: "Character Sheet",
    desc: "Generate heroes, villains, mascots, and stickers for games or stories.",
    badge: "Characters",
    action: "Open Image Tool",
    tool: "image" as StudioTool,
  },
  {
    title: "Maze & Puzzle Pages",
    desc: "Create mazes, dot-to-dot sheets, and activity pages for kids or fans.",
    badge: "Activities",
    action: "Open Gallery",
    tool: "gallery" as StudioTool,
  },
];

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

function WorkspaceCard({
  title,
  subtitle,
  children,
  T,
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
  T: ReturnType<typeof useTheme>["resolvedColors"];
}) {
  return (
    <section
      className="rounded-3xl border overflow-hidden"
      style={{
        background:
          `linear-gradient(180deg, ${T.boxBg}f0 0%, ${T.bgColor}f0 100%)`,
        borderColor: T.borderColor + "24",
        boxShadow: `0 24px 80px ${T.bgColor}80`,
      }}
    >
      <div className="flex items-center justify-between gap-3 border-b px-4 py-3" style={{ borderColor: T.borderColor + "18" }}>
        <div>
          <div className="text-sm font-black uppercase tracking-[0.18em]" style={{ color: T.headerColor }}>
            {title}
          </div>
          <div className="text-[11px] mt-1" style={{ color: T.textMuted }}>
            {subtitle}
          </div>
        </div>
      </div>
      <div>{children}</div>
    </section>
  );
}

function TerminalDrawer({ open, onToggle, T }: { open: boolean; onToggle: () => void; T: ReturnType<typeof useTheme>["resolvedColors"] }) {
  const [command, setCommand] = useState("");
  const [history, setHistory] = useState<string[]>([
    "workspace boot complete",
    "model router online",
    "terminal bridge ready",
  ]);

  return (
    <div
      className={`border-t transition-all duration-300 ${open ? "h-60" : "h-12"}`}
      style={{ backgroundColor: T.boxBg + "c0", borderColor: T.borderColor + "24" }}
    >
      <button onClick={onToggle} className="flex w-full items-center justify-between px-4 h-12 text-xs font-bold uppercase tracking-[0.2em]" style={{ color: T.textMuted }}>
        <span className="flex items-center gap-2"><Monitor size={13} /> Terminal</span>
        <span>{open ? <PanelRightClose size={14} /> : <PanelLeftClose size={14} />}</span>
      </button>
      {open && (
        <div className="grid h-[calc(100%-3rem)] grid-rows-[1fr_auto] gap-3 px-4 pb-4">
          <div className="overflow-auto rounded-2xl border p-3 font-mono text-xs" style={{ backgroundColor: T.bgColor + "88", borderColor: T.borderColor + "22" }}>
            {history.map((line, i) => (
              <div key={i} className="mb-1" style={{ color: i % 2 === 0 ? T.textColor : T.textMuted }}>
                <span style={{ color: T.accentColor }}>$</span> {line}
              </div>
            ))}
          </div>
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (!command.trim()) return;
              setHistory((prev) => [...prev, command.trim()]);
              setCommand("");
            }}
          >
            <input
              value={command}
              onChange={(e) => setCommand(e.target.value)}
              placeholder="Run a command, ask for a task, or trigger a tool..."
              className="min-w-0 flex-1 rounded-xl border px-3 py-2 text-sm outline-none"
              style={{ backgroundColor: T.bgColor + "60", borderColor: T.borderColor + "26", color: T.textColor }}
            />
            <button className="rounded-xl px-4 py-2 text-sm font-bold" style={{ backgroundColor: T.accentColor, color: "#fff" }}>
              Run
            </button>
          </form>
        </div>
      )}
    </div>
  );
}

function StudioInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { resolvedColors: T } = useTheme();
  const { isLoaded, isSignedIn } = useClerkAuth();
  const [selectedModel, setSelectedModel] = useState("adaptive");
  const [activeTool, setActiveTool] = useState<StudioTool>("image");
  const [activeTab, setActiveTab] = useState<WorkspaceTab>("model");
  const [terminalOpen, setTerminalOpen] = useState(true);
  const [litcoins] = useState(() => 500);
  const [leftRailOpen, setLeftRailOpen] = useState(true);
  const [rightRailOpen, setRightRailOpen] = useState(true);

  useEffect(() => {
    const toolParam = searchParams.get("tool") as StudioTool | null;
    if (toolParam && toolParam in TOOL_TO_TAB) {
      setActiveTool(toolParam);
      setActiveTab(TOOL_TO_TAB[toolParam]);
    }
  }, [searchParams]);

  useEffect(() => {
    if (isLoaded && !isSignedIn) router.push("/sign-in?redirect_url=/studio");
  }, [isLoaded, isSignedIn, router]);

  if (!isLoaded) {
    return <div className="min-h-screen grid place-items-center" style={{ backgroundColor: T.bgColor, color: T.accentColor }}>Loading Studio...</div>;
  }

  if (!isSignedIn) {
    return (
      <div className="min-h-[60vh] grid place-items-center">
        <Link href="/sign-in?redirect_url=/studio" className="rounded-xl px-4 py-2 font-bold text-white" style={{ backgroundColor: T.accentColor }}>
          Sign in to continue
        </Link>
      </div>
    );
  }

  return (
    <div className="min-h-[calc(100vh-4rem)] overflow-hidden" style={{ background: `radial-gradient(circle at top, ${T.accentColor}18, transparent 30%), linear-gradient(180deg, ${T.bgColor} 0%, ${T.boxBg} 100%)`, color: T.textColor }}>
      <div className="grid min-h-[calc(100vh-4rem)] grid-cols-1 xl:grid-cols-[240px_minmax(0,1fr)_300px]">
        <aside className={`border-r ${leftRailOpen ? "block" : "hidden xl:block"}`} style={{ backgroundColor: T.boxBg + "88", borderColor: T.borderColor + "20" }}>
          <div className="flex items-center justify-between border-b px-4 py-3" style={{ borderColor: T.borderColor + "18" }}>
            <div className="text-sm font-black uppercase tracking-[0.2em]" style={{ color: T.headerColor }}>Studio</div>
            <button onClick={() => setLeftRailOpen((v) => !v)} className="rounded-lg p-2" style={{ color: T.textMuted }}>
              <PanelLeftClose size={14} />
            </button>
          </div>
          <div className="p-4 space-y-4">
            <div className="rounded-2xl border p-4" style={{ backgroundColor: T.bgColor + "65", borderColor: T.borderColor + "22" }}>
              <div className="text-[10px] uppercase tracking-[0.2em]" style={{ color: T.textMuted }}>Current model</div>
              <div className="mt-2">
                <ModelPicker selectedModel={selectedModel} onModelChange={setSelectedModel} recentModels={["adaptive", "gpt-4o", "claude-3.5-sonnet"]} />
              </div>
            </div>
            <div className="rounded-2xl border p-4" style={{ backgroundColor: T.bgColor + "65", borderColor: T.borderColor + "22" }}>
              <div className="text-[10px] uppercase tracking-[0.2em]" style={{ color: T.textMuted }}>Rooms</div>
              <div className="mt-3 space-y-2">
                {CHAT_ROOMS.map((room) => (
                  <div key={room.id} className="rounded-xl border px-3 py-2" style={{ borderColor: T.borderColor + "18" }}>
                    <div className="text-sm font-bold">{room.label}</div>
                    <div className="mt-1 text-[11px]" style={{ color: T.textMuted }}>{room.description}</div>
                  </div>
                ))}
              </div>
            </div>
            <div className="rounded-2xl border p-4" style={{ backgroundColor: T.bgColor + "65", borderColor: T.borderColor + "22" }}>
              <div className="text-[10px] uppercase tracking-[0.2em]" style={{ color: T.textMuted }}>Session</div>
              <div className="mt-3 space-y-3 text-sm">
                <div className="flex items-center justify-between"><span>Coins</span><span style={{ color: T.accentColor }}>{litcoins.toLocaleString()}</span></div>
                <div className="flex items-center justify-between"><span>Status</span><span style={{ color: "#34d399" }}>Ready</span></div>
                <div className="flex items-center justify-between"><span>Mode</span><span>Hybrid</span></div>
              </div>
            </div>
            <div className="space-y-2">
              {(Object.entries(TOOL_TO_TAB) as [StudioTool, WorkspaceTab][]).map(([tool, tab]) => {
                const active = activeTool === tool;
                return (
                  <button
                    key={tool}
                    onClick={() => {
                      setActiveTool(tool);
                      setActiveTab(tab);
                      router.push(`/studio?tool=${tool}`, { scroll: false });
                    }}
                    className="flex w-full items-center justify-between rounded-2xl border px-4 py-3 text-left transition-transform hover:scale-[1.01]"
                    style={{ backgroundColor: active ? T.accentColor + "16" : T.bgColor + "50", borderColor: active ? T.accentColor + "35" : T.borderColor + "20" }}
                  >
                    <span className="flex items-center gap-2">
                      <Sparkles size={13} />
                      <span className="text-sm font-bold capitalize">{tool}</span>
                    </span>
                    <span className="text-[10px] uppercase tracking-[0.2em]" style={{ color: T.textMuted }}>{tab}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </aside>

        <main className="min-w-0 flex flex-col">
          <div className="flex items-center justify-between gap-3 border-b px-4 py-3" style={{ backgroundColor: T.boxBg + "72", borderColor: T.borderColor + "20" }}>
            <div>
              <div className="text-[10px] uppercase tracking-[0.25em]" style={{ color: T.textMuted }}>Premium Studio Workspace</div>
              <div className="text-lg font-black">Hybrid creator cockpit</div>
            </div>
            <div className="hidden md:block">
              <ModelPicker selectedModel={selectedModel} onModelChange={setSelectedModel} recentModels={["adaptive", "gpt-4o", "claude-3.5-sonnet"]} />
            </div>
          </div>

          <div className="border-b px-4 py-4" style={{ borderColor: T.borderColor + "18" }}>
            <div className="flex items-end justify-between gap-3 mb-3">
              <div>
                <div className="text-[10px] uppercase tracking-[0.25em]" style={{ color: T.textMuted }}>Creative launcher</div>
                <div className="text-sm font-bold" style={{ color: T.headerColor }}>Start with a template</div>
              </div>
              <div className="text-[10px] opacity-50 hidden md:block">Games, coloring pages, printables, and more</div>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              {CREATIVE_TEMPLATES.map((item) => (
                <button
                  key={item.title}
                  onClick={() => {
                    setActiveTool(item.tool);
                    setActiveTab(TOOL_TO_TAB[item.tool]);
                    router.push(`/studio?tool=${item.tool}`, { scroll: false });
                  }}
                  className="rounded-2xl border p-4 text-left transition-all hover:-translate-y-0.5"
                  style={{ backgroundColor: T.bgColor + "70", borderColor: T.borderColor + "28" }}
                >
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <span className="text-[10px] font-bold uppercase tracking-[0.2em]" style={{ color: T.accentColor }}>{item.badge}</span>
                    <span className="text-[10px] opacity-40">{item.action}</span>
                  </div>
                  <div className="font-bold mb-1">{item.title}</div>
                  <p className="text-xs leading-relaxed opacity-60">{item.desc}</p>
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-2 border-b px-4 py-3 overflow-x-auto" style={{ borderColor: T.borderColor + "18" }}>
            {(Object.keys(TAB_ICONS) as WorkspaceTab[]).map((tab) => {
              const active = activeTab === tab;
              return (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  className="flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-bold capitalize transition-all"
                  style={{ backgroundColor: active ? T.accentColor + "18" : "transparent", borderColor: active ? T.accentColor + "35" : T.borderColor + "20", color: active ? T.accentColor : T.textColor }}
                >
                  {TAB_ICONS[tab]}
                  {tab}
                </button>
              );
            })}
          </div>

          <div className="min-h-0 flex-1 overflow-auto p-4">
            <WorkspaceCard title="Workspace" subtitle={`Active tab: ${activeTab}`} T={T}>
              <div className="p-4">
                {activeTab === "agent" && <ToolRouter tool="agents" />}
                {activeTab === "model" && <ToolRouter tool={activeTool === "terminal" ? "image" : activeTool} />}
                {activeTab === "terminal" && <ToolRouter tool="terminal" />}
                {activeTab === "workflow" && <ToolRouter tool="pipeline" />}
                {activeTab === "context" && <ToolRouter tool="gallery" />}
              </div>
            </WorkspaceCard>
          </div>

          <TerminalDrawer open={terminalOpen} onToggle={() => setTerminalOpen((v) => !v)} T={T} />
        </main>

        <aside className={`border-l ${rightRailOpen ? "block" : "hidden xl:block"}`} style={{ backgroundColor: T.boxBg + "88", borderColor: T.borderColor + "20" }}>
          <div className="flex items-center justify-between border-b px-4 py-3" style={{ borderColor: T.borderColor + "18" }}>
            <div className="text-sm font-black uppercase tracking-[0.2em]" style={{ color: T.headerColor }}>Control panel</div>
            <button onClick={() => setRightRailOpen((v) => !v)} className="rounded-lg p-2" style={{ color: T.textMuted }}>
              <PanelRightClose size={14} />
            </button>
          </div>
          <div className="space-y-4 p-4">
            <KeyManager />
            <div className="rounded-2xl border p-4" style={{ backgroundColor: T.bgColor + "65", borderColor: T.borderColor + "22" }}>
              <div className="text-[10px] uppercase tracking-[0.2em]" style={{ color: T.textMuted }}>Quick stats</div>
              <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
                <div className="rounded-xl border p-3" style={{ borderColor: T.borderColor + "18" }}><div className="text-xs" style={{ color: T.textMuted }}>Tools</div><div className="mt-1 text-lg font-black">8</div></div>
                <div className="rounded-xl border p-3" style={{ borderColor: T.borderColor + "18" }}><div className="text-xs" style={{ color: T.textMuted }}>Tabs</div><div className="mt-1 text-lg font-black">5</div></div>
              </div>
            </div>
            <div className="rounded-2xl border p-4" style={{ backgroundColor: T.bgColor + "65", borderColor: T.borderColor + "22" }}>
              <div className="text-[10px] uppercase tracking-[0.2em]" style={{ color: T.textMuted }}>Themes</div>
              <div className="mt-3 grid gap-2">
                {THEMES.map((theme) => (
                  <div key={theme.id} className="flex items-center justify-between rounded-xl border px-3 py-2" style={{ borderColor: T.borderColor + "18" }}>
                    <span className="text-sm font-bold">{theme.name}</span>
                    <span className="h-3 w-3 rounded-full" style={{ backgroundColor: theme.accent }} />
                  </div>
                ))}
              </div>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}

export default function StudioPage() {
  return (
    <Suspense fallback={<div className="min-h-screen grid place-items-center">Loading Studio...</div>}>
      <StudioInner />
    </Suspense>
  );
}
