"use client";

export const dynamic = "force-dynamic";

import { Suspense, useEffect, useState } from "react";
import nextDynamic from "next/dynamic";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Bot, Sparkles, Image as ImageIcon, PanelLeftClose } from "lucide-react";
import { useTheme } from "@/context/ThemeContext";
import { useClerkAuth } from "@/hooks/useClerkAuth";

const CanvasTool = nextDynamic(() => import("./tools/CanvasTool"), { ssr: false });
const AgentTool = nextDynamic(() => import("./tools/AgentTool"), { ssr: false });
const ImageTool = nextDynamic(() => import("./tools/ImageTool"), { ssr: false });

type Tool = "canvas" | "agents" | "image";

const TOOLS: { id: Tool; label: string; icon: typeof Bot; desc: string }[] = [
  { id: "canvas", label: "Canvas", icon: Sparkles, desc: "AI code builder with live preview" },
  { id: "agents", label: "Agents", icon: Bot, desc: "Chat with your AI team" },
  { id: "image", label: "Generate", icon: ImageIcon, desc: "Image generation studio" },
];

function StudioInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { resolvedColors: T } = useTheme();
  const { isLoaded, isSignedIn } = useClerkAuth();
  const toolParam = searchParams.get("tool") as Tool | null;
  const activeTool = toolParam && TOOLS.some((t) => t.id === toolParam) ? toolParam : "canvas";
  const [sidebarOpen, setSidebarOpen] = useState(true);

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

  const currentTool = TOOLS.find((t) => t.id === activeTool)!;

  return (
    <div className="flex h-[calc(100vh-4rem)] overflow-hidden" style={{ backgroundColor: T.bgColor, color: T.textColor }}>
      {/* Sidebar - Clean & Minimal */}
      <aside
        className={`flex flex-col border-r shrink-0 transition-all duration-300 ${sidebarOpen ? "w-52" : "w-14"}`}
        style={{ backgroundColor: T.boxBg + "90", borderColor: T.borderColor + "20" }}
      >
        <div className="flex items-center justify-between px-3 h-12 border-b" style={{ borderColor: T.borderColor + "18" }}>
          {sidebarOpen && <span className="text-xs font-black uppercase tracking-[0.2em]" style={{ color: T.headerColor }}>Studio</span>}
          <button onClick={() => setSidebarOpen((v) => !v)} className="p-1.5 rounded-lg hover:bg-white/5 ml-auto" style={{ color: T.textMuted }}>
            <PanelLeftClose size={14} />
          </button>
        </div>
        <nav className="flex-1 p-2 space-y-1">
          {TOOLS.map((tool) => {
            const Icon = tool.icon;
            const active = activeTool === tool.id;
            return (
              <button
                key={tool.id}
                onClick={() => { router.push(`/studio?tool=${tool.id}`, { scroll: false }); }}
                className={`group relative w-full flex items-center rounded-xl transition-all ${sidebarOpen ? "gap-2.5 px-3 py-2.5" : "justify-center px-2 py-2.5"}`}
                style={{
                  color: active ? T.accentColor : T.textColor + "99",
                  backgroundColor: active ? T.accentColor + "12" : "transparent",
                }}
              >
                {active && <span className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-5 rounded-r-full" style={{ backgroundColor: T.accentColor }} />}
                <Icon size={16} strokeWidth={active ? 2.5 : 1.8} className="shrink-0" />
                {sidebarOpen && (
                  <div className="flex-1 text-left">
                    <div className="text-xs font-bold">{tool.label}</div>
                    <div className="text-[9px] mt-0.5" style={{ color: T.textMuted }}>{tool.desc}</div>
                  </div>
                )}
              </button>
            );
          })}
        </nav>
        <div className="px-3 py-2.5 border-t" style={{ borderColor: T.borderColor + "12" }}>
          {sidebarOpen ? (
            <div className="flex items-center justify-between">
              <span className="text-[9px] font-mono opacity-40" style={{ color: T.textMuted }}>v2.0</span>
              <span className="flex items-center gap-1.5 text-[9px] font-mono" style={{ color: T.textMuted + "80" }}>
                <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: "#34d399" }} /> Online
              </span>
            </div>
          ) : (
            <div className="flex justify-center">
              <span className="w-2 h-2 rounded-full animate-pulse" style={{ backgroundColor: "#34d399" }} />
            </div>
          )}
        </div>
      </aside>

      {/* Main - Just the tool, no clutter */}
      <main className="flex-1 min-w-0 flex flex-col">
        <div className="flex items-center justify-between px-4 h-12 border-b shrink-0" style={{ backgroundColor: T.boxBg + "50", borderColor: T.borderColor + "18" }}>
          <div className="flex items-center gap-2">
            <currentTool.icon size={14} style={{ color: T.accentColor }} />
            <span className="text-sm font-bold" style={{ color: T.headerColor }}>{currentTool.label}</span>
          </div>
          <div className="text-[10px] opacity-50" style={{ color: T.textMuted }}>{currentTool.desc}</div>
        </div>
        <div className="flex-1 min-h-0 overflow-hidden">
          {activeTool === "canvas" && <CanvasTool />}
          {activeTool === "agents" && <AgentTool />}
          {activeTool === "image" && <ImageTool />}
        </div>
      </main>
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
