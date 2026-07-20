"use client";

import Link from "next/link";
import {
  Bot,
  FolderOpen,
  Menu,
  MessageCircle,
  Mic,
  Monitor,
  Terminal,
  Workflow,
  X,
} from "lucide-react";
import { useState } from "react";

export type StudioMobileView =
  | "chat"
  | "build"
  | "files"
  | "preview"
  | "terminal";

type Props = {
  activeView: StudioMobileView;
  onViewChange: (view: StudioMobileView) => void;
  projectLabel: string;
  voiceActive: boolean;
  onVoiceAction: () => void;
};

const studioViews = [
  { id: "chat", label: "Chat", icon: MessageCircle },
  { id: "build", label: "Build", icon: Workflow },
  { id: "files", label: "Files", icon: FolderOpen },
  { id: "preview", label: "Preview", icon: Monitor },
  { id: "terminal", label: "Terminal", icon: Terminal },
] as const;

const globalLinks = [
  ["Dashboard", "/dashboard"],
  ["Agents", "/agents"],
  ["Gallery", "/gallery"],
  ["Games", "/games"],
  ["Social", "/social"],
  ["Marketplace", "/marketplace"],
  ["Settings", "/settings"],
] as const;

export default function StudioMobileChrome({
  activeView,
  onViewChange,
  projectLabel,
  voiceActive,
  onVoiceAction,
}: Props) {
  const [drawerOpen, setDrawerOpen] = useState(false);

  return (
    <>
      {/* Top app bar — mobile only */}
      <header className="fixed inset-x-0 top-0 z-[80] flex h-[52px] items-center gap-2 border-b border-white/10 bg-[#040817]/95 px-2 backdrop-blur-xl md:hidden">
        <button
          type="button"
          onClick={() => setDrawerOpen(true)}
          className="grid h-9 w-9 place-items-center rounded-lg border border-white/10 bg-white/5 text-white"
          aria-label="Open navigation"
        >
          <Menu size={17} />
        </button>

        <div className="flex min-w-0 flex-1 items-center gap-2">
          <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-violet-500 to-cyan-400 text-white">
            <Bot size={17} />
          </div>

          <div className="min-w-0">
            <strong className="block text-xs font-black text-white">
              LiTT Studio
            </strong>
            <span className="block truncate text-[9px] text-white/45">
              {projectLabel}
            </span>
          </div>
        </div>

        <button
          type="button"
          onClick={onVoiceAction}
          className={`grid h-9 w-9 place-items-center rounded-lg border ${
            voiceActive
              ? "border-cyan-300/40 bg-cyan-400/15 text-cyan-200"
              : "border-white/10 bg-white/5 text-white/65"
          }`}
          aria-label={voiceActive ? "End live voice" : "Start live voice"}
        >
          <Mic size={17} />
        </button>
      </header>

      {/* Drawer — global site navigation */}
      {drawerOpen && (
        <div className="fixed inset-0 z-[100] md:hidden">
          <button
            type="button"
            aria-label="Close navigation"
            onClick={() => setDrawerOpen(false)}
            className="absolute inset-0 bg-black/70 backdrop-blur-sm"
          />

          <aside className="absolute inset-y-0 left-0 w-[82%] max-w-[320px] border-r border-white/10 bg-[#050817] p-3 shadow-2xl">
            <div className="mb-5 flex items-center justify-between">
              <strong className="text-sm font-black text-white">
                LiTTree LabStudios
              </strong>

              <button
                type="button"
                onClick={() => setDrawerOpen(false)}
                className="grid h-9 w-9 place-items-center rounded-lg bg-white/5 text-white/70"
              >
                <X size={17} />
              </button>
            </div>

            <nav className="grid gap-1">
              {globalLinks.map(([label, href]) => (
                <Link
                  key={href}
                  href={href}
                  onClick={() => setDrawerOpen(false)}
                  className="rounded-xl px-3 py-3 text-sm font-bold text-white/70 transition hover:bg-white/7 hover:text-white"
                >
                  {label}
                </Link>
              ))}
            </nav>
          </aside>
        </div>
      )}

      {/* Bottom Studio nav — single navigation bar */}
      <nav
        className="fixed inset-x-2 bottom-[max(6px,env(safe-area-inset-bottom))] z-[80] grid grid-cols-5 rounded-2xl border border-white/10 bg-[#040817]/96 p-1.5 shadow-2xl backdrop-blur-xl md:hidden"
        aria-label="Studio workspace"
      >
        {studioViews.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            data-active={activeView === id}
            onClick={() => onViewChange(id)}
            className="grid place-items-center gap-0.5 rounded-xl py-1.5 text-[8px] font-bold text-white/40 data-[active=true]:bg-cyan-400/10 data-[active=true]:text-cyan-300"
          >
            <Icon size={16} />
            <span>{label}</span>
          </button>
        ))}
      </nav>
    </>
  );
}
