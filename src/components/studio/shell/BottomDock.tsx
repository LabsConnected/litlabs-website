"use client";

import { useStudioStore, type BottomDockTab } from "@/stores/useStudioStore";
import { ChatCircleIcon } from "@phosphor-icons/react/dist/csr/ChatCircle";
import { TerminalIcon } from "@phosphor-icons/react/dist/csr/Terminal";
import { BugIcon } from "@phosphor-icons/react/dist/csr/Bug";
import { CheckCircleIcon } from "@phosphor-icons/react/dist/csr/CheckCircle";
import { RocketIcon } from "@phosphor-icons/react/dist/csr/Rocket";
import { MusicNoteIcon } from "@phosphor-icons/react/dist/csr/MusicNote";

const TABS: { id: BottomDockTab; label: string; icon: typeof ChatCircleIcon }[] = [
  { id: "chat", label: "LiTT Chat", icon: ChatCircleIcon },
  { id: "terminal", label: "Terminal", icon: TerminalIcon },
  { id: "console", label: "Console", icon: BugIcon },
  { id: "problems", label: "Problems", icon: CheckCircleIcon },
  { id: "tests", label: "Tests", icon: CheckCircleIcon },
  { id: "deploy", label: "Deploy", icon: RocketIcon },
  { id: "music", label: "Music", icon: MusicNoteIcon },
];

export function BottomDock() {
  const { activeBottomDockTab, setBottomDockTab, toggleBottomDock } = useStudioStore();

  return (
    <div className="flex h-full flex-col bg-[#0d0a12]">
      {/* Tab bar */}
      <div className="flex items-center justify-between border-b border-white/5 px-2">
        <div className="flex items-center gap-1">
          {TABS.map((tab) => {
            const Icon = tab.icon;
            const active = activeBottomDockTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setBottomDockTab(tab.id)}
                className={`flex items-center gap-1.5 border-b-2 px-3 py-2 text-xs transition-colors ${
                  active
                    ? "border-[#8b5cf6] text-white/80"
                    : "border-transparent text-white/30 hover:text-white/50"
                }`}
              >
                <Icon size={14} weight={active ? "fill" : "regular"} />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>
        <button
          onClick={toggleBottomDock}
          className="p-2 text-white/20 hover:text-white/40"
          title="Close dock"
        >
          <span className="text-xs">✕</span>
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-3">
        {activeBottomDockTab === "chat" && (
          <div className="flex h-full flex-col items-center justify-center text-white/20">
            <ChatCircleIcon size={32} weight="thin" />
            <p className="mt-2 text-xs">LiTT Chat — persistent conversation dock</p>
          </div>
        )}
        {activeBottomDockTab === "terminal" && (
          <div className="flex h-full flex-col items-center justify-center text-white/20">
            <TerminalIcon size={32} weight="thin" />
            <p className="mt-2 text-xs">Terminal — connect to workspace</p>
          </div>
        )}
        {activeBottomDockTab === "console" && (
          <div className="flex h-full flex-col items-center justify-center text-white/20">
            <p className="text-xs">Console output will appear here</p>
          </div>
        )}
        {activeBottomDockTab === "problems" && (
          <div className="flex h-full flex-col items-center justify-center text-white/20">
            <p className="text-xs">No problems detected</p>
          </div>
        )}
        {activeBottomDockTab === "tests" && (
          <div className="flex h-full flex-col items-center justify-center text-white/20">
            <p className="text-xs">Test results will appear here</p>
          </div>
        )}
        {activeBottomDockTab === "deploy" && (
          <div className="flex h-full flex-col items-center justify-center text-white/20">
            <p className="text-xs">Deployment status will appear here</p>
          </div>
        )}
        {activeBottomDockTab === "music" && (
          <div className="flex h-full flex-col items-center justify-center text-white/20">
            <MusicNoteIcon size={32} weight="thin" />
            <p className="mt-2 text-xs">Music player — LiTTree audio widget</p>
          </div>
        )}
      </div>
    </div>
  );
}
