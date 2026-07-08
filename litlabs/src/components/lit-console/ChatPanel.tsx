"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import {
  User,
  Bot,
  Loader2,
  FileCode,
  Terminal,
  Copy,
  Check,
  Play,
  Brain,
  FileText,
  ChevronDown,
  ChevronUp,
  Sparkles,
  Activity,
  Palette,
  Image,
  Wand2,
  Plus,
} from "lucide-react";
import { useLitConsoleTheme } from "./useLitConsoleTheme";

export interface Message {
  id: string;
  role: "user" | "lit" | "tool" | "system";
  content: string;
  attachment?: {
    name: string;
    url: string;
    type: string;
  };
  meta?: {
    tool?: string;
    status?: "running" | "done" | "error";
    images?: Array<{ url: string; prompt: string; provider: string }>;
    thoughts?: string[];
    readFiles?: string[];
  };
}

const WALLPAPERS: Array<{ id: string; label: string; style?: CSSProperties }> = [
  { id: "none", label: "Default", style: undefined },
  {
    id: "grid",
    label: "Grid",
    style: {
      backgroundImage:
        "radial-gradient(circle at 50% 8%, rgba(34,211,238,0.16), transparent 34%), linear-gradient(rgba(34,211,238,0.13) 1px, transparent 1px), linear-gradient(90deg, rgba(34,211,238,0.10) 1px, transparent 1px)",
      backgroundSize: "100% 100%, 32px 32px, 32px 32px",
    },
  },
  {
    id: "dots",
    label: "Dots",
    style: {
      backgroundImage:
        "radial-gradient(circle at 18% 22%, rgba(251,146,60,0.20), transparent 26%), radial-gradient(circle at 78% 16%, rgba(34,211,238,0.18), transparent 28%), radial-gradient(rgba(255,255,255,0.22) 1px, transparent 1px)",
      backgroundSize: "100% 100%, 100% 100%, 18px 18px",
    },
  },
  {
    id: "cyan-glow",
    label: "Cyan Glow",
    style: {
      backgroundImage:
        "radial-gradient(circle at 50% 12%, rgba(0,245,255,0.34), transparent 34%), radial-gradient(circle at 22% 70%, rgba(59,130,246,0.18), transparent 30%)",
    },
  },
  {
    id: "purple-glow",
    label: "Purple Glow",
    style: {
      backgroundImage:
        "radial-gradient(circle at 50% 15%, rgba(217,70,239,0.30), transparent 34%), radial-gradient(circle at 82% 74%, rgba(124,58,237,0.24), transparent 32%)",
    },
  },
  {
    id: "stars",
    label: "Stars",
    style: {
      backgroundImage:
        "radial-gradient(circle at 50% 20%, rgba(255,255,255,0.12), transparent 34%), radial-gradient(rgba(255,255,255,0.35) 1px, transparent 1px), radial-gradient(rgba(34,211,238,0.28) 1px, transparent 1px)",
      backgroundSize: "100% 100%, 46px 46px, 27px 27px",
      backgroundPosition: "0 0, 0 0, 13px 11px",
    },
  },
  {
    id: "aurora",
    label: "Aurora",
    style: {
      backgroundImage:
        "linear-gradient(125deg, rgba(34,211,238,0.18), rgba(217,70,239,0.22), rgba(251,146,60,0.16), rgba(34,211,238,0.18))",
      backgroundSize: "220% 220%",
      animation: "litAurora 10s ease infinite",
    },
  },
  {
    id: "pulse-grid",
    label: "Pulse Grid",
    style: {
      backgroundImage:
        "radial-gradient(circle at 50% 12%, rgba(251,146,60,0.18), transparent 32%), linear-gradient(rgba(251,146,60,0.13) 1px, transparent 1px), linear-gradient(90deg, rgba(34,211,238,0.10) 1px, transparent 1px)",
      backgroundSize: "100% 100%, 36px 36px, 36px 36px",
      animation: "litPulseGrid 5s ease-in-out infinite",
    },
  },
  {
    id: "holo-scan",
    label: "Holo Scan",
    style: {
      backgroundImage:
        "radial-gradient(circle at 50% 18%, rgba(34,211,238,0.24), transparent 34%), repeating-linear-gradient(0deg, rgba(34,211,238,0.08), rgba(34,211,238,0.08) 1px, transparent 2px, transparent 5px)",
      animation: "litScan 7s linear infinite",
    },
  },
];

const WALLPAPER_KEY = "lit-chat-wallpaper";

const PARTICLES = Array.from({ length: 18 }).map((_, i) => ({
  id: i,
  size: i % 2 === 0 ? 2 : 3,
  left: ((i * 37) % 100),
  top: ((i * 53) % 100),
  duration: 6 + ((i * 17) % 8),
  delay: (i * 7) % 5,
}));

function suggestedActions(text: string): string[] {
  const lower = text.toLowerCase();
  if (lower.includes("landing page") || lower.includes("website")) {
    return ["Build the hero section", "Add a features grid", "Make it responsive", "Create copy"];
  }
  if (lower.includes("image") || lower.includes("generate")) {
    return ["Generate another", "Create variations", "Save to gallery", "Turn into brand system"];
  }
  if (lower.includes("code") || lower.includes("component") || lower.includes("tsx")) {
    return ["Fix issues", "Explain the code", "Add tests", "Refactor this"];
  }
  if (lower.includes("deploy") || lower.includes("build")) {
    return ["Run build", "Check logs", "Deploy now", "Summarize risk"];
  }
  if (lower.includes("agent") || lower.includes("create an agent")) {
    return ["Name it", "Set personality", "Define tools", "Publish to marketplace"];
  }
  if (lower.includes("purpose") || lower.includes("concept") || lower.includes("users") || lower.includes("ai")) {
    return ["Shape the product pitch", "Design onboarding", "Define agent memory", "Map the user flow"];
  }
  return ["Make this actionable", "Suggest UI changes", "Create a plan", "Save this direction"];
}

const PROMPT_SUGGESTIONS = [
  "Generate a hero image",
  "Build a landing page",
  "Fix my code",
  "Create an agent",
  "Write a blog post",
  "Design a logo concept",
  "Build a todo app",
  "Create a dashboard",
  "Explain React hooks",
  "Make a pricing card",
  "Generate a music loop",
  "Create a login form",
  "Build a portfolio site",
  "Write a product description",
  "Create a chat component",
  "Generate a video script",
  "Build a navigation bar",
  "Create a settings panel",
  "Write a Twitter thread",
  "Make a 3D skybox prompt",
];

interface ChatPanelProps {
  messages: Message[];
  onSend: (text: string) => void;
  onNewChat?: () => void;
  loading?: boolean;
  onApprove?: (command: string) => void;
  plan?: {
    runId: string | null;
    steps: Array<{
      id: string;
      title: string;
      command?: string | null;
      needs_approval?: boolean;
      risk_level?: string;
    }>;
  };
  onApproveStep?: (runId: string, command: string) => void;
  onApprovePlan?: () => void;
}

type Theme = ReturnType<typeof useLitConsoleTheme>;

function CodeBlock({
  lang,
  code,
  theme,
}: {
  lang: string;
  code: string;
  theme: Theme;
}) {
  const [copied, setCopied] = useState(false);
  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }, [code]);

  return (
    <div
      className="group relative my-2 overflow-hidden rounded-lg border"
      style={{ backgroundColor: theme.bgSecondary, borderColor: theme.border }}
    >
      <div
        className="flex items-center justify-between px-3 py-1.5 text-[10px] uppercase tracking-wider"
        style={{ backgroundColor: theme.bgPanelHover, color: theme.textDim }}
      >
        <span>{lang || "code"}</span>
        <button
          onClick={handleCopy}
          className="rounded p-1 opacity-0 transition-opacity group-hover:opacity-100"
          style={{ color: theme.textMuted }}
          title="Copy"
        >
          {copied ? (
            <Check size={12} style={{ color: theme.success }} />
          ) : (
            <Copy size={12} />
          )}
        </button>
      </div>
      <pre
        className="overflow-x-auto p-3 text-xs"
        style={{ color: theme.textDim, fontFamily: theme.fontMono }}
      >
        <code>{code}</code>
      </pre>
    </div>
  );
}

function ThinkingIndicator({ theme, stage }: { theme: Theme; stage?: number }) {
  const [step, setStep] = useState(0);
  const steps = [
    { label: "Reading context", icon: FileText },
    { label: "Checking memory", icon: Brain },
    { label: "Planning next step", icon: Sparkles },
    { label: "Generating response", icon: Bot },
  ];

  const activeStep = typeof stage === "number" ? Math.max(0, Math.min(steps.length - 1, stage)) : step;

  useEffect(() => {
    if (typeof stage === "number") return;
    const interval = setInterval(() => {
      setStep((s) => (s + 1) % steps.length);
    }, 1400);
    return () => clearInterval(interval);
  }, [steps.length, stage]);

  const ActiveIcon = steps[activeStep].icon;

  return (
    <div
      className="flex w-full gap-3 rounded-2xl border p-3 animate-in fade-in slide-in-from-bottom-2 duration-500"
      style={{ backgroundColor: theme.bgPanel, borderColor: theme.border }}
    >
      <div
        className="mt-0.5 shrink-0 rounded-full p-1.5"
        style={{ backgroundColor: theme.bgSecondary, color: theme.accentCyan }}
      >
        <ActiveIcon size={14} className="animate-pulse" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 text-xs font-bold" style={{ color: theme.text }}>
          <span style={{ color: theme.accentCyan }}>LiT is thinking</span>
          <span className="flex gap-0.5">
            <span className="h-1.5 w-1.5 rounded-full animate-bounce" style={{ backgroundColor: theme.accentCyan, animationDelay: "0ms" }} />
            <span className="h-1.5 w-1.5 rounded-full animate-bounce" style={{ backgroundColor: theme.accentCyan, animationDelay: "150ms" }} />
            <span className="h-1.5 w-1.5 rounded-full animate-bounce" style={{ backgroundColor: theme.accentCyan, animationDelay: "300ms" }} />
          </span>
        </div>
        <div className="mt-2 space-y-1.5">
          {steps.map((s, i) => {
            const Icon = s.icon;
            const active = i === activeStep;
            const past = i < activeStep;
            return (
              <div
                key={s.label}
                className="flex items-center gap-2 text-[10px] transition-all duration-500"
                style={{ color: active ? theme.accentCyan : past ? theme.textMuted : theme.textDim }}
              >
                <div
                  className="flex h-4 w-4 items-center justify-center rounded-full transition-colors duration-500"
                  style={{
                    backgroundColor: active ? `${theme.accentCyan}25` : past ? `${theme.success}15` : theme.bgSecondary,
                    border: `1px solid ${active ? theme.accentCyan : past ? theme.success : theme.border}`,
                  }}
                >
                  {past ? <Check size={8} style={{ color: theme.success }} /> : <Icon size={8} />}
                </div>
                <span className={active ? "font-semibold" : ""}>{s.label}</span>
                {active && <Activity size={10} className="animate-pulse ml-auto" style={{ color: theme.accentCyan }} />}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function formatContent(text: string, theme: Theme) {
  const parts = text.split(/(```[\s\S]*?```)/g);
  return parts.map((part, i) => {
    if (part.startsWith("```")) {
      const fence = part.match(/^```(\w+)?\n?/);
      const lang = fence?.[1] || "";
      const code = part.replace(/^```(\w+)?\n?/, "").replace(/```$/, "");
      return <CodeBlock key={i} lang={lang} code={code} theme={theme} />;
    }
    return (
      <div
        key={i}
        className="whitespace-pre-wrap text-sm leading-relaxed"
        style={{ color: theme.text }}
      >
        {part}
      </div>
    );
  });
}

function GenerateImageTool({ m, theme }: { m: Message; theme: Theme }) {
  const status = m.meta?.status || "done";
  const provider = m.meta?.images?.[0]?.provider || "AI";
  const steps = [
    { label: "Understanding prompt", icon: Sparkles, done: status !== "running" },
    { label: `Calling ${provider}`, icon: Wand2, done: status !== "running" },
    { label: "Rendering image", icon: Image, done: status !== "running" },
  ];
  return (
    <div className="flex w-full gap-3">
      <div
        className="mt-1 shrink-0 rounded-full p-1.5"
        style={{
          backgroundColor: `${theme.accentCyan}15`,
          color: theme.accentCyan,
        }}
      >
        {status === "running" ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
      </div>
      <div
        className="min-w-0 flex-1 rounded-2xl border p-3"
        style={{
          backgroundColor: theme.bgPanel,
          borderColor: theme.border,
          borderLeft: `3px solid ${theme.accentCyan}`,
        }}
      >
        <div className="flex items-center gap-2 text-xs font-bold" style={{ color: theme.text }}>
          <span style={{ color: theme.accentCyan }}>Generate Image</span>
          {status === "done" && (
            <span className="rounded-full px-2 py-0.5 text-[10px] font-bold" style={{ backgroundColor: `${theme.success}20`, color: theme.success }}>
              <Check size={10} className="inline mr-1" />Done
            </span>
          )}
          {status === "error" && (
            <span className="rounded-full px-2 py-0.5 text-[10px] font-bold" style={{ backgroundColor: `${theme.danger}20`, color: theme.danger }}>
              Failed
            </span>
          )}
        </div>

        <div className="mt-3 space-y-2">
          {steps.map((s, i) => {
            const Icon = s.icon;
            const done = status === "done" ? i < 3 : status === "error" ? i < 1 : i === 0;
            const active = status === "running" && i === 1;
            return (
              <div key={s.label} className="flex items-center gap-2 text-[11px]" style={{ color: done ? theme.accentCyan : theme.textDim }}>
                <div className="flex h-4 w-4 items-center justify-center rounded-full" style={{ backgroundColor: done ? `${theme.accentCyan}20` : theme.bgSecondary, border: `1px solid ${done ? theme.accentCyan : theme.border}` }}>
                  {done ? <Check size={8} style={{ color: theme.accentCyan }} /> : <Icon size={8} />}
                </div>
                <span className={active ? "font-semibold" : ""}>{s.label}</span>
                {active && <Loader2 size={10} className="ml-auto animate-spin" style={{ color: theme.accentCyan }} />}
              </div>
            );
          })}
        </div>

        {m.meta?.images?.length ? (
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {m.meta.images.map((image, index) => (
              <a
                key={`${image.url}-${index}`}
                href={image.url}
                target="_blank"
                rel="noopener noreferrer"
                className="group overflow-hidden rounded-xl border"
                style={{
                  backgroundColor: theme.bgPanel,
                  borderColor: theme.border,
                  boxShadow: "0 14px 40px rgba(0,0,0,0.25)",
                }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={image.url}
                  alt={image.prompt}
                  className="aspect-square w-full object-cover transition-transform group-hover:scale-[1.02]"
                />
                <div
                  className="flex items-center justify-between gap-2 px-3 py-2 text-[10px]"
                  style={{ color: theme.textMuted }}
                >
                  <span className="truncate font-semibold" style={{ color: theme.text }}>
                    {image.provider}
                  </span>
                  <span style={{ color: theme.accentCyan }}>Open image</span>
                </div>
              </a>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

export default function ChatPanel({
  messages,
  onSend,
  onNewChat,
  loading,
  onApprove,
  plan,
  onApproveStep,
  onApprovePlan,
}: ChatPanelProps) {
  const LC = useLitConsoleTheme();
  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const isScrolledRef = useRef(false);
  const [activeLitId, setActiveLitId] = useState<string | null>(
    () => [...messages].reverse().find((m) => m.role === "lit")?.id || null,
  );
  const [expandedThoughts, setExpandedThoughts] = useState<Record<string, boolean>>({});
  const [wallpaper, setWallpaper] = useState<string>("none");
  const [wallpaperOpen, setWallpaperOpen] = useState(false);
  const [demoMode, setDemoMode] = useState(false);
  const promptSeed = 0;
  const [revealed, setRevealed] = useState<Record<string, number>>(() => {
    const latest = [...messages].reverse().find((m) => m.role === "lit");
    const init: Record<string, number> = {};
    messages.forEach((m) => {
      if (m.role === "lit") {
        init[m.id] = m.id === latest?.id ? 0 : m.content.length;
      }
    });
    return init;
  });

  useEffect(() => {
    const latestLit = [...messages].reverse().find((m) => m.role === "lit");
    if (!latestLit || latestLit.id === activeLitId) return;
    setActiveLitId(latestLit.id);
    isScrolledRef.current = false;
    setRevealed((prev) => {
      const next: Record<string, number> = { ...prev, [latestLit.id]: 0 };
      messages.forEach((m) => {
        if (m.role === "lit" && m.id !== latestLit.id) {
          next[m.id] = m.content.length;
        }
      });
      return next;
    });
  }, [messages, activeLitId]);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(WALLPAPER_KEY);
      if (saved && WALLPAPERS.find((w) => w.id === saved)) setWallpaper(saved);
    } catch {}
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(WALLPAPER_KEY, wallpaper);
    } catch {}
  }, [wallpaper]);

  useEffect(() => {
    fetch("/api/llm/status")
      .then((res) => res.json())
      .then((data) => setDemoMode(Boolean(data.demoMode)))
      .catch(() => setDemoMode(false));
  }, []);

  const wallpaperRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!wallpaperOpen) return;
    const handle = (e: MouseEvent) => {
      if (!wallpaperRef.current?.contains(e.target as Node)) setWallpaperOpen(false);
    };
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [wallpaperOpen]);

  const activeContent = useMemo(
    () => messages.find((m) => m.id === activeLitId)?.content || "",
    [messages, activeLitId],
  );

  useEffect(() => {
    if (!activeLitId || isScrolledRef.current) return;
    const timer = setInterval(() => {
      setRevealed((prev) => {
        const c = prev[activeLitId] || 0;
        if (c >= activeContent.length) {
          clearInterval(timer);
          return prev;
        }
        return { ...prev, [activeLitId]: c + 1 };
      });
    }, 10);
    return () => clearInterval(timer);
  }, [activeLitId, activeContent]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  const handleScroll = useCallback(() => {
    if (!activeLitId || isScrolledRef.current) return;
    const el = scrollRef.current;
    if (!el) return;
    const isAtBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 20;
    if (isAtBottom) return;
    isScrolledRef.current = true;
    setRevealed((prev) => {
      const content = messages.find((m) => m.id === activeLitId)?.content || "";
      return { ...prev, [activeLitId]: content.length };
    });
  }, [activeLitId, messages]);

  const isEmpty = messages.length === 0;

  const renderLitContent = (m: Message) => {
    const rawLen = revealed[m.id];
    const isStreaming =
      m.id === activeLitId &&
      (rawLen === undefined || rawLen < m.content.length);
    const len = rawLen ?? 0;
    if (isStreaming) {
      return (
        <div
          className="whitespace-pre-wrap text-sm leading-relaxed"
          style={{ color: LC.text }}
        >
          {m.content.slice(0, len)}
          <span
            className="ml-0.5 inline-block h-4 w-0.5 animate-pulse"
            style={{ backgroundColor: LC.accentCyan }}
          />
        </div>
      );
    }
    return <div className="text-sm">{formatContent(m.content, LC)}</div>;
  };

  const activeWallpaper = WALLPAPERS.find((w) => w.id === wallpaper)?.style;

  return (
    <div
      className="relative flex h-full w-full flex-col overflow-hidden"
      style={{ backgroundColor: LC.bg }}
    >
      <style>{`
        @keyframes litAurora {
          0% { background-position: 0% 50%; }
          50% { background-position: 100% 50%; }
          100% { background-position: 0% 50%; }
        }
        @keyframes litPulseGrid {
          0%, 100% { opacity: 0.6; }
          50% { opacity: 1; }
        }
        @keyframes litScan {
          0% { background-position: 0 0; }
          100% { background-position: 0 200px; }
        }
        @keyframes litFloat {
          0%, 100% { transform: translateY(0) translateX(0); opacity: 0.3; }
          50% { transform: translateY(-20px) translateX(10px); opacity: 0.6; }
        }
        @keyframes litOrbit {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
      `}</style>

      {activeWallpaper && (
        <div
          key={wallpaper}
          className="pointer-events-none absolute inset-0 z-0 opacity-100 transition-opacity duration-300"
          style={activeWallpaper}
        />
      )}

      {/* Floating particles overlay (subtle, always on) */}
      <div className="pointer-events-none absolute inset-0 z-0 overflow-hidden opacity-70">
        {PARTICLES.map((p) => (
          <span
            key={p.id}
            className="absolute rounded-full"
            style={{
              width: p.size,
              height: p.size,
              left: `${p.left}%`,
              top: `${p.top}%`,
              backgroundColor: LC.accentCyan,
              boxShadow: `0 0 6px ${LC.accentCyan}`,
              animation: `litFloat ${p.duration}s ease-in-out infinite`,
              animationDelay: `${p.delay}s`,
            }}
          />
        ))}
      </div>

      {/* Holographic scanline overlay */}
      <div
        className="pointer-events-none absolute inset-0 z-0 opacity-[0.04]"
        style={{
          background: `repeating-linear-gradient(0deg, transparent, transparent 2px, ${LC.accentCyan} 3px, transparent 4px)`,
          mixBlendMode: "screen",
        }}
      />
      {/* Holographic vignette glow */}
      <div
        className="pointer-events-none absolute inset-0 z-0"
        style={{
          background: `radial-gradient(circle at 50% 40%, ${LC.accentCyan}08 0%, transparent 55%)`,
        }}
      />

      {/* Chat header with backdrop control */}
      <div className="relative z-10 flex items-center justify-between border-b px-3 py-2 sm:px-4" style={{ borderColor: LC.border, backgroundColor: `${LC.bg}cc`, backdropFilter: "blur(8px)" }}>
        <div className="flex items-center gap-2 text-xs font-black" style={{ color: LC.text }}>
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-75" style={{ backgroundColor: LC.accentCyan }} />
            <span className="relative inline-flex h-2 w-2 rounded-full" style={{ backgroundColor: LC.accentCyan }} />
          </span>
          <Bot size={14} style={{ color: LC.accentCyan }} /> LiTTree Agent
          <span className="hidden text-[9px] font-black uppercase tracking-widest min-[380px]:inline" style={{ color: LC.accentCyan }}>Live</span>
          {demoMode && (
            <span className="rounded-full px-2 py-0.5 text-[9px] font-black" style={{ backgroundColor: `${LC.warning}20`, color: LC.warning }}>
              Demo
            </span>
          )}
        </div>
        <div className="relative flex items-center gap-2">
          {onNewChat && (
            <button
              onClick={onNewChat}
              className="flex h-8 items-center gap-1.5 rounded-lg px-2 text-[11px] font-bold transition-colors hover:bg-white/5 sm:px-2.5"
              style={{ color: LC.textMuted, border: `1px solid ${LC.border}` }}
              title="Start a new chat"
            >
              <Plus size={13} /> <span className="hidden min-[390px]:inline">New</span>
            </button>
          )}
          <button
            onClick={() => setWallpaperOpen((v) => !v)}
            className="flex h-8 items-center gap-1.5 rounded-lg px-2 text-[11px] font-bold transition-colors hover:bg-white/5 sm:px-2.5"
            style={{ color: LC.textMuted, border: `1px solid ${LC.border}` }}
            title="Open chat backdrop panel"
          >
            <Palette size={13} /> <span className="hidden min-[390px]:inline">Backdrop</span>
          </button>
        </div>
      </div>
      {wallpaperOpen && (
        <div className="fixed inset-0 z-50 md:absolute md:inset-auto md:right-4 md:top-14">
          <button
            type="button"
            aria-label="Close backdrop panel"
            className="absolute inset-0 bg-black/60 md:hidden"
            onClick={() => setWallpaperOpen(false)}
          />
          <div
            ref={wallpaperRef}
            className="absolute inset-x-0 bottom-0 rounded-t-2xl border-t p-3 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-2xl md:relative md:inset-auto md:w-80 md:rounded-2xl md:border md:pb-3"
            style={{ backgroundColor: LC.bgPanel, borderColor: LC.border }}
          >
            <div className="mx-auto mb-3 h-1 w-10 rounded-full md:hidden" style={{ backgroundColor: LC.border }} />
            <div className="mb-3 flex items-center justify-between gap-2">
              <div>
                <div className="text-xs font-black uppercase tracking-[0.18em]" style={{ color: LC.textMuted }}>
                  Backdrop
                </div>
                <div className="text-[10px]" style={{ color: LC.textDim }}>
                  Changes only the chat canvas.
                </div>
              </div>
              <button
                type="button"
                onClick={() => setWallpaperOpen(false)}
                className="rounded-lg px-3 py-1.5 text-xs font-bold"
                style={{ color: LC.accentCyan, backgroundColor: `${LC.accentCyan}12` }}
              >
                Hide
              </button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {WALLPAPERS.map((w) => (
                <button
                  key={w.id}
                  type="button"
                  onPointerDown={(e) => {
                    e.preventDefault();
                    setWallpaper(w.id);
                    setWallpaperOpen(false);
                  }}
                  className="flex min-h-14 items-center gap-2 rounded-xl border px-2 text-left text-[11px] font-bold transition active:scale-95"
                  style={{
                    color: wallpaper === w.id ? LC.accentCyan : LC.text,
                    backgroundColor: wallpaper === w.id ? `${LC.accentCyan}12` : LC.bgSecondary,
                    borderColor: wallpaper === w.id ? LC.accentCyan : LC.borderSubtle,
                  }}
                >
                  <span
                    className="h-8 w-10 shrink-0 rounded-lg border"
                    style={{
                      backgroundColor: LC.bg,
                      borderColor: wallpaper === w.id ? LC.accentCyan : LC.borderSubtle,
                      ...(w.style || {}),
                    }}
                  />
                  <span className="min-w-0 flex-1 truncate">{w.label}</span>
                  {wallpaper === w.id && <Check size={13} style={{ color: LC.accentCyan }} />}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="flex-1 space-y-5 overflow-y-auto"
      >
        <div className="mx-auto w-full max-w-5xl px-3 py-4 sm:px-4 sm:py-6 lg:px-8">
          {isEmpty ? (
            <div className="relative z-10 flex h-full min-h-[calc(100svh-250px)] flex-col items-center justify-center px-0 py-3 sm:min-h-[60vh] sm:px-4 sm:py-8">
              <div className="mx-auto w-full max-w-3xl space-y-4 text-center sm:space-y-6 sm:px-4 lg:px-6">
                <div className="relative mx-auto flex h-16 w-16 items-center justify-center sm:h-20 sm:w-20">
                  {/* Holographic ring */}
                  <div
                    className="absolute inset-0 rounded-full animate-pulse"
                    style={{
                      background: `conic-gradient(from 0deg, transparent, ${LC.accentCyan}40, transparent, ${LC.accentCyan}20, transparent)`,
                      filter: "blur(4px)",
                    }}
                  />
                  <div
                    className="absolute inset-[-6px] rounded-full border border-dashed animate-[spin_8s_linear_infinite]"
                    style={{ borderColor: `${LC.accentCyan}40` }}
                  />
                  <div
                    className="absolute inset-0 rounded-full blur-2xl"
                    style={{
                      background: `radial-gradient(circle, ${LC.accentCyan}30, transparent 70%)`,
                    }}
                  />
                  <div
                    className="relative flex h-12 w-12 items-center justify-center rounded-2xl border sm:h-14 sm:w-14"
                    style={{
                      backgroundColor: `${LC.bgPanel}cc`,
                      borderColor: LC.accentCyan,
                      boxShadow: `0 0 32px ${LC.accentCyan}30, inset 0 0 16px ${LC.accentCyan}10`,
                    }}
                  >
                    <Bot size={24} className="sm:h-7 sm:w-7" style={{ color: LC.accentCyan }} />
                  </div>
                </div>
                <div>
                  <h2
                    className="text-lg font-black tracking-tight sm:text-xl"
                    style={{ color: LC.text }}
                  >
                    LiTTree Agent
                  </h2>
                  <p
                    className="text-[11px] font-medium sm:text-xs"
                    style={{ color: LC.textMuted }}
                  >
                    Creative Director + Builder + Operator
                  </p>
                  <p className="mt-1 text-[9px] font-black uppercase tracking-[0.18em] sm:text-[10px] sm:tracking-[0.2em]" style={{ color: LC.accentCyan }}>
                    ● Live Holographic Link
                  </p>
                </div>

                <div className="-mx-3 flex snap-x items-center gap-2 overflow-x-auto px-3 pb-1 sm:mx-0 sm:flex-wrap sm:justify-center sm:overflow-visible sm:px-0 sm:pb-0">
                  {PROMPT_SUGGESTIONS
                    .slice(promptSeed % PROMPT_SUGGESTIONS.length)
                    .concat(PROMPT_SUGGESTIONS.slice(0, promptSeed % PROMPT_SUGGESTIONS.length))
                    .slice(0, 6)
                    .map((prompt) => (
                      <button
                        key={prompt}
                        onClick={() => onSend(prompt)}
                        className="snap-start whitespace-nowrap rounded-full border px-3 py-2 text-[11px] font-bold transition-all hover:scale-[1.02] sm:py-1.5"
                        style={{
                          backgroundColor: LC.bgPanel,
                          borderColor: LC.border,
                          color: LC.textMuted,
                        }}
                      >
                        {prompt}
                      </button>
                    ))}
                </div>
              </div>
            </div>
          ) : (
            <div className="relative z-10 mx-auto w-full max-w-3xl rounded-3xl border p-4 lg:p-6" style={{ borderColor: `${LC.accentCyan}20`, background: `linear-gradient(180deg, ${LC.bgPanel}40 0%, transparent 100%)`, boxShadow: `0 0 40px ${LC.accentCyan}08` }}>
              <div className="absolute left-1/2 top-0 h-px w-24 -translate-x-1/2 -translate-y-px" style={{ background: `linear-gradient(90deg, transparent, ${LC.accentCyan}, transparent)` }} />
            {messages.map((m) => (
              <div
                key={m.id}
                className={
                  m.role === "user" ? "flex justify-end" : "flex justify-start"
                }
              >
                {m.role === "user" && (
                  <div className="flex max-w-[80%] items-end gap-2">
                    <div
                      className="rounded-2xl rounded-br-sm px-4 py-2.5 text-sm"
                      style={{
                        backgroundColor: `${LC.accentCyan}10`,
                        border: `1px solid ${LC.accentCyan}30`,
                        color: LC.text,
                      }}
                    >
                      {m.content}
                      {m.attachment && (
                        m.attachment.type.startsWith("image") ? (
                          <a
                            href={m.attachment.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="mt-2 block overflow-hidden rounded-lg border transition-opacity hover:opacity-90"
                            style={{ borderColor: `${LC.accentCyan}40` }}
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={m.attachment.url}
                              alt={m.attachment.name}
                              className="max-h-64 w-auto object-contain"
                            />
                          </a>
                        ) : (
                          <a
                            href={m.attachment.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="mt-2 flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] font-semibold transition-colors hover:bg-white/5"
                            style={{ borderColor: `${LC.accentCyan}40`, color: LC.accentCyan }}
                          >
                            <FileText size={12} />
                            {m.attachment.name}
                          </a>
                        )
                      )}
                    </div>
                    <div
                      className="rounded-full p-1.5"
                      style={{
                        backgroundColor: LC.bgSecondary,
                        color: LC.accentCyan,
                      }}
                    >
                      <User size={14} />
                    </div>
                  </div>
                )}

                {m.role === "lit" && (
                  <div className="flex w-full gap-3 animate-in fade-in slide-in-from-left-2 duration-300">
                    <div
                      className="mt-1 shrink-0 rounded-full p-1.5"
                      style={{
                        backgroundColor: LC.bgSecondary,
                        color: LC.accentCyan,
                        boxShadow: m.id === activeLitId ? `0 0 12px ${LC.accentCyan}40` : "none",
                      }}
                    >
                      <Bot size={14} />
                    </div>
                    <div
                      className="min-w-0 flex-1 rounded-2xl border p-3"
                      style={{
                        backgroundColor: LC.bgPanel,
                        borderColor: LC.border,
                      }}
                    >
                      {renderLitContent(m)}

                      {/* Read files chips */}
                      {m.meta?.readFiles && m.meta.readFiles.length > 0 && (
                        <div className="mt-3 flex flex-wrap items-center gap-1.5">
                          <span className="text-[9px] font-bold uppercase tracking-wider" style={{ color: LC.textMuted }}>Read</span>
                          {m.meta.readFiles.map((file) => (
                            <span
                              key={file}
                              className="flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-mono"
                              style={{ backgroundColor: LC.bgSecondary, borderColor: LC.border, color: LC.textDim }}
                            >
                              <FileText size={10} />
                              {file}
                            </span>
                          ))}
                        </div>
                      )}

                      {/* Expandable thoughts */}
                      {m.meta?.thoughts && m.meta.thoughts.length > 0 && (
                        <div className="mt-2">
                          <button
                            onClick={() => setExpandedThoughts((prev) => ({ ...prev, [m.id]: !prev[m.id] }))}
                            className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider transition-colors hover:text-cyan-300"
                            style={{ color: LC.textMuted }}
                          >
                            <Brain size={11} />
                            Thoughts
                            {expandedThoughts[m.id] ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
                          </button>
                          {expandedThoughts[m.id] && (
                            <div
                              className="mt-2 space-y-1.5 rounded-lg border p-2 animate-in fade-in duration-200"
                              style={{ backgroundColor: LC.bgSecondary, borderColor: LC.border }}
                            >
                              {m.meta.thoughts.map((thought, i) => (
                                <div key={i} className="flex items-start gap-2 text-[10px]" style={{ color: LC.textDim }}>
                                  <span className="mt-0.5 text-[9px]" style={{ color: LC.accentCyan }}>#{i + 1}</span>
                                  <span>{thought}</span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}

                      {/* Suggested next actions */}
                      {m.content && (
                        <div className="mt-3 flex flex-wrap items-center gap-1.5">
                          {suggestedActions(m.content).slice(0, 4).map((action) => (
                            <button
                              key={action}
                              onClick={() => onSend(action)}
                              className="rounded-full border px-2 py-1 text-[10px] font-bold transition-all hover:scale-[1.02]"
                              style={{
                                backgroundColor: `${LC.accentCyan}10`,
                                borderColor: `${LC.accentCyan}40`,
                                color: LC.accentCyan,
                              }}
                            >
                              {action}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {m.role === "tool" && m.meta?.tool === "generate_image" && (
                  <GenerateImageTool m={m} theme={LC} />
                )}

                {m.role === "tool" && m.meta?.tool !== "generate_image" && (
                  <div className="flex w-full gap-3">
                    <div
                      className="mt-1 shrink-0 rounded-full p-1.5"
                      style={{
                        backgroundColor: `${LC.accentOrange}15`,
                        color: LC.accentOrange,
                      }}
                    >
                      <FileCode size={14} />
                    </div>
                    <div
                      className="flex-1 rounded-xl border p-3"
                      style={{
                        backgroundColor: LC.bgSecondary,
                        borderColor: LC.border,
                        borderLeft: `3px solid ${LC.accentOrange}`,
                      }}
                    >
                      <div
                        className="flex items-center gap-2 text-xs font-medium"
                        style={{ color: LC.text }}
                      >
                        {m.meta?.status === "running" && (
                          <Loader2
                            size={14}
                            className="animate-spin"
                            style={{ color: LC.accentOrange }}
                          />
                        )}
                        {m.meta?.status === "done" && (
                          <span
                            className="rounded px-1 py-0.5 text-[10px]"
                            style={{
                              backgroundColor: `${LC.success}20`,
                              color: LC.success,
                            }}
                          >
                            done
                          </span>
                        )}
                        {m.meta?.status === "error" && (
                          <span
                            className="rounded px-1 py-0.5 text-[10px]"
                            style={{
                              backgroundColor: `${LC.danger}20`,
                              color: LC.danger,
                            }}
                          >
                            error
                          </span>
                        )}
                        {m.meta?.tool || "Tool"}
                      </div>
                      <div
                        className="mt-1 text-xs"
                        style={{ color: LC.textMuted }}
                      >
                        {m.content}
                      </div>
                      {m.meta?.images?.length ? (
                        <div className="mt-3 grid gap-3 sm:grid-cols-2">
                          {m.meta.images.map((image, index) => (
                            <a
                              key={`${image.url}-${index}`}
                              href={image.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="group overflow-hidden rounded-xl border"
                              style={{
                                backgroundColor: LC.bgPanel,
                                borderColor: LC.border,
                                boxShadow: "0 14px 40px rgba(0,0,0,0.25)",
                              }}
                            >
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img
                                src={image.url}
                                alt={image.prompt}
                                className="aspect-square w-full object-cover transition-transform group-hover:scale-[1.02]"
                              />
                              <div
                                className="flex items-center justify-between gap-2 px-3 py-2 text-[10px]"
                                style={{ color: LC.textMuted }}
                              >
                                <span
                                  className="truncate font-semibold"
                                  style={{ color: LC.text }}
                                >
                                  {image.provider}
                                </span>
                                <span style={{ color: LC.accentCyan }}>
                                  Open image
                                </span>
                              </div>
                            </a>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  </div>
                )}

                {m.role === "system" && (
                  <div
                    className="flex w-full flex-col gap-2 rounded-xl border px-3 py-2 text-xs"
                    style={{
                      backgroundColor: LC.bgSecondary,
                      borderColor: LC.border,
                      color: LC.textDim,
                    }}
                  >
                    <div className="flex items-center gap-2">
                      <Terminal size={14} />
                      {m.content}
                    </div>
                    {(() => {
                      const cmd = (m.content.match(/`([^`]+)`/) || [])[1];
                      if (
                        !cmd ||
                        !onApprove ||
                        !m.content.toLowerCase().includes("approve")
                      )
                        return null;
                      return (
                        <button
                          onClick={() => onApprove(cmd)}
                          className="flex w-fit items-center gap-1 rounded px-2 py-1 text-xs font-semibold"
                          style={{
                            backgroundColor: LC.accentOrange,
                            color: "#000",
                          }}
                        >
                          <Play size={12} /> Approve
                        </button>
                      );
                    })()}
                  </div>
                )}
              </div>
            ))}
            </div>
          )}

          {plan && (
            <div
              className="flex flex-col gap-2 rounded-xl border p-4"
              style={{ backgroundColor: LC.bgSecondary, borderColor: LC.border }}
            >
              <div className="flex items-center justify-between">
                <div className="text-xs font-semibold" style={{ color: LC.text }}>
                  Run Plan
                </div>
                <div className="flex items-center gap-2">
                  <div
                    className="mr-2 text-[10px]"
                    style={{ color: LC.textMuted }}
                  >
                    {plan.runId
                      ? `Run #${plan.runId.slice(0, 8)}`
                      : "Unsaved preview"}
                  </div>
                  {onApprovePlan && plan.steps.some((s) => s.needs_approval) ? (
                    <button
                      onClick={onApprovePlan}
                      className="flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-bold"
                      style={{ backgroundColor: LC.accentOrange, color: "#000" }}
                    >
                      <Play size={12} /> Approve Plan
                    </button>
                  ) : !plan.steps.some((s) => s.needs_approval) &&
                    onApprovePlan ? (
                    <button
                      onClick={onApprovePlan}
                      className="flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-bold"
                      style={{ backgroundColor: LC.accentCyan, color: "#000" }}
                    >
                      Execute Plan
                    </button>
                  ) : null}
                </div>
              </div>
              <div className="text-xs" style={{ color: LC.textDim }}>
                {plan.steps[0]?.title || "No steps."}
              </div>
              <div className="flex max-h-52 flex-col gap-1.5 overflow-y-auto pr-1">
                {plan.steps.map((step, idx) => (
                  <div
                    key={step.id}
                    className="flex items-center justify-between rounded-lg border px-3 py-2 text-xs"
                    style={{
                      backgroundColor: LC.bgPanel,
                      borderColor: LC.border,
                    }}
                  >
                    <div className="min-w-0">
                      <div className="font-medium" style={{ color: LC.text }}>
                        {idx + 1}. {step.title}
                      </div>
                      {step.command ? (
                        <div
                          className="mt-1 truncate font-mono"
                          style={{ color: LC.accentOrange }}
                        >
                          {step.command}
                        </div>
                      ) : null}
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <span
                        className="rounded px-1.5 py-0.5 text-[10px] font-bold"
                        style={{
                          backgroundColor:
                            step.risk_level === "critical" ||
                            step.risk_level === "high"
                              ? `${LC.danger}25`
                              : `${LC.success}15`,
                          color:
                            step.risk_level === "critical" ||
                            step.risk_level === "high"
                              ? LC.danger
                              : LC.success,
                        }}
                      >
                        {step.risk_level || "low"}
                      </span>
                      {step.needs_approval ? (
                        <span
                          className="rounded px-1.5 py-0.5 text-[10px] font-bold"
                          style={{
                            backgroundColor: `${LC.accentOrange}20`,
                            color: LC.accentOrange,
                          }}
                        >
                          approve
                        </span>
                      ) : null}
                      {step.command ? (
                        <button
                          onClick={() => {
                            if (!plan.runId || !onApproveStep) return;
                            onApproveStep(plan.runId, step.command as string);
                          }}
                          className="rounded-full px-2 py-1 font-semibold"
                          style={{
                            backgroundColor: LC.accentOrange,
                            color: "#000",
                          }}
                        >
                          Run
                        </button>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
          {loading && <ThinkingIndicator theme={LC} />}
          <div ref={bottomRef} />
        </div>
      </div>
    </div>
  );
}
