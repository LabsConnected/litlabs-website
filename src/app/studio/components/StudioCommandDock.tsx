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
  const [expanded, setExpanded] = useState(() => {
    if (typeof window === "undefined") return true;
    return window.innerWidth > 768;
  });
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
        className="w-full flex items-center justify-between px-3 h-8 text-[10px] font-bold uppercase tracking-[0.2em] transition-colors hover:bg-white/5"
        style={{ color: T.textMuted }}
        aria-label={expanded ? "Collapse command dock" : "Expand command dock"}
        title={expanded ? "Collapse dock" : "Expand dock"}
      >
        <span className="flex items-center gap-2">
          <Wand2 size={11} style={{ color: T.accentColor }} />
          Command dock
        </span>
        <ChevronUp
          size={12}
          className="transition-transform"
          style={{ transform: expanded ? "rotate(0deg)" : "rotate(180deg)" }}
        />
      </button>

      {expanded && (
        <div className="p-2 space-y-2">
          {/* Input row */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (busy) return;
              setBusy(true);
              onSubmit();
              setTimeout(() => setBusy(false), 800);
            }}
            className="flex items-stretch gap-2"
          >
            <div
              className="flex-1 flex items-center gap-2 rounded-xl border px-3"
              style={{
                backgroundColor: T.bgColor + "70",
                borderColor: T.borderColor + "25",
              }}
            >
              <Sparkles size={12} style={{ color: T.accentColor }} />
              <input
                id="studio-command-input"
                name="studio-command-input"
                ref={inputRef}
                value={prompt}
                onChange={(e) => onPromptChange(e.target.value)}
                placeholder="Ask in plain English: generate, fix, search, deploy…  ⌘K"
                className="flex-1 min-w-0 py-2 text-[12px] outline-none bg-transparent"
                style={{ color: T.textColor }}
              />
              <span
                className="hidden md:inline text-[9px] font-mono opacity-40"
                style={{ color: T.textMuted }}
              >
                {prompt.length}/2000
              </span>
            </div>
            <button
              type="submit"
              disabled={!prompt.trim() || busy}
              className="rounded-xl px-3 flex items-center gap-1.5 text-[11px] font-black uppercase tracking-wider transition-all disabled:opacity-40"
              style={{
                backgroundColor: T.accentColor,
                color: "#fff",
                boxShadow: `0 4px 16px ${T.accentColor}40`,
              }}
              title="Send"
            >
              {busy ? <Square size={11} /> : <Send size={11} />}
              <span className="hidden sm:inline">Run</span>
            </button>
          </form>

          {/* Shortcut row */}
          <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5">
            <span
              className="text-[9px] font-bold uppercase tracking-[0.2em] shrink-0"
              style={{ color: T.textMuted }}
            >
              Route to
            </span>
            {SHORTCUTS.map((s) => {
              const Icon = s.icon;
              const active = activeTool === s.tool;
              return (
                <button
                  key={s.id}
                  onClick={() => onToolChange(s.tool)}
                  className="shrink-0 flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider transition-all"
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
                  <Icon size={10} />
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
                className="shrink-0 max-w-[140px] truncate rounded-full border px-2.5 py-1 text-[10px] font-bold transition-colors hover:bg-white/5"
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
