"use client";

import { Check, X, Loader2, Clock, AlertTriangle, Terminal, FileCode, Search, Globe, Eye } from "lucide-react";
import type { DirectorStep, DirectorRunStatus } from "@/lib/director/types";

interface RunTimelineProps {
  goal: string;
  steps: DirectorStep[];
  runStatus: DirectorRunStatus;
  currentStepId?: string;
  theme: {
    bgPanel: string;
    bgSecondary: string;
    border: string;
    text: string;
    textMuted: string;
    textDim: string;
    accentCyan: string;
    accentOrange: string;
    success: string;
    danger: string;
    warning: string;
  };
}

function statusIcon(status: string) {
  switch (status) {
    case "success": return <Check size={12} />;
    case "failed": return <X size={12} />;
    case "running": return <Loader2 size={12} className="animate-spin" />;
    case "approved": return <Check size={12} />;
    default: return <Clock size={12} />;
  }
}

function statusColor(status: string, t: RunTimelineProps["theme"]): string {
  switch (status) {
    case "success": return t.success;
    case "failed": return t.danger;
    case "running": return t.accentCyan;
    case "approved": return t.success;
    default: return t.textDim;
  }
}

export default function RunTimeline({ goal, steps, runStatus, currentStepId, theme: t }: RunTimelineProps) {
  if (!steps.length) return null;
  const statusLabel: Record<string, string> = {
    planned: "Planned", running: "Running...", waiting_approval: "Awaiting Approval",
    completed: "Completed", failed: "Failed", cancelled: "Cancelled",
  };
  return (
    <div className="rounded-xl border p-4" style={{ backgroundColor: t.bgPanel, borderColor: t.border }}>
      <div className="mb-3 flex items-center gap-2">
        <div className="flex h-6 w-6 items-center justify-center rounded-lg text-[10px] font-black"
          style={{ backgroundColor: t.accentCyan + "20", color: t.accentCyan }}>D</div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold" style={{ color: t.text }}>Director Run</span>
            <span className="rounded px-1.5 py-0.5 text-[9px] font-bold uppercase"
              style={{
                backgroundColor: runStatus === "running" || runStatus === "waiting_approval" ? t.accentOrange + "20"
                  : runStatus === "completed" || runStatus === "planned" ? t.success + "20" : t.danger + "20",
                color: runStatus === "running" || runStatus === "waiting_approval" ? t.accentOrange
                  : runStatus === "completed" || runStatus === "planned" ? t.success : t.danger,
              }}>{statusLabel[runStatus] || runStatus}</span>
          </div>
          <p className="mt-0.5 truncate text-[10px]" style={{ color: t.textMuted }}>{goal}</p>
        </div>
      </div>
      <div className="relative space-y-0">
        {steps.map((step, idx) => {
          const isCurrent = step.id === currentStepId;
          const isLast = idx === steps.length - 1;
          return (
            <div key={step.id} className="relative flex gap-3">
              {!isLast && <div className="absolute left-[14px] top-6 w-px"
                style={{ height: "calc(100% + 4px)", backgroundColor: step.status === "success" ? t.success + "40" : t.border }} />}
              <div className="relative z-10 mt-1.5 flex h-[28px] w-[28px] shrink-0 items-center justify-center rounded-full text-[10px]"
                style={{
                  backgroundColor: isCurrent ? t.accentCyan + "20" : statusColor(step.status, t) + "15",
                  color: isCurrent ? t.accentCyan : statusColor(step.status, t),
                  border: `1.5px solid ${isCurrent ? t.accentCyan : statusColor(step.status, t) + "30"}`,
                }}>{statusIcon(step.status)}</div>
              <div className="min-w-0 flex-1 pb-4">
                <div className="flex items-center gap-1.5">
                  <span className="text-xs font-semibold" style={{ color: isCurrent ? t.text : t.textMuted }}>{step.title}</span>
                  {step.requiresApproval && step.status === "pending" && (
                    <span className="rounded px-1 text-[9px] font-bold uppercase"
                      style={{ backgroundColor: t.accentOrange + "20", color: t.accentOrange }}>Approval</span>)}
                  {step.riskLevel !== "low" && step.status === "pending" && (
                    <span className="rounded px-1 text-[9px] font-bold uppercase"
                      style={{
                        backgroundColor: step.riskLevel === "critical" || step.riskLevel === "high" ? t.danger + "20" : t.warning + "20",
                        color: step.riskLevel === "critical" || step.riskLevel === "high" ? t.danger : t.warning,
                      }}>{step.riskLevel}</span>)}
                </div>
                {step.description && <p className="mt-0.5 text-[10px]" style={{ color: t.textDim }}>{step.description}</p>}
                {step.command && <div className="mt-1 rounded px-2 py-1 font-mono text-[10px]"
                  style={{ backgroundColor: t.bgSecondary, color: t.accentCyan }}>$ {step.command}</div>}
                {step.result && <div className="mt-1 max-h-20 overflow-y-auto rounded px-2 py-1 text-[10px] leading-relaxed"
                  style={{ backgroundColor: t.bgSecondary + "80", color: t.textDim, border: `1px solid ${t.border}` }}>
                  {step.result.slice(0, 300)}{step.result.length > 300 && <span style={{ color: t.textMuted }}>... [truncated]</span>}
                </div>}
                {step.error && <div className="mt-1 text-[10px]" style={{ color: t.danger }}>Error: {step.error}</div>}
              </div>
            </div>
          );
        })}
      </div>
      {runStatus === "completed" && <div className="mt-2 rounded-lg px-3 py-2 text-center text-[11px] font-bold"
        style={{ backgroundColor: t.success + "10", color: t.success }}>✅ Run completed successfully</div>}
      {runStatus === "failed" && <div className="mt-2 rounded-lg px-3 py-2 text-center text-[11px] font-bold"
        style={{ backgroundColor: t.danger + "10", color: t.danger }}>❌ Run failed</div>}
    </div>
  );
}

