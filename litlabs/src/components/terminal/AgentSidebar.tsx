"use client";

import { useState } from "react";
import { ChevronLeft, ChevronRight, Sparkles, Wrench, Hammer, Rocket, ScanLine, GitBranch, Send } from "lucide-react";
import { AgentSidebarProps, AgentAction } from "./terminal-types";
import { TERMINAL_THEME } from "./terminal-theme";

const QUICK_ACTIONS: Omit<AgentAction, "id">[] = [
  { label: "Explain Error", icon: "Sparkles", description: "Get AI help with current error", command: "explain the current error" },
  { label: "Fix Command", icon: "Wrench", description: "Fix the last failed command", command: "fix the last failed command" },
  { label: "Run Build", icon: "Hammer", description: "Execute npm run build", command: "npm run build" },
  { label: "Deploy", icon: "Rocket", description: "Deploy to production", command: "deploy to production" },
  { label: "Scan Project", icon: "ScanLine", description: "Scan project structure", command: "/scan" },
  { label: "Git Status", icon: "GitBranch", description: "Check git repository status", command: "git status" },
];

const ICON_MAP = {
  Sparkles,
  Wrench,
  Hammer,
  Rocket,
  ScanLine,
  GitBranch,
} as const;

export default function AgentSidebar({ onRunAction, onSendMessage, collapsed = false, onToggle }: AgentSidebarProps) {
  const [message, setMessage] = useState("");

  const handleActionClick = (action: Omit<AgentAction, "id">, index: number) => {
    onRunAction({
      id: `action-${index}`,
      ...action,
    });
  };

  const handleSendMessage = () => {
    if (message.trim()) {
      onSendMessage(message.trim());
      setMessage("");
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const width = collapsed ? "48px" : "280px";

  return (
    <div
      className="flex flex-col border-l transition-all duration-300 ease-in-out"
      style={{
        width,
        backgroundColor: TERMINAL_THEME.ui.bgSecondary,
        borderColor: TERMINAL_THEME.ui.border,
      }}
    >
      {/* Header */}
      <div className="flex items-center justify-between p-3 border-b" style={{ borderColor: TERMINAL_THEME.ui.border }}>
        {!collapsed && (
          <h3 className="text-sm font-medium" style={{ color: TERMINAL_THEME.ui.text }}>
            Agent Panel
          </h3>
        )}
        <button
          onClick={onToggle}
          className="p-1 rounded hover:bg-opacity-10 transition-colors"
          style={{ color: TERMINAL_THEME.ui.textMuted }}
          onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = TERMINAL_THEME.ui.borderAccent)}
          onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
        >
          {collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
        </button>
      </div>

      {/* Quick Actions */}
      <div className="flex-1 p-3">
        {!collapsed ? (
          <div className="grid grid-cols-2 gap-2">
            {QUICK_ACTIONS.map((action, index) => {
              const Icon = ICON_MAP[action.icon as keyof typeof ICON_MAP];
              return (
                <button
                  key={index}
                  onClick={() => handleActionClick(action, index)}
                  className="flex flex-col items-center p-3 rounded-lg transition-all hover:scale-105"
                  style={{
                    backgroundColor: TERMINAL_THEME.ui.bgTertiary,
                    border: `1px solid ${TERMINAL_THEME.ui.border}`,
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.backgroundColor = TERMINAL_THEME.ui.borderAccent;
                    e.currentTarget.style.borderColor = TERMINAL_THEME.ui.accent;
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.backgroundColor = TERMINAL_THEME.ui.bgTertiary;
                    e.currentTarget.style.borderColor = TERMINAL_THEME.ui.border;
                  }}
                >
                  <Icon size={20} style={{ color: TERMINAL_THEME.ui.accent }} />
                  <span className="text-xs mt-1" style={{ color: TERMINAL_THEME.ui.text }}>
                    {action.label}
                  </span>
                </button>
              );
            })}
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {QUICK_ACTIONS.map((action, index) => {
              const Icon = ICON_MAP[action.icon as keyof typeof ICON_MAP];
              return (
                <button
                  key={index}
                  onClick={() => handleActionClick(action, index)}
                  className="p-2 rounded transition-all hover:scale-105"
                  style={{
                    backgroundColor: TERMINAL_THEME.ui.bgTertiary,
                    border: `1px solid ${TERMINAL_THEME.ui.border}`,
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.backgroundColor = TERMINAL_THEME.ui.borderAccent;
                    e.currentTarget.style.borderColor = TERMINAL_THEME.ui.accent;
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.backgroundColor = TERMINAL_THEME.ui.bgTertiary;
                    e.currentTarget.style.borderColor = TERMINAL_THEME.ui.border;
                  }}
                  title={action.label}
                >
                  <Icon size={16} style={{ color: TERMINAL_THEME.ui.accent }} />
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Chat Input */}
      {!collapsed && (
        <div className="p-3 border-t" style={{ borderColor: TERMINAL_THEME.ui.border }}>
          <div className="flex gap-2">
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask agent..."
              className="flex-1 p-2 rounded resize-none text-sm"
              style={{
                backgroundColor: TERMINAL_THEME.ui.bgTertiary,
                color: TERMINAL_THEME.ui.text,
                border: `1px solid ${TERMINAL_THEME.ui.border}`,
              }}
              rows={2}
            />
            <button
              onClick={handleSendMessage}
              disabled={!message.trim()}
              className="p-2 rounded transition-all hover:scale-105 disabled:opacity-50 disabled:cursor-not-allowed"
              style={{
                backgroundColor: message.trim() ? TERMINAL_THEME.ui.accent : TERMINAL_THEME.ui.bgTertiary,
                border: `1px solid ${TERMINAL_THEME.ui.border}`,
              }}
            >
              <Send size={16} style={{ color: message.trim() ? "white" : TERMINAL_THEME.ui.textMuted }} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}