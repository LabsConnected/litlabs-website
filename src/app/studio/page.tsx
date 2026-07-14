"use client";

export const dynamic = "force-dynamic";

import { Suspense, memo, useCallback, useEffect, useRef, useState } from "react";
import nextDynamic from "next/dynamic";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useTheme } from "@/context/ThemeContext";
import { useClerkAuth } from "@/hooks/useClerkAuth";

import type { StudioTool } from "./components/StudioSidebar";
import StudioTopBar from "./components/StudioTopBar";
import StudioInspector from "./components/StudioInspector";
import StudioCommandDock, {
  type DockAction,
} from "./components/StudioCommandDock";
import { X } from "lucide-react";

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

function StudioCommandCenter() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { resolvedColors: T } = useTheme();
  const { isLoaded, isSignedIn } = useClerkAuth();

  // Top-level state
  const [activeTool, setActiveTool] = useState<StudioTool>("chat");
  const [selectedModel, setSelectedModel] = useState("adaptive");
  const [search, setSearch] = useState("");
  const [prompt, setPrompt] = useState("");
  const [recentActions, setRecentActions] = useState<
    { tool: StudioTool; label: string }[]
  >([]);
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);
  const [screenStream, setScreenStream] = useState<MediaStream | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [activeAgent, setActiveAgent] = useState<"auto" | "litt-code" | "little-bit">("auto");
  const streamRef = useRef<MediaStream | null>(null);
  const screenStreamRef = useRef<MediaStream | null>(null);

  // Mobile inspector sheet
  const [mobileInspector, setMobileInspector] = useState(false);

  // URL → tool (deep-link sync; the prev-comparison prevents redundant
  // re-renders that would otherwise fire on every router push).

  useEffect(() => {
    const toolParam = searchParams.get("tool") as StudioTool | null;
    if (toolParam) {
      const timer = window.setTimeout(
        () => setActiveTool((prev) => (prev === toolParam ? prev : toolParam)),
        0,
      );
      return () => window.clearTimeout(timer);
    }
  }, [searchParams]);

  // Auth gate
  useEffect(() => {
    if (isLoaded && !isSignedIn) router.push("/sign-in?redirect_url=/studio");
  }, [isLoaded, isSignedIn, router]);

  const handleToolChange = useCallback((t: StudioTool) => {
    setActiveTool(t);
    router.push(`/studio?tool=${t}`, { scroll: false });
  }, [router]);

  useEffect(() => () => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    screenStreamRef.current?.getTracks().forEach((track) => track.stop());
  }, []);

  const toggleCamera = useCallback(async () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      setCameraStream(null);
      setCameraError(null);
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 360 } },
        audio: false,
      });
      streamRef.current = stream;
      setCameraStream(stream);
      setCameraError(null);
    } catch {
      setCameraError("Camera permission is blocked or unavailable.");
    }
  }, []);

  const toggleScreen = useCallback(async () => {
    if (screenStreamRef.current) {
      screenStreamRef.current.getTracks().forEach((track) => track.stop());
      screenStreamRef.current = null;
      setScreenStream(null);
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
      screenStreamRef.current = stream;
      setScreenStream(stream);
      stream.getVideoTracks()[0]?.addEventListener("ended", () => {
        screenStreamRef.current = null;
        setScreenStream(null);
      }, { once: true });
    } catch {
      // The browser reports cancellation as an exception; keep the workspace unchanged.
    }
  }, []);

  const handlePromptSubmit = () => {
    const text = prompt.trim();
    if (!text) return;
    const aliases: Record<string, StudioTool> = {
      chat: "chat", image: "image", video: "video", audio: "audio",
      build: "builder", code: "builder", agents: "agents", terminal: "terminal",
      pipeline: "pipeline", cli: "clibridge", assets: "gallery",
      color: "color", space: "space",
    };
    const slash = text.match(/^\/(\S+)(?:\s+([\s\S]*))?$/);
    if (slash && aliases[slash[1].toLowerCase()]) {
      const tool = aliases[slash[1].toLowerCase()];
      handleToolChange(tool);
      const remainder = slash[2]?.trim() ?? "";
      if (tool === "chat" && remainder) {
        window.setTimeout(() => {
          window.dispatchEvent(new CustomEvent("litt:studio-command", { detail: { text: remainder, agent: activeAgent } }));
        }, 80);
      }
      setPrompt(remainder && tool !== "chat" ? remainder : "");
      return;
    }
    if (activeTool !== "chat") handleToolChange("chat");
    window.setTimeout(() => {
      window.dispatchEvent(new CustomEvent("litt:studio-command", { detail: { text, agent: activeAgent } }));
    }, activeTool === "chat" ? 0 : 80);
    setRecentActions((prev) =>
      [{ tool: "chat" as StudioTool, label: text.slice(0, 24) }, ...prev].slice(0, 5),
    );
    setPrompt("");
  };

  const handleAction = (a: DockAction) => {
    if (a.tool) handleToolChange(a.tool);
    if (a.prompt) setPrompt(a.prompt);
  };

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
      <StudioTopBar
        search={search}
        onSearchChange={setSearch}
        selectedModel={selectedModel}
        onModelChange={setSelectedModel}
        onInspectorToggle={() => setMobileInspector(true)}
        T={T}
      />

      <div className="flex-1 min-h-0 flex">
        <main className="flex-1 min-w-0 flex flex-col">
          {/* Active tool */}
          <div
            className="flex-1 min-h-0 overflow-auto p-2 sm:p-3"
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
            cameraOn={Boolean(cameraStream)}
            onCameraToggle={() => void toggleCamera()}
            screenOn={Boolean(screenStream)}
            onScreenToggle={() => void toggleScreen()}
            activeAgent={activeAgent}
            onAgentChange={setActiveAgent}
            onOpenPlugins={() => router.push("/settings?tab=keys")}
            T={T}
          />
        </main>

        {/* Desktop inspector */}
        <StudioInspector
          cameraStream={cameraStream}
          screenStream={screenStream}
          cameraError={cameraError}
          onCameraToggle={() => void toggleCamera()}
          onScreenToggle={() => void toggleScreen()}
          T={T}
        />
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
              cameraStream={cameraStream}
              screenStream={screenStream}
              cameraError={cameraError}
              onCameraToggle={() => void toggleCamera()}
              onScreenToggle={() => void toggleScreen()}
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
