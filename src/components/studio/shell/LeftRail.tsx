"use client";

import { useStudioStore, type LeftRailTab } from "@/stores/useStudioStore";
import { useProjectStore } from "@/stores/useProjectStore";
import { FolderOpenIcon } from "@phosphor-icons/react/dist/csr/FolderOpen";
import { FileIcon } from "@phosphor-icons/react/dist/csr/File";
import { ImageIcon } from "@phosphor-icons/react/dist/csr/Image";
import { BrainIcon } from "@phosphor-icons/react/dist/csr/Brain";
import { RobotIcon } from "@phosphor-icons/react/dist/csr/Robot";
import { RocketIcon } from "@phosphor-icons/react/dist/csr/Rocket";

const TABS: { id: LeftRailTab; label: string; icon: typeof FolderOpenIcon }[] = [
  { id: "projects", label: "Projects", icon: FolderOpenIcon },
  { id: "files", label: "Files", icon: FileIcon },
  { id: "assets", label: "Assets", icon: ImageIcon },
  { id: "memory", label: "Memory", icon: BrainIcon },
  { id: "agents", label: "Agents", icon: RobotIcon },
  { id: "deploy", label: "Deploy", icon: RocketIcon },
];

export function LeftRail() {
  const { activeLeftRailTab, setLeftRailTab } = useStudioStore();
  const { files, agents, projectName } = useProjectStore();

  return (
    <div className="flex h-full flex-col bg-[#0d0a12]">
      {/* Tab icons */}
      <div className="flex flex-col gap-1 border-b border-white/5 p-2">
        {TABS.map((tab) => {
          const Icon = tab.icon;
          const active = activeLeftRailTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setLeftRailTab(tab.id)}
              className={`flex items-center gap-3 rounded-lg px-3 py-2 text-xs transition-colors ${
                active
                  ? "bg-[#8b5cf6]/10 text-[#8b5cf6]"
                  : "text-white/40 hover:bg-white/[0.03] hover:text-white/60"
              }`}
            >
              <Icon size={16} weight={active ? "fill" : "regular"} />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto p-3">
        {activeLeftRailTab === "projects" && (
          <div className="space-y-2">
            <div className="text-[10px] uppercase tracking-wider text-white/30">Active Project</div>
            <div className="rounded-lg border border-white/5 bg-white/[0.02] p-3">
              <div className="text-sm text-white/80">{projectName ?? "No project selected"}</div>
              <div className="mt-1 text-xs text-white/30">Click to switch projects</div>
            </div>
          </div>
        )}

        {activeLeftRailTab === "files" && (
          <div className="space-y-1">
            <div className="text-[10px] uppercase tracking-wider text-white/30">Files</div>
            {files.length === 0 ? (
              <div className="text-xs text-white/20">No files loaded</div>
            ) : (
              <FileTree files={files} depth={0} />
            )}
          </div>
        )}

        {activeLeftRailTab === "assets" && (
          <div className="space-y-2">
            <div className="text-[10px] uppercase tracking-wider text-white/30">Assets</div>
            <div className="text-xs text-white/20">Logos, images, icons, audio</div>
          </div>
        )}

        {activeLeftRailTab === "memory" && (
          <div className="space-y-2">
            <div className="text-[10px] uppercase tracking-wider text-white/30">Project Memory</div>
            <div className="text-xs text-white/20">Memories will appear here</div>
          </div>
        )}

        {activeLeftRailTab === "agents" && (
          <div className="space-y-2">
            <div className="text-[10px] uppercase tracking-wider text-white/30">Agents</div>
            {agents.length === 0 ? (
              <div className="text-xs text-white/20">No agents active</div>
            ) : (
              agents.map((agent) => (
                <div key={agent.id} className="flex items-center gap-2 rounded-lg border border-white/5 bg-white/[0.02] p-2">
                  <span className={`h-1.5 w-1.5 rounded-full ${
                    agent.status === "online" ? "bg-[#22c55e]" :
                    agent.status === "running" ? "bg-[#8b5cf6] animate-pulse" :
                    agent.status === "error" ? "bg-[#ef4444]" :
                    "bg-white/20"
                  }`} />
                  <span className="text-xs text-white/60">{agent.name}</span>
                </div>
              ))
            )}
          </div>
        )}

        {activeLeftRailTab === "deploy" && (
          <div className="space-y-2">
            <div className="text-[10px] uppercase tracking-wider text-white/30">Deployment</div>
            <div className="text-xs text-white/20">No active deployment</div>
          </div>
        )}
      </div>
    </div>
  );
}

function FileTree({ files, depth }: { files: { path: string; name: string; type: "file" | "directory"; children?: typeof files }[]; depth: number }) {
  return (
    <>
      {files.map((file) => (
        <div key={file.path}>
          <div
            className="flex items-center gap-2 rounded-md px-2 py-1 text-xs text-white/50 hover:bg-white/[0.03] hover:text-white/70 cursor-pointer"
            style={{ paddingLeft: `${depth * 12 + 8}px` }}
          >
            <FileIcon size={12} weight="regular" />
            <span>{file.name}</span>
          </div>
          {file.children && <FileTree files={file.children} depth={depth + 1} />}
        </div>
      ))}
    </>
  );
}
