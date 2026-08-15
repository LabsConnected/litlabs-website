"use client";

import { useStudioStore, type LiTTStatus } from "@/stores/useStudioStore";
import { useProjectStore } from "@/stores/useProjectStore";
import { MagnifyingGlassIcon } from "@phosphor-icons/react/dist/csr/MagnifyingGlass";
import { ListIcon } from "@phosphor-icons/react/dist/csr/List";
import { SidebarSimpleIcon } from "@phosphor-icons/react/dist/csr/SidebarSimple";
import { ArrowsOutSimpleIcon } from "@phosphor-icons/react/dist/csr/ArrowsOutSimple";
import { ArrowsInSimpleIcon } from "@phosphor-icons/react/dist/csr/ArrowsInSimple";

const statusConfig: Record<LiTTStatus, { color: string; label: string }> = {
  ready: { color: "bg-[#22c55e]", label: "Ready" },
  working: { color: "bg-[#8b5cf6]", label: "Working" },
  error: { color: "bg-[#ef4444]", label: "Error" },
  "needs-attention": { color: "bg-[#eab308]", label: "Needs Attention" },
};

export function TopBar() {
  const {
    littStatus,
    toggleLeftRail,
    toggleRightPanel,
    toggleBottomDock,
    toggleFocusMode,
    toggleCommandBar,
    leftRailOpen,
    rightPanelOpen,
    bottomDockOpen,
    focusMode,
  } = useStudioStore();

  const { projectName } = useProjectStore();
  const status = statusConfig[littStatus];

  return (
    <header className="flex h-16 items-center justify-between border-b border-white/5 bg-[#0d0a12] px-4">
      {/* Left: Logo + Project Switcher */}
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2">
          <div className="h-7 w-7 rounded-lg bg-gradient-to-br from-[#8b5cf6] to-[#25f4ff]" />
          <span className="text-sm font-semibold text-white">LiTT Studio</span>
        </div>
        {projectName && (
          <>
            <div className="h-4 w-px bg-white/10" />
            <span className="text-sm text-white/60">{projectName}</span>
          </>
        )}
      </div>

      {/* Center: LiTT Status + Search */}
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2">
          <span className={`h-2 w-2 rounded-full ${status.color} ${littStatus === "working" ? "animate-pulse" : ""}`} />
          <span className="text-xs text-white/60">LiTT {status.label}</span>
        </div>

        <button
          onClick={() => toggleCommandBar()}
          className="flex items-center gap-2 rounded-lg border border-white/5 bg-white/[0.02] px-3 py-1.5 text-xs text-white/40 transition-colors hover:bg-white/[0.04] hover:text-white/60"
        >
          <MagnifyingGlassIcon size={14} weight="regular" />
          <span>Search or ask LiTT...</span>
          <kbd className="ml-2 rounded bg-white/5 px-1.5 py-0.5 text-[10px] text-white/30">⌘K</kbd>
        </button>
      </div>

      {/* Right: Panel toggles */}
      <div className="flex items-center gap-1">
        <button
          onClick={toggleLeftRail}
          className={`rounded-md p-2 transition-colors ${leftRailOpen ? "text-white/60" : "text-white/20 hover:text-white/40"}`}
          title="Toggle Left Rail"
        >
          <SidebarSimpleIcon size={18} weight="regular" mirrored={leftRailOpen} />
        </button>
        <button
          onClick={toggleBottomDock}
          className={`rounded-md p-2 transition-colors ${bottomDockOpen ? "text-white/60" : "text-white/20 hover:text-white/40"}`}
          title="Toggle Bottom Dock"
        >
          <ListIcon size={18} weight="regular" />
        </button>
        <button
          onClick={toggleRightPanel}
          className={`rounded-md p-2 transition-colors ${rightPanelOpen ? "text-white/60" : "text-white/20 hover:text-white/40"}`}
          title="Toggle Right Inspector"
        >
          <SidebarSimpleIcon size={18} weight="regular" />
        </button>
        <div className="mx-1 h-4 w-px bg-white/10" />
        <button
          onClick={toggleFocusMode}
          className={`rounded-md p-2 transition-colors ${focusMode ? "text-[#8b5cf6]" : "text-white/20 hover:text-white/40"}`}
          title="Focus Mode (Ctrl+Shift+F)"
        >
          {focusMode ? <ArrowsInSimpleIcon size={18} weight="regular" /> : <ArrowsOutSimpleIcon size={18} weight="regular" />}
        </button>
      </div>
    </header>
  );
}
