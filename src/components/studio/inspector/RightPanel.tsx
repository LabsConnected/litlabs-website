"use client";

import { useSelectionStore, type SelectionType } from "@/stores/useSelectionStore";
import { useProjectStore } from "@/stores/useProjectStore";
import {
  ImageIcon,
  CodeIcon,
  RobotIcon,
  RocketIcon,
  BrainIcon,
  GearIcon,
} from "@phosphor-icons/react";

const typeConfig: Record<SelectionType, { icon: typeof ImageIcon; label: string }> = {
  component: { icon: CodeIcon, label: "Component" },
  file: { icon: CodeIcon, label: "File" },
  image: { icon: ImageIcon, label: "Image" },
  asset: { icon: ImageIcon, label: "Asset" },
  agent: { icon: RobotIcon, label: "Agent" },
  deployment: { icon: RocketIcon, label: "Deployment" },
  workflow: { icon: GearIcon, label: "Workflow" },
  memory: { icon: BrainIcon, label: "Memory" },
  database: { icon: GearIcon, label: "Database" },
  none: { icon: GearIcon, label: "Properties" },
};

export function RightPanel() {
  const { selection } = useSelectionStore();
  const { projectName } = useProjectStore();

  // No selection → show Project Overview / Memory
  if (!selection) {
    return (
      <div className="flex h-full flex-col bg-[#0d0a12]">
        <div className="border-b border-white/5 px-4 py-3">
          <span className="text-xs font-medium text-white/60">Project Overview</span>
        </div>
        <div className="flex-1 overflow-y-auto p-4">
          <div className="space-y-4">
            <div>
              <div className="text-[10px] uppercase tracking-wider text-white/30">Project</div>
              <div className="mt-1 text-sm text-white/70">{projectName ?? "No project selected"}</div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wider text-white/30">Memory</div>
              <div className="mt-1 text-xs text-white/20">
                Project memories will appear here. Select an object to see its properties.
              </div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wider text-white/30">Ask LiTT</div>
              <div className="mt-2 rounded-lg border border-white/5 bg-white/[0.02] p-3">
                <input
                  type="text"
                  placeholder="Ask about this project..."
                  className="w-full bg-transparent text-xs text-white/60 placeholder:text-white/20 focus:outline-none"
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const config = typeConfig[selection.type];
  const Icon = config.icon;

  return (
    <div className="flex h-full flex-col bg-[#0d0a12]">
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-white/5 px-4 py-3">
        <Icon size={16} weight="regular" className="text-[#8b5cf6]" />
        <span className="text-xs font-medium text-white/60">{config.label}</span>
        <span className="ml-auto text-xs text-white/30">{selection.name}</span>
      </div>

      {/* Properties */}
      <div className="flex-1 overflow-y-auto p-4">
        <div className="space-y-3">
          {selection.type === "image" && (
            <>
              <PropertyRow label="Source" value="—" />
              <PropertyRow label="Alt text" value="—" />
              <PropertyRow label="Dimensions" value="—" />
              <PropertyRow label="Size" value="—" />
              <ActionButtons actions={["Crop", "Replace", "Upscale", "Remove BG"]} />
            </>
          )}
          {selection.type === "component" && (
            <>
              <PropertyRow label="Layout" value="flex" />
              <PropertyRow label="Spacing" value="16px" />
              <PropertyRow label="Typography" value="Inter" />
              <PropertyRow label="Radius" value="8px" />
              <ActionButtons actions={["Edit", "Duplicate", "Wrap"]} />
            </>
          )}
          {selection.type === "agent" && (
            <>
              <PropertyRow label="Model" value="—" />
              <PropertyRow label="Temperature" value="0.7" />
              <PropertyRow label="Instructions" value="—" />
              <PropertyRow label="Tools" value="—" />
              <ActionButtons actions={["Configure", "Test", "Deploy"]} />
            </>
          )}
          {selection.type === "deployment" && (
            <>
              <PropertyRow label="Status" value="—" />
              <PropertyRow label="Domain" value="—" />
              <PropertyRow label="Environment" value="production" />
              <ActionButtons actions={["Redeploy", "Rollback", "View Logs"]} />
            </>
          )}
          {selection.type === "file" && (
            <>
              <PropertyRow label="Path" value={selection.id} />
              <PropertyRow label="Type" value="—" />
              <ActionButtons actions={["Open", "Rename", "Delete"]} />
            </>
          )}
          {selection.type === "memory" && (
            <>
              <PropertyRow label="Type" value="—" />
              <PropertyRow label="Created" value="—" />
              <ActionButtons actions={["Edit", "Delete"]} />
            </>
          )}
        </div>
      </div>

      {/* Ask LiTT footer */}
      <div className="border-t border-white/5 p-3">
        <div className="rounded-lg border border-white/5 bg-white/[0.02] p-3">
          <input
            type="text"
            placeholder={`Ask LiTT about this ${config.label.toLowerCase()}...`}
            className="w-full bg-transparent text-xs text-white/60 placeholder:text-white/20 focus:outline-none"
          />
        </div>
      </div>
    </div>
  );
}

function PropertyRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-xs text-white/40">{label}</span>
      <span className="text-xs text-white/60">{value}</span>
    </div>
  );
}

function ActionButtons({ actions }: { actions: string[] }) {
  return (
    <div className="flex flex-wrap gap-2 pt-2">
      {actions.map((action) => (
        <button
          key={action}
          className="rounded-lg border border-white/5 bg-white/[0.02] px-3 py-1.5 text-xs text-white/50 transition-colors hover:bg-white/[0.04] hover:text-white/70"
        >
          {action}
        </button>
      ))}
    </div>
  );
}
