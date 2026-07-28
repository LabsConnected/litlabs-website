"use client";

/**
 * MessageEventCards — structured event cards for typed message data.
 * Phase 2.6: PlanCard, ActivityCard, ApprovalCard, CompletionCard,
 * ErrorCard, ArtifactCard, ToolResultCard.
 *
 * These render from typed `MessageEventData` on `StudioMessage.event`,
 * NOT from inferring execution state from assistant prose.
 */

import {
  ClipboardList,
  Activity,
  ShieldCheck,
  CircleCheck,
  CircleAlert,
  FileCode,
  Wrench,
  Check,
  X,
  ChevronRight,
} from "lucide-react";
import type { MessageEventData, PlanStep, ApprovalRequest } from "../types/conversation";

// ── PlanCard ────────────────────────────────────────────────────

function PlanStepRow({ step }: { step: PlanStep }) {
  const icon = step.status === "complete" ? <Check size={10} /> : step.status === "failed" ? <X size={10} /> : <ChevronRight size={10} />;
  const color = step.status === "complete" ? "#22c55e" : step.status === "failed" ? "#ef4444" : step.status === "in-progress" ? "#fbbf24" : "var(--text-muted)";
  return (
    <div className="flex items-center gap-2 text-[11px]" style={{ color: "var(--text-secondary)" }}>
      <span className="shrink-0" style={{ color }}>{icon}</span>
      <span className={step.status === "pending" ? "opacity-60" : ""}>{step.label}</span>
      {step.status === "in-progress" && <span className="text-[9px] font-mono opacity-60">running…</span>}
    </div>
  );
}

export function PlanCard({ steps }: { steps: PlanStep[] }) {
  const completed = steps.filter((s) => s.status === "complete").length;
  return (
    <div
      className="rounded-lg border p-3 space-y-2"
      style={{ borderColor: "var(--studio-border)", backgroundColor: "var(--studio-surface)" }}
      data-testid="plan-card"
    >
      <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest" style={{ color: "var(--text-secondary)" }}>
        <ClipboardList size={12} />
        <span>Plan</span>
        <span className="ml-auto opacity-50">{completed}/{steps.length}</span>
      </div>
      <div className="space-y-1.5">
        {steps.map((step) => <PlanStepRow key={step.id} step={step} />)}
      </div>
    </div>
  );
}

// ── ActivityCard ────────────────────────────────────────────────

export function ActivityCard({ action, detail }: { action: string; detail?: string }) {
  return (
    <div
      className="rounded-lg border p-3 flex items-start gap-2"
      style={{ borderColor: "var(--studio-border)", backgroundColor: "var(--studio-surface)" }}
      data-testid="activity-card"
    >
      <Activity size={12} className="shrink-0 mt-0.5" style={{ color: "var(--litt-primary)" }} />
      <div className="min-w-0">
        <div className="text-[11px] font-bold" style={{ color: "var(--text-secondary)" }}>{action}</div>
        {detail && <div className="text-[10px] opacity-60 mt-0.5" style={{ color: "var(--text-muted)" }}>{detail}</div>}
      </div>
    </div>
  );
}

// ── ApprovalCard ────────────────────────────────────────────────

export function ApprovalCard({ request }: { request: ApprovalRequest }) {
  return (
    <div
      className="rounded-lg border p-3 space-y-2"
      style={{ borderColor: "#fbbf2440", backgroundColor: "#fbbf2408" }}
      data-testid="approval-card"
    >
      <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest" style={{ color: "#fbbf24" }}>
        <ShieldCheck size={12} />
        <span>Approval Required</span>
      </div>
      <div className="text-[11px] font-bold" style={{ color: "var(--text-primary)" }}>{request.title}</div>
      <div className="text-[10px] opacity-70" style={{ color: "var(--text-secondary)" }}>{request.description}</div>
      <div className="flex gap-2 pt-1">
        {request.actions.map((action) => (
          <button
            key={action.id}
            type="button"
            className="text-[10px] px-3 py-1.5 rounded-md font-bold transition-all"
            style={{
              backgroundColor: action.type === "approve" ? "#22c55e15" : action.type === "reject" ? "#ef444415" : "var(--studio-surface)",
              color: action.type === "approve" ? "#22c55e" : action.type === "reject" ? "#ef4444" : "var(--text-secondary)",
              border: `1px solid ${action.type === "approve" ? "#22c55e30" : action.type === "reject" ? "#ef444430" : "var(--studio-border)"}`,
            }}
          >
            {action.label}
          </button>
        ))}
      </div>
    </div>
  );
}

// ── CompletionCard ──────────────────────────────────────────────

export function CompletionCard({ summary, artifacts }: { summary: string; artifacts?: string[] }) {
  return (
    <div
      className="rounded-lg border p-3 space-y-2"
      style={{ borderColor: "#22c55e30", backgroundColor: "#22c55e08" }}
      data-testid="completion-card"
    >
      <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest" style={{ color: "#22c55e" }}>
        <CircleCheck size={12} />
        <span>Complete</span>
      </div>
      <div className="text-[11px]" style={{ color: "var(--text-secondary)" }}>{summary}</div>
      {artifacts && artifacts.length > 0 && (
        <div className="flex flex-wrap gap-1.5 pt-1">
          {artifacts.map((a, i) => (
            <span key={i} className="text-[9px] px-2 py-0.5 rounded-md font-mono" style={{ backgroundColor: "var(--studio-surface)", color: "var(--text-muted)" }}>
              {a}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// ── ErrorCard ───────────────────────────────────────────────────

export function ErrorCard({ code, message, recoverable }: { code: string; message: string; recoverable: boolean }) {
  return (
    <div
      className="rounded-lg border p-3 space-y-2"
      style={{ borderColor: "#ef444430", backgroundColor: "#ef444408" }}
      data-testid="error-card"
    >
      <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest" style={{ color: "#ef4444" }}>
        <CircleAlert size={12} />
        <span>Error</span>
        <span className="ml-auto font-mono opacity-50">{code}</span>
      </div>
      <div className="text-[11px]" style={{ color: "var(--text-secondary)" }}>{message}</div>
      {recoverable && <div className="text-[9px] opacity-50" style={{ color: "var(--text-muted)" }}>This error is recoverable. Try again or adjust your request.</div>}
    </div>
  );
}

// ── ArtifactCard ────────────────────────────────────────────────

export function ArtifactCard({ artifactType, name, url }: { artifactType: string; name: string; url?: string }) {
  return (
    <div
      className="rounded-lg border p-3 flex items-center gap-2"
      style={{ borderColor: "var(--studio-border)", backgroundColor: "var(--studio-surface)" }}
      data-testid="artifact-card"
    >
      <FileCode size={14} className="shrink-0" style={{ color: "var(--litt-primary)" }} />
      <div className="min-w-0 flex-1">
        <div className="text-[11px] font-bold truncate" style={{ color: "var(--text-secondary)" }}>{name}</div>
        <div className="text-[9px] opacity-50" style={{ color: "var(--text-muted)" }}>{artifactType}</div>
      </div>
      {url && (
        <a href={url} target="_blank" rel="noopener noreferrer" className="text-[9px] px-2 py-1 rounded-md font-bold shrink-0" style={{ backgroundColor: "var(--studio-card)", color: "var(--text-secondary)" }}>
          Open
        </a>
      )}
    </div>
  );
}

// ── ToolResultCard ──────────────────────────────────────────────

export function ToolResultCard({ tool, result, exitCode }: { tool: string; result: string; exitCode?: number }) {
  const success = exitCode === 0 || exitCode === undefined;
  return (
    <div
      className="rounded-lg border p-3 space-y-1.5"
      style={{ borderColor: "var(--studio-border)", backgroundColor: "var(--studio-surface)" }}
      data-testid="tool-result-card"
    >
      <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest" style={{ color: success ? "#22c55e" : "#ef4444" }}>
        <Wrench size={12} />
        <span>Tool: {tool}</span>
        {exitCode !== undefined && <span className="ml-auto font-mono opacity-50">exit {exitCode}</span>}
      </div>
      <pre className="text-[10px] font-mono overflow-x-auto p-2 rounded" style={{ backgroundColor: "#0c0c0c", color: "var(--text-muted)" }}>
        {result}
      </pre>
    </div>
  );
}

// ── Dispatcher ──────────────────────────────────────────────────

export function MessageEventCard({ event }: { event: MessageEventData }) {
  switch (event.type) {
    case "plan":
      return <PlanCard steps={event.steps} />;
    case "activity":
      return <ActivityCard action={event.action} detail={event.detail} />;
    case "approval":
      return <ApprovalCard request={event.request} />;
    case "completion":
      return <CompletionCard summary={event.summary} artifacts={event.artifacts} />;
    case "error":
      return <ErrorCard code={event.code} message={event.message} recoverable={event.recoverable} />;
    case "artifact":
      return <ArtifactCard artifactType={event.artifactType} name={event.name} url={event.url} />;
    case "tool-result":
      return <ToolResultCard tool={event.tool} result={event.result} exitCode={event.exitCode} />;
    default:
      return null;
  }
}
