"use client";

import { useMemo } from "react";
import {
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Loader2,
  FileEdit,
  GitBranch,
  Shield,
  Terminal,
  RotateCcw,
  Circle,
} from "lucide-react";
import type { RunEvent, RunEventType } from "@/lib/litt-intelligence/run-events";

/* ─────────────────────────────────────────────────────────────────
 * StudioActivityEvents — chronological event feed from the
 * RunEventStore. Shows the full lifecycle:
 *
 *   Plan created
 *   Approval requested
 *   Approval granted
 *   ACT started
 *   files.write started
 *   src/foo.ts changed
 *   Diff captured
 *   Mutation verified
 *   ACT completed
 *
 * Failures are equally visible:
 *
 *   Mutation blocked
 *   Reason: PROTECTED_BRANCH
 *   Target: main
 *
 * Phase 7 — Studio Control Plane V1
 * ───────────────────────────────────────────────────────────────── */

interface StudioActivityEventsProps {
  events: RunEvent[];
  loading: boolean;
}

const EVENT_ICONS: Partial<Record<RunEventType, React.ComponentType<{ className?: string }>>> = {
  plan_created: Circle,
  approval_requested: Shield,
  approval_granted: CheckCircle2,
  approval_denied: XCircle,
  approval_expired: AlertTriangle,
  act_started: GitBranch,
  act_completed: CheckCircle2,
  tool_started: Loader2,
  tool_completed: CheckCircle2,
  tool_failed: XCircle,
  file_changed: FileEdit,
  diff_captured: FileEdit,
  mutation_verified: CheckCircle2,
  mutation_blocked: AlertTriangle,
  command_executed: Terminal,
  check_passed: CheckCircle2,
  check_failed: XCircle,
  check_skipped: AlertTriangle,
  recovery_attempt: RotateCcw,
  checkpoint_created: GitBranch,
  branch_created: GitBranch,
  branch_switched: GitBranch,
};

const EVENT_COLORS: Partial<Record<RunEventType, string>> = {
  approval_granted: "#4ade80",
  act_completed: "#4ade80",
  tool_completed: "#4ade80",
  mutation_verified: "#4ade80",
  check_passed: "#4ade80",
  approval_denied: "#f87171",
  tool_failed: "#f87171",
  check_failed: "#f87171",
  mutation_blocked: "#fb923c",
  approval_expired: "#fb923c",
  check_skipped: "#fb923c",
  recovery_attempt: "#fb923c",
};

function eventLabel(type: RunEventType, data: Record<string, unknown>): string {
  switch (type) {
    case "plan_created":
      return "Plan created";
    case "approval_requested":
      return `Approval requested for ${data.toolId ?? "mutation"}`;
    case "approval_granted":
      return "Approval granted";
    case "approval_denied":
      return `Approval denied: ${data.reason ?? "unknown"}`;
    case "approval_expired":
      return "Approval expired";
    case "act_started":
      return "ACT mode started";
    case "act_completed":
      return "ACT completed";
    case "tool_started":
      return `${data.toolId ?? "Tool"} started`;
    case "tool_completed":
      return `${data.toolId ?? "Tool"} completed`;
    case "tool_failed":
      return `${data.toolId ?? "Tool"} failed: ${data.error ?? ""}`;
    case "file_changed":
      return `${data.path ?? "File"} changed`;
    case "diff_captured":
      return "Diff captured";
    case "mutation_verified":
      return "Mutation verified (hashes differ)";
    case "mutation_blocked":
      return `Mutation blocked: ${data.reason ?? "unknown"}${data.target ? ` → ${data.target}` : ""}`;
    case "command_executed":
      return `Command: ${data.command ?? ""}`;
    case "check_passed":
      return `Check passed: ${data.checkId ?? ""}`;
    case "check_failed":
      return `Check failed: ${data.checkId ?? ""}`;
    case "check_skipped":
      return `Check skipped: ${data.checkId ?? ""} — ${data.skipReason ?? ""}`;
    case "recovery_attempt":
      return `Recovery attempt ${data.attempt ?? ""}`;
    case "checkpoint_created":
      return `Checkpoint: ${data.label ?? ""}`;
    case "branch_created":
      return `Branch created: ${data.branch ?? ""}`;
    case "branch_switched":
      return `Switched to branch: ${data.branch ?? ""}`;
    default:
      return type;
  }
}

export function StudioActivityEvents({ events, loading }: StudioActivityEventsProps) {
  const sorted = useMemo(
    () =>
      [...events].sort(
        (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
      ),
    [events],
  );

  if (loading && events.length === 0) {
    return (
      <div className="flex items-center justify-center py-8 text-[10px]" style={{ color: "var(--text-muted)" }}>
        <Loader2 className="mr-2 h-3 w-3 animate-spin" />
        Loading activity…
      </div>
    );
  }

  if (sorted.length === 0) {
    return (
      <div
        className="flex min-h-24 items-center justify-center rounded-lg border px-3 text-center text-[10px]"
        style={{ borderColor: "var(--studio-border)", color: "var(--text-muted)" }}
        role="status"
        data-testid="activity-empty"
      >
        No activity yet. Events will appear here as LiTT plans, edits, and verifies.
      </div>
    );
  }

  return (
    <div className="space-y-1" data-testid="studio-activity-events">
      {sorted.map((event) => {
        const Icon = EVENT_ICONS[event.eventType] ?? Circle;
        const color = EVENT_COLORS[event.eventType] ?? "var(--text-muted)";
        const isSpinner = event.eventType === "tool_started" || event.eventType === "act_started";
        return (
          <div
            key={event.id}
            className="flex items-start gap-2 rounded-lg border px-2.5 py-2"
            style={{ borderColor: "var(--studio-border)", backgroundColor: "var(--studio-card)" }}
            data-testid={`activity-event-${event.eventType}`}
          >
            <Icon
              className={`mt-0.5 h-3 w-3 shrink-0 ${isSpinner ? "animate-spin" : ""}`}
              style={{ color }}
            />
            <div className="min-w-0 flex-1">
              <div className="text-[10px] font-bold" style={{ color: "var(--text-primary)" }}>
                {eventLabel(event.eventType, event.eventData)}
              </div>
              {event.evidenceId && (
                <div className="mt-0.5 text-[9px] font-mono" style={{ color: "var(--text-muted)" }}>
                  evidence: {event.evidenceId.slice(0, 16)}
                </div>
              )}
            </div>
            <span className="shrink-0 text-[9px]" style={{ color: "var(--text-muted)" }}>
              {new Date(event.createdAt).toLocaleTimeString()}
            </span>
          </div>
        );
      })}
    </div>
  );
}
