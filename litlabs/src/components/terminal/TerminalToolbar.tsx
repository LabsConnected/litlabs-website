"use client";

import { Trash2, Copy, Maximize2, Minimize2, Command } from "lucide-react";
import { TerminalToolbarProps, ConnectionStatus } from "./terminal-types";
import { TERMINAL_THEME } from "./terminal-theme";
import { TerminalTabs } from "./TerminalTabs";

function StatusDot({ status }: { status: ConnectionStatus }) {
  const color =
    status === "connected"
      ? TERMINAL_THEME.status.online
      : status === "connecting"
      ? TERMINAL_THEME.status.connecting
      : status === "error"
      ? TERMINAL_THEME.status.error
      : TERMINAL_THEME.status.offline;

  const label =
    status === "connected"
      ? "Connected"
      : status === "connecting"
      ? "Connecting…"
      : status === "error"
      ? "Error"
      : "Offline";

  return (
    <div className="flex items-center gap-1.5 mr-2" title={label}>
      <span
        className="w-2 h-2 rounded-full"
        style={{
          backgroundColor: color,
          boxShadow: `0 0 5px ${color}80`,
          animation: status === "connecting" ? "pulse 1.5s ease-in-out infinite" : "none",
        }}
      />
      <span className="text-xs hidden sm:block" style={{ color: TERMINAL_THEME.ui.textMuted }}>
        {label}
      </span>
    </div>
  );
}

function ToolbarBtn({
  onClick,
  title,
  children,
}: {
  onClick: () => void;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      className="flex items-center justify-center w-7 h-7 rounded-sm transition-colors"
      style={{ color: TERMINAL_THEME.ui.textMuted }}
      onClick={onClick}
      title={title}
      onMouseEnter={(e) => {
        e.currentTarget.style.backgroundColor = TERMINAL_THEME.toolbar.tabHoverBg;
        e.currentTarget.style.color = TERMINAL_THEME.ui.text;
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.backgroundColor = "transparent";
        e.currentTarget.style.color = TERMINAL_THEME.ui.textMuted;
      }}
    >
      {children}
    </button>
  );
}

export function TerminalToolbar({
  tabs,
  activeTab,
  onTabChange,
  onAddTab,
  onCloseTab,
  connectionStatus,
  mode,
  onClear,
  onCopy,
  onToggleFullscreen,
  isFullscreen,
  onOpenCommandPalette,
}: TerminalToolbarProps) {
  return (
    <div
      className="flex items-center w-full shrink-0 border-b"
      style={{
        height: TERMINAL_THEME.toolbar.height,
        backgroundColor: TERMINAL_THEME.ui.bgSecondary,
        borderColor: TERMINAL_THEME.ui.border,
      }}
    >
      {/* Tabs area */}
      <TerminalTabs
        tabs={tabs}
        activeTab={activeTab}
        onTabChange={onTabChange}
        onAddTab={onAddTab}
        onCloseTab={onCloseTab}
      />

      {/* Right-side controls */}
      <div
        className="flex items-center gap-0.5 px-2 shrink-0 border-l"
        style={{ borderColor: TERMINAL_THEME.ui.border }}
      >
        {mode === "real" && <StatusDot status={connectionStatus} />}

        <ToolbarBtn onClick={onClear} title="Clear terminal">
          <Trash2 size={14} />
        </ToolbarBtn>

        <ToolbarBtn onClick={onCopy} title="Copy output">
          <Copy size={14} />
        </ToolbarBtn>

        <ToolbarBtn onClick={onOpenCommandPalette} title="Command palette (⌘K)">
          <div className="flex items-center gap-0.5">
            <Command size={12} />
            <span
              className="text-[10px] font-mono hidden sm:block"
              style={{ color: TERMINAL_THEME.ui.textMuted }}
            >
              K
            </span>
          </div>
        </ToolbarBtn>

        <ToolbarBtn
          onClick={onToggleFullscreen}
          title={isFullscreen ? "Exit fullscreen" : "Fullscreen"}
        >
          {isFullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
        </ToolbarBtn>
      </div>
    </div>
  );
}
