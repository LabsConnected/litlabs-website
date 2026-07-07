"use client";

import { useEffect, useRef, useState } from "react";
import { useTheme } from "@/context/ThemeContext";
import {
  ChevronUp,
  Image as ImageIcon,
  Film,
  Music,
  Palette,
  Bot,
  Send,
  Sparkles,
  Square,
  TerminalSquare,
  Wand2,
  Code2,
} from "lucide-react";
import type { StudioTool } from "./StudioSidebar";

export type DockAction = {
  id: string;
  label: string;
  icon: typeof Sparkles;
  shortcut?: string;
  prompt?: string;
  tool?: StudioTool;
};

/**
 * StudioCommandDock — the bottom command input + shortcut row.
 *
 *  [ ⌘K prompt input ] [ send ] ... [ quick action chips ] [ mode toggles ]
 *
 * Collapsible on mobile to save vertical space. The dock is the main
 * command surface for the Command Center and can route a single
 * plain-English prompt to the right tool.
 */
export default function StudioCommandDock({
  prompt,
  onPromptChange,
  onSubmit,
  activeTool,
  onToolChange,
  recentActions,
  onAction,
  T,
}: {
  prompt: string;
  onPromptChange: (v: string) => void;
  onSubmit: () => void;
  activeTool: StudioTool;
  onToolChange: (t: StudioTool) => void;
  recentActions: { tool: StudioTool; label: string }[];
  onAction: (action: DockAction) => void;
  T: ReturnType<typeof useTheme>["resolvedColors"];
}) {
  const [expanded, setExpanded] = useState(true);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // ⌘K / Ctrl-K to focus
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const SHORTCUTS: {
    id: string;
    label: string;
    icon: typeof Sparkles;
    tool: StudioTool;
  }[] = [
    { id: "image", label: "Image", icon: ImageIcon, tool: "image" },
    { id: "video", label: "Video", icon: Film, tool: "video" },
    { id: "audio", label: "Audio", icon: Music, tool: "audio" },
    { id: "color", label: "Color", icon: Palette, tool: "color" },
    { id: "agents", label: "Agent", icon: Bot, tool: "agents" },
    { id: "terminal", label: "Term", icon: TerminalSquare, tool: "terminal" },
  ];

  type Skill = { label: string; prompt: string; icon: typeof Sparkles };

  const SKILLS: Record<StudioTool, Skill[]> = {
    chat: [
      { label: "Ask LiT", prompt: "What can you help me with today?", icon: Bot },
      { label: "Plan project", prompt: "Plan a full-stack SaaS project", icon: Sparkles },
      { label: "Explain code", prompt: "Explain this code like I'm 5", icon: Code2 },
    ],
    image: [
      { label: "Wallpaper", prompt: "Make a cyberpunk city wallpaper at night with neon reflections", icon: ImageIcon },
      { label: "Logo", prompt: "Design a modern minimalist logo for a tech brand", icon: ImageIcon },
      { label: "Portrait", prompt: "Generate a photorealistic portrait of a futuristic astronaut", icon: ImageIcon },
      { label: "Anime", prompt: "Create an anime character with cyberpunk outfit", icon: ImageIcon },
    ],
    video: [
      { label: "Cinematic", prompt: "Generate a cinematic sci-fi city fly-through", icon: Film },
      { label: "Reel", prompt: "Create a 15-second product showcase reel", icon: Film },
      { label: "B-roll", prompt: "Generate abstract tech b-roll footage", icon: Film },
    ],
    audio: [
      { label: "Beat", prompt: "Make a chill lo-fi hip hop beat", icon: Music },
      { label: "Song", prompt: "Generate an upbeat electronic pop song", icon: Music },
      { label: "SFX", prompt: "Create futuristic UI sound effects", icon: Music },
      { label: "Voice", prompt: "Synthesize a calm narrator voiceover", icon: Music },
    ],
    color: [
      { label: "Mandala", prompt: "Color a mandala", icon: Palette },
      { label: "Landscape", prompt: "Color a mountain landscape", icon: Palette },
      { label: "Pixel art", prompt: "Color a pixel art character", icon: Palette },
    ],
    canvas: [
      { label: "Dashboard", prompt: "Build a dashboard with stat cards, chart placeholder, and sidebar", icon: Code2 },
      { label: "Landing page", prompt: "Build a modern landing page with hero, features, and CTA", icon: Code2 },
      { label: "Todo app", prompt: "Build a todo app with add, delete, and mark complete", icon: Code2 },
      { label: "Counter", prompt: "Create a React counter with increment, decrement, and reset", icon: Code2 },
    ],
    builder: [
      { label: "Landing page", prompt: "Build a modern landing page with hero, features, and CTA", icon: Code2 },
      { label: "Dashboard", prompt: "Build a dashboard with stat cards, chart, and sidebar", icon: Code2 },
      { label: "Fixer", prompt: "Fix any errors and improve the current page", icon: Wand2 },
      { label: "Component", prompt: "Build a reusable card component with Tailwind", icon: Code2 },
    ],
    agents: [
      { label: "Code reviewer", prompt: "Create an agent that reviews code and suggests improvements", icon: Bot },
      { label: "Planner", prompt: "Create a project planner agent", icon: Bot },
      { label: "Social pilot", prompt: "Create a social media manager agent", icon: Bot },
    ],
    terminal: [
      { label: "/status", prompt: "/status", icon: TerminalSquare },
      { label: "/image", prompt: "/image generate a cyberpunk city", icon: ImageIcon },
      { label: "/build", prompt: "/build a landing page", icon: Code2 },
      { label: "/help", prompt: "/help", icon: Wand2 },
    ],
    pipeline: [
      { label: "New run", prompt: "Run the default pipeline", icon: Wand2 },
      { label: "View logs", prompt: "Show latest pipeline logs", icon: TerminalSquare },
    ],
    gallery: [
      { label: "Search", prompt: "Search gallery for cyberpunk", icon: Wand2 },
      { label: "Refresh", prompt: "Refresh recent generations", icon: Wand2 },
    ],
    space: [
      { label: "Skybox", prompt: "Generate a nebula skybox", icon: Wand2 },
      { label: "Planet", prompt: "Create a procedural planet texture", icon: Wand2 },
    ],
    clibridge: [
      { label: "Connect", prompt: "Connect to default CLI bridge", icon: TerminalSquare },
      { label: "Run", prompt: "Run ls -la on the bridge", icon: TerminalSquare },
    ],
  };

  const activeSkills: Skill[] = SKILLS[activeTool] ?? SKILLS.chat;

  return (
    <div
      className="border-t shrink-0"
      style={{
        backgroundColor: T.boxBg + "c0",
        borderColor: T.borderColor + "20",
        backdropFilter: "blur(14px) saturate(180%)",
      }}
    >
      {/* Toggle bar */}
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center justify-between px-4 h-10 text-xs font-bold uppercase tracking-[0.2em] transition-colors hover:bg-white/5"
        style={{ color: T.textMuted }}
        aria-label={expanded ? "Collapse command dock" : "Expand command dock"}
        title={expanded ? "Collapse dock" : "Expand dock"}
      >
        <span className="flex items-center gap-2">
          <Wand2 size={13} style={{ color: T.accentColor }} />
          Command dock
        </span>
        <ChevronUp
          size={14}
          className="transition-transform"
          style={{ transform: expanded ? "rotate(0deg)" : "rotate(180deg)" }}
        />
      </button>

      {expanded && (
        <div className="p-3 space-y-2.5">
          {/* Contextual skill chips for the active tool */}
          <div className="flex items-center gap-2 overflow-x-auto pb-0.5">
            <span
              className="text-xs font-bold uppercase tracking-[0.15em] shrink-0"
              style={{ color: T.textMuted }}
            >
              {activeTool}
            </span>
            {activeSkills.map((s) => {
              const Icon = s.icon;
              return (
                <button
                  key={s.label}
                  onClick={() => {
                    onPromptChange(s.prompt);
                    inputRef.current?.focus();
                  }}
                  className="shrink-0 flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-bold transition-all hover:scale-[1.02] hover:bg-white/5"
                  style={{
                    backgroundColor: T.bgColor + "60",
                    borderColor: T.borderColor + "22",
                    color: T.textColor,
                  }}
                  title={s.prompt}
                >
                  <Icon size={12} style={{ color: T.accentColor }} />
                  {s.label}
                </button>
              );
            })}
          </div>

          {/* Input row */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (busy) return;
              setBusy(true);
              onSubmit();
              setTimeout(() => setBusy(false), 800);
            }}
            className="flex items-stretch gap-2.5"
          >
            <div
              className="flex-1 flex items-center gap-2.5 rounded-xl border px-4"
              style={{
                backgroundColor: T.bgColor + "70",
                borderColor: T.borderColor + "25",
              }}
            >
              <Sparkles size={14} style={{ color: T.accentColor }} />
              <input
                ref={inputRef}
                value={prompt}
                onChange={(e) => onPromptChange(e.target.value)}
                placeholder={
                  activeTool === "image"
                    ? "Describe an image to generate..."
                    : activeTool === "audio"
                    ? "Describe a sound or song to generate..."
                    : activeTool === "video"
                    ? "Describe a video scene..."
                    : activeTool === "canvas" || activeTool === "builder"
                    ? "Describe what to build..."
                    : activeTool === "terminal"
                    ? "Type /help, /image, or ask LiT..."
                    : activeTool === "agents"
                    ? "Describe an agent to create..."
                    : "Ask in plain English: generate, fix, search, deploy…"
                }
                className="flex-1 min-w-0 py-2.5 text-sm outline-none bg-transparent"
                style={{ color: T.textColor }}
              />
              <span
                className="hidden md:inline text-xs font-mono opacity-40"
                style={{ color: T.textMuted }}
              >
                {prompt.length}/2000
              </span>
            </div>
            <button
              type="submit"
              disabled={!prompt.trim() || busy}
              className="rounded-xl px-4 flex items-center gap-1.5 text-xs font-black uppercase tracking-wider transition-all disabled:opacity-40"
              style={{
                backgroundColor: T.accentColor,
                color: "#fff",
                boxShadow: `0 4px 16px ${T.accentColor}40`,
              }}
              title="Send"
            >
              {busy ? <Square size={13} /> : <Send size={13} />}
              <span className="hidden sm:inline">Run</span>
            </button>
          </form>

          {/* Shortcut row */}
          <div className="flex items-center gap-2 overflow-x-auto pb-0.5">
            <span
              className="text-xs font-bold uppercase tracking-[0.2em] shrink-0"
              style={{ color: T.textMuted }}
            >
              Jump to
            </span>
            {SHORTCUTS.map((s) => {
              const Icon = s.icon;
              const active = activeTool === s.tool;
              return (
                <button
                  key={s.id}
                  onClick={() => onToolChange(s.tool)}
                  className="shrink-0 flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-bold uppercase tracking-wider transition-all"
                  style={{
                    backgroundColor: active
                      ? T.accentColor + "22"
                      : T.bgColor + "60",
                    borderColor: active
                      ? T.accentColor + "55"
                      : T.borderColor + "22",
                    color: active ? T.accentColor : T.textColor,
                  }}
                  title={`Open ${s.label} tool`}
                >
                  <Icon size={12} />
                  {s.label}
                </button>
              );
            })}

            <div className="flex-1" />

            {recentActions.slice(0, 3).map((r, i) => (
              <button
                key={i}
                onClick={() =>
                  onAction({
                    id: r.label,
                    label: r.label,
                    icon: Sparkles,
                    tool: r.tool,
                  })
                }
                className="shrink-0 max-w-[160px] truncate rounded-full border px-3 py-1.5 text-xs font-bold transition-colors hover:bg-white/5"
                style={{
                  backgroundColor: "transparent",
                  borderColor: T.borderColor + "22",
                  color: T.textMuted,
                }}
                title={r.label}
              >
                ↻ {r.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
