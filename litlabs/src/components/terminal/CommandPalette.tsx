"use client";

import { useEffect, useRef, useState } from "react";
import { Search, Terminal, Zap, Package, GitBranch, FolderOpen, Home, Info, Trash2, User, Tag } from "lucide-react";
import { CommandPaletteProps } from "./terminal-types";
import { TERMINAL_THEME } from "./terminal-theme";

const DEMO_COMMANDS = [
  { name: "help", description: "Show available commands", icon: "Help" },
  { name: "agents", description: "List available AI agents", icon: "Zap" },
  { name: "status", description: "Show system status", icon: "Info" },
  { name: "scan", description: "Scan project structure", icon: "FolderOpen" },
  { name: "deploy", description: "Deploy to production", icon: "Package" },
  { name: "clear", description: "Clear terminal", icon: "Trash2" },
  { name: "whoami", description: "Show current user", icon: "User" },
  { name: "version", description: "Show version info", icon: "Tag" },
];

const REAL_COMMANDS = [
  ...DEMO_COMMANDS,
  { name: "npm run build", description: "Build the project", icon: "Package" },
  { name: "npm run dev", description: "Start development server", icon: "Zap" },
  { name: "git status", description: "Show git repository status", icon: "GitBranch" },
  { name: "git log --oneline -5", description: "Show recent git commits", icon: "GitBranch" },
  { name: "ls -la", description: "List directory contents", icon: "FolderOpen" },
  { name: "pwd", description: "Show current directory", icon: "Home" },
];

const ICON_MAP = {
  Help: Search,
  Zap: Zap,
  Info: Info,
  FolderOpen: FolderOpen,
  Package: Package,
  Trash2: Trash2,
  User: User,
  Tag: Tag,
  GitBranch: GitBranch,
  Terminal: Terminal,
} as const;

export default function CommandPalette({ open, onClose, onSelect, mode }: CommandPaletteProps) {
  const [search, setSearch] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const commands = mode === "demo" ? DEMO_COMMANDS : REAL_COMMANDS;
  
  const filteredCommands = commands.filter(
    (cmd) =>
      cmd.name.toLowerCase().includes(search.toLowerCase()) ||
      cmd.description.toLowerCase().includes(search.toLowerCase())
  );

  useEffect(() => {
    if (open && searchInputRef.current) {
      searchInputRef.current.focus();
      setSearch("");
      setSelectedIndex(0);
    }
  }, [open]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!open) return;

      switch (e.key) {
        case "Escape":
          onClose();
          break;
        case "ArrowDown":
          e.preventDefault();
          setSelectedIndex((prev) => (prev + 1) % filteredCommands.length);
          break;
        case "ArrowUp":
          e.preventDefault();
          setSelectedIndex((prev) => (prev - 1 + filteredCommands.length) % filteredCommands.length);
          break;
        case "Enter":
          e.preventDefault();
          if (filteredCommands[selectedIndex]) {
            onSelect(filteredCommands[selectedIndex].name);
            onClose();
          }
          break;
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, filteredCommands, selectedIndex, onSelect, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[20vh]">
      {/* Backdrop */}
      <div
        className="absolute inset-0 backdrop-blur-sm"
        style={{ backgroundColor: "#00000060" }}
        onClick={onClose}
      />

      {/* Modal */}
      <div
        className="relative w-full max-w-2xl mx-4 rounded-lg shadow-2xl overflow-hidden animate-in fade-in zoom-in duration-200"
        style={{
          backgroundColor: TERMINAL_THEME.ui.bgSecondary,
          border: `1px solid ${TERMINAL_THEME.ui.border}`,
        }}
      >
        {/* Search Input */}
        <div className="flex items-center px-4 py-3 border-b" style={{ borderColor: TERMINAL_THEME.ui.border }}>
          <Search size={18} style={{ color: TERMINAL_THEME.ui.textMuted }} />
          <input
            ref={searchInputRef}
            type="text"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setSelectedIndex(0);
            }}
            placeholder="Type a command..."
            className="flex-1 ml-3 bg-transparent outline-none text-sm"
            style={{ color: TERMINAL_THEME.ui.text }}
          />
          <kbd className="px-2 py-1 text-xs rounded" style={{ 
            backgroundColor: TERMINAL_THEME.ui.bgTertiary,
            color: TERMINAL_THEME.ui.textMuted 
          }}>
            ESC
          </kbd>
        </div>

        {/* Commands List */}
        <div
          className="overflow-y-auto"
          style={{ maxHeight: "400px" }}
        >
          {filteredCommands.length === 0 ? (
            <div className="p-8 text-center text-sm" style={{ color: TERMINAL_THEME.ui.textMuted }}>
              No commands found
            </div>
          ) : (
            filteredCommands.map((cmd, index) => {
              const Icon = ICON_MAP[cmd.icon as keyof typeof ICON_MAP] || Terminal;
              const isSelected = index === selectedIndex;
              
              return (
                <div
                  key={cmd.name}
                  className={`flex items-center px-4 py-3 cursor-pointer transition-colors ${
                    isSelected ? "" : ""
                  }`}
                  style={{
                    backgroundColor: isSelected ? TERMINAL_THEME.ui.borderAccent : "transparent",
                    borderLeft: isSelected ? `3px solid ${TERMINAL_THEME.ui.accent}` : "3px solid transparent",
                  }}
                  onClick={() => {
                    onSelect(cmd.name);
                    onClose();
                  }}
                  onMouseEnter={() => setSelectedIndex(index)}
                >
                  <Icon size={16} style={{ color: TERMINAL_THEME.ui.accent }} />
                  <div className="ml-3 flex-1">
                    <div className="text-sm font-medium" style={{ color: TERMINAL_THEME.ui.text }}>
                      {cmd.name}
                    </div>
                    <div className="text-xs mt-0.5" style={{ color: TERMINAL_THEME.ui.textMuted }}>
                      {cmd.description}
                    </div>
                  </div>
                  {isSelected && (
                    <kbd className="px-2 py-1 text-xs rounded" style={{ 
                      backgroundColor: TERMINAL_THEME.ui.bgTertiary,
                      color: TERMINAL_THEME.ui.textMuted 
                    }}>
                      ↵
                    </kbd>
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-4 py-2 border-t text-xs" style={{ 
          borderColor: TERMINAL_THEME.ui.border,
          color: TERMINAL_THEME.ui.textDim 
        }}>
          <div>
            {filteredCommands.length} command{filteredCommands.length !== 1 ? "s" : ""}
          </div>
          <div className="flex gap-3">
            <span>↑↓ Navigate</span>
            <span>↵ Select</span>
            <span>ESC Close</span>
          </div>
        </div>
      </div>
    </div>
  );
}