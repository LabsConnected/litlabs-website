"use client";

/**
 * StudioBrowserJobsPanel — live browser agent job viewer.
 *
 * Shows:
 *   - List of recent browser jobs with status badges and progress bars
 *   - Selected job detail with step-by-step progress
 *   - Live Browserbase view (iframe when available)
 *   - Action controls: Cancel (queued/awaiting), Approve (awaiting_approval)
 *   - Error and result display
 *
 * Data comes from useBrowserJobs() which polls /api/browser/jobs.
 * No SSE needed — the polling hook handles adaptive refresh rates.
 */
import { useMemo } from "react";
import {
  Globe,
  Loader2,
  CheckCircle2,
  XCircle,
  Clock,
  ShieldCheck,
  AlertTriangle,
  ExternalLink,
  Play,
  Square,
  RefreshCw,
  ChevronRight,
  Bot,
} from "lucide-react";
import { useBrowserJobs, type BrowserJob, type BrowserJobStep } from "../hooks/useBrowserJobs";

const ACTIVE_STATUSES = new Set(["queued", "running", "awaiting_approval", "approved"]);
const TERMINAL_STATUSES = new Set(["completed", "failed", "cancelled"]);

function statusIcon(status: BrowserJob["status"]) {
  if (status === "completed") return <CheckCircle2 size={12} style={{ color: "#22c55e" }} />;
  if (status === "failed") return <XCircle size={12} style={{ color: "#ef4444" }} />;
  if (status === "cancelled") return <Square size={10} style={{ color: "var(--text-muted)" }} />;
  if (status === "awaiting_approval") return <ShieldCheck size={12} style={{ color: "#e3b341" }} />;
  if (ACTIVE_STATUSES.has(status)) return <Loader2 size={12} className="animate-spin" style={{ color: "var(--litt-primary)" }} />;
  return <Clock size={12} style={{ color: "var(--text-muted)" }} />;
}

function statusLabel(status: BrowserJob["status"]): string {
  switch (status) {
    case "queued": return "Queued";
    case "running": return "Running";
    case "awaiting_approval": return "Needs Approval";
    case "approved": return "Approved";
    case "completed": return "Completed";
    case "failed": return "Failed";
    case "cancelled": return "Cancelled";
    default: return status;
  }
}

function statusColor(status: BrowserJob["status"]): string {
  if (status === "completed") return "#22c55e";
  if (status === "failed") return "#ef4444";
  if (status === "cancelled") return "var(--text-muted)";
  if (status === "awaiting_approval") return "#e3b341";
  if (ACTIVE_STATUSES.has(status)) return "var(--litt-primary)";
  return "var(--text-secondary)";
}

function riskBadge(risk: BrowserJob["riskLevel"]): { label: string; color: string } {
  switch (risk) {
    case "low": return { label: "READ", color: "var(--text-muted)" };
    case "medium": return { label: "WRITE", color: "#e3b341" };
    case "high": return { label: "HIGH", color: "#ef4444" };
    default: return { label: "UNKNOWN", color: "var(--text-muted)" };
  }
}

function jobTypeLabel(jobType: string): string {
  // "ghl.workflow.inspect" → "GHL · Workflow Inspect"
  const parts = jobType.split(".");
  if (parts.length >= 2) {
    return parts[0].toUpperCase() + " · " + parts.slice(1).map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join(" ");
  }
  return jobType;
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60_000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

function duration(job: BrowserJob): string {
  if (!job.startedAt) return "—";
  const end = job.completedAt ? new Date(job.completedAt).getTime() : Date.now();
  const ms = end - new Date(job.startedAt).getTime();
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60_000)}m ${Math.floor((ms % 60_000) / 1000)}s`;
}

// ─── Job Row ─────────────────────────────────────────────────

function JobRow({
  job,
  selected,
  onClick,
}: {
  job: BrowserJob;
  selected: boolean;
  onClick: () => void;
}) {
  const progress = job.progress;
  const progressPct = progress.totalSteps > 0
    ? Math.round((progress.step / progress.totalSteps) * 100)
    : 0;
  const risk = riskBadge(job.riskLevel);

  return (
    <button
      onClick={onClick}
      className="w-full text-left border-b px-3 py-2.5 transition hover:bg-white/4"
      style={{
        borderColor: "var(--studio-border)",
        backgroundColor: selected ? "rgba(155,77,255,0.06)" : undefined,
      }}
    >
      <div className="flex items-center gap-2">
        {statusIcon(job.status)}
        <span className="flex-1 truncate text-[11px] font-bold" style={{ color: "var(--text-primary)" }}>
          {job.goal || jobTypeLabel(job.jobType)}
        </span>
        <span
          className="shrink-0 rounded px-1.5 py-0.5 text-[8px] font-black"
          style={{ color: risk.color, border: `1px solid ${risk.color}40` }}
        >
          {risk.label}
        </span>
      </div>
      <div className="mt-1 flex items-center gap-2">
        <span className="text-[9px]" style={{ color: statusColor(job.status) }}>
          {statusLabel(job.status)}
        </span>
        <span className="text-[9px]" style={{ color: "var(--text-muted)" }}>
          · {timeAgo(job.createdAt)}
        </span>
        {ACTIVE_STATUSES.has(job.status) && progress.totalSteps > 0 && (
          <span className="text-[9px]" style={{ color: "var(--text-muted)" }}>
            · {progress.step}/{progress.totalSteps}
          </span>
        )}
      </div>
      {ACTIVE_STATUSES.has(job.status) && progress.totalSteps > 0 && (
        <div className="mt-1.5 h-0.5 w-full overflow-hidden rounded-full" style={{ backgroundColor: "var(--studio-border)" }}>
          <div
            className="h-full rounded-full transition-all duration-500"
            style={{ width: `${progressPct}%`, backgroundColor: "var(--litt-primary)" }}
          />
        </div>
      )}
    </button>
  );
}

// ─── Step Item ───────────────────────────────────────────────

function StepItem({ step, index }: { step: BrowserJobStep; index: number }) {
  const icon = step.status === "completed"
    ? <CheckCircle2 size={11} style={{ color: "#22c55e" }} />
    : step.status === "failed"
      ? <XCircle size={11} style={{ color: "#ef4444" }} />
      : step.status === "running"
        ? <Loader2 size={11} className="animate-spin" style={{ color: "var(--litt-primary)" }} />
        : <div className="grid h-[11px] w-[11px] place-items-center rounded-full border" style={{ borderColor: "var(--studio-border)" }} />;

  return (
    <div className="flex items-start gap-2 py-1">
      <div className="mt-0.5 shrink-0">{icon}</div>
      <div className="flex-1 min-w-0">
        <div
          className="text-[10px] font-bold"
          style={{
            color: step.status === "pending" ? "var(--text-muted)" : "var(--text-primary)",
          }}
        >
          {step.label}
        </div>
        {step.detail && (
          <div className="mt-0.5 text-[9px]" style={{ color: "var(--text-muted)" }}>
            {step.detail}
          </div>
        )}
      </div>
      <span className="shrink-0 text-[8px] font-mono" style={{ color: "var(--text-muted)" }}>
        {String(index + 1).padStart(2, "0")}
      </span>
    </div>
  );
}

// ─── Job Detail ──────────────────────────────────────────────

function JobDetail({
  job,
  onCancel,
  onApprove,
  onDeselect,
}: {
  job: BrowserJob;
  onCancel: () => void;
  onApprove: () => void;
  onDeselect: () => void;
}) {
  const progress = job.progress;
  const progressPct = progress.totalSteps > 0
    ? Math.round((progress.step / progress.totalSteps) * 100)
    : 0;
  const risk = riskBadge(job.riskLevel);
  const canCancel = job.status === "queued" || job.status === "awaiting_approval";
  const canApprove = job.status === "awaiting_approval";

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="shrink-0 border-b px-3 py-2.5" style={{ borderColor: "var(--studio-border)" }}>
        <div className="flex items-center gap-2">
          <button
            onClick={onDeselect}
            className="grid h-6 w-6 place-items-center rounded-lg hover:bg-white/8"
            style={{ color: "var(--text-muted)" }}
            aria-label="Back to job list"
          >
            <ChevronRight size={14} className="rotate-180" />
          </button>
          <Bot size={14} style={{ color: "var(--litt-primary)" }} />
          <span className="flex-1 truncate text-[11px] font-black" style={{ color: "var(--text-primary)" }}>
            {job.goal || jobTypeLabel(job.jobType)}
          </span>
        </div>
        <div className="mt-1.5 flex items-center gap-2 pl-8">
          {statusIcon(job.status)}
          <span className="text-[10px] font-bold" style={{ color: statusColor(job.status) }}>
            {statusLabel(job.status)}
          </span>
          <span className="text-[9px]" style={{ color: "var(--text-muted)" }}>·</span>
          <span className="text-[9px]" style={{ color: risk.color }}>{risk.label}</span>
          <span className="text-[9px]" style={{ color: "var(--text-muted)" }}>·</span>
          <span className="text-[9px]" style={{ color: "var(--text-muted)" }}>{duration(job)}</span>
        </div>
      </div>

      {/* Progress bar */}
      {progress.totalSteps > 0 && (
        <div className="shrink-0 px-3 pt-2">
          <div className="flex items-center justify-between text-[9px]" style={{ color: "var(--text-muted)" }}>
            <span>Step {progress.step + 1} of {progress.totalSteps}</span>
            <span>{progressPct}%</span>
          </div>
          <div className="mt-1 h-1 w-full overflow-hidden rounded-full" style={{ backgroundColor: "var(--studio-border)" }}>
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{ width: `${progressPct}%`, backgroundColor: "var(--litt-primary)" }}
            />
          </div>
        </div>
      )}

      {/* Live View */}
      {job.liveViewUrl && (
        <div className="shrink-0 px-3 pt-2">
          <div className="flex items-center gap-1.5 text-[9px] font-black uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>
            <Globe size={10} />
            Live Browser View
          </div>
          <div className="mt-1 overflow-hidden rounded-lg border" style={{ borderColor: "var(--studio-border)" }}>
            <iframe
              src={job.liveViewUrl}
              className="w-full"
              style={{ height: 200, border: "none", backgroundColor: "#0a0b10" }}
              title="Browserbase live view"
              allow="clipboard-read; clipboard-write"
            />
          </div>
          <a
            href={job.liveViewUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-1 inline-flex items-center gap-1 text-[9px] font-bold hover:underline"
            style={{ color: "var(--litt-primary)" }}
          >
            <ExternalLink size={9} />
            Open in new tab
          </a>
        </div>
      )}

      {/* Steps */}
      {progress.steps.length > 0 && (
        <div className="flex-1 overflow-y-auto px-3 py-2">
          <div className="text-[9px] font-black uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>
            Steps
          </div>
          <div className="mt-1">
            {progress.steps.map((step, i) => (
              <StepItem key={i} step={step} index={i} />
            ))}
          </div>
        </div>
      )}

      {/* Error */}
      {job.error && job.status === "failed" && (
        <div className="shrink-0 mx-3 mb-2 rounded-lg border p-2" style={{ borderColor: "#ef444440", backgroundColor: "#ef444408" }}>
          <div className="flex items-center gap-1.5 text-[9px] font-black uppercase" style={{ color: "#ef4444" }}>
            <AlertTriangle size={10} />
            Error
          </div>
          <div className="mt-1 text-[10px] font-mono" style={{ color: "var(--text-secondary)" }}>
            {job.error}
          </div>
        </div>
      )}

      {/* Result summary */}
      {job.result && job.status === "completed" && (
        <div className="shrink-0 mx-3 mb-2 rounded-lg border p-2" style={{ borderColor: "#22c55e40", backgroundColor: "#22c55e08" }}>
          <div className="flex items-center gap-1.5 text-[9px] font-black uppercase" style={{ color: "#22c55e" }}>
            <CheckCircle2 size={10} />
            Result
          </div>
          <pre className="mt-1 max-h-32 overflow-auto text-[9px] font-mono" style={{ color: "var(--text-secondary)" }}>
            {JSON.stringify(job.result, null, 2)}
          </pre>
        </div>
      )}

      {/* Controls */}
      <div className="shrink-0 flex items-center gap-2 border-t px-3 py-2" style={{ borderColor: "var(--studio-border)" }}>
        {canApprove && (
          <button
            onClick={onApprove}
            className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[10px] font-black transition hover:opacity-80"
            style={{ backgroundColor: "#22c55e", color: "#fff" }}
          >
            <ShieldCheck size={11} />
            Approve
          </button>
        )}
        {canCancel && (
          <button
            onClick={onCancel}
            className="flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[10px] font-black transition hover:bg-white/4"
            style={{ borderColor: "var(--studio-border-strong)", color: "var(--text-secondary)" }}
          >
            <Square size={9} />
            Cancel
          </button>
        )}
        {ACTIVE_STATUSES.has(job.status) && !canCancel && !canApprove && (
          <div className="flex items-center gap-1.5 text-[10px]" style={{ color: "var(--text-muted)" }}>
            <Loader2 size={11} className="animate-spin" />
            Executing...
          </div>
        )}
        {TERMINAL_STATUSES.has(job.status) && (
          <div className="text-[10px]" style={{ color: "var(--text-muted)" }}>
            {timeAgo(job.completedAt ?? job.createdAt)}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Main Panel ──────────────────────────────────────────────

export default function StudioBrowserJobsPanel() {
  const {
    jobs,
    selectedJob,
    selectedJobId,
    loading,
    error,
    activeCount,
    selectJob,
    refresh,
    cancelJob,
    approveJob,
  } = useBrowserJobs();

  const sortedJobs = useMemo(() => {
    // Active jobs first, then by createdAt descending
    return [...jobs].sort((a, b) => {
      const aActive = ACTIVE_STATUSES.has(a.status) ? 0 : 1;
      const bActive = ACTIVE_STATUSES.has(b.status) ? 0 : 1;
      if (aActive !== bActive) return aActive - bActive;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });
  }, [jobs]);

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex shrink-0 items-center gap-2 border-b px-3 py-2" style={{ borderColor: "var(--studio-border)" }}>
        <Globe size={13} style={{ color: "var(--litt-primary)" }} />
        <span className="flex-1 text-[10px] font-black uppercase tracking-[0.12em]" style={{ color: "var(--text-secondary)" }}>
          Browser Agent
        </span>
        {activeCount > 0 && (
          <span
            className="flex items-center gap-1 rounded-full px-2 py-0.5 text-[8px] font-black"
            style={{ backgroundColor: "var(--litt-primary-soft)", color: "var(--litt-primary)" }}
          >
            <Loader2 size={8} className="animate-spin" />
            {activeCount} active
          </span>
        )}
        <button
          onClick={refresh}
          className="grid h-6 w-6 place-items-center rounded-lg hover:bg-white/8"
          style={{ color: "var(--text-muted)" }}
          aria-label="Refresh jobs"
        >
          <RefreshCw size={11} />
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-hidden">
        {error ? (
          <div className="flex h-full items-center justify-center p-4 text-center">
            <div>
              <AlertTriangle size={20} className="mx-auto mb-2" style={{ color: "#ef4444" }} />
              <div className="text-[10px]" style={{ color: "var(--text-muted)" }}>{error}</div>
            </div>
          </div>
        ) : loading ? (
          <div className="flex h-full items-center justify-center">
            <Loader2 size={18} className="animate-spin" style={{ color: "var(--text-muted)" }} />
          </div>
        ) : selectedJob ? (
          <JobDetail
            job={selectedJob}
            onCancel={() => cancelJob(selectedJob.jobId)}
            onApprove={() => approveJob(selectedJob.jobId)}
            onDeselect={() => selectJob(null)}
          />
        ) : sortedJobs.length === 0 ? (
          <div className="flex h-full items-center justify-center p-4 text-center">
            <div>
              <Globe size={24} className="mx-auto mb-2 opacity-30" style={{ color: "var(--text-muted)" }} />
              <div className="text-[10px] font-bold" style={{ color: "var(--text-muted)" }}>
                No browser jobs yet
              </div>
              <div className="mt-1 text-[9px]" style={{ color: "var(--text-muted)" }}>
                Jobs triggered by LiTT or Vapi will appear here
              </div>
            </div>
          </div>
        ) : (
          <div className="h-full overflow-y-auto">
            {sortedJobs.map((job) => (
              <JobRow
                key={job.jobId}
                job={job}
                selected={selectedJobId === job.jobId}
                onClick={() => selectJob(job.jobId)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
