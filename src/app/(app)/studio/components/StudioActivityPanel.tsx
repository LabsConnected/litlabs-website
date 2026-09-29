"use client";

// Item 5a — the Studio Activity panel. Rendered from the persisted
// `action_events` of one ActionRun (the Activity truth): server-written
// labels are trusted; only presentation (icon/tone/detail) is derived.
// Never chat messages, never localStorage.
import { useEffect, useRef } from "react";
import {
  Eye,
  CircleCheck,
  ShieldCheck,
  AlertTriangle,
  Wrench,
  XCircle,
  Rocket,
  Info,
  GitPullRequest,
  Folder,
} from "lucide-react";
import type { ActionEvent } from "@/lib/action-runtime/types";
import { useRunActivity } from "../hooks/useRunActivity";
import StudioActivityTimeline from "./StudioActivityTimeline";

function eventTime(iso: string): string {
  const at = new Date(iso).getTime();
  if (Number.isNaN(at)) return "";
  const diff = Math.max(0, Date.now() - at);
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

type ActivityTone = "ok" | "warn" | "muted";

interface DescribedEvent {
  title: string;
  detail?: string;
  icon: typeof Eye;
  tone: ActivityTone;
}

function payloadLabel(payload: Record<string, unknown>, fallback: string): string {
  return typeof payload.label === "string" && payload.label ? payload.label : fallback;
}

/**
 * Item 5a — render one persisted run event. The server writes a
 * human-readable `label` into every persisted payload; the panel trusts
 * it and only derives presentation (icon/tone/detail) from the type.
 */
function describeRunEvent(event: ActionEvent): DescribedEvent {
  const p = (event.payload ?? {}) as Record<string, unknown>;
  switch (event.type) {
    case "tool.started":
      return { title: payloadLabel(p, "Tool started"), detail: typeof p.toolId === "string" ? p.toolId : undefined, icon: Wrench, tone: "muted" };
    case "tool.completed":
      return {
        title: payloadLabel(p, "Tool completed"),
        detail: typeof p.durationMs === "number" ? `${p.durationMs}ms` : undefined,
        icon: CircleCheck,
        tone: "ok",
      };
    case "tool.failed":
      return { title: payloadLabel(p, "Tool failed"), detail: typeof p.summary === "string" ? p.summary : undefined, icon: XCircle, tone: "warn" };
    case "approval.required":
      return { title: payloadLabel(p, "Approval required"), detail: typeof p.reason === "string" ? p.reason : undefined, icon: ShieldCheck, tone: "warn" };
    case "preview.started":
      return { title: payloadLabel(p, "Starting preview"), icon: Eye, tone: "muted" };
    case "preview.ready":
      return { title: payloadLabel(p, "Preview ready"), detail: typeof p.previewUrl === "string" ? p.previewUrl : undefined, icon: Eye, tone: "ok" };
    case "preview.failed":
      return { title: payloadLabel(p, "Preview failed"), detail: typeof p.error === "string" ? p.error : undefined, icon: XCircle, tone: "warn" };
    case "deployment.started":
      return { title: payloadLabel(p, "Deploying"), icon: Rocket, tone: "muted" };
    case "deployment.status":
      return { title: payloadLabel(p, "Deploy update"), icon: Rocket, tone: "muted" };
    case "deployment.completed":
      return { title: payloadLabel(p, "Deploy completed"), detail: typeof p.productionUrl === "string" ? p.productionUrl : undefined, icon: Rocket, tone: "ok" };
    case "deployment.failed":
      return { title: payloadLabel(p, "Deploy failed"), detail: typeof p.error === "string" ? p.error : undefined, icon: XCircle, tone: "warn" };
    case "agent.completed":
      return { title: payloadLabel(p, "Run finished"), icon: CircleCheck, tone: "ok" };
    case "agent.failed":
      return { title: payloadLabel(p, "Run failed"), icon: XCircle, tone: "warn" };
    case "activity.created":
      return { title: payloadLabel(p, "Activity"), icon: Info, tone: "muted" };
    case "agent.status": {
      const kind = typeof p.kind === "string" ? p.kind : "";
      if (kind === "checkpoint") {
        return {
          title: payloadLabel(p, "Checkpoint"),
          detail: typeof p.gitSha === "string" ? p.gitSha.slice(0, 8) : undefined,
          icon: GitPullRequest,
          tone: "ok",
        };
      }
      if (kind === "build_start") return { title: payloadLabel(p, "Check running"), icon: CircleCheck, tone: "muted" };
      if (kind === "build_result") {
        const passed = p.passed === true;
        return {
          title: payloadLabel(p, passed ? "Check passed" : "Check failed"),
          detail: typeof p.errorCount === "number" && p.errorCount > 0 ? `${p.errorCount} errors` : undefined,
          icon: passed ? CircleCheck : XCircle,
          tone: passed ? "ok" : "warn",
        };
      }
      if (kind === "workspace_change") {
        return {
          title: payloadLabel(p, "Workspace change"),
          detail: typeof p.fileCount === "number" ? `${p.fileCount} files` : undefined,
          icon: Folder,
          tone: p.status === "changed" ? "ok" : "muted",
        };
      }
      if (kind === "model_failed") return { title: payloadLabel(p, "Model failed"), icon: AlertTriangle, tone: "warn" };
      if (kind === "quality_verdict") {
        const passed = p.passed === true;
        return { title: payloadLabel(p, passed ? "Quality gate passed" : "Quality gate failed"), icon: ShieldCheck, tone: passed ? "ok" : "warn" };
      }
      if (kind === "preview_status") return { title: payloadLabel(p, "Preview update"), icon: Eye, tone: "muted" };
      return { title: payloadLabel(p, "Agent update"), icon: Info, tone: "muted" };
    }
    default:
      return { title: payloadLabel(p, event.type), icon: Info, tone: "muted" };
  }
}

const TONE_COLOR: Record<ActivityTone, string> = {
  ok: "var(--litt-primary)",
  warn: "#e3b341",
  muted: "var(--text-muted)",
};

const MAX_RENDERED_EVENTS = 60;

export function StudioActivityPanel({
  runId,
  busy,
  modelLabel,
  projectName,
  terminalStatus,
  missionContent,
}: {
  /**
   * Item 5a — the ActionRun whose persisted action_events are the Activity
   * truth for this panel. Resolved by the parent from the conversation's
   * studio task (activeActionRunId ?? latestActionRunId). Never chat
   * messages, never localStorage.
   */
  runId: string | null;
  busy: boolean;
  modelLabel: string;
  projectName: string | null;
  terminalStatus: string;
  /** Operational project state (Mission / Checkpoints / Next actions)
      rendered between the workspace header and the activity feed. */
  missionContent?: React.ReactNode;
}) {
  const { events, state } = useRunActivity(runId, busy);
  const activityRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (busy) activityRef.current?.scrollIntoView({ block: "nearest" });
  }, [busy]);

  // Newest first; cap the render — the full log stays one fetch away.
  const visible = events.slice().reverse().slice(0, MAX_RENDERED_EVENTS);

  return (
    <div ref={activityRef} className="space-y-2" data-testid="studio-activity-panel" aria-live="polite" aria-label="Studio activity">
      <div className="grid grid-cols-2 gap-1.5">
        <div className="rounded-lg border px-2.5 py-2" style={{ borderColor: "var(--studio-border)", backgroundColor: "var(--studio-card)" }}>
          <div className="text-[9px] uppercase tracking-[0.14em]" style={{ color: "var(--text-muted)" }}>Workspace</div>
          <div className="mt-1 truncate text-[10px] font-bold" style={{ color: "var(--text-primary)" }}>{projectName ?? "No project"}</div>
        </div>
        <div className="rounded-lg border px-2.5 py-2" style={{ borderColor: "var(--studio-border)", backgroundColor: "var(--studio-card)" }}>
          <div className="text-[9px] uppercase tracking-[0.14em]" style={{ color: "var(--text-muted)" }}>Model</div>
          <div className="mt-1 truncate text-[10px] font-bold" style={{ color: "var(--text-primary)" }}>{modelLabel}</div>
        </div>
      </div>
      {missionContent}
      {busy && (
        <div className="flex items-center gap-2 rounded-lg border px-2.5 py-2 text-[10px]" style={{ borderColor: "rgba(167,139,250,0.25)", backgroundColor: "rgba(167,139,250,0.06)", color: "#c4b5fd" }}>
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-violet-400" aria-hidden />
          Agent working in the active conversation
        </div>
      )}
      {!runId ? (
        <div
          className="flex min-h-24 items-center justify-center rounded-lg border px-3 text-center text-[10px]"
          style={{ borderColor: "var(--studio-border)", color: "var(--text-muted)" }}
          role="status"
        >
          No task run yet — send a message and LiTT&apos;s work will appear here as run activity.
        </div>
      ) : state === "loading" ? (
        <div className="space-y-1" aria-label="Loading run activity">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-10 animate-pulse rounded-lg border" style={{ borderColor: "var(--studio-border)", backgroundColor: "var(--studio-card)" }} />
          ))}
        </div>
      ) : state === "error" ? (
        <div
          className="flex min-h-24 items-center justify-center rounded-lg border px-3 text-center text-[10px]"
          style={{ borderColor: "rgba(227,179,65,0.25)", color: "#e3b341" }}
          role="status"
        >
          Run activity is temporarily unavailable.
        </div>
      ) : visible.length > 0 ? (
        <div className="space-y-1">
          {visible.map((event) => {
            const described = describeRunEvent(event);
            const Icon = described.icon;
            const color = TONE_COLOR[described.tone];
            return (
              <div key={event.id} className="flex items-start gap-2 rounded-lg border px-2.5 py-2" style={{ borderColor: "var(--studio-border)", backgroundColor: "var(--studio-card)" }}>
                <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-md" style={{ backgroundColor: `${color}14`, color }} aria-hidden>
                  <Icon size={11} className="pointer-events-none" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-[10px] font-bold" style={{ color: "var(--text-primary)" }}>{described.title}</span>
                    <span className="shrink-0 text-[9px]" style={{ color: "var(--text-muted)" }}>{eventTime(event.createdAt)}</span>
                  </div>
                  {described.detail && (
                    <div className="mt-0.5 truncate text-[9px]" style={{ color: "var(--text-secondary)" }} title={described.detail}>{described.detail}</div>
                  )}
                </div>
              </div>
            );
          })}
          {events.length > visible.length && (
            <div className="px-1 text-[9px]" style={{ color: "var(--text-muted)" }}>
              Showing latest {visible.length} of {events.length} run events
            </div>
          )}
        </div>
      ) : (
        <div
          className="flex min-h-24 items-center justify-center rounded-lg border px-3 text-center text-[10px]"
          style={{ borderColor: "var(--studio-border)", color: "var(--text-muted)" }}
          role="status"
        >
          No run activity yet — this run hasn&apos;t produced any events.
        </div>
      )}
      <div className="flex items-center justify-between px-1 text-[9px]" style={{ color: "var(--text-muted)" }}>
        <span>{terminalStatus}</span>
        <span>{events.length} run event{events.length === 1 ? "" : "s"}</span>
      </div>
      <StudioActivityTimeline />
    </div>
  );
}
