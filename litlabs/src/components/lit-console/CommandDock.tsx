"use client";

import { useEffect, useRef } from "react";
import { Send, Paperclip, Wrench, Play, Mic, ChevronUp, Bot, Cpu } from "lucide-react";
import { LC } from "./lit-console-theme";

interface CommandDockProps {
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
  onRun?: () => void;
  agent: string;
  model: string;
  onAgentChange?: () => void;
  onModelChange?: () => void;
  onAttach?: () => void;
  onTools?: () => void;
}

export default function CommandDock(props: CommandDockProps) {
  const { value, onChange, onSend, onRun, agent, model, onAgentChange, onModelChange, onAttach, onTools } = props;
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [value]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      onSend();
    }
  };

  return (
    <div className="w-full border-t px-4 py-3" style={{ backgroundColor: LC.bgPanel, borderColor: LC.border }}>
      <div className="mx-auto flex max-w-[820px] items-end gap-2">
        <div className="hidden items-center gap-1.5 sm:flex">
          <button
            onClick={onAgentChange}
            className="flex items-center gap-1 rounded-md px-2 py-1.5 text-xs font-medium transition-colors hover:bg-white/5"
            style={{ color: LC.text, border: `1px solid ${LC.borderSubtle}` }}
          >
            <Bot size={14} style={{ color: LC.accentCyan }} />
            {agent}
            <ChevronUp size={12} style={{ color: LC.textDim }} />
          </button>
          <button
            onClick={onModelChange}
            className="flex items-center gap-1 rounded-md px-2 py-1.5 text-xs font-medium transition-colors hover:bg-white/5"
            style={{ color: LC.text, border: `1px solid ${LC.borderSubtle}` }}
          >
            <Cpu size={14} style={{ color: LC.accentOrange }} />
            {model}
            <ChevronUp size={12} style={{ color: LC.textDim }} />
          </button>
        </div>

        <div
          className="flex min-h-[56px] flex-1 items-end gap-2 rounded-xl border px-3 py-2.5"
          style={{ backgroundColor: LC.bgSecondary, borderColor: LC.border }}
        >
          <textarea
            ref={textareaRef}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask LiT to build, run, edit, search, or deploy..."
            className="max-h-40 min-h-[40px] flex-1 resize-none bg-transparent py-1 text-sm outline-none"
            style={{ color: LC.text, fontFamily: LC.fontMono }}
            rows={1}
          />
          <div className="flex items-center gap-1">
            <button onClick={onAttach} className="rounded-md p-1.5 transition-colors hover:bg-white/5" style={{ color: LC.textMuted }}>
              <Paperclip size={16} />
            </button>
            <button onClick={onTools} className="rounded-md p-1.5 transition-colors hover:bg-white/5" style={{ color: LC.textMuted }}>
              <Wrench size={16} />
            </button>
            <button className="rounded-md p-1.5 transition-colors hover:bg-white/5" style={{ color: LC.textMuted }}>
              <Mic size={16} />
            </button>
            {onRun && (
              <button
                onClick={onRun}
                className="flex items-center gap-1 rounded-md px-2.5 py-1.5 text-xs font-semibold transition-colors"
                style={{ backgroundColor: LC.accentOrange, color: "#000" }}
              >
                <Play size={14} fill="currentColor" />
                Run
              </button>
            )}
            <button
              onClick={onSend}
              className="flex items-center gap-1 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors"
              style={{ backgroundColor: LC.accentCyan, color: "#000" }}
            >
              <Send size={14} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
