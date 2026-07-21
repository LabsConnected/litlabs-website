"use client";

import Link from "next/link";
import {
  Bot,
  Menu,
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
  projectLabel: string;
  activeView?: StudioMobileView;
  onViewChange?: (view: StudioMobileView) => void;
  voiceActive?: boolean;
  onVoiceAction?: () => void;
};

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
  projectLabel,
  activeView = "chat",
  onViewChange,
  voiceActive = false,
  onVoiceAction,
}: Props) {
  const [drawerOpen, setDrawerOpen] = useState(false);

  const handleView = (v: StudioMobileView) => {
    onViewChange?.(v);
  };

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

        {/* Compact mobile view switcher (single source of truth) */}
        <div className="ml-auto flex items-center gap-1 pr-1 md:hidden">
          {([
            { id: "chat" as const, label: "Chat" },
            { id: "build" as const, label: "Build" },
            { id: "files" as const, label: "Files" },
            { id: "preview" as const, label: "Prev" },
            { id: "terminal" as const, label: "Term" },
          ]).map((v) => (
            <button
              key={v.id}
              type="button"
              data-active={activeView === v.id}
              onClick={() => handleView(v.id)}
              className="rounded-md border border-white/10 px-2 py-0.5 text-[9px] font-bold text-white/60 data-[active=true]:border-cyan-400/60 data-[active=true]:text-cyan-300"
            >
              {v.label}
            </button>
          ))}
          <button
            type="button"
            onClick={onVoiceAction}
            className={`ml-1 rounded-md border px-2 py-0.5 text-[9px] font-bold ${voiceActive ? "border-emerald-400 text-emerald-300" : "border-white/10 text-white/60"}`}
            aria-pressed={voiceActive}
          >
            {voiceActive ? "Mic" : "Mic"}
          </button>
        </div>
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

      {/* Bottom nav is now rendered inside the unified bottom shell in LITTTerminalShell */}
    </>
  );
}
