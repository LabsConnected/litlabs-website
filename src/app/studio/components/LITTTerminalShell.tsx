"use client";

import {
  useState,
  useRef,
  useEffect,
  useCallback,
  useMemo,
  type ComponentType,
} from "react";
import type { TerminalStatus, TerminalToolHandle } from "../tools/TerminalTool";
import {
  createTerminalBlock,
  updateTerminalBlock,
  type TerminalBlock,
} from "@/app/studio/lib/builder-blocks";
import { useRouter, useSearchParams } from "next/navigation";
import { UserButton } from "@clerk/nextjs";
import { useTheme } from "@/context/ThemeContext";
import { useProfile } from "@/context/ProfileContext";
import { useVoiceSession } from "@/app/studio/context/VoiceSessionContext";
import { cn } from "@/lib/utils";
import { parseLiTTActions } from "@/lib/litt-context";
import { AGENTS } from "@/lib/agents";
import { AGENT_AVATAR_META } from "@/lib/avatars";
export type StudioTool =
  | "chat"
  | "image"
  | "video"
  | "audio"
  | "agents"
  | "terminal"
  | "builder"
  | "pipeline"
  | "gallery"
  | "canvas"
  | "clibridge"
  | "color"
  | "space"
  | "loops";


import {
  Terminal,
  FolderKanban,
  Bot,
  FolderOpen,
  Settings,
  Send,
  Plus,
  Upload,
  Camera,
  ScreenShare,
  Mic,
  MicOff,
  X,
  Sparkles,
  LayoutGrid,
  Zap,
  Copy,
  Check,
  Square,
  Loader2,
  Image as ImageIcon,
  Film,
  Music,
  Hammer,
  Code,
  Rocket,
  Menu,
} from "lucide-react";

import dynamic from "next/dynamic";

const PluginPanel = dynamic(() => import("./PluginPanel"), { ssr: false });
const CameraSession = dynamic(() => import("./CameraSession"), { ssr: false });
const ReactMarkdown = dynamic(() => import("react-markdown"), {
  ssr: false,
  loading: () => <span className="text-gray-300">…</span>,
});
const PersonaSwitcher = dynamic(
  () =>
    import("@/components/terminal/PersonaSwitcher").then(
      (m) => m.PersonaSwitcher,
    ),
  { ssr: false },
);
import {
  PersonaProvider,
  usePersona,
} from "@/components/terminal/PersonaContext";

const ImageTool = dynamic(() => import("../tools/ImageTool"), { ssr: false });
const VideoTool = dynamic(() => import("../tools/VideoTool"), { ssr: false });
const AudioTool = dynamic(() => import("../tools/AudioTool"), { ssr: false });
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
const SpaceTool = dynamic(() => import("../tools/SpaceTool"), { ssr: false });
const LoopsTool = dynamic(() => import("../tools/LoopsTool"), { ssr: false });
const TerminalTool = dynamic(() => import("../tools/TerminalTool"), {
  ssr: false,
  loading: () => (
    <div className="p-4 text-xs text-neutral-500">Loading terminal…</div>
  ),
});

const ChatShell = dynamic(() => import("./ChatShell"), { ssr: false });
const ImageGenPopover = dynamic(() => import("./ImageGenPopover"), {
  ssr: false,
});
const ProjectDrawer = dynamic(() => import("./ProjectDrawer"), {
  ssr: false,
});

type Message = {
  role: "user" | "assistant";
  content: string;
  createdAt?: number;
  type?: "text" | "image" | "video" | "audio" | "error";
  mediaUrl?: string;
  status?: string;
};

type Attachment = {
  url: string; // data URL
  name: string;
  type: string;
};

type ToolRailItem = {
  id: string;
  label: string;
  icon: typeof Terminal;
  tool?: StudioTool;
  href?: string;
  drawer?: "projects";
};

const TOOL_RAIL: ToolRailItem[] = [
  { id: "builder", label: "Create", icon: Hammer, tool: "builder" },
  { id: "projects", label: "Projects", icon: FolderKanban, drawer: "projects" },
  { id: "assets", label: "Assets", icon: FolderOpen, tool: "gallery" },
  { id: "video", label: "Video", icon: Film, tool: "video" },
  { id: "audio", label: "Audio", icon: Music, tool: "audio" },
  { id: "canvas", label: "Code", icon: Code, tool: "canvas" },
  { id: "terminal", label: "Terminal", icon: Terminal, tool: "terminal" },
  { id: "pipeline", label: "Pipeline", icon: LayoutGrid, tool: "pipeline" },
  { id: "loops", label: "Loops", icon: Zap, tool: "loops" },
  { id: "space", label: "Space", icon: Rocket, tool: "space" },
  { id: "clibridge", label: "CLI", icon: Terminal, tool: "clibridge" },
  { id: "settings", label: "Settings", icon: Settings, href: "/settings" },
];


const SLASH_CHIPS: {
  id: string;
  label: string;
  desc: string;
  tool: StudioTool;
}[] = [
  { id: "image", label: "/image", desc: "Generate Image", tool: "image" },
  { id: "video", label: "/video", desc: "Generate Video", tool: "video" },
  { id: "audio", label: "/audio", desc: "Generate Audio", tool: "audio" },
  { id: "build", label: "/build", desc: "Build Anything", tool: "builder" },
  { id: "code", label: "/code", desc: "Generate Code", tool: "canvas" },
  { id: "agent", label: "/agent", desc: "Run Agent", tool: "builder" },
  { id: "terminal", label: "/terminal", desc: "Open Terminal", tool: "terminal" },
];

const QUICK_START = ["Show me around", "Help me build", "Analyze this"];

const AGENT_QUICK: Record<string, string[]> = {
  littcode: [
    "Write a React component for a chat interface",
    "Debug: TypeError cannot read property of undefined",
    "Explain async/await vs Promises",
  ],
  littlebit: [
    "Build me an agent system for my business",
    "Create a 30-day AI roadmap for me",
    "Write 5 viral Twitter threads about AI",
    "Generate a prompt for album cover art",
    "Create a brand color palette for a tech startup",
    "Set up an automation: lights on at sunset",
    "Create a webhook integration for my app",
  ],
};

const TOOL_COMPONENTS: Partial<Record<
  Exclude<StudioTool, "chat" | "agents" | "builder">,
  ComponentType
>> = {
  image: ImageTool,
  video: VideoTool,
  audio: AudioTool,
  terminal: TerminalTool,
  pipeline: PipelineTool,
  gallery: GalleryTool,
  canvas: CanvasTool,
  clibridge: CLIBridgeTool,
  space: SpaceTool,
  loops: LoopsTool,
};


const PLUGINS = [
  "git",
  "docker",
  "k8s",
  "aws",
  "supabase",
  "linear",
  "sentry",
  "vercel",
];

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {}
  };
  return (
    <button
      onClick={handleCopy}
      className="flex items-center gap-1 text-[9px] transition hover:text-cyan-400"
      title="Copy"
    >
      {copied ? (
        <Check size={10} aria-hidden="true" />
      ) : (
        <Copy size={10} aria-hidden="true" />
      )}
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

function LiTTAvatar({ size = 80 }: { size?: number }) {
  return (
    <div
      className="relative grid shrink-0 place-items-center"
      style={{ width: size, height: size }}
    >
      {/* Outer glow */}
      <div
        className="absolute inset-0 rounded-full blur-xl"
        style={{
          background:
            "radial-gradient(circle, rgba(34,211,238,0.35) 0%, transparent 70%)",
          transform: "scale(1.4)",
        }}
      />
      {/* Rotating ring */}
      <div
        className="absolute inset-0 rounded-full"
        style={{
          border: "1.5px solid rgba(34,211,238,0.25)",
          boxShadow:
            "0 0 24px rgba(34,211,238,0.15), inset 0 0 24px rgba(34,211,238,0.08)",
          animation: "spin 12s linear infinite",
        }}
      />
      <div
        className="absolute inset-[8px] rounded-full"
        style={{
          background:
            "radial-gradient(circle at 30% 30%, rgba(34,211,238,0.18) 0%, rgba(6,182,212,0.05) 50%, transparent 80%)",
          border: "1px solid rgba(34,211,238,0.15)",
        }}
      />
      <Bot size={size * 0.45} className="relative z-10 text-cyan-400" />
    </div>
  );
}

function Waveform({ active = true }: { active?: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.scale(dpr, dpr);
    let raf = 0;
    let t = 0;
    const draw = () => {
      t += 0.08;
      ctx.clearRect(0, 0, width, height);
      if (!active) {
        raf = requestAnimationFrame(draw);
        return;
      }
      const bars = 48;
      const barW = width / bars;
      const gradient = ctx.createLinearGradient(0, 0, width, 0);
      gradient.addColorStop(0, "rgba(34,211,238,0.1)");
      gradient.addColorStop(0.5, "rgba(34,211,238,0.8)");
      gradient.addColorStop(1, "rgba(34,211,238,0.1)");
      ctx.fillStyle = gradient;
      for (let i = 0; i < bars; i++) {
        const x = i * barW + barW * 0.2;
        const w = barW * 0.6;
        const center = height / 2;
        const amp =
          Math.sin(t + i * 0.4) * 0.5 +
          Math.sin(t * 1.6 + i * 0.15) * 0.25 +
          0.4;
        const h = Math.max(2, Math.abs(amp) * height * 0.75);
        ctx.fillRect(x, center - h / 2, w, h);
      }
      raf = requestAnimationFrame(draw);
    };
    draw();
    return () => cancelAnimationFrame(raf);
  }, [active]);
  return (
    <canvas
      ref={canvasRef}
      aria-label="Voice waveform"
      className="h-10 w-full"
      style={{ opacity: active ? 1 : 0.4 }}
    />
  );
}

function TelemetryBar() {
  return null;
}

function ActiveCommandTabs({
  tabs,
  onClose,
  onActivate,
}: {
  tabs: {
    id: string;
    label: string;
    tool?: string;
    payload?: Record<string, unknown>;
  }[];
  onClose: (id: string) => void;
  /**
   * Fired when the user clicks the chip body (not the close X). The
   * terminal's parent wires this to either (a) push the label into the
   * composer as a follow-up message, or (b) when the chip carries a
   * direct tool invocation, POST /api/agent-tool to dispatch it.
   */
  onActivate?: (id: string) => void;
}) {
  return (
    <div className="flex items-center gap-2 px-4 pb-2">
      {tabs.map((tab) => (
        <div
          key={tab.id}
          className="group flex items-center gap-1 rounded-md border border-cyan-500/20 bg-cyan-500/5 text-[10px] font-medium text-cyan-400"
        >
          <button
            onClick={() => onActivate?.(tab.id)}
            disabled={!onActivate}
            title={tab.tool ? `Run ${tab.tool}` : "Send as follow-up"}
            className="flex items-center gap-2 rounded-l-md px-2.5 py-1 transition hover:bg-cyan-500/10 disabled:cursor-default"
          >
            <span className="h-1.5 w-1.5 rounded-full bg-cyan-400 animate-pulse" />
            {tab.label}
          </button>
          <button
            onClick={() => onClose(tab.id)}
            aria-label={`Close ${tab.label}`}
            className="rounded-r-md px-1.5 py-1 text-gray-300 transition hover:bg-rose-500/10 hover:text-rose-300"
          >
            <X size={10} />
          </button>
        </div>
      ))}
      <button
        aria-label="Add active command"
        className="flex h-5 w-5 items-center justify-center rounded-md border border-white/10 text-gray-300 transition hover:bg-white/5"
      >
        <Plus size={10} />
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Attachment previews — shown above the input row                    */
/* ------------------------------------------------------------------ */
function AttachmentStrip({
  attachments,
  onRemove,
}: {
  attachments: Attachment[];
  onRemove: (idx: number) => void;
}) {
  if (attachments.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-2 pb-1">
      {attachments.map((att, idx) => {
        const isImage = att.type.startsWith("image/");
        return (
          <div
            key={`${att.name}-${idx}`}
            className="group relative flex items-center gap-2 overflow-hidden rounded-lg border border-white/10 bg-white/3 pr-7"
          >
            {isImage ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={att.url}
                alt={att.name}
                className="h-12 w-12 object-cover"
              />
            ) : (
              <div className="flex h-12 w-12 items-center justify-center bg-white/5 text-cyan-400">
                <ImageIcon size={18} />
              </div>
            )}
            <div className="flex min-w-0 flex-col py-1 pr-2">
              <span className="max-w-[140px] truncate text-[10px] font-medium text-neutral-200">
                {att.name}
              </span>
              <span className="text-[9px] text-gray-300">
                {att.type || "file"}
              </span>
            </div>
            <button
              onClick={() => onRemove(idx)}
              aria-label={`Remove ${att.name}`}
              className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-md bg-black/40 text-neutral-300 opacity-0 transition group-hover:opacity-100 hover:bg-black/70 hover:text-white"
            >
              <X size={10} />
            </button>
          </div>
        );
      })}
    </div>
  );
}

function LITTTerminalShellInner({
  activeTool = "builder",
  onToolChangeAction,
}: {
  activeTool?: StudioTool;
  onToolChangeAction?: (tool: StudioTool) => void;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { resolvedColors: T } = useTheme();
  const { profile } = useProfile();
  const {
    voiceState,
    errorMessage,
    cooldownRemaining,
    speakText,
    startVoice,
    stopVoice,
    setOnTurn,
    setActivity,
    timings,
    markTiming,
  } = useVoiceSession();
  const { persona } = usePersona();
  const [messages, setMessages] = useState<Message[]>([]);
  const [busy, setBusy] = useState(false);
  const [input, setInput] = useState("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [pluginsOpen, setPluginsOpen] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [plusMenuOpen, setPlusMenuOpen] = useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [imageGenOpen, setImageGenOpen] = useState(false);
  const [projectDrawerOpen, setProjectDrawerOpen] = useState(false);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  type ActiveCommand = {
    id: string;
    label: string;
    tool?: string;
    payload?: Record<string, unknown>;
  };
  const [activeCommands, setActiveCommands] = useState<ActiveCommand[]>([]);
  const [agentId, setAgentId] = useState<keyof typeof AGENTS>("littcode");
  const [agentChats, setAgentChats] = useState<Record<string, Message[]>>({});
  const [pendingAgentQuery, setPendingAgentQuery] = useState("");
  const [terminalDrawerOpen, setTerminalDrawerOpen] = useState(false);
  const [terminalBlocks, setTerminalBlocks] = useState<TerminalBlock[]>([]);
  const [terminalStatus, setTerminalStatus] = useState<TerminalStatus>("disconnected");
  const terminalRef = useRef<TerminalToolHandle | null>(null);
  const activeTerminalBlockRef = useRef<string | null>(null);
  const transcriptRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const cameraCaptureRef = useRef<(() => string | null) | null>(null);
  const textInputRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const prevPersonaRef = useRef(persona.id);

  const displayName = profile?.displayName || "Operator";
  const agentList = useMemo(() => Object.values(AGENTS), []);
  const activeAgent = useMemo(
    () => AGENTS[agentId] || AGENTS.littcode,
    [agentId],
  );
  const activeAgentAvatar = useMemo(
    () => AGENT_AVATAR_META[agentId] || AGENT_AVATAR_META.littcode,
    [agentId],
  );
  const ActiveTool = useMemo<ComponentType | null>(() => {
    // chat, agents, and builder have dedicated rendering branches.
    if (activeTool === "chat" || activeTool === "agents" || activeTool === "builder")
      return null;
    return TOOL_COMPONENTS[activeTool] ?? null;
  }, [activeTool]);
  const agentMessages = useMemo(
    () => agentChats[activeAgent.id] || [],
    [agentChats, activeAgent.id],
  );
  const chatMessages = useMemo(
    () =>
      messages.map((m) => ({
        id: `${m.role}-${m.createdAt ?? Math.random()}`,
        role: m.role as "user" | "assistant",
        content: m.content,
        createdAt: m.createdAt,
        type: m.type,
        mediaUrl: m.mediaUrl,
        status: m.status,
      })),
    [messages],
  );
  const isAgentEmpty = agentMessages.length === 0;
  const micActive = voiceState !== "idle";
  const micDisabled =
    voiceState === "transcribing" ||
    voiceState === "thinking" ||
    voiceState === "speaking" ||
    voiceState === "cooldown";

  // Auto-open the image generation popover when navigated with ?openImage=1
  useEffect(() => {
    if (searchParams?.get("openImage") === "1") {
      setImageGenOpen(true);
      // Clean the param so it doesn't re-open on every render
      const params = new URLSearchParams(searchParams.toString());
      params.delete("openImage");
      const query = params.toString();
      router.replace(`/studio${query ? `?${query}` : ""}`, { scroll: false });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  // Sync active project from URL ?project=ID
  useEffect(() => {
    const urlProject = searchParams?.get("project");
    if (urlProject && urlProject !== activeProjectId) {
      setActiveProjectId(urlProject);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  useEffect(() => {
    const el = transcriptRef.current;
    if (el) {
      el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    }
  }, [messages, busy]);

  // Insert a divider when the user switches persona
  useEffect(() => {
    if (prevPersonaRef.current === persona.id) return;
    if (messages.length === 0) {
      prevPersonaRef.current = persona.id;
      return;
    }
    setMessages((prev) => [
      ...prev,
      {
        role: "assistant",
        content: `--- Switched to ${persona.name} ---`,
        createdAt: Date.now(),
      },
    ]);
    prevPersonaRef.current = persona.id;
  }, [persona, messages.length]);

  // Esc cancels an in-flight request
  useEffect(() => {
    if (!busy) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        abortRef.current?.abort();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy]);

  // Auto-scroll agent conversation
  useEffect(() => {
    const el = transcriptRef.current;
    if (el) {
      el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    }
  }, [agentMessages, busy]);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const handleFiles = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (!files.length) return;
    const readers = files.map(
      (file) =>
        new Promise<Attachment>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () =>
            resolve({
              url: String(reader.result ?? ""),
              name: file.name,
              type: file.type,
            });
          reader.onerror = () =>
            reject(reader.error ?? new Error("read failed"));
          reader.readAsDataURL(file);
        }),
    );
    Promise.all(readers)
      .then((items) =>
        setAttachments((prev) => [...prev, ...items].slice(0, 8)),
      )
      .catch(() => {
        // ignore read errors
      })
      .finally(() => {
        if (e.target) e.target.value = "";
      });
  }, []);

  const handleScreenCapture = useCallback(async () => {
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getDisplayMedia) {
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
      });
      const video = document.createElement("video");
      video.srcObject = stream;
      video.muted = true;
      video.playsInline = true;
      await new Promise<void>((resolve, reject) => {
        video.onloadedmetadata = () => resolve();
        video.onerror = () => reject();
      });
      await video.play();
      const canvas = document.createElement("canvas");
      canvas.width = video.videoWidth || 1280;
      canvas.height = video.videoHeight || 720;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      stream.getTracks().forEach((track) => track.stop());
      const dataUrl = canvas.toDataURL("image/png");
      setAttachments((prev) =>
        [...prev, { url: dataUrl, name: "screenshot.png", type: "image/png" }].slice(0, 8),
      );
    } catch {
      // ignore cancellation or errors
    }
  }, []);

  const removeAttachment = useCallback((idx: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== idx));
  }, []);

  // Helpers: route message adds/updates to the correct state depending on
  // whether we're in agents mode (agentChats) or chat mode (messages).
  const addToolMessage = useCallback(
    (msg: Message) => {
      if (activeTool === "agents") {
        setAgentChats((prev) => ({
          ...prev,
          [activeAgent.id]: [...(prev[activeAgent.id] || []), msg],
        }));
      } else {
        setMessages((prev) => [...prev, msg]);
      }
    },
    [activeTool, activeAgent.id],
  );

  const updateLastToolMessage = useCallback(
    (updates: Partial<Message>) => {
      if (activeTool === "agents") {
        setAgentChats((prev) => {
          const msgs = [...(prev[activeAgent.id] || [])];
          if (msgs.length > 0) {
            msgs[msgs.length - 1] = { ...msgs[msgs.length - 1], ...updates };
          }
          return { ...prev, [activeAgent.id]: msgs };
        });
      } else {
        setMessages((current) => {
          if (current.length === 0) return current;
          const next = current.slice();
          next[next.length - 1] = { ...next[next.length - 1], ...updates };
          return next;
        });
      }
    },
    [activeTool, activeAgent.id],
  );

  // Run slash commands like /image, /audio, /video inline in the chat
  const runSlashCommand = useCallback(
    async (text: string) => {
      const match = text.match(
        /^\/(image|audio|video|build|code|agent|terminal)\s*(.*)/i,
      );
      if (!match) return false;
      const [, cmd, raw] = match;
      const prompt = raw.trim();

      if (cmd === "agent") {
        if (!prompt) {
          addToolMessage({
            role: "assistant",
            content:
              "Add a prompt after `/agent`, e.g. `/agent review my React component`.",
            createdAt: Date.now(),
          });
          return true;
        }
        addToolMessage({
          role: "assistant",
          content: `Asking ${activeAgent.name}…`,
          createdAt: Date.now(),
          status: "pending",
        });
        try {
          const res = await fetch("/api/agents/chat", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              agentId: activeAgent.id,
              message: prompt,
            }),
          });
          if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(
              err.error || err.detail || "Agent service error",
            );
          }
          const data = (await res.json()) as {
            response?: string;
            agent?: { name?: string };
          };
          const reply = data.response || "I'm on it.";
          updateLastToolMessage({
            content: reply,
            status: "complete",
          });
        } catch (err) {
          const msg =
            err instanceof Error
              ? err.message
              : "Agent service unavailable";
          updateLastToolMessage({
            content: msg,
            type: "error",
            status: "error",
          });
        }
        return true;
      }

      // In agents mode, show the user's command as a user message first
      if (activeTool === "agents") {
        addToolMessage({
          role: "user",
          content: text,
          createdAt: Date.now(),
        });
      }

      if (cmd === "image") {
        if (!prompt) {
          addToolMessage({
            role: "assistant",
            content:
              "Add a prompt after `/image`, e.g. `/image a futuristic city at sunset`.",
            createdAt: Date.now(),
          });
          return true;
        }
        addToolMessage({
          role: "assistant",
          content: `Generating image: "${prompt}"…`,
          createdAt: Date.now(),
          type: "image",
          status: "pending",
        });
        try {
          const res = await fetch("/api/media/generate", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              prompt,
              format: "image",
              providerId: "gemini",
              width: 1024,
              height: 1024,
            }),
          });
          const data = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(data.error || "Image generation failed");
          updateLastToolMessage({
            content: `Generated image: ${prompt}`,
            mediaUrl: data.downloadUrl,
            status: "complete",
          });
        } catch (err) {
          updateLastToolMessage({
            content:
              err instanceof Error ? err.message : "Image generation failed",
            type: "error",
            status: "error",
          });
        }
        return true;
      }

      if (cmd === "audio") {
        if (!prompt) {
          addToolMessage({
            role: "assistant",
            content:
              "Add a prompt after `/audio`, e.g. `/audio a cinematic sci-fi trailer voiceover`.",
            createdAt: Date.now(),
          });
          return true;
        }
        addToolMessage({
          role: "assistant",
          content: `Generating audio: "${prompt}"…`,
          createdAt: Date.now(),
          type: "audio",
          status: "pending",
        });
        try {
          const res = await fetch("/api/media/generate-audio", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ prompt }),
          });
          const data = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(data.error || "Audio generation failed");
          updateLastToolMessage({
            content: `Generated audio: ${prompt}`,
            mediaUrl: data.audioBase64,
            status: "complete",
          });
        } catch (err) {
          updateLastToolMessage({
            content:
              err instanceof Error ? err.message : "Audio generation failed",
            type: "error",
            status: "error",
          });
        }
        return true;
      }

      if (cmd === "video") {
        if (!prompt) {
          addToolMessage({
            role: "assistant",
            content:
              "Add a prompt after `/video`, e.g. `/video a drone flying over a neon city`.",
            createdAt: Date.now(),
          });
          return true;
        }
        addToolMessage({
          role: "assistant",
          content: `Starting video generation: "${prompt}"…`,
          createdAt: Date.now(),
          type: "video",
          status: "pending",
        });
        try {
          const res = await fetch("/api/media/generate-video", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              prompt,
              aspectRatio: "16:9",
              resolution: "720p",
            }),
          });
          const data = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(data.error || "Video generation failed");

          const poll = async () => {
            const start = Date.now();
            while (Date.now() - start < 300_000) {
              await new Promise((r) => setTimeout(r, 4000));
              const pollRes = await fetch("/api/media/video-status", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ operationName: data.operationName }),
              });
              const pollData = await pollRes.json().catch(() => ({}));
              if (pollData.error) throw new Error(pollData.error);
              if (pollData.done && pollData.videoUri) {
                updateLastToolMessage({
                  content: `Generated video: ${prompt}`,
                  mediaUrl: pollData.videoUri,
                  status: "complete",
                });
                return;
              }
            }
            throw new Error("Video generation timed out");
          };

          void poll().catch((err) => {
            updateLastToolMessage({
              content:
                err instanceof Error
                  ? err.message
                  : "Video generation failed",
              type: "error",
              status: "error",
            });
          });
        } catch (err) {
          updateLastToolMessage({
            content:
              err instanceof Error ? err.message : "Video generation failed",
            type: "error",
            status: "error",
          });
        }
        return true;
      }

      if (cmd === "build") {
        onToolChangeAction?.("builder");
        addToolMessage({
          role: "assistant",
          content: prompt
            ? `Switched to the Build tool. Use it to build: ${prompt}`
            : "Switched to the Build tool.",
          createdAt: Date.now(),
        });
        return true;
      }

      if (cmd === "code") {
        onToolChangeAction?.("canvas");
        addToolMessage({
          role: "assistant",
          content: prompt
            ? `Switched to the Code tool. Prompt: ${prompt}`
            : "Switched to the Code tool.",
          createdAt: Date.now(),
        });
        return true;
      }

      if (cmd === "terminal") {
        setTerminalDrawerOpen(true);
        if (prompt) {
          executeTerminalCommand(prompt, "user");
        }
        return true;
      }

      return false;
    },
    [
      activeTool,
      addToolMessage,
      updateLastToolMessage,
      onToolChangeAction,
      activeAgent.id,
      activeAgent.name,
    ],
  );

  const executeTerminalCommand = useCallback(
    async (command: string, startedBy: "user" | "litt" = "user") => {
      const block = createTerminalBlock(command, startedBy);
      activeTerminalBlockRef.current = block.id;
      setTerminalBlocks((prev) => [...prev, block]);
      setTerminalDrawerOpen(true);

      const handle = terminalRef.current;
      if (!handle || terminalStatus !== "connected" || handle.getStatus() !== "connected") {
        const message = "The embedded shell is open, but the real PTY is not connected. Start `pnpm terminal:dev`, then connect the PTY.";
        setTerminalBlocks((prev) => prev.map((b) => b.id === block.id ? updateTerminalBlock(b, { status: "disconnected", output: message, durationMs: 0 }) : b));
        setMessages((current) => [...current, { role: "assistant", content: message, createdAt: Date.now() }]);
        return { command, output: "", exitCode: null, durationMs: 0, error: message };
      }

      setTerminalBlocks((prev) => prev.map((b) => b.id === block.id ? updateTerminalBlock(b, { status: "running" }) : b));
      const result = await handle.runCommand(command);
      const status = result.error || result.exitCode !== 0 ? "failed" : "success";
      setTerminalBlocks((prev) => prev.map((b) => b.id === block.id ? updateTerminalBlock(b, {
        status,
        output: result.output || result.error || "",
        exitCode: result.exitCode ?? undefined,
        durationMs: result.durationMs,
      }) : b));
      const summary = result.error
        ? `Command failed: \`${command}\`\n\n${result.error}\n\nExit code: ${result.exitCode ?? "unavailable"} · Duration: ${result.durationMs}ms`
        : `Command completed: \`${command}\`\n\n\`\`\`text\n${result.output || "(no output)"}\n\`\`\`\n\nExit code: ${result.exitCode} · Duration: ${result.durationMs}ms`;
      setMessages((current) => [...current, { role: "assistant", content: summary, createdAt: Date.now() }]);
      return result;
    },
    [terminalStatus],
  );

  const handleTerminalOutput = useCallback((data: string) => {
    const blockId = activeTerminalBlockRef.current;
    if (!blockId) return;
    setTerminalBlocks((prev) =>
      prev.map((block) =>
        block.id === blockId
          ? updateTerminalBlock(block, {
              status: "running",
              output: `${block.output || ""}${data}`.slice(-12000),
            })
          : block,
      ),
    );
  }, []);

  const sendAgent = useCallback(
    async (value: string) => {
      const text = value.trim();
      const agent = activeAgent;
      const userMessage: Message = {
        role: "user",
        content: text || "(image attachment)",
        createdAt: Date.now(),
      };
      setAgentChats((prev) => ({
        ...prev,
        [agent.id]: [...(prev[agent.id] || []), userMessage],
      }));
      setBusy(true);
      setActivity({ type: "thinking" });

      try {
        const res = await fetch("/api/agents/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            agentId: agent.id,
            message: text || "Describe what you see.",
          }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || err.detail || "Agent service error");
        }
        const data = (await res.json()) as {
          response?: string;
          agent?: { name?: string };
        };
        const reply = data.response || "I'm on it.";
        setAgentChats((prev) => ({
          ...prev,
          [agent.id]: [
            ...(prev[agent.id] || []),
            { role: "assistant", content: reply, createdAt: Date.now() },
          ],
        }));
        return reply;
      } catch (err) {
        const reply =
          err instanceof Error ? err.message : "Agent service unavailable";
        setAgentChats((prev) => ({
          ...prev,
          [agent.id]: [
            ...(prev[agent.id] || []),
            { role: "assistant", content: reply, createdAt: Date.now() },
          ],
        }));
        return reply;
      } finally {
        setBusy(false);
        setActivity({ type: "idle" });
      }
    },
    [activeAgent, setActivity],
  );

  // Route a pending /agent query once the shell switches to agent mode
  useEffect(() => {
    if (activeTool === "agents" && pendingAgentQuery) {
      const query = pendingAgentQuery;
      setPendingAgentQuery("");
      void sendAgent(query || "...");
    }
  }, [activeTool, pendingAgentQuery, sendAgent]);

  const send = useCallback(
    async (value: string, attachmentsArg?: string[]) => {
      const text = value.trim();
      const attachList =
        attachmentsArg ?? attachments.map((a) => a.url).filter(Boolean);
      if (!attachmentsArg && cameraOpen && cameraCaptureRef.current) {
        const liveFrame = cameraCaptureRef.current();
        if (liveFrame) attachList.push(liveFrame);
      }
      if ((!text && !attachList.length) || busy) return "";

      // Terminal commands: "$ command" or "/run command"
      const termMatch = text.match(/^\$\s+(.+)/) || text.match(/^\/run\s+(.+)/i);
      if (termMatch) {
        const cmd = termMatch[1].trim();
        void executeTerminalCommand(cmd, "user");
        setInput("");
        setAttachments([]);
        return "";
      }

      if (activeTool === "agents") {
        setBusy(true);
        setInput("");
        setAttachments((prev) => (attachmentsArg ? prev : []));
        setActivity({ type: "thinking" });

        // Handle slash commands inline before falling back to the agent API
        if (text && (await runSlashCommand(text))) {
          setBusy(false);
          setActivity({ type: "idle" });
          return "";
        }

        const agentText = text.replace(/^\/agent\s*/i, "").trim();
        const reply = await sendAgent(agentText || "(image attachment)");
        return reply;
      }

      const userMessage = text || "(image attachment)";

      // Route ordinary creation language through Builder capabilities. Users
      // should not need to know slash commands to generate an artifact.
      const imageIntent = /\b(?:make|create|generate|design|draw)\b[\s\S]*\b(?:logo|image|picture|graphic|icon|illustration|artwork|poster|banner|thumbnail)\b/i.test(text);
      if (imageIntent) {
        setMessages((current) => [
          ...current,
          { role: "user", content: userMessage, createdAt: Date.now() },
        ]);
        setInput("");
        setAttachments([]);
        await runSlashCommand(`/image ${text}`);
        return "";
      }

      // Let creators ask for the common project build in plain English. Keep
      // this deliberately narrow so ordinary discussion never executes code.
      const buildIntent = /^(?:please\s+)?(?:run|start|do)\s+(?:the\s+)?build\b/i.test(text)
        || /^(?:please\s+)?build\s+(?:the\s+)?(?:project|app|site|repo|from here)\b/i.test(text);
      if (buildIntent) {
        if (terminalStatus !== "connected") {
          const disconnectedMessage = "The embedded shell is open, but the real PTY is not connected. Start `pnpm terminal:dev`, then connect the PTY.";
          setMessages((current) => [...current, { role: "user", content: text, createdAt: Date.now() }, { role: "assistant", content: disconnectedMessage, createdAt: Date.now() }]);
          setTerminalDrawerOpen(true);
          setInput("");
          setAttachments([]);
          return disconnectedMessage;
        }
        setMessages((current) => [
          ...current,
          { role: "user", content: text, createdAt: Date.now() },
          {
            role: "assistant",
            content: "Running the project build in the Studio terminal. You can watch it live below.",
            createdAt: Date.now(),
          },
        ]);
        void executeTerminalCommand("pnpm build", "litt");
        setInput("");
        setAttachments([]);
        return "Running the project build in the Studio terminal.";
      }

      // Multimodal snapshots go through the Gemini image-chat path because the
      // unified streaming endpoint does not accept image data yet.
      if (attachList.length > 0) {
        const historyForApi = messages.map((m) => ({
          role: m.role as "user" | "assistant",
          content: m.content,
        }));
        setMessages((current) => [
          ...current,
          {
            role: "user" as const,
            content: userMessage,
            createdAt: Date.now(),
          },
        ]);
        setBusy(true);
        setInput("");
        setAttachments((prev) => (attachmentsArg ? prev : []));
        setActivity({ type: "thinking" });

        try {
          const response = await fetch("/api/gemini/chat", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              agentSlug: persona.id,
              message: userMessage,
              history: historyForApi,
              images: attachList,
              userName: profile.displayName || "Creator",
            }),
          });
          if (!response.ok) {
            const err = await response.json().catch(() => ({}));
            throw new Error(err.detail || err.error || "Image chat failed");
          }
          const data = (await response.json()) as { response?: string };
          markTiming("AI_first_token");
          const reply =
            data.response ||
            "I\u2019m ready. Tell me what we\u2019re building.";
          setMessages((current) => [
            ...current,
            {
              role: "assistant" as const,
              content: reply,
              createdAt: Date.now(),
            },
          ]);
          markTiming("AI_complete");
          return reply;
        } catch (error) {
          const reply =
            error instanceof Error ? error.message : "LiTT is reconnecting";
          setMessages((current) => [
            ...current,
            {
              role: "assistant" as const,
              content: reply,
              createdAt: Date.now(),
            },
          ]);
          return reply;
        } finally {
          setBusy(false);
          setActivity({ type: "idle" });
        }
      }

      const historyForApi = messages.map((m) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      }));
      setMessages((current) => [
        ...current,
        { role: "user" as const, content: userMessage, createdAt: Date.now() },
      ]);
      setBusy(true);
      setInput("");
      setAttachments((prev) => (attachmentsArg ? prev : []));
      setActivity({ type: "thinking" });

      // Handle slash commands inline before falling back to the chat API
      if (text && (await runSlashCommand(text))) {
        setBusy(false);
        setActivity({ type: "idle" });
        return "";
      }

      const controller = new AbortController();
      abortRef.current = controller;

      // Insert a streaming placeholder for the assistant turn
      const placeholderIndex = messages.length + 1; // +1 for the user message we just appended
      setMessages((current) => [
        ...current,
        { role: "assistant" as const, content: "", createdAt: Date.now() },
      ]);

      let fullText = "";
      let receivedFirstToken = false;
      try {
        const response = await fetch("/api/chat/unified", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            mode: "llm",
            agentSlug: persona.id,
            message: text || "Describe what you see.",
            history: historyForApi,
            stream: true,
            userName: profile.displayName || "Creator",
            images: attachList,
          }),
          signal: controller.signal,
        });

        if (!response.ok || !response.body) {
          const err = await response.json().catch(() => ({}));
          throw new Error(err.detail || err.error || "LiTT is reconnecting");
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buf = "";
        setActivity({ type: "generating_response" });
        // Read the full stream
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          const events = buf.split("\n\n");
          buf = events.pop() ?? "";
          for (const ev of events) {
            const trimmed = ev.trim();
            if (!trimmed.startsWith("data:")) continue;
            const payload = trimmed.slice(5).trim();
            if (payload === "[DONE]") continue;
            try {
              const json = JSON.parse(payload) as {
                text?: string;
                error?: string;
                done?: boolean;
              };
              if (typeof json.text === "string" && json.text.length > 0) {
                if (!receivedFirstToken) {
                  receivedFirstToken = true;
                  markTiming("AI_first_token");
                }
                fullText += json.text;
                setMessages((current) => {
                  if (placeholderIndex >= current.length) return current;
                  const next = current.slice();
                  next[placeholderIndex] = {
                    ...next[placeholderIndex],
                    content: fullText,
                  };
                  return next;
                });
              } else if (typeof json.error === "string") {
                throw new Error(json.error);
              }
            } catch (parseErr) {
              if (parseErr instanceof Error && parseErr.message) {
                // Only rethrow server-reported errors
                const msg = parseErr.message;
                if (
                  msg !== "Unexpected token" &&
                  msg !== "Unexpected end of JSON input"
                ) {
                  throw parseErr;
                }
              }
            }
          }
        }
        // The action-chips emitted by parseLiTTActions are *user-driven* next
        // steps, not model function calls. The model emits them as
        // structured JSON; the user clicks one and the terminal sends the
        // label back as a follow-up turn. We attach the original action
        // object so the click handler can do something smarter (run a
        // command, ask for confirmation, etc.) when the shape allows.
        const actionObjects = parseLiTTActions(fullText);
        markTiming("AI_complete");
        setActiveCommands(
          actionObjects.map((a, i) => ({
            id: `${a.type}-${i}`,
            label: a.label,
            tool: a.type,
            payload: {
              command: a.command,
              filePath: a.filePath,
              content: a.content,
              goalTitle: a.goalTitle,
              memoryContent: a.memoryContent,
            },
          })),
        );
        return fullText;
      } catch (error) {
        const isAbort =
          error instanceof DOMException && error.name === "AbortError";
        if (isAbort) {
          setMessages((current) => {
            if (placeholderIndex >= current.length) return current;
            const next = current.slice();
            const cur = next[placeholderIndex];
            const stamp = cur.content
              ? `${cur.content}\n\n_(cancelled)_`
              : "_(cancelled)_";
            next[placeholderIndex] = { ...cur, content: stamp };
            return next;
          });
          return "";
        }
        const reply =
          error instanceof Error ? error.message : "LiTT is reconnecting";
        setMessages((current) => {
          if (placeholderIndex >= current.length) return current;
          const next = current.slice();
          next[placeholderIndex] = {
            ...next[placeholderIndex],
            content: reply,
          };
          return next;
        });
        return reply;
      } finally {
        setBusy(false);
        abortRef.current = null;
        setActivity({ type: "idle" });
      }
    },
    [
      busy,
      messages,
      attachments,
      activeTool,
      sendAgent,
      profile.displayName,
      persona.id,
      setActivity,
      runSlashCommand,
      executeTerminalCommand,
      markTiming,
      cameraOpen,
    ],
  );

  // Voice transcripts are finalised after a silence gap — auto-send and speak reply
  useEffect(() => {
    setOnTurn((text) => {
      if (!text) return;
      void send(text).then((reply) => {
        if (reply) speakText(reply);
      });
    });
    return () => setOnTurn(() => {});
  }, [send, speakText, setOnTurn]);

  const handleChatSend = useCallback(
    async (text: string) => {
      return send(text);
    },
    [send],
  );

  const handleSend = () => {
    if (busy) {
      cancel();
      return;
    }
    const trimmed = input.trim();
    if (!trimmed && attachments.length === 0) return;

    void send(input);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleChip = (chip: string) => {
    // /image opens the inline image generation popover instead of just
    // inserting the slash command text.
    if (chip === "/image") {
      setImageGenOpen(true);
      return;
    }
    setInput((prev) => {
      const base = prev.replace(/\s+/g, " ").trim();
      return base ? `${base} ${chip} ` : `${chip} `;
    });
  };

  const closeCommand = (id: string) => {
    setActiveCommands((prev) => prev.filter((c) => c.id !== id));
  };

  const toggleMic = () => {
    if (micDisabled) return;
    if (micActive) {
      stopVoice();
    } else {
      void startVoice();
    }
  };

  const plusActions = [
    {
      id: "upload",
      label: "Upload",
      icon: Upload,
      onClick: () => fileInputRef.current?.click(),
    },
    {
      id: "camera",
      label: "Camera",
      icon: Camera,
      onClick: () => setCameraOpen(true),
    },
    {
      id: "screen",
      label: "Screen capture",
      icon: ScreenShare,
      onClick: handleScreenCapture,
    },
    {
      id: "image",
      label: "Image",
      icon: ImageIcon,
      onClick: () => setImageGenOpen(true),
    },
    {
      id: "video",
      label: "Video",
      icon: Film,
      onClick: () => onToolChangeAction?.("video"),
    },
    {
      id: "audio",
      label: "Audio",
      icon: Music,
      onClick: () => onToolChangeAction?.("audio"),
    },
    {
      id: "build",
      label: "Build",
      icon: Hammer,
      onClick: () => onToolChangeAction?.("builder"),
    },
    {
      id: "code",
      label: "Code",
      icon: Code,
      onClick: () => onToolChangeAction?.("canvas"),
    },
    {
      id: "plugins",
      label: "Plugins",
      icon: LayoutGrid,
      onClick: () => setPluginsOpen(true),
    },
    {
      id: "assets",
      label: "Assets",
      icon: FolderOpen,
      onClick: () => onToolChangeAction?.("gallery"),
    },
    {
      id: "agent",
      label: "Add agent/skill",
      icon: Bot,
      onClick: () => onToolChangeAction?.("agents"),
    },
  ];

  // When the user clicks a chip body, we treat it as a follow-up turn so
  // the chat path picks up the chip's intent. Destructive action types
  // (anything that would run a shell command, edit a file, or build/deploy)
  // are gated behind window.confirm() — the user has to explicitly say
  // yes before the action fires. A richer in-app confirmation dialog
  // can replace this later without touching the loop logic.
  const activateCommand = useCallback(
    (id: string) => {
      const chip = activeCommands.find((c) => c.id === id);
      if (!chip) return;
      const destructive = new Set([
        "run_command",
        "edit_file",
        "create_file",
        "shell_command",
        "npm_run",
        "run_build",
        "run_lint",
      ]);
      const cmdText =
        typeof chip.payload?.command === "string"
          ? chip.payload.command
          : undefined;
      const hasCommand =
        typeof cmdText === "string" && cmdText.trim().length > 0;
      const isDestructive =
        (chip.tool && destructive.has(chip.tool)) || hasCommand;
      if (isDestructive) {
        const desc =
          hasCommand && cmdText
            ? `This will run: \`${cmdText}\``
            : `This will run: ${chip.label}`;

        if (
          typeof window !== "undefined" &&
          !window.confirm(`${desc}\n\nAllow?`)
        ) {
          return;
        }
      }
      // Send the chip's label back as a follow-up message. The chat path
      // will see the label in history and the model can either (a)
      // decide to call a tool, or (b) answer with a clarification.
      void send(chip.label);
    },
    [activeCommands, send],
  );

  return (
    <div
      className="flex h-full min-h-0 w-full flex-col overflow-hidden bg-[#030308] text-neutral-100"
      style={{ color: T.textColor }}
    >
      {/* Hidden file input — driven by the toolbar buttons */}
      <input
        ref={fileInputRef}
        type="file"
        name="file-attachment"
        id="litt-file-attachment"
        multiple
        hidden
        aria-label="File attachment"
        accept="image/*,application/pdf,text/*"
        onChange={handleFiles}
      />
      <input
        ref={cameraInputRef}
        type="file"
        name="camera-capture"
        id="litt-camera-capture"
        hidden
        aria-label="Camera capture"
        accept="image/*"
        capture="environment"
        onChange={handleFiles}
      />

      {/* ── BODY ── */}
      <div className="flex min-h-0 flex-1">
        {/* MAIN STAGE */}
        <main className="relative flex min-w-0 flex-1 flex-col overflow-hidden">
          {/* Ambient background - simplified on mobile to reduce paint */}
          <div
            className="pointer-events-none absolute inset-0 hidden opacity-50 sm:block"
            style={{
              backgroundImage:
                "radial-gradient(circle at 20% 30%, rgba(34,211,238,0.12) 0%, transparent 40%), radial-gradient(circle at 80% 20%, rgba(168,85,247,0.12) 0%, transparent 35%), radial-gradient(circle at 60% 80%, rgba(236,72,153,0.08) 0%, transparent 45%), linear-gradient(to bottom, transparent, rgba(3,3,8,0.9))",
            }}
          />
          <div
            className="pointer-events-none absolute inset-0 hidden opacity-[0.04] sm:block"
            style={{
              backgroundImage:
                "linear-gradient(rgba(34,211,238,0.4) 1px, transparent 1px), linear-gradient(90deg, rgba(34,211,238,0.4) 1px, transparent 1px)",
              backgroundSize: "60px 60px",
            }}
          />

          {/* Stage header */}
          <div className="relative z-10 hidden min-h-14 shrink-0 items-center justify-between border-b border-white/5 px-4 py-2 sm:flex sm:border-0 sm:px-6 sm:pt-5">
            <div className="flex items-center gap-3">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-cyan-500/20 bg-cyan-500/10">
                <Terminal size={16} className="text-cyan-400" />
              </div>
              <div>
                <div className="text-sm font-black tracking-wide text-white">
                  Builder
                </div>
                <div className="hidden text-[10px] text-gray-300 sm:block">
                  {activeProjectId
                    ? `Project · ${activeProjectId.slice(0, 12)}`
                    : "Your intelligent workspace. One command away."}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2 text-[10px]">
              <UserButton
                afterSignOutUrl="/sign-in"
                appearance={{
                  elements: {
                    userButtonAvatarBox:
                      "h-7 w-7 rounded-full border border-white/10",
                  },
                }}
              />
            </div>
          </div>

          {cameraOpen && (
            <div className="absolute right-4 top-14 z-60 w-64 sm:top-16">
              <CameraSession
                compact
                visionOnSend
                onCaptureReady={(capture) => {
                  cameraCaptureRef.current = capture;
                }}
                onSnapshot={(url) => {
                  if (
                    activeTool !== "builder" &&
                    activeTool !== "chat" &&
                    activeTool !== "image"
                  ) {
                    onToolChangeAction?.("builder");
                  }
                  void send("Describe what you see.", [url]).then(
                    (reply) => {
                      if (reply) speakText(reply);
                    },
                  );
                }}
                onClose={() => {
                  cameraCaptureRef.current = null;
                  setCameraOpen(false);
                }}
                modelName={persona.name}
              />
            </div>
          )}

          {/* Inline image generation popover — opened from the + menu */}
          <ImageGenPopover
            open={imageGenOpen}
            onClose={() => setImageGenOpen(false)}
            initialPrompt={input}
            onInsert={(url, name) => {
              setAttachments((prev) =>
                [
                  ...prev,
                  { url, name, type: "image/png" },
                ].slice(0, 8),
              );
            }}
          />

          {/* Project drawer — opened from the Projects rail item */}
          <ProjectDrawer
            open={projectDrawerOpen}
            onClose={() => setProjectDrawerOpen(false)}
            activeProjectId={activeProjectId}
            onSelect={(projectId) => {
              setActiveProjectId(projectId);
              setProjectDrawerOpen(false);
              // Update URL with project param
              const params = new URLSearchParams(
                searchParams?.toString() ?? "",
              );
              params.set("project", projectId);
              params.set("tool", "builder");
              router.push(`/studio?${params.toString()}`, { scroll: false });
            }}
          />

          {/* Scrollable content — ChatShell is always mounted as the persistent Builder */}
          <div
            ref={transcriptRef}
            className={cn(
              "relative z-10 min-h-0 flex-1 overflow-y-auto",
              activeTool === "builder" || activeTool === "chat"
                ? "px-0 py-0"
                : "px-0 py-0",
            )}
          >
            {/* ChatShell is always rendered — the permanent Builder stream */}
            <ChatShell
              embedded
              hideDock={true}
              builderMode={true}
              messages={chatMessages}
              sending={busy}
              systemLines={[]}
              onSend={handleChatSend}
              onToolSelect={onToolChangeAction}
              onOpenImageGen={() => setImageGenOpen(true)}
            />
          </div>

          {/* Mobile tool rail removed in favor of the global bottom nav. */}

          {/* COMMAND BAR — single persistent bottom composer */}
              <div className="relative z-20 shrink-0 overflow-x-hidden border-t border-white/5 bg-[#030308]/95 px-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-2 backdrop-blur-md sm:px-6 sm:py-3">
            <div className="mx-auto flex max-w-4xl flex-col gap-1.5">
              {/* Compact voice state strip — replaces the old giant panel */}
              {micActive && (
                <div className="flex items-center gap-2 px-1 text-[11px]">
                  {(() => {
                    if (voiceState === "cooldown") {
                      return (
                        <>
                          <span className="text-amber-400 font-bold">Voice limit reached</span>
                          <span className="text-amber-400">· Retry available in {cooldownRemaining}s</span>
                        </>
                      );
                    }
                    if (voiceState === "error") {
                      return (
                        <span className="text-rose-400 truncate">
                          {errorMessage || "Voice session error"}
                        </span>
                      );
                    }
                    const steps = [
                      { label: "Listening", active: voiceState === "listening" },
                      { label: "Transcribing", active: voiceState === "transcribing" },
                      { label: "Thinking", active: voiceState === "thinking" },
                      { label: "Speaking", active: voiceState === "speaking" },
                    ];
                    const activeIdx = steps.findIndex((s) => s.active);
	                    return steps.map((step, idx) => (
                      <span key={step.label} className="flex shrink-0 items-center gap-1">
                        <span className={idx <= activeIdx && activeIdx >= 0 ? "text-cyan-400" : idx < activeIdx ? "text-emerald-400" : "text-white/20"}>
                          {idx < activeIdx ? "✓" : idx === activeIdx ? "●" : "○"}
                        </span>
                        <span className={idx === activeIdx ? "text-neutral-200 font-bold" : idx < activeIdx ? "text-neutral-400" : "text-white/20"}>{step.label}</span>
                        {idx < steps.length - 1 && <span className="text-white/10">›</span>}
                      </span>
	                    ));
	                  })()}
                  {timings.speech_end && timings.playback_started && (
                    <span className="ml-auto hidden text-[10px] text-white/45 sm:inline">
                      Transcription: {timings.transcription_complete ? Math.round(timings.transcription_complete - timings.speech_end) : "…"}ms · AI: {timings.AI_complete && timings.transcription_complete ? Math.round(timings.AI_complete - timings.transcription_complete) : "…"}ms · TTS: {timings.TTS_first_audio && timings.TTS_request ? Math.round(timings.TTS_first_audio - timings.TTS_request) : "…"}ms · Total: {Math.round(timings.playback_started - timings.speech_end)}ms
                    </span>
                  )}
                </div>
              )}

              <AttachmentStrip
                attachments={attachments}
                onRemove={removeAttachment}
              />
              <div className="flex items-end gap-2 sm:items-center">
                {/* + button — single, opens bottom sheet */}
                <div className="relative">
                  <button
                    aria-label="Open creation menu"
                    aria-expanded={plusMenuOpen}
                    onClick={() => setPlusMenuOpen((v) => !v)}
                    className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border transition ${
                      plusMenuOpen
                        ? "border-cyan-500/40 bg-cyan-500/10 text-cyan-400"
                        : "border-white/10 bg-white/5 text-neutral-300 hover:bg-white/10"
                    }`}
                  >
                    <Plus size={16} aria-hidden="true" />
                  </button>
                  {plusMenuOpen && (
                    <>
                      <div
                        className="fixed inset-0 z-90 bg-black/60 sm:bg-transparent"
                        onClick={() => setPlusMenuOpen(false)}
                        aria-hidden="true"
                      />
                      <div
                        className="fixed bottom-0 left-0 right-0 z-100 rounded-t-2xl border border-white/10 bg-[#0a0a0f] p-4 shadow-2xl sm:absolute sm:bottom-full sm:left-0 sm:top-auto sm:mb-2 sm:w-56 sm:rounded-xl sm:p-2"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <div className="flex items-center justify-between pb-2 sm:hidden">
                          <span className="text-xs font-black text-white">
                            Create & attach
                          </span>
                          <button
                            onClick={() => setPlusMenuOpen(false)}
                            aria-label="Close creation menu"
                            className="rounded-md p-1 text-neutral-300 hover:bg-white/10"
                          >
                            <X size={16} />
                          </button>
                        </div>
                        <div className="grid grid-cols-3 gap-2 sm:grid-cols-1">
                          {plusActions.map((action) => {
                            const Icon = action.icon;
                            return (
                              <button
                                key={action.id}
                                onClick={() => {
                                  setPlusMenuOpen(false);
                                  action.onClick();
                                }}
                                className="flex flex-col items-center gap-1 rounded-lg p-2 text-[10px] text-neutral-200 transition hover:bg-white/5 sm:flex-row sm:gap-2 sm:px-3 sm:py-2 sm:text-xs"
                              >
                                <Icon size={16} className="text-cyan-400" />
                                <span>{action.label}</span>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    </>
                  )}
                </div>

                {/* Text input — placeholder shows voice state when mic active */}
                <div className="relative flex min-w-0 flex-1 items-end">
                  <textarea
                    ref={textInputRef}
                    name="litt-message"
                    id="litt-message-input"
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={handleKeyDown}
                    aria-label="Message LITT"
                    placeholder={
                      micActive
                        ? voiceState === "speaking"
                          ? "LiTT is speaking..."
                          : voiceState === "transcribing"
                            ? "Transcribing..."
                            : voiceState === "thinking"
                              ? "LiTT is thinking..."
                              : voiceState === "listening"
                                ? "Listening..."
                                : voiceState === "cooldown"
                                  ? "Voice temporarily unavailable"
                                  : "Voice active..."
                        : "Ask LiTT anything..."
                    }
                    rows={1}
                    className="max-h-32 min-h-11 w-full resize-none rounded-xl border border-white/10 bg-white/3 py-2.5 pl-3 pr-12 text-sm leading-5 text-neutral-100 outline-none placeholder:text-gray-400 focus:border-cyan-500/30 focus:bg-white/5 sm:min-h-12 sm:py-3 sm:pl-4 sm:text-base"
                  />
                  {/* Contextual send/stop button inside textarea */}
                  <button
                    aria-label={busy ? "Stop" : "Send message"}
                    onClick={handleSend}
                    disabled={
                      !busy && !input.trim() && attachments.length === 0
                    }
                    className={`absolute bottom-1.5 right-1.5 flex h-8 w-8 items-center justify-center rounded-lg transition disabled:opacity-40 sm:bottom-2 sm:h-9 sm:w-9 ${
                      busy
                        ? "bg-rose-500/15 text-rose-300 hover:bg-rose-500/25"
                        : "bg-cyan-500/10 text-cyan-400 hover:bg-cyan-500/20"
                    }`}
                  >
                    {busy ? (
                      <Square size={12} aria-hidden="true" />
                    ) : (
                      <Send size={15} aria-hidden="true" />
                    )}
                  </button>
                </div>

                {/* Mic button — tap to start, tap again to cancel */}
                <button
                  aria-label={
                    micDisabled ? "Voice busy" : micActive ? "Cancel voice" : "Start voice"
                  }
                  onClick={toggleMic}
                  disabled={micDisabled}
                  className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border transition ${
                    micDisabled
                      ? "border-white/5 bg-white/5 text-neutral-500 cursor-not-allowed"
                      : micActive
                        ? "border-rose-500/40 bg-rose-500/10 text-rose-300"
                        : "border-white/10 bg-white/5 text-neutral-300 hover:bg-white/10"
                  }`}
                >
                  {micDisabled ? (
                    <Loader2 size={15} aria-hidden="true" />
                  ) : micActive ? (
                    <MicOff size={15} aria-hidden="true" />
                  ) : (
                    <Mic size={15} aria-hidden="true" />
                  )}
                </button>
              </div>

              {/* Slash + plugin chips: secondary actions, hidden on mobile
                  (they live in the + menu there) to keep the composer compact. */}
              <div className="hidden items-center gap-1.5 overflow-x-auto pb-1 scrollbar-none sm:flex [&::-webkit-scrollbar]:hidden">
                {SLASH_CHIPS.map((chip) => (
                  <button
                    key={chip.id}
                    onClick={() => handleChip(chip.label)}
                    className="flex shrink-0 items-center gap-1 rounded-md border border-white/5 bg-white/2 px-2 py-1 text-[11px] text-gray-300 transition hover:border-cyan-500/20 hover:text-cyan-400"
                  >
                    <span className="text-cyan-500">{chip.label}</span>
                    <span className="hidden text-gray-400 sm:inline">
                      {chip.desc}
                    </span>
                  </button>
                ))}
                {activeTool === "agents" && (
                  <button
                    onClick={() =>
                      setAgentId(
                        activeAgent.id === "littcode"
                          ? "littlebit"
                          : "littcode",
                      )
                    }
                    className="flex shrink-0 items-center gap-1 rounded-md border px-2 py-1 text-[11px] transition"
                    style={{
                      borderColor: activeAgent.color + "40",
                      backgroundColor: activeAgent.color + "10",
                      color: activeAgent.color,
                    }}
                  >
                    <span>{activeAgentAvatar.emoji}</span>
                    <span>{activeAgent.name}</span>
                  </button>
                )}
                <div className="flex items-center gap-1 pl-1 sm:pl-2">
                  {PLUGINS.slice(0, 4).map((plugin) => (
                    <button
                      key={plugin}
                      onClick={() => handleChip(`/${plugin}`)}
                      aria-label={`/${plugin} plugin command`}
                      className="shrink-0 rounded-md px-1.5 py-1 text-[11px] font-mono text-gray-300 transition hover:text-white"
                    >
                      /{plugin}
                    </button>
                  ))}
                  <span
                    title="More plugins coming soon"
                    className="shrink-0 cursor-not-allowed rounded-md px-1.5 py-1 text-[11px] text-gray-300 opacity-40"
                  >
                    +8
                  </span>
                </div>
              </div>
            </div>

            <ActiveCommandTabs
              tabs={activeCommands}
              onClose={closeCommand}
              onActivate={activateCommand}
            />
          </div>

          {/* FOOTER TELEMETRY */}
          <div className="relative z-20 hidden h-8 shrink-0 items-center border-t border-white/5 bg-[#030308]/90">
            <TelemetryBar />
            <div className="ml-auto flex items-center gap-2 px-4 text-[10px] text-gray-400">
              <span>&ldquo;Greatness is built, not generated.&rdquo;</span>
              <span className="font-black tracking-widest text-cyan-500/60">
                LITT
              </span>
            </div>
          </div>

          {/* Persistent terminal drawer. It stays mounted so PTY sessions and
              command history survive closing and reopening the panel. */}
          <div
            className={`fixed inset-0 z-50 flex items-end justify-center transition ${terminalDrawerOpen ? "pointer-events-auto bg-black/50 backdrop-blur-sm" : "pointer-events-none bg-transparent"}`}
            onClick={() => setTerminalDrawerOpen(false)}
            aria-hidden={!terminalDrawerOpen}
          >
              <div
                className={`relative flex h-[72dvh] max-h-[760px] w-full max-w-5xl flex-col overflow-hidden rounded-t-2xl border border-white/10 bg-[#05050a] shadow-2xl transition-transform duration-300 ${terminalDrawerOpen ? "translate-y-0" : "translate-y-full"}`}
                onClick={(e) => e.stopPropagation()}
              >
                <div className="flex items-center justify-between border-b border-white/5 px-4 py-2">
                  <div className="flex items-center gap-2 text-sm font-bold text-cyan-400">
                    <Terminal size={14} /> Terminal
                  </div>
                  <button
                    onClick={() => setTerminalDrawerOpen(false)}
                    className="flex h-7 w-7 items-center justify-center rounded-lg border border-white/10 bg-white/5 text-gray-400 transition hover:bg-white/10 hover:text-white"
                    aria-label="Close terminal"
                  >
                    ✕
                  </button>
                </div>
                <div className="min-h-0 flex-1">
                  <TerminalTool ref={terminalRef} onOutput={handleTerminalOutput} onStatusChange={setTerminalStatus} />
                </div>
              </div>
          </div>
        </main>
      </div>
    </div>
  );
}

export default function LITTTerminalShell(props: {
  activeTool?: StudioTool;
  onToolChangeAction?: (tool: StudioTool) => void;
}) {
  return (
    <PersonaProvider>
      <LITTTerminalShellInner {...props} />
    </PersonaProvider>
  );
}
