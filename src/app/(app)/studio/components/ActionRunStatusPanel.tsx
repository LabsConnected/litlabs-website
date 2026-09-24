"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ExecutionDetailsExpander, type ExecutionDetailRecord } from "./ExecutionBlock";

interface ActionRunProjectionResponse {
  run: {
    id: string;
    status: string;
    updatedAt: string;
    cancellationRequestedAt: string | null;
  };
  displayState:
    | "queued"
    | "starting"
    | "running"
    | "waiting_for_user"
    | "awaiting_approval"
    | "paused"
    | "stopping"
    | "stopped"
    | "completed"
    | "failed";
  currentActivity: string | null;
  pendingApprovals: Array<{ id: string; toolId: string; reason: string }>;
  capabilities: Record<string, { status: string }> & {
    deployment: {
      status: string;
      deploymentId: string | null;
      publicUrl: string | null;
      verified: boolean;
      error: string | null;
    };
  };
  timeline: Array<{ id: string; type: string; createdAt: string; payload: Record<string, unknown> }>;
  failure: { code: string | null; message: string | null } | null;
}

const ACTIVE_STATES = new Set([
  "queued",
  "starting",
  "running",
  "waiting_for_user",
  "awaiting_approval",
  "paused",
  "stopping",
]);

const STATE_LABELS: Record<ActionRunProjectionResponse["displayState"], string> = {
  queued: "Queued",
  starting: "Starting",
  running: "Working",
  waiting_for_user: "Waiting for you",
  awaiting_approval: "Needs approval",
  paused: "Paused",
  stopping: "Stopping",
  stopped: "Stopped",
  completed: "Completed",
  failed: "Failed",
};

const STAGES: Array<{ key: string; label: string }> = [
  { key: "agent", label: "Agent" },
  { key: "files", label: "Files" },
  { key: "terminal", label: "Checks" },
  { key: "browser", label: "Browser" },
  { key: "preview", label: "Preview" },
  { key: "approval", label: "Approval" },
  { key: "deployment", label: "Deploy" },
  { key: "verification", label: "Verify" },
];

function statusColor(status: string): string {
  if (status === "completed" || status === "ready") return "var(--litt-primary)";
  if (status === "failed") return "#ef4444";
  if (status === "cancelled") return "#f97316";
  if (status === "running") return "#e3b341";
  return "var(--text-muted)";
}

function stateColor(state: ActionRunProjectionResponse["displayState"]): string {
  if (state === "failed") return "#ef4444";
  if (state === "stopped") return "#f97316";
  if (state === "completed") return "var(--litt-primary)";
  if (state === "awaiting_approval" || state === "waiting_for_user") return "#e3b341";
  return "var(--litt-primary)";
}

export function ActionRunStatusPanel({
  conversationId,
  busy,
}: {
  conversationId: string;
  busy: boolean;
}) {
  const [projection, setProjection] = useState<ActionRunProjectionResponse | null>(null);
  const [unavailable, setUnavailable] = useState(false);

  const load = useCallback(async () => {
    try {
      const response = await fetch(
        `/api/studio/conversations/${encodeURIComponent(conversationId)}/action-run`,
        { cache: "no-store", credentials: "include" },
      );
      if (!response.ok) {
        setUnavailable(response.status !== 404);
        return;
      }
      const body = await response.json() as { projection?: ActionRunProjectionResponse | null };
      setProjection(body.projection ?? null);
      setUnavailable(false);
    } catch {
      setUnavailable(true);
    }
  }, [conversationId]);

  useEffect(() => {
    setProjection(null);
    setUnavailable(false);
    void load();
  }, [load]);

  useEffect(() => {
    if (busy) void load();
  }, [busy, load]);

  const active = projection ? ACTIVE_STATES.has(projection.displayState) : false;
  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => void load(), 2000);
    return () => window.clearInterval(timer);
  }, [active, load]);

  const details = useMemo<ExecutionDetailRecord[]>(() => {
    if (!projection) return [];
    return projection.timeline.slice(-80).map((event) => {
      const toolId = typeof event.payload.toolId === "string" ? event.payload.toolId : null;
      return {
        id: event.id,
        summary: `${event.type}${toolId ? ` · ${toolId}` : ""}`,
        dotColor: event.type.endsWith(".failed")
          ? "#ef4444"
          : event.type.endsWith(".completed") || event.type.endsWith(".ready")
            ? "#4ade80"
            : "#e3b341",
      };
    });
  }, [projection]);

  if (!projection) {
    return unavailable ? (
      <div
        className="shrink-0 border-b px-3 py-2 text-[10px] font-bold"
        style={{ borderColor: "var(--studio-border)", color: "#e3b341" }}
        data-testid="action-run-status-panel"
      >
        Runtime status is temporarily unavailable.
      </div>
    ) : null;
  }

  const deployment = projection.capabilities.deployment;
  const stateLabel = STATE_LABELS[projection.displayState] ?? projection.displayState;
  const headline = projection.currentActivity ?? `${stateLabel} · ${projection.run.status}`;

  return (
    <section
      className="shrink-0 border-b px-3 py-2"
      style={{ borderColor: "var(--studio-border)", backgroundColor: "rgba(255,255,255,0.02)" }}
      aria-label="Task runtime status"
      data-testid="action-run-status-panel"
    >
      <div className="mx-auto flex w-full min-w-0 flex-col gap-1.5" style={{ maxWidth: "var(--studio-composer-max-w)" }}>
        <div className="flex min-w-0 items-center gap-2">
          <span
            className="inline-block h-1.5 w-1.5 shrink-0 rounded-full"
            style={{ backgroundColor: stateColor(projection.displayState) }}
            aria-hidden
          />
          <span className="shrink-0 text-[9px] font-black uppercase tracking-[.14em]" style={{ color: "var(--text-muted)" }}>
            Runtime · {stateLabel}
          </span>
          <span className="min-w-0 flex-1 truncate text-[10px] font-bold" style={{ color: "var(--text-secondary)" }}>
            {headline}
          </span>
          <span className="hidden shrink-0 text-[8px] font-bold sm:inline" style={{ color: "var(--text-muted)" }}>
            {projection.run.id.slice(0, 8)}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-1">
          {STAGES.map((stage) => {
            const capability = projection.capabilities[stage.key];
            const status = capability?.status ?? "not_started";
            return (
              <span
                key={stage.key}
                className="rounded-full border px-1.5 py-0.5 text-[8px] font-bold"
                style={{
                  borderColor: status === "not_started" ? "rgba(255,255,255,0.08)" : `${statusColor(status)}55`,
                  color: status === "not_started" ? "var(--text-muted)" : statusColor(status),
                  backgroundColor: status === "not_started" ? "transparent" : `${statusColor(status)}12`,
                }}
              >
                {stage.label} · {status === "not_started" ? "—" : status}
              </span>
            );
          })}
        </div>

        {projection.pendingApprovals.length > 0 && (
          <div className="text-[10px] font-bold" style={{ color: "#e3b341" }}>
            Approval needed: {projection.pendingApprovals.map((approval) => approval.toolId).join(", ")}
          </div>
        )}
        {projection.failure?.message && (
          <div className="text-[10px] font-bold" style={{ color: "#ef4444" }}>
            {projection.failure.message}
          </div>
        )}
        {deployment.publicUrl && (
          <a
            href={deployment.publicUrl}
            target="_blank"
            rel="noreferrer"
            className="truncate text-[10px] font-bold underline-offset-2 hover:underline"
            style={{ color: "var(--litt-primary)" }}
          >
            {deployment.verified ? "Live URL verified" : "Deployment URL"} · {deployment.publicUrl}
          </a>
        )}
        <ExecutionDetailsExpander details={details} />
      </div>
    </section>
  );
}
