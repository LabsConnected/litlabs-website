"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useTheme } from "@/context/ThemeContext";
import { useProfile } from "@/context/ProfileContext";
import { useVoiceSession } from "@/app/studio/context/VoiceSessionContext";
import { cn } from "@/lib/utils";
import { parseLiTTActions } from "@/lib/litt-context";
import {
  Terminal,
  FolderKanban,
  GitBranch,
  Bot,
  FolderOpen,
  BookOpen,
  Boxes,
  Settings,
  Send,
  Plus,
  Camera,
  Mic,
  MicOff,
  Paperclip,
  X,
  ChevronRight,
  Sparkles,
  Rocket,
  LayoutGrid,
  Activity,
  Zap,
  Copy,
  Check,
  RefreshCw,
  Square,
  Trash2,
  Image as ImageIcon,
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

type RailItem = {
  id: string;
  label: string;
  icon: typeof Terminal;
  tool?: string;
  href?: string;
};

const RAIL_ITEMS: RailItem[] = [
  { id: "terminal", label: "Terminal", icon: Terminal },
  { id: "projects", label: "Projects", icon: FolderKanban, href: "/projects" },
  { id: "pipelines", label: "Pipelines", icon: GitBranch, tool: "pipeline" },
  { id: "agents", label: "Agents", icon: Bot, tool: "agents" },
  { id: "assets", label: "Assets", icon: FolderOpen, tool: "gallery" },
  { id: "knowledge", label: "Knowledge", icon: BookOpen, href: "/docs" },
  { id: "spaces", label: "Spaces", icon: Boxes, tool: "space" },
  { id: "settings", label: "Settings", icon: Settings, href: "/settings" },
];

const SLASH_CHIPS = [
  { id: "image", label: "/image", desc: "Generate Image", tool: "image" },
  { id: "video", label: "/video", desc: "Generate Video", tool: "video" },
  { id: "audio", label: "/audio", desc: "Generate Audio", tool: "audio" },
  { id: "build", label: "/build", desc: "Build Anything", tool: "builder" },
  { id: "code", label: "/code", desc: "Generate Code", tool: "canvas" },
  { id: "agent", label: "/agent", desc: "Run Agent", tool: "agents" },
];

const QUICK_START = ["Show me around", "Help me build", "Analyze this"];

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
      {copied ? <Check size={10} /> : <Copy size={10} />}
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
  const metrics = [
    { label: "GPU", value: 68, color: "#22d3ee" },
    { label: "CPU", value: 32, color: "#f97316" },
    { label: "RAM", value: 72, color: "#a855f7" },
    { label: "NET", value: 42, color: "#34d399" },
  ];
  return (
    <div className="flex min-w-0 items-center gap-2 px-3 text-[9px] font-mono text-gray-300 sm:gap-4 sm:px-4 sm:text-[10px]">
      <div className="flex items-center gap-1.5">
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 shadow-[0_0_6px_#34d399]" />
        <span className="text-emerald-400">NEURAL LINK</span>
        <span>STABLE</span>
      </div>
      <div className="hidden h-3 w-px bg-white/10 sm:block" />
      {metrics.map((m) => (
        <div key={m.label} className="hidden items-center gap-1.5 sm:flex">
          <span className="uppercase">{m.label}</span>
          <div className="h-1 w-16 overflow-hidden rounded-full bg-white/5">
            <div
              className="h-full rounded-full transition-all duration-700"
              style={{ width: `${m.value}%`, backgroundColor: m.color }}
            />
          </div>
          <span style={{ color: m.color }}>{m.value}%</span>
        </div>
      ))}
      <div className="ml-auto hidden items-center gap-1.5 md:flex">
        <Activity size={10} className="text-cyan-400" />
        <span>NET</span>
        <span className="text-cyan-400">42ms</span>
      </div>
    </div>
  );
}

function LiveClock() {
  const [time, setTime] = useState("--:--:--");
  useEffect(() => {
    const tick = () => {
      const now = new Date();
      setTime(
        now.toLocaleTimeString("en-GB", {
          hour12: false,
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        }) + " UTC+0",
      );
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);
  return <span className="font-mono text-[10px] text-gray-300">{time}</span>;
}

function ActiveCommandTabs({
  tabs,
  onClose,
}: {
  tabs: { id: string; label: string }[];
  onClose: (id: string) => void;
}) {
  return (
    <div className="flex items-center gap-2 px-4 pb-2">
      {tabs.map((tab) => (
        <div
          key={tab.id}
          className="group flex items-center gap-2 rounded-md border border-cyan-500/20 bg-cyan-500/5 px-2.5 py-1 text-[10px] font-medium text-cyan-400"
        >
          <span className="h-1.5 w-1.5 rounded-full bg-cyan-400 animate-pulse" />
          {tab.label}
          <button
            onClick={() => onClose(tab.id)}
            aria-label={`Close ${tab.label}`}
            className="text-gray-300 transition hover:text-white"
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
  activeTool = "chat",
  onToolChangeAction,
}: {
  activeTool?: string;
  onToolChangeAction?: (tool: string) => void;
}) {
  const router = useRouter();
  const { resolvedColors: T } = useTheme();
  const { profile } = useProfile();
  const {
    voiceState,
    interimTranscript,
    micLevel,
    errorMessage,
    listeningDurationMs,
    availableDevices,
    selectedDeviceId,
    speakText,
    startVoice,
    stopVoice,
    interrupt,
    stopSpeaking,
    selectDevice,
    setOnTurn,
    setActivity,
  } = useVoiceSession();
  const { persona } = usePersona();
  const [messages, setMessages] = useState<Message[]>([]);
  const [busy, setBusy] = useState(false);
  const [input, setInput] = useState("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [activeTab, setActiveTab] = useState("terminal");
  const [pluginsOpen, setPluginsOpen] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [activeCommands, setActiveCommands] = useState<
    { id: string; label: string }[]
  >([]);
  const transcriptRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const textInputRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const prevPersonaRef = useRef(persona.id);

  const displayName = profile?.displayName || "Operator";
  const isEmpty = messages.length === 0;
  const micActive =
    voiceState === "requesting_permission" ||
    voiceState === "connecting" ||
    voiceState === "listening" ||
    voiceState === "speech_detected" ||
    voiceState === "transcribing" ||
    voiceState === "sending" ||
    voiceState === "thinking" ||
    voiceState === "using_tool" ||
    voiceState === "reading_files" ||
    voiceState === "writing_files" ||
    voiceState === "running_command" ||
    voiceState === "testing" ||
    voiceState === "generating_response" ||
    voiceState === "speaking" ||
    voiceState === "muted" ||
    voiceState === "paused" ||
    voiceState === "error";

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

  // Voice transcripts are finalised after a silence gap — auto-send and speak reply
  useEffect(() => {
    setOnTurn((text) => {
      if (!text) return;
      void send(text).then((reply) => {
        if (reply) speakText(reply);
      });
    });
    return () => setOnTurn(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const clearChat = useCallback(() => {
    if (busy) abortRef.current?.abort();
    setMessages([]);
    setAttachments([]);
  }, [busy]);

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

  const removeAttachment = useCallback((idx: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== idx));
  }, []);

  // Run slash commands like /image, /audio, /video inline in the chat
  const runSlashCommand = useCallback(
    async (text: string) => {
      const match = text.match(
        /^\/(image|audio|video|build|code|agent)\s*(.*)/i,
      );
      if (!match) return false;
      const [, cmd, raw] = match;
      const prompt = raw.trim();

      const placeholderIndex = messages.length + 1;

      if (cmd === "image") {
        if (!prompt) {
          setMessages((prev) => [
            ...prev,
            {
              role: "assistant",
              content:
                "Add a prompt after `/image`, e.g. `/image a futuristic city at sunset`.",
              createdAt: Date.now(),
            },
          ]);
          return true;
        }
        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            content: `Generating image: “${prompt}”…`,
            createdAt: Date.now(),
            type: "image",
            status: "pending",
          },
        ]);
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
          setMessages((current) => {
            if (placeholderIndex >= current.length) return current;
            const next = current.slice();
            next[placeholderIndex] = {
              ...next[placeholderIndex],
              content: `Generated image: ${prompt}`,
              mediaUrl: data.downloadUrl,
              status: "complete",
            };
            return next;
          });
        } catch (err) {
          setMessages((current) => {
            if (placeholderIndex >= current.length) return current;
            const next = current.slice();
            next[placeholderIndex] = {
              ...next[placeholderIndex],
              content:
                err instanceof Error ? err.message : "Image generation failed",
              type: "error",
              status: "error",
            };
            return next;
          });
        }
        return true;
      }

      if (cmd === "audio") {
        if (!prompt) {
          setMessages((prev) => [
            ...prev,
            {
              role: "assistant",
              content:
                "Add a prompt after `/audio`, e.g. `/audio a cinematic sci-fi trailer voiceover`.",
              createdAt: Date.now(),
            },
          ]);
          return true;
        }
        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            content: `Generating audio: “${prompt}”…`,
            createdAt: Date.now(),
            type: "audio",
            status: "pending",
          },
        ]);
        try {
          const res = await fetch("/api/media/generate-audio", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ prompt }),
          });
          const data = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(data.error || "Audio generation failed");
          setMessages((current) => {
            if (placeholderIndex >= current.length) return current;
            const next = current.slice();
            next[placeholderIndex] = {
              ...next[placeholderIndex],
              content: `Generated audio: ${prompt}`,
              mediaUrl: data.audioBase64,
              status: "complete",
            };
            return next;
          });
        } catch (err) {
          setMessages((current) => {
            if (placeholderIndex >= current.length) return current;
            const next = current.slice();
            next[placeholderIndex] = {
              ...next[placeholderIndex],
              content:
                err instanceof Error ? err.message : "Audio generation failed",
              type: "error",
              status: "error",
            };
            return next;
          });
        }
        return true;
      }

      if (cmd === "video") {
        if (!prompt) {
          setMessages((prev) => [
            ...prev,
            {
              role: "assistant",
              content:
                "Add a prompt after `/video`, e.g. `/video a drone flying over a neon city`.",
              createdAt: Date.now(),
            },
          ]);
          return true;
        }
        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            content: `Starting video generation: “${prompt}”…`,
            createdAt: Date.now(),
            type: "video",
            status: "pending",
          },
        ]);
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
                setMessages((current) => {
                  if (placeholderIndex >= current.length) return current;
                  const next = current.slice();
                  next[placeholderIndex] = {
                    ...next[placeholderIndex],
                    content: `Generated video: ${prompt}`,
                    mediaUrl: pollData.videoUri,
                    status: "complete",
                  };
                  return next;
                });
                return;
              }
            }
            throw new Error("Video generation timed out");
          };

          void poll().catch((err) => {
            setMessages((current) => {
              if (placeholderIndex >= current.length) return current;
              const next = current.slice();
              next[placeholderIndex] = {
                ...next[placeholderIndex],
                content:
                  err instanceof Error
                    ? err.message
                    : "Video generation failed",
                type: "error",
                status: "error",
              };
              return next;
            });
          });
        } catch (err) {
          setMessages((current) => {
            if (placeholderIndex >= current.length) return current;
            const next = current.slice();
            next[placeholderIndex] = {
              ...next[placeholderIndex],
              content:
                err instanceof Error ? err.message : "Video generation failed",
              type: "error",
              status: "error",
            };
            return next;
          });
        }
        return true;
      }

      if (cmd === "build") {
        onToolChangeAction?.("builder");
        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            content: prompt
              ? `Switched to the Build tool. Use it to build: ${prompt}`
              : "Switched to the Build tool.",
            createdAt: Date.now(),
          },
        ]);
        return true;
      }

      if (cmd === "code") {
        onToolChangeAction?.("terminal");
        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            content: prompt
              ? `Switched to the Code Terminal. Prompt: ${prompt}`
              : "Switched to the Code Terminal.",
            createdAt: Date.now(),
          },
        ]);
        return true;
      }

      if (cmd === "agent") {
        onToolChangeAction?.("agent");
        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            content: prompt
              ? `Switched to the Agent tool. Task: ${prompt}`
              : "Switched to the Agent tool.",
            createdAt: Date.now(),
          },
        ]);
        return true;
      }

      return false;
    },
    [messages.length, onToolChangeAction],
  );

  const send = useCallback(
    async (value: string, attachmentsArg?: string[]) => {
      const text = value.trim();
      const attachList =
        attachmentsArg ?? attachments.map((a) => a.url).filter(Boolean);
      if ((!text && !attachList.length) || busy) return "";
      const userMessage = text || "(image attachment)";
      const historyForApi = [
        ...messages,
        { role: "user" as const, content: userMessage },
      ];
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
        setActiveCommands(
          parseLiTTActions(fullText).map((a, i) => ({
            id: `${a.type}-${i}`,
            label: a.label,
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
      profile.displayName,
      persona.id,
      setActivity,
      runSlashCommand,
    ],
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
    setInput((prev) => {
      const base = prev.replace(/\s+/g, " ").trim();
      return base ? `${base} ${chip} ` : `${chip} `;
    });
  };

  const closeCommand = (id: string) => {
    setActiveCommands((prev) => prev.filter((c) => c.id !== id));
  };

  const regenerate = () => {
    if (busy) return;
    const lastUserIndex = messages.findLastIndex((m) => m.role === "user");
    if (lastUserIndex === -1) return;
    const trimmed = messages.slice(0, lastUserIndex + 1);
    setMessages(trimmed);
    void send(trimmed[lastUserIndex].content);
  };

  const toggleMic = () => {
    if (micActive) {
      stopVoice();
    } else {
      startVoice();
    }
  };

  return (
    <div
      className="flex h-dvh md:h-full min-h-0 w-full flex-col overflow-hidden bg-[#030308] text-neutral-100"
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

      {/* ── TOP BAR ── */}
      <header className="hidden h-12 shrink-0 items-center justify-between border-b border-white/5 bg-[#030308]/90 px-4 backdrop-blur-md md:flex">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <div className="flex h-6 w-6 items-center justify-center rounded-md bg-gradient-to-br from-cyan-400 to-blue-600">
              <Sparkles size={12} className="text-white" />
            </div>
            <span className="text-sm font-black tracking-[0.15em]">LITT</span>
          </div>
          <div className="ml-4 flex items-center gap-2 rounded-full border border-amber-500/20 bg-amber-500/10 px-2.5 py-1">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber-400" />
            <span className="text-[9px] font-bold uppercase tracking-wider text-amber-400">
              Mission Active
            </span>
            <span className="text-[9px] text-gray-300">
              Everything is under control.
            </span>
          </div>
          {messages.length > 0 && (
            <button
              onClick={clearChat}
              title="Start a new chat"
              className="ml-2 flex items-center gap-1 rounded-md border border-white/10 bg-white/2 px-2 py-1 text-[10px] text-gray-300 transition hover:border-rose-500/30 hover:text-rose-300"
            >
              <Trash2 size={10} />
              New Chat
            </button>
          )}
        </div>

        <div className="flex items-center gap-4">
          <button
            onClick={() => setPluginsOpen((v) => !v)}
            aria-label="Toggle plugin registry"
            className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[9px] font-bold uppercase tracking-wider transition ${
              pluginsOpen
                ? "border-cyan-500/30 bg-cyan-500/10 text-cyan-400"
                : "border-white/10 bg-white/5 text-gray-300 hover:text-white"
            }`}
          >
            <LayoutGrid size={12} />
            Plugins
          </button>
          <div className="flex items-center gap-1.5 text-cyan-400">
            <Camera size={12} />
            <span className="text-[9px] font-bold uppercase tracking-wider">
              Vision On
            </span>
          </div>
          <div className="flex flex-col items-end">
            <LiveClock />
          </div>
          <div
            className="flex h-7 w-7 items-center justify-center rounded-full border border-white/10 bg-white/5 text-[10px] font-bold"
            title={displayName}
          >
            {displayName.slice(0, 2).toUpperCase()}
          </div>
        </div>
      </header>

      {/* ── BODY ── */}
      <div className="flex min-h-0 flex-1">
        {/* LEFT RAIL */}
        <aside className="hidden w-16 shrink-0 flex-col items-center gap-1 overflow-y-auto border-r border-white/5 bg-[#05050a]/80 py-3 md:flex">
          {RAIL_ITEMS.map((item) => {
            const Icon = item.icon;
            const active = activeTool === item.tool || activeTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => {
                  if (item.href) {
                    router.push(item.href);
                  } else if (item.tool) {
                    onToolChangeAction?.(item.tool);
                  } else {
                    setActiveTab(item.id);
                  }
                }}
                aria-label={item.label}
                className={`group relative flex w-11 flex-col items-center justify-center gap-1 rounded-xl py-2.5 transition-colors ${
                  active ? "bg-cyan-500/10" : "hover:bg-white/5"
                }`}
                title={item.label}
              >
                {active && (
                  <span className="absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-full bg-cyan-400 shadow-[0_0_8px_#22d3ee]" />
                )}
                <Icon
                  size={18}
                  className={
                    active
                      ? "text-cyan-400"
                      : "text-gray-300 group-hover:text-white"
                  }
                />
                <span
                  className={`text-[8px] font-bold ${
                    active
                      ? "text-cyan-400"
                      : "text-gray-300 group-hover:text-neutral-200"
                  }`}
                >
                  {item.label}
                </span>
              </button>
            );
          })}
          <div className="w-full border-t border-white/5" />
          <PersonaSwitcher />
          <div className="mt-auto flex flex-col items-center gap-2 py-2">
            <div className="text-center">
              <div className="text-[9px] font-black text-cyan-400">LITT OS</div>
              <div className="text-[8px] text-gray-300">v2.2.0</div>
            </div>
            <div className="flex items-center gap-1 text-[8px] text-emerald-400">
              <span className="h-1 w-1 rounded-full bg-emerald-400" />
              ONLINE
            </div>
          </div>
        </aside>

        {/* MAIN STAGE */}
        <main className="relative flex min-w-0 flex-1 flex-col overflow-hidden">
          {/* Ambient background - simplified on mobile to reduce paint */}
          <div
            className="pointer-events-none absolute inset-0 hidden opacity-40 sm:block"
            style={{
              backgroundImage:
                "radial-gradient(circle at 50% 60%, rgba(34,211,238,0.10) 0%, transparent 45%), radial-gradient(circle at 80% 20%, rgba(168,85,247,0.08) 0%, transparent 35%)",
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
          <div className="relative z-10 flex min-h-14 shrink-0 items-center justify-between border-b border-white/5 px-4 py-2 sm:border-0 sm:px-6 sm:pt-5">
            <div className="flex items-center gap-3">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-cyan-500/20 bg-cyan-500/10">
                <Terminal size={16} className="text-cyan-400" />
              </div>
              <div>
                <div className="text-sm font-black tracking-wide text-white">
                  LITT Terminal
                </div>
                <div className="hidden text-[10px] text-gray-300 sm:block">
                  Your intelligent workspace. One command away.
                </div>
              </div>
            </div>
            <div className="flex items-center gap-3 text-[10px]">
              <span className="flex items-center gap-1.5 rounded-full border border-white/5 bg-white/5 px-2.5 py-1 text-gray-300">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                SYSTEMS NOMINAL
              </span>
              <span className="hidden font-mono text-gray-300 sm:inline">
                MEMORY 78%
              </span>
              <span className="hidden font-mono text-gray-300 md:inline">
                CONTEXT 128K
              </span>
              <span className="hidden font-mono text-gray-300 md:inline">
                TOKENS 1.2M
              </span>
            </div>
          </div>

          {/* Scrollable content */}
          <div
            ref={transcriptRef}
            className="relative z-10 min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6"
          >
            {isEmpty ? (
              <div className="mx-auto flex min-h-0 max-w-3xl flex-col items-center justify-start gap-3 py-4 sm:min-h-full sm:justify-center sm:gap-6 sm:py-6">
                <div className="flex flex-col items-center gap-2 text-center sm:gap-3">
                  <div className="text-[11px] font-bold uppercase tracking-[0.2em] text-cyan-400 sm:text-xs">
                    Welcome back, {displayName}.
                  </div>
                  <h1 className="max-w-xl text-lg font-light leading-tight sm:text-3xl">
                    What can I{" "}
                    <span className="font-black text-transparent bg-clip-text bg-gradient-to-r from-cyan-300 to-blue-400">
                      amplify
                    </span>{" "}
                    in your mission today?
                  </h1>
                </div>

                {/* Hero visualization */}
                <div className="relative hidden h-16 w-full max-w-xs items-center justify-center sm:flex sm:h-40 sm:max-w-md">
                  <div
                    className="absolute inset-0 rounded-full blur-2xl"
                    style={{
                      background:
                        "radial-gradient(circle, rgba(34,211,238,0.12) 0%, transparent 70%)",
                    }}
                  />
                  <svg
                    viewBox="0 0 400 200"
                    className="h-full w-full"
                    style={{ opacity: 0.7 }}
                  >
                    <defs>
                      <linearGradient
                        id="lineGrad"
                        x1="0%"
                        y1="0%"
                        x2="100%"
                        y2="0%"
                      >
                        <stop offset="0%" stopColor="rgba(34,211,238,0)" />
                        <stop offset="50%" stopColor="rgba(34,211,238,0.6)" />
                        <stop offset="100%" stopColor="rgba(34,211,238,0)" />
                      </linearGradient>
                    </defs>
                    <path
                      d="M0,150 Q100,180 200,100 T400,150"
                      fill="none"
                      stroke="url(#lineGrad)"
                      strokeWidth="1.5"
                    />
                    <path
                      d="M0,120 Q100,60 200,120 T400,80"
                      fill="none"
                      stroke="url(#lineGrad)"
                      strokeWidth="1"
                      opacity="0.5"
                    />
                    <path
                      d="M0,170 Q120,140 220,160 T400,120"
                      fill="none"
                      stroke="url(#lineGrad)"
                      strokeWidth="1"
                      opacity="0.3"
                    />
                    {[...Array(24)].map((_, i) => {
                      const x = (i / 23) * 360 + 20;
                      const y = 100 + Math.sin(i * 0.7) * 30;
                      return (
                        <circle
                          key={i}
                          cx={x}
                          cy={y}
                          r={1.5}
                          fill="rgba(34,211,238,0.7)"
                        />
                      );
                    })}
                  </svg>
                </div>

                {/* Action cards */}
                <div className="grid w-full grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-3">
                  {[
                    {
                      icon: Sparkles,
                      title: "Create",
                      desc: "Scaffold apps, services, and pipelines.",
                    },
                    {
                      icon: Activity,
                      title: "Analyze",
                      desc: "Inspect logs, data, and system health.",
                    },
                    {
                      icon: Rocket,
                      title: "Build",
                      desc: "Generate code, infra, and docs.",
                    },
                    {
                      icon: Zap,
                      title: "Automate",
                      desc: "Design workflows and integrations.",
                    },
                  ].map((card) => (
                    <button
                      key={card.title}
                      onClick={() =>
                        void send(
                          `Help me ${card.title.toLowerCase()} something`,
                        )
                      }
                      className="group flex min-h-[72px] flex-col gap-1 rounded-xl border border-white/5 bg-white/2 p-2 text-left transition hover:border-cyan-500/20 hover:bg-cyan-500/5 sm:min-h-20 sm:gap-1.5 sm:p-3"
                    >
                      <div className="flex items-center justify-between">
                        <card.icon
                          size={14}
                          className="text-cyan-400 transition group-hover:scale-110 sm:size-[15px]"
                        />
                        <ChevronRight
                          size={12}
                          className="text-gray-300 group-hover:text-cyan-400"
                        />
                      </div>
                      <div className="text-xs font-bold sm:text-sm">
                        {card.title}
                      </div>
                      <div className="text-[10px] leading-relaxed text-neutral-300 sm:text-[11px]">
                        {card.desc}
                      </div>
                    </button>
                  ))}
                </div>

                <button
                  onClick={() => setPluginsOpen(true)}
                  className="flex items-center gap-1.5 text-[10px] font-bold text-neutral-300 transition hover:text-cyan-400 sm:text-xs"
                >
                  <LayoutGrid size={12} />
                  View all plugins
                  <ChevronRight size={10} />
                </button>
              </div>
            ) : (
              <div className="mx-auto flex max-w-3xl flex-col gap-4">
                {messages.map((message, index) => {
                  const isUser = message.role === "user";
                  const isLastAssistant =
                    !isUser && index === messages.length - 1 && !busy;
                  return (
                    <div
                      key={index}
                      className={`flex gap-3 ${
                        isUser ? "flex-row-reverse" : "flex-row"
                      }`}
                    >
                      <div
                        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${
                          isUser
                            ? "border border-orange-500/20 bg-orange-500/10"
                            : "border border-cyan-500/20 bg-cyan-500/10"
                        }`}
                      >
                        {isUser ? (
                          <span className="text-[10px] font-bold text-orange-400">
                            {displayName.slice(0, 1).toUpperCase()}
                          </span>
                        ) : (
                          <Bot size={14} className="text-cyan-400" />
                        )}
                      </div>
                      <div
                        className={`flex max-w-[85%] flex-col ${
                          isUser ? "items-end" : "items-start"
                        }`}
                      >
                        <div className="overflow-hidden rounded-2xl border border-white/10 bg-white/3 px-3.5 py-2.5 text-xs leading-relaxed shadow-sm">
                          {isUser ? (
                            message.content
                          ) : message.type === "image" && message.mediaUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={message.mediaUrl}
                              alt={message.content}
                              className="max-w-full rounded-xl border border-white/10"
                              loading="lazy"
                            />
                          ) : message.type === "audio" && message.mediaUrl ? (
                            <audio
                              src={message.mediaUrl}
                              controls
                              className="w-full min-w-[240px]"
                              preload="metadata"
                            />
                          ) : message.type === "video" && message.mediaUrl ? (
                            <video
                              src={message.mediaUrl}
                              controls
                              className="max-w-full rounded-xl border border-white/10"
                              preload="metadata"
                            />
                          ) : message.type === "error" ? (
                            <div className="text-xs leading-relaxed text-rose-300">
                              {message.content}
                            </div>
                          ) : (
                            <div className="prose prose-invert prose-sm max-w-none prose-p:my-1 prose-pre:my-1">
                              <ReactMarkdown>{message.content}</ReactMarkdown>
                            </div>
                          )}
                        </div>
                        <div className="mt-1 flex items-center gap-2 px-1">
                          <span className="text-[9px] text-gray-300">
                            {message.createdAt
                              ? new Date(message.createdAt).toLocaleTimeString(
                                  [],
                                  {
                                    hour: "2-digit",
                                    minute: "2-digit",
                                  },
                                )
                              : ""}
                          </span>
                          {!isUser &&
                            (!message.type || message.type === "text") &&
                            message.content && (
                              <>
                                <CopyButton text={message.content} />
                                <button
                                  onClick={() => speakText(message.content)}
                                  className="flex items-center gap-1 text-[9px] text-gray-300 transition hover:text-cyan-400"
                                >
                                  <Zap size={10} /> Speak
                                </button>
                                {isLastAssistant && (
                                  <button
                                    onClick={regenerate}
                                    disabled={busy}
                                    className="flex items-center gap-1 text-[9px] text-gray-300 transition hover:text-cyan-400 disabled:opacity-40"
                                  >
                                    <RefreshCw size={10} /> Regen
                                  </button>
                                )}
                              </>
                            )}
                        </div>
                      </div>
                    </div>
                  );
                })}
                {busy && (
                  <div className="flex items-center gap-2 text-[10px] text-cyan-400">
                    <span className="flex gap-0.5">
                      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-cyan-300" />
                      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-cyan-300 [animation-delay:0.1s]" />
                      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-cyan-300 [animation-delay:0.2s]" />
                    </span>
                    LiTT is thinking…
                    <button
                      onClick={cancel}
                      className="ml-2 flex items-center gap-1 rounded border border-white/10 bg-white/2 px-1.5 py-0.5 text-[9px] text-gray-300 transition hover:border-rose-500/30 hover:text-rose-300"
                      title="Cancel (Esc)"
                    >
                      <Square size={8} /> Stop
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Mobile tool rail removed in favor of the global bottom nav. */}

          {/* COMMAND BAR */}
          <div className="relative z-20 shrink-0 border-t border-white/5 bg-[#030308]/95 px-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-3 backdrop-blur-md sm:px-6 sm:py-3">
            <div className="mx-auto flex max-w-4xl flex-col gap-2">
              {cameraOpen && (
                <div className="mb-1 overflow-hidden rounded-2xl border border-white/10 bg-black shadow-2xl">
                  <CameraSession
                    onSnapshot={(url) => {
                      void send("Describe what you see.", [url]);
                      setCameraOpen(false);
                    }}
                    onClose={() => setCameraOpen(false)}
                    modelName={persona.name}
                  />
                </div>
              )}
              {micActive && (
                <div className="mb-1 overflow-hidden rounded-xl border border-white/10 bg-white/5 p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-3">
                      <div className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-cyan-500/10">
                        <Waveform
                          active={
                            voiceState === "listening" ||
                            voiceState === "speech_detected" ||
                            voiceState === "connecting"
                          }
                        />
                        {(voiceState === "listening" ||
                          voiceState === "speech_detected") && (
                          <span className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-emerald-400 ring-2 ring-[#030308]" />
                        )}
                      </div>
                      <div className="min-w-0">
                        <div className="text-xs font-bold text-white truncate">
                          {voiceState === "requesting_permission" &&
                            "Allow microphone"}
                          {voiceState === "connecting" && "Connecting..."}
                          {voiceState === "listening" && "Listening"}
                          {voiceState === "speech_detected" && "Hearing you"}
                          {voiceState === "transcribing" && "Transcribing"}
                          {voiceState === "sending" && "Sending"}
                          {voiceState === "thinking" && "Thinking..."}
                          {voiceState === "using_tool" && "Using tool..."}
                          {voiceState === "reading_files" && "Reading files..."}
                          {voiceState === "writing_files" && "Writing files..."}
                          {voiceState === "running_command" &&
                            "Running command..."}
                          {voiceState === "testing" && "Running tests..."}
                          {voiceState === "generating_response" &&
                            "Generating response..."}
                          {voiceState === "speaking" && "LiTT is speaking"}
                          {voiceState === "muted" && "Paused"}
                          {voiceState === "error" && "Voice error"}
                        </div>
                        <div className="text-[10px] text-gray-300 truncate">
                          {errorMessage
                            ? errorMessage
                            : interimTranscript ||
                              `00:${Math.floor(listeningDurationMs / 1000)
                                .toString()
                                .padStart(2, "0")}`}
                        </div>
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {voiceState === "speaking" && (
                        <button
                          onClick={interrupt}
                          className="rounded-md border border-white/10 bg-white/5 px-2 py-1 text-[10px] font-bold text-neutral-300 transition hover:bg-white/10"
                        >
                          Interrupt
                        </button>
                      )}
                      <button
                        onClick={() =>
                          voiceState === "speaking"
                            ? stopSpeaking()
                            : stopVoice()
                        }
                        className="rounded-md border border-rose-500/20 bg-rose-500/10 px-2 py-1 text-[10px] font-bold text-rose-300 transition hover:bg-rose-500/20"
                      >
                        {voiceState === "speaking" ? "Stop" : "End"}
                      </button>
                    </div>
                  </div>
                  {(voiceState === "listening" ||
                    voiceState === "speech_detected" ||
                    voiceState === "connecting") && (
                    <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-white/5">
                      <div
                        className="h-full bg-cyan-400 transition-all duration-100"
                        style={{ width: `${Math.max(5, micLevel * 100)}%` }}
                      />
                    </div>
                  )}
                  {(voiceState === "speech_detected" ||
                    voiceState === "transcribing" ||
                    voiceState === "sending" ||
                    voiceState === "thinking" ||
                    voiceState === "using_tool" ||
                    voiceState === "reading_files" ||
                    voiceState === "writing_files" ||
                    voiceState === "running_command" ||
                    voiceState === "testing" ||
                    voiceState === "generating_response" ||
                    voiceState === "speaking") && (
                    <div className="mt-2 flex items-center gap-2 overflow-x-auto text-[10px] text-gray-300 scrollbar-none">
                      {[
                        { key: "hear", label: "Heard", done: true },
                        {
                          key: "transcribe",
                          label: "Transcribed",
                          done: voiceState !== "speech_detected",
                        },
                        {
                          key: "think",
                          label: "Thinking",
                          done: ["generating_response", "speaking"].includes(
                            voiceState,
                          ),
                        },
                        {
                          key: "respond",
                          label: "Responding",
                          done: voiceState === "speaking",
                        },
                      ].map((step, idx, arr) => (
                        <span
                          key={step.key}
                          className="flex shrink-0 items-center gap-1"
                        >
                          <span className={step.done ? "text-emerald-400" : ""}>
                            {step.done ? "✓" : "○"}
                          </span>
                          <span className={step.done ? "text-neutral-300" : ""}>
                            {step.label}
                          </span>
                          {idx < arr.length - 1 && (
                            <span className="text-white/10">›</span>
                          )}
                        </span>
                      ))}
                    </div>
                  )}
                  {availableDevices.length > 1 && (
                    <div className="mt-2 flex items-center gap-2 border-t border-white/5 pt-2">
                      <span className="text-[10px] text-gray-300">Mic:</span>
                      <select
                        name="mic-device"
                        id="litt-mic-device"
                        value={selectedDeviceId ?? ""}
                        onChange={(e) => selectDevice(e.target.value)}
                        className="max-w-[180px] rounded border border-white/10 bg-white/3 px-2 py-1 text-[10px] text-neutral-300 outline-none"
                      >
                        {availableDevices.map((d) => (
                          <option key={d.deviceId} value={d.deviceId}>
                            {d.label || "Microphone"}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>
              )}

              <AttachmentStrip
                attachments={attachments}
                onRemove={removeAttachment}
              />
              <div className="flex flex-wrap items-end gap-2 sm:flex-nowrap sm:items-center">
                <button
                  aria-label="Add attachment"
                  onClick={() => fileInputRef.current?.click()}
                  className="order-2 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-white/5 text-neutral-300 transition hover:bg-white/10 sm:order-none sm:h-9 sm:w-9"
                >
                  <Plus size={15} />
                </button>
                <button
                  aria-label="Capture from camera"
                  onClick={() => setCameraOpen(true)}
                  className={`order-2 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border transition sm:order-none sm:h-9 sm:w-9 ${
                    cameraOpen
                      ? "border-cyan-500/40 bg-cyan-500/10 text-cyan-400"
                      : "border-white/10 bg-white/5 text-neutral-300 hover:bg-white/10"
                  }`}
                >
                  <Camera size={15} />
                </button>
                <button
                  aria-label={micActive ? "Stop voice" : "Start voice"}
                  onClick={toggleMic}
                  className={`order-2 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border transition sm:order-none sm:h-9 sm:w-9 ${
                    micActive
                      ? "border-rose-500/40 bg-rose-500/10 text-rose-300 hover:bg-rose-500/20"
                      : "border-white/10 bg-white/5 text-neutral-300 hover:bg-white/10"
                  }`}
                >
                  {micActive ? <MicOff size={15} /> : <Mic size={15} />}
                </button>

                <div className="relative order-1 flex w-full min-w-0 flex-1 items-end sm:order-none sm:w-auto sm:items-center">
                  <textarea
                    ref={textInputRef}
                    name="litt-message"
                    id="litt-message-input"
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={handleKeyDown}
                    aria-label="Message LITT"
                    placeholder="Ask LiTT..."
                    rows={1}
                    className="max-h-32 min-h-11 w-full resize-none rounded-xl border border-white/10 bg-white/3 py-2.5 pl-3 pr-12 text-sm leading-5 text-neutral-100 outline-none placeholder:text-gray-400 focus:border-cyan-500/30 focus:bg-white/5 sm:min-h-12 sm:py-3 sm:pl-4 sm:text-base"
                  />
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
                    {busy ? <Square size={12} /> : <Send size={15} />}
                  </button>
                </div>

                <button
                  aria-label="Attach file"
                  onClick={() => fileInputRef.current?.click()}
                  className="order-2 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-white/5 text-neutral-300 transition hover:bg-white/10 sm:order-none sm:h-9 sm:w-9"
                >
                  <Paperclip size={15} />
                </button>
              </div>

              <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-none [&::-webkit-scrollbar]:hidden">
                {SLASH_CHIPS.map((chip) => (
                  <button
                    key={chip.id}
                    onClick={() =>
                      onToolChangeAction
                        ? onToolChangeAction(chip.tool)
                        : handleChip(chip.label)
                    }
                    className="flex shrink-0 items-center gap-1 rounded-md border border-white/5 bg-white/2 px-2 py-1 text-[11px] text-gray-300 transition hover:border-cyan-500/20 hover:text-cyan-400"
                  >
                    <span className="text-cyan-500">{chip.label}</span>
                    <span className="hidden text-gray-400 sm:inline">
                      {chip.desc}
                    </span>
                  </button>
                ))}
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

            <ActiveCommandTabs tabs={activeCommands} onClose={closeCommand} />
          </div>

          {/* FOOTER TELEMETRY */}
          <div className="relative z-20 hidden h-8 shrink-0 items-center border-t border-white/5 bg-[#030308]/90 sm:flex">
            <TelemetryBar />
            <div className="ml-auto flex items-center gap-2 px-4 text-[10px] text-gray-400">
              <span>&ldquo;Greatness is built, not generated.&rdquo;</span>
              <span className="font-black tracking-widest text-cyan-500/60">
                LITT
              </span>
            </div>
          </div>
        </main>

        {/* RIGHT PRESENCE PANEL / PLUGIN REGISTRY */}
        {pluginsOpen && (
          <div
            className="fixed inset-0 z-40 bg-black/60 md:hidden"
            onClick={() => setPluginsOpen(false)}
            aria-hidden="true"
          />
        )}
        <aside
          className={cn(
            "shrink-0 flex-col border-l border-white/5 bg-[#05050a]/80",
            pluginsOpen
              ? "fixed inset-y-0 right-0 z-50 flex w-[85%] md:relative md:inset-auto md:w-[300px] lg:relative"
              : "hidden w-[300px] lg:flex",
          )}
        >
          {pluginsOpen ? (
            <PluginPanel onClose={() => setPluginsOpen(false)} />
          ) : (
            <>
              <div className="flex items-center gap-2 border-b border-white/5 px-4 py-3">
                <span className="text-xs font-black uppercase tracking-[0.18em] text-gray-300">
                  LITT Presence
                </span>
                <div className="ml-auto flex items-center gap-1 text-[10px] text-emerald-400">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  ONLINE
                </div>
              </div>

              <div className="flex flex-col items-center gap-3 border-b border-white/5 px-4 py-6">
                <LiTTAvatar size={90} />
                <div className="text-center">
                  <div className="text-sm font-black text-white">
                    {persona.name}
                  </div>
                  <div className="flex items-center justify-center gap-2 text-[10px] text-gray-300">
                    <span style={{ color: persona.color }}>{persona.tag}</span>
                    <span>·</span>
                    <span>Omni</span>
                    <span>·</span>
                    <span>128K Context</span>
                  </div>
                </div>
                <div className="flex w-full items-center justify-between rounded-lg border border-white/5 bg-white/2 px-3 py-2">
                  <span className="text-[10px] font-bold text-gray-300">
                    Voice
                  </span>
                  <span
                    className="text-[10px] font-bold"
                    style={{ color: persona.color }}
                  >
                    {persona.name}
                  </span>
                  <span className="flex items-center gap-1 text-[9px] text-emerald-400">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                    {micActive ? "Listening" : "Live"}
                  </span>
                </div>
              </div>

              <div className="flex flex-1 flex-col gap-3 overflow-hidden px-4 py-4">
                <div className="text-[10px] font-black uppercase tracking-[0.18em] text-gray-300">
                  Speaking Now
                </div>
                <Waveform active={busy || micActive} />

                <div className="text-[10px] font-black uppercase tracking-[0.18em] text-gray-300">
                  Recent Transcript
                </div>
                <div className="flex flex-1 flex-col gap-2 overflow-y-auto rounded-xl border border-white/5 bg-white/2 p-3">
                  {messages.length === 0 ? (
                    <div className="text-[10px] leading-relaxed text-gray-300">
                      Hey, I am {persona.name}.
                      <br />
                      Need help building something?
                      <br />
                      <br />I can see your workspace and talk you through it.
                    </div>
                  ) : (
                    messages.slice(-6).map((m, i) => (
                      <div
                        key={i}
                        className={`flex items-start gap-2 text-[10px] ${
                          m.role === "user" ? "text-gray-300" : "text-cyan-400"
                        }`}
                      >
                        <span className="mt-0.5 shrink-0 text-[8px] text-gray-300">
                          {m.role === "user" ? "You" : "LITT"}
                        </span>
                        <span className="line-clamp-3">{m.content}</span>
                      </div>
                    ))
                  )}
                </div>

                <div className="text-[10px] font-black uppercase tracking-[0.18em] text-gray-300">
                  Quick Replies
                </div>
                <div className="flex flex-wrap gap-2">
                  {QUICK_START.map((q) => (
                    <button
                      key={q}
                      onClick={() => void send(q)}
                      className="rounded-full border border-white/10 bg-white/3 px-2.5 py-1 text-[10px] text-gray-300 transition hover:border-cyan-500/20 hover:text-cyan-400"
                    >
                      {q}
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}
        </aside>
      </div>
    </div>
  );
}

export default function LITTTerminalShell(props: {
  activeTool?: string;
  onToolChangeAction?: (tool: string) => void;
}) {
  return (
    <PersonaProvider>
      <LITTTerminalShellInner {...props} />
    </PersonaProvider>
  );
}
