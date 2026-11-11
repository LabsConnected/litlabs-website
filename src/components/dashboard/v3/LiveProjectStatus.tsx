"use client";

import Link from "next/link";
import { Activity, GitBranch, Monitor, Rocket, TerminalSquare } from "lucide-react";
import type { DashboardProject, PulseItem, PulseState } from "./types";
import { useTheme } from "@/context/ThemeContext";

function color(state: PulseItem["state"]) {
  if (state === "live" || state === "passing") return "#34d399";
  if (state === "building") return "#f59e0b";
  if (state === "failed") return "#f87171";
  return "#71717a";
}

export function LiveProjectStatus({ project, pulseItems, loading }: { project: DashboardProject | null; pulseItems: PulseItem[]; loading: boolean }) {
  // Theme-token driven (was hard-coded dark glass): follows the applied
  // theme — light under the default LiTT Signature theme. Status dot
  // colors above are state semantics and stay fixed.
  const { resolvedColors } = useTheme();
  const find = (id: string) => pulseItems.find((item) => item.id === id);
  const rows: { label: string; value: string; icon: typeof Monitor; state: PulseState }[] = [
    { label: "Preview", value: project?.previewState ?? "No project", icon: Monitor, state: project?.previewState === "running" || project?.previewState === "ready" ? "live" : "unknown" },
    { label: "Build", value: find("build")?.label.replace("Build ", "") ?? "Unknown", icon: Activity, state: find("build")?.state ?? "unknown" },
    { label: "Deploy", value: project?.deploymentState ?? "No project", icon: Rocket, state: project?.deploymentState === "production" ? "live" : project?.deploymentState === "failed" ? "failed" : "unknown" },
    { label: "Terminal", value: project?.terminalState ?? "Disconnected", icon: TerminalSquare, state: project?.terminalState === "connected" ? "live" : "unknown" },
  ];

  return (
    <section className="rounded-xl border p-5" style={{ background: resolvedColors.boxBg, borderColor: resolvedColors.borderColor }}>
      <div className="mb-4 flex items-center justify-between">
        <div><h2 className="text-sm font-bold uppercase tracking-[.18em]" style={{ color: resolvedColors.textColor }}>Live project status</h2><p className="mt-1 text-xs" style={{ color: resolvedColors.textMuted }}>Only reported runtime state appears here.</p></div>
        {project && <span className="max-w-[9rem] truncate rounded-full px-2.5 py-1 text-[10px] font-mono" style={{ background: `${resolvedColors.textColor}0d`, color: resolvedColors.textMuted }}>{project.name}</span>}
      </div>
      {loading ? <div className="space-y-2">{[1, 2, 3, 4].map((row) => <div key={row} className="h-10 animate-pulse rounded-lg" style={{ background: `${resolvedColors.textColor}0d` }} />)}</div> : !project ? <div className="rounded-lg border border-dashed px-4 py-6 text-center text-sm" style={{ borderColor: resolvedColors.borderColor, color: resolvedColors.textMuted }}>Connect a project to see preview, build, deploy, and terminal state.</div> : <div className="space-y-2">{rows.map(({ label, value, icon: Icon, state }) => <div key={label} className="flex items-center justify-between rounded-lg border px-3 py-2.5" style={{ borderColor: resolvedColors.borderColor, background: `${resolvedColors.textColor}06` }}><span className="flex items-center gap-2 text-xs" style={{ color: resolvedColors.textMuted }}><Icon size={14} />{label}</span><span className="flex items-center gap-2 text-xs font-semibold capitalize" style={{ color: resolvedColors.textColor }}><i className="h-1.5 w-1.5 rounded-full" style={{ background: color(state) }} />{value}</span></div>)}</div>}
      {project && <div className="mt-3 flex items-center gap-2 text-xs" style={{ color: resolvedColors.textMuted }}><GitBranch size={13} />{project.branch || "No branch reported"}<Link href="/studio" className="ml-auto font-semibold hover:brightness-125" style={{ color: resolvedColors.accentColor }}>Open Studio →</Link></div>}
    </section>
  );
}
