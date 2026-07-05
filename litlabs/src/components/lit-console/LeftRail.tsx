"use client";

import {
  MessageSquare,
  Plus,
  Folder,
  FileCode,
  Wrench,
  Layers,
  PanelLeftClose,
  PanelLeftOpen,
} from "lucide-react";
import { LC } from "./lit-console-theme";

interface LeftRailProps {
  activeAgent: string;
  onAgentChange: (agent: string) => void;
  collapsed?: boolean;
  onToggle?: () => void;
}

const agents = [
  { name: "Director", color: "#00f5ff" },
  { name: "Code Champ", color: "#22c55e" },
  { name: "Writer", color: "#ec4899" },
  { name: "Social Dom", color: "#ef4444" },
  { name: "Data Slayer", color: "#eab308" },
];

const conversations = [
  { title: "Sign-up page build", time: "2m" },
  { title: "Fix auth redirect", time: "1h" },
  { title: "Marketplace agents", time: "3h" },
  { title: "Social content plan", time: "1d" },
];

const projects = [
  { name: "litlabs", active: true },
  { name: "website-v2", active: false },
  { name: "agent-marketplace", active: false },
];

const files = ["src/app/page.tsx", "src/components/Navbar.tsx", "terminal/server.ts"];

const tools = ["Terminal", "Code Scanner", "Image Forge", "Flow Builder"];

const workflows = ["Deploy pipeline", "Content loop"];

const sectionLabel = {
  fontSize: 10,
  fontWeight: 700,
  textTransform: "uppercase" as const,
  letterSpacing: "0.05em",
  color: LC.textDim,
};

const itemBase =
  "flex items-center gap-2.5 w-full rounded-md px-2.5 py-1.5 text-left text-xs font-medium transition-colors hover:bg-white/5";

const activeItem = {
  backgroundColor: `${LC.accentCyan}15`,
  color: LC.accentCyan,
  borderLeft: `2px solid ${LC.accentCyan}`,
};

const inactiveItem = {
  color: LC.text,
  borderLeft: "2px solid transparent",
};

export default function LeftRail({
  activeAgent,
  onAgentChange,
  collapsed,
  onToggle,
}: LeftRailProps) {
  const isCollapsed = collapsed ?? false;

  return (
    <aside
      className="flex h-full shrink-0 flex-col transition-all duration-300"
      style={{
        width: isCollapsed ? 56 : 240,
        backgroundColor: LC.bgPanel,
        borderRight: `1px solid ${LC.border}`,
      }}
    >
      <div
        className="flex h-[52px] shrink-0 items-center gap-2 px-3"
        style={{ borderBottom: `1px solid ${LC.borderSubtle}` }}
      >
        <div
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-sm font-bold"
          style={{
            background: "linear-gradient(135deg, #6366f1, #00f5ff)",
            color: "#fff",
          }}
        >
          L
        </div>
        {!isCollapsed && (
          <span className="text-sm font-semibold" style={{ color: LC.text }}>
            LiT Console
          </span>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-2 py-3">
        {!isCollapsed && (
          <button
            className="mb-3 flex w-full items-center justify-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-semibold transition-colors hover:bg-white/10"
            style={{ backgroundColor: LC.accentCyan, color: "#000" }}
          >
            <Plus size={14} />
            New chat
          </button>
        )}
        {isCollapsed && (
          <button
            className="mb-3 flex h-7 w-full items-center justify-center rounded-md transition-colors hover:bg-white/10"
            style={{ backgroundColor: LC.accentCyan, color: "#000" }}
          >
            <Plus size={16} />
          </button>
        )}

        <div className="mb-4">
          {!isCollapsed && <div className="mb-2 px-2.5" style={sectionLabel}>Conversations</div>}
          {conversations.map((c) => (
            <button
              key={c.title}
              className={itemBase}
              style={inactiveItem}
              title={isCollapsed ? c.title : undefined}
            >
              <MessageSquare size={14} style={{ color: LC.textMuted }} />
              {!isCollapsed && (
                <>
                  <span className="truncate">{c.title}</span>
                  <span className="ml-auto shrink-0" style={{ color: LC.textDim }}>
                    {c.time}
                  </span>
                </>
              )}
            </button>
          ))}
        </div>

        <div className="mb-4">
          {!isCollapsed && <div className="mb-2 px-2.5" style={sectionLabel}>Agents</div>}
          {agents.map((a) => {
            const active = activeAgent === a.name;
            return (
              <button
                key={a.name}
                className={itemBase}
                style={active ? activeItem : inactiveItem}
                onClick={() => onAgentChange(a.name)}
                title={isCollapsed ? a.name : undefined}
              >
                <span
                  className="h-2 w-2 shrink-0 rounded-full"
                  style={{ backgroundColor: a.color }}
                />
                {!isCollapsed && <span className="truncate">{a.name}</span>}
              </button>
            );
          })}
        </div>

        <div className="mb-4">
          {!isCollapsed && <div className="mb-2 px-2.5" style={sectionLabel}>Projects</div>}
          {projects.map((p) => (
            <button
              key={p.name}
              className={itemBase}
              style={p.active ? activeItem : inactiveItem}
              title={isCollapsed ? p.name : undefined}
            >
              <Folder size={14} style={{ color: p.active ? LC.accentCyan : LC.textMuted }} />
              {!isCollapsed && <span className="truncate">{p.name}</span>}
            </button>
          ))}
        </div>

        <div className="mb-4">
          {!isCollapsed && <div className="mb-2 px-2.5" style={sectionLabel}>Files</div>}
          {files.map((f) => (
            <button
              key={f}
              className={itemBase}
              style={inactiveItem}
              title={isCollapsed ? f : undefined}
            >
              <FileCode size={14} style={{ color: LC.textMuted }} />
              {!isCollapsed && <span className="truncate font-mono text-[11px]">{f}</span>}
            </button>
          ))}
        </div>

        <div className="mb-4">
          {!isCollapsed && <div className="mb-2 px-2.5" style={sectionLabel}>Tools</div>}
          {tools.map((t) => (
            <button
              key={t}
              className={itemBase}
              style={inactiveItem}
              title={isCollapsed ? t : undefined}
            >
              <Wrench size={14} style={{ color: LC.textMuted }} />
              {!isCollapsed && <span className="truncate">{t}</span>}
            </button>
          ))}
        </div>

        <div className="mb-2">
          {!isCollapsed && <div className="mb-2 px-2.5" style={sectionLabel}>Workflows</div>}
          {workflows.map((w) => (
            <button
              key={w}
              className={itemBase}
              style={inactiveItem}
              title={isCollapsed ? w : undefined}
            >
              <Layers size={14} style={{ color: LC.textMuted }} />
              {!isCollapsed && <span className="truncate">{w}</span>}
            </button>
          ))}
        </div>
      </div>

      <div
        className="flex h-10 shrink-0 items-center justify-center border-t px-2"
        style={{ borderColor: LC.borderSubtle }}
      >
        <button
          onClick={onToggle}
          className="flex items-center justify-center rounded-md p-1.5 transition-colors hover:bg-white/5"
          style={{ color: LC.textMuted }}
          title={isCollapsed ? "Expand" : "Collapse"}
        >
          {isCollapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
        </button>
      </div>
    </aside>
  );
}
