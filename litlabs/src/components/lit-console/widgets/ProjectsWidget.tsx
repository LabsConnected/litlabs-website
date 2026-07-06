"use client";

import { useTheme } from "@/context/ThemeContext";
import { Folder, Plus, ArrowRight } from "lucide-react";
import { BentoCard } from "@/components/site/BentoCard";
import { EmptyState } from "@/components/site/EmptyState";

const PROJECTS = [
  { id: "litlabs", name: "LiTTree LabStudios", type: "Platform", updated: "2h ago", status: "active" },
  { id: "console", name: "LiT Console", type: "Dashboard", updated: "5h ago", status: "building" },
  { id: "agents", name: "Agent Forge", type: "AI Agents", updated: "1d ago", status: "active" },
];

export function ProjectsWidget() {
  const { resolvedColors: T } = useTheme();

  return (
    <BentoCard
      title="Projects"
      icon={<Folder size={14} />}
      action={
        <button
          className="flex items-center gap-1 rounded-lg px-2 py-1 text-[10px] font-bold transition hover:opacity-80"
          style={{ backgroundColor: `${T.accentColor}20`, color: T.accentColor }}
        >
          <Plus size={12} /> New
        </button>
      }
    >
      {PROJECTS.length === 0 ? (
        <EmptyState
          icon="📁"
          title="No projects yet"
          description="Start your first LiT build."
          action={
            <button
              className="mt-2 rounded-lg px-3 py-1.5 text-xs font-bold"
              style={{ backgroundColor: T.accentColor, color: T.bgColor }}
            >
              New Project
            </button>
          }
        />
      ) : (
        <div className="flex flex-col gap-2">
          {PROJECTS.map((project) => (
            <div
              key={project.id}
              className="group flex items-center justify-between rounded-xl border p-2.5 transition hover:border-opacity-60"
              style={{
                borderColor: `${T.borderColor}25`,
                backgroundColor: `${T.borderColor}08`,
              }}
            >
              <div>
                <div className="text-sm font-bold" style={{ color: T.textColor }}>
                  {project.name}
                </div>
                <div className="text-[10px]" style={{ color: T.textMuted }}>
                  {project.type} • {project.updated}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span
                  className="rounded-full px-2 py-0.5 text-[9px] font-bold"
                  style={{
                    backgroundColor: project.status === "active" ? `${T.success}20` : `${T.warning}20`,
                    color: project.status === "active" ? T.success : T.warning,
                  }}
                >
                  {project.status}
                </span>
                <button
                  className="rounded-lg p-1.5 opacity-0 transition group-hover:opacity-100"
                  style={{ color: T.accentColor }}
                >
                  <ArrowRight size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </BentoCard>
  );
}
