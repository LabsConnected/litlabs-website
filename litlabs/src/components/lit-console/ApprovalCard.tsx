"use client";

import { Check, X, AlertTriangle, ShieldAlert, Info, Terminal, FileCode, Search, Globe } from "lucide-react";
import type { DirectorStep } from "@/lib/director/types";

interface ApprovalCardProps {
  step: DirectorStep;
  onApprove: (stepId: string) => void;
  onReject: (stepId: string) => void;
  theme: {
    bgPanel: string;
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

function riskColor(risk: string, theme: ApprovalCardProps["theme"]): string {
  switch (risk) {
    case "critical": return theme.danger;
    case "high": return theme.accentOrange;
    case "medium": return theme.warning;
    default: return theme.success;
  }
}

function stepIcon(type: string) {
  switch (type) {
    case "read_file": return <FileCode size={14} />;
    case "write_file": return <FileCode size={14} />;
    case "run_command": return <Terminal size={14} />;
    case "search_code": return <Search size={14} />;
    case "web_check": return <Globe size={14} />;
    default: return <Info size={14} />;
  }
}

export default function ApprovalCard({ step, onApprove, onReject, theme }: ApprovalCardProps) {
  return (
    <div
      className="rounded-xl border p-4 shadow-lg"
      style={{
        backgroundColor: theme.bgPanel,
        borderColor: riskColor(step.riskLevel, theme) + "50",
        boxShadow: `0 4px 24px rgba(0,0,0,0.3)`,
      }}
    >
      <div className="flex items-start gap-3">
        <div
          className="mt-0.5 flex h-8 w-8 items-center justify-center rounded-lg"
          style={{ backgroundColor: riskColor(step.riskLevel, theme) + "20", color: riskColor(step.riskLevel, theme) }}
        >
          {stepIcon(step.type)}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-bold" style={{ color: theme.text }}>
              {step.title}
            </span>
            <span
              className="rounded px-1.5 py-0.5 text-[10px] font-bold uppercase"
              style={{
                backgroundColor: riskColor(step.riskLevel, theme) + "20",
                color: riskColor(step.riskLevel, theme),
              }}
            >
              {step.riskLevel}
            </span>
          </div>
          {step.description && (
            <p className="mt-1 text-xs" style={{ color: theme.textMuted }}>
              {step.description}
            </p>
          )}
          {step.command && (
            <div
              className="mt-2 rounded-lg px-3 py-2 font-mono text-xs"
              style={{ backgroundColor: theme.textDim + "15", color: theme.accentCyan }}
            >
              $ {step.command}
            </div>
          )}
          {step.target && (
            <p className="mt-1 text-[11px]" style={{ color: theme.textDim }}>
              Target: {step.target}
            </p>
          )}

          {/* Risk warning */}
          {(step.riskLevel === "high" || step.riskLevel === "critical") && (
            <div className="mt-2 flex items-center gap-1.5 text-[11px]" style={{ color: riskColor(step.riskLevel, theme) }}>
              <ShieldAlert size={12} />
              This action may modify system state or deploy to production.
            </div>
          )}
          {step.riskLevel === "medium" && (
            <div className="mt-2 flex items-center gap-1.5 text-[11px]" style={{ color: theme.warning }}>
              <AlertTriangle size={12} />
              This action modifies files or installs dependencies.
            </div>
          )}

          {/* Actions */}
          <div className="mt-3 flex items-center gap-2">
            <button
              onClick={() => onApprove(step.id)}
              className="flex items-center gap-1.5 rounded-lg px-4 py-1.5 text-xs font-bold transition-all hover:scale-[1.02]"
              style={{ backgroundColor: riskColor(step.riskLevel, theme), color: "#000" }}
            >
              <Check size={13} /> Approve & Run
            </button>
            <button
              onClick={() => onReject(step.id)}
              className="flex items-center gap-1.5 rounded-lg px-4 py-1.5 text-xs font-bold transition-all hover:bg-white/5"
              style={{ color: theme.textMuted, border: `1px solid ${theme.border}` }}
            >
              <X size={13} /> Skip
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
