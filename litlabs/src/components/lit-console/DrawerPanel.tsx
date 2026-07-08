"use client";

import { Terminal, FolderTree, Eye, Bot, Brain, Plug, X } from "lucide-react";
import { LC } from "./lit-console-theme";

interface DrawerPanelProps {
  open: boolean;
  onClose: () => void;
  position?: "right" | "bottom";
  activeTab: "terminal" | "files" | "preview" | "agents" | "memory" | "connectors";
  onTabChange: (tab: string) => void;
  children?: React.ReactNode;
}

const tabs = [
  { id: "terminal", label: "Terminal", icon: Terminal },
  { id: "files", label: "Files", icon: FolderTree },
  { id: "preview", label: "Preview", icon: Eye },
  { id: "agents", label: "Agents", icon: Bot },
  { id: "memory", label: "Memory", icon: Brain },
  { id: "connectors", label: "Connectors", icon: Plug },
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
        ...(isRight
          ? { top: 0, right: 0, bottom: 0, width: "min(100vw, 420px)" }
          : { left: 0, right: 0, bottom: 0, height: "min(70svh, 340px)" }),
      }}
    >
      <div className="flex min-w-0 items-center gap-2 border-b px-2 py-2 sm:px-3" style={{ borderColor: LC.border }}>
        <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto pr-1">
          {tabs.map((t) => {
            const Icon = t.icon;
            const active = activeTab === t.id;
            return (
              <button
                key={t.id}
                onClick={() => onTabChange(t.id)}
                className="flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors"
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
        <button
          onClick={onClose}
          className="flex shrink-0 items-center gap-1 rounded-md border px-2 py-1.5 text-xs font-bold transition-colors hover:bg-white/5"
          style={{ color: LC.textMuted, borderColor: LC.border }}
          aria-label="Hide panel"
          title="Hide panel"
        >
          <span className="hidden min-[380px]:inline">Hide</span>
          <X size={16} />
        </button>
      </div>
      <div className="h-[calc(100%-44px)] overflow-auto p-3 sm:p-4">
        {children || (
          <div className="flex h-full flex-col items-center justify-center text-xs" style={{ color: LC.textDim }}>
            <p>{activeTab} panel</p>
          </div>
        )}
      </div>
    </div>
  );
}
