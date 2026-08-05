"use client";

import { useState, useEffect, useRef } from "react";
import { useStudioStore } from "@/stores/useStudioStore";
import { AnimatePresence, motion } from "framer-motion";
import {
  MagnifyingGlassIcon,
  CommandIcon,
  FileIcon,
  ImageIcon,
  RocketIcon,
  BrainIcon,
  RobotIcon,
} from "@phosphor-icons/react";

interface CommandItem {
  id: string;
  label: string;
  type: "action" | "file" | "asset" | "navigation";
  icon: typeof FileIcon;
  hint?: string;
}

const DEFAULT_COMMANDS: CommandItem[] = [
  { id: "build", label: "Build something new", type: "action", icon: CommandIcon, hint: "/build" },
  { id: "create-app", label: "Create a new app", type: "action", icon: CommandIcon, hint: "/create app" },
  { id: "design-logo", label: "Design a logo", type: "action", icon: ImageIcon, hint: "/design logo" },
  { id: "generate-image", label: "Generate an image", type: "action", icon: ImageIcon, hint: "/generate image" },
  { id: "generate-music", label: "Generate music", type: "action", icon: CommandIcon, hint: "/generate music" },
  { id: "open-terminal", label: "Open Terminal", type: "action", icon: CommandIcon, hint: "/open terminal" },
  { id: "open-files", label: "Open Files", type: "action", icon: FileIcon, hint: "/open files" },
  { id: "open-preview", label: "Open Preview", type: "action", icon: CommandIcon, hint: "/open preview" },
  { id: "deploy", label: "Deploy project", type: "action", icon: RocketIcon, hint: "/deploy" },
  { id: "run-tests", label: "Run tests", type: "action", icon: CommandIcon, hint: "/run tests" },
  { id: "remember", label: "Remember this", type: "action", icon: BrainIcon, hint: "/remember" },
  { id: "memory", label: "View project memory", type: "navigation", icon: BrainIcon },
  { id: "agents", label: "View agents", type: "navigation", icon: RobotIcon },
];

export function CommandBar() {
  const { commandBarOpen, setCommandBarOpen } = useStudioStore();
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (commandBarOpen) {
      setQuery("");
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [commandBarOpen]);

  const filtered = query
    ? DEFAULT_COMMANDS.filter((cmd) =>
        cmd.label.toLowerCase().includes(query.toLowerCase()) ||
        cmd.hint?.toLowerCase().includes(query.toLowerCase())
      )
    : DEFAULT_COMMANDS;

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const selected = filtered[selectedIndex];
      if (selected) {
        // TODO: Execute command
        setCommandBarOpen(false);
      }
    }
  };

  return (
    <AnimatePresence>
      {commandBarOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          className="fixed inset-0 z-[100] flex items-start justify-center pt-[15vh] bg-black/40 backdrop-blur-sm"
          onClick={() => setCommandBarOpen(false)}
        >
          <motion.div
            initial={{ scale: 0.98, y: -10 }}
            animate={{ scale: 1, y: 0 }}
            exit={{ scale: 0.98, y: -10 }}
            transition={{ duration: 0.15 }}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-xl overflow-hidden rounded-2xl border border-white/10 bg-[#13101a] shadow-2xl"
          >
            {/* Input */}
            <div className="flex items-center gap-3 border-b border-white/5 px-4 py-3">
              <MagnifyingGlassIcon size={18} className="text-white/30" weight="regular" />
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setSelectedIndex(0);
                }}
                onKeyDown={handleKeyDown}
                placeholder="Search or ask LiTT anything... (e.g. /deploy, make the hero purple)"
                className="flex-1 bg-transparent text-sm text-white/80 placeholder:text-white/20 focus:outline-none"
              />
              <kbd className="rounded bg-white/5 px-1.5 py-0.5 text-[10px] text-white/30">ESC</kbd>
            </div>

            {/* Results */}
            <div className="max-h-[400px] overflow-y-auto p-2">
              {filtered.length === 0 ? (
                <div className="px-3 py-8 text-center">
                  <p className="text-sm text-white/30">
                    {query.startsWith("/") ? "Command not found" : "Press Enter to ask LiTT"}
                  </p>
                </div>
              ) : (
                filtered.map((cmd, index) => {
                  const Icon = cmd.icon;
                  const active = index === selectedIndex;
                  return (
                    <button
                      key={cmd.id}
                      onMouseEnter={() => setSelectedIndex(index)}
                      onClick={() => setCommandBarOpen(false)}
                      className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors ${
                        active ? "bg-[#8b5cf6]/10" : "hover:bg-white/[0.02]"
                      }`}
                    >
                      <Icon
                        size={16}
                        weight={active ? "fill" : "regular"}
                        className={active ? "text-[#8b5cf6]" : "text-white/40"}
                      />
                      <span className={`text-sm ${active ? "text-white/80" : "text-white/50"}`}>
                        {cmd.label}
                      </span>
                      {cmd.hint && (
                        <span className="ml-auto font-mono text-[10px] text-white/20">{cmd.hint}</span>
                      )}
                    </button>
                  );
                })
              )}
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between border-t border-white/5 px-4 py-2">
              <div className="flex items-center gap-3 text-[10px] text-white/20">
                <span>↑↓ Navigate</span>
                <span>↵ Select</span>
                <span>ESC Close</span>
              </div>
              <span className="text-[10px] text-white/20">LiTT Command Bar</span>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
