"use client";

import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import dynamic from "next/dynamic";
import { useTheme } from "@/context/ThemeContext";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import StudioSidebar, { type StudioTool } from "./StudioSidebar";
import StudioTopBar from "./StudioTopBar";

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
const AgentTool = dynamic(() => import("../tools/AgentTool"), { ssr: false });
const TerminalTool = dynamic(() => import("../tools/AgentsTerminalTool"), {
  ssr: false,
});
const PipelineTool = dynamic(() => import("../tools/PipelineTool"), {
  ssr: false,
});
const GalleryTool = dynamic(() => import("../tools/GalleryTool"), {
  ssr: false,
});
const CanvasTool = dynamic(() => import("../tools/CanvasTool"), { ssr: false });
const CLIBridgeTool = dynamic(() => import("../tools/CLIBridgeTool"), {
  ssr: false,
});
const ColorByNumberTool = dynamic(() => import("../tools/ColorByNumberTool"), {
  ssr: false,
});
const SpaceTool = dynamic(() => import("../tools/SpaceTool"), { ssr: false });

const TOOL_COMPONENTS: Record<StudioTool, React.ComponentType> = {
  chat: ChatTool,
  image: ImageTool,
  video: VideoTool,
  audio: AudioTool,
  builder: BuilderTool,
  agents: AgentTool,
  terminal: TerminalTool,
  pipeline: PipelineTool,
  gallery: GalleryTool,
  canvas: CanvasTool,
  clibridge: CLIBridgeTool,
  color: ColorByNumberTool,
  space: SpaceTool,
};

const VALID_TOOLS = Object.keys(TOOL_COMPONENTS) as StudioTool[];
const MODEL_PREF_KEY = "littree:studio:model";

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
    return "chat";
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
  const scrollRef = useRef<HTMLDivElement>(null);
  const isInitialMount = useRef(true);

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
    if (activeTool !== "chat") params.set("tool", activeTool);
    else params.delete("tool");
    if (model !== "adaptive") params.set("model", model);
    else params.delete("model");
    const query = params.toString();
    router.replace(`${pathname}${query ? `?${query}` : ""}`, { scroll: false });
  }, [activeTool, model, pathname, router, searchParams]);

  const ActiveTool = useMemo(
    () => TOOL_COMPONENTS[activeTool] || ChatTool,
    [activeTool],
  );

  const handleToolChange = useCallback(
    (tool: StudioTool) => {
      setActiveTool(tool);
    },
    [setActiveTool],
  );

  return (
    <div
      className="flex h-full w-full flex-col overflow-hidden"
      style={{ backgroundColor: T.bgColor, color: T.textColor }}
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
            className="flex-1 min-h-0 overflow-auto p-2 pb-[calc(3.5rem+env(safe-area-inset-bottom))] sm:p-3 md:pb-2"
          >
            {activeTool === "chat" ? (
              <ChatTool selectedModel={model} />
            ) : (
              <ActiveTool />
            )}
          </div>
        </main>

        <StudioInspector variant="aside" T={T} />
      </div>

      {inspectorOpen && (
        <div className="fixed inset-0 z-10000 md:hidden">
          <div
            className="absolute inset-0 bg-black/60"
            onClick={() => setInspectorOpen(false)}
          />
          <div className="absolute right-0 top-0 h-full w-[280px]">
            <StudioInspector
              variant="sheet"
              onClose={() => setInspectorOpen(false)}
              T={T}
            />
          </div>
        </div>
      )}
    </div>
  );
}
