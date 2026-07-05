"use client";

import { Terminal, FolderTree, Eye, Bot, Brain, X } from "lucide-react";
import { LC } from "./lit-console-theme";

interface DrawerPanelProps {
  open: boolean;
  onClose: () => void;
  position?: "right" | "bottom";
  activeTab: "terminal" | "files" | "preview" | "agents" | "memory";
  onTabChange: (tab: string) => void;
  children?: React.ReactNode;
}

const tabs = [
  { id: "terminal", label: "Terminal", icon: Terminal },
  { id: "files", label: "Files", icon: FolderTree },
  { id: "preview", label: "Preview", icon: Eye },
  { id: "agents", label: "Agents", icon: Bot },
  { id: "memory", label: "Memory", icon: Brain },
];

export default function DrawerPanel({ open, onClose, position = "right", activeTab, onTabChange, children }: DrawerPanelProps) {
  const isRight = position === "right";
  const transform = isRight ? (open ? "translateX(0)" : "translateX(100%)") : open ? "translateY(0)" : "translateY(100%)";

  return (
    <div
      className="fixed z-40 transition-transform duration-300 ease-out"
      style={{
        backgroundColor: LC.bgPanel,
        border: `1px solid ${LC.border}`,
        transform,
        ...(isRight ? { top: 0, right: 0, bottom: 0, width: 420 } : { left: 0, right: 0, bottom: 0, height: 340 }),
      }}
    >
      <div className="flex items-center justify-between border-b px-3 py-2" style={{ borderColor: LC.border }}>
        <div className="flex items-center gap-1">
          {tabs.map((t) => {
            const Icon = t.icon;
            const active = activeTab === t.id;
            return (
              <button
                key={t.id}
                onClick={() => onTabChange(t.id)}
                className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors"
                style={{
                  color: active ? LC.text : LC.textMuted,
                  backgroundColor: active ? `${LC.accentCyan}15` : "transparent",
                }}
              >
                <Icon size={14} />
                {t.label}
              </button>
            );
          })}
        </div>
        <button onClick={onClose} className="rounded-md p-1 transition-colors hover:bg-white/5" style={{ color: LC.textMuted }}>
          <X size={16} />
        </button>
      </div>
      <div className="h-[calc(100%-44px)] overflow-auto p-4">
        {children || (
          <div className="flex h-full flex-col items-center justify-center text-xs" style={{ color: LC.textDim }}>
            <p>{activeTab} panel</p>
          </div>
        )}
      </div>
    </div>
  );
}
