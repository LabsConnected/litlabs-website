"use client";

export const dynamic = "force-dynamic";

import { useCallback, useEffect, useState } from "react";
import { useTheme } from "@/context/ThemeContext";
import { useClerkAuth } from "@/hooks/useClerkAuth";

// ── Types ──

interface N8nHealth {
  configured: boolean;
  reachable: boolean;
  responseTime?: number;
}

type HealthState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ok"; data: N8nHealth; checkedAt: Date }
  | { status: "error"; message: string; checkedAt: Date };

// ── n8n Status Card ──

function N8nStatusCard() {
  const { resolvedColors: T } = useTheme();
  const [health, setHealth] = useState<HealthState>({ status: "idle" });

  const checkHealth = useCallback(async () => {
    setHealth({ status: "loading" });
    try {
      const res = await fetch("/api/n8n/health", { cache: "no-store" });
      if (!res.ok) {
        setHealth({
          status: "error",
          message: `Health check failed (${res.status})`,
          checkedAt: new Date(),
        });
        return;
      }
      const data = (await res.json()) as N8nHealth;
      setHealth({ status: "ok", data, checkedAt: new Date() });
    } catch (err) {
      setHealth({
        status: "error",
        message: err instanceof Error ? err.message : "Request failed",
        checkedAt: new Date(),
      });
    }
  }, []);

  useEffect(() => {
    checkHealth();
  }, [checkHealth]);

  const isLoading = health.status === "loading";
  const isOk = health.status === "ok";
  const isError = health.status === "error";

  const configured = isOk ? health.data.configured : false;
  const reachable = isOk ? health.data.reachable : false;
  const responseTime = isOk ? health.data.responseTime : undefined;
  const lastCheck = isOk || isError ? health.checkedAt : null;

  // Status dot color
  const dotColor = reachable
    ? "#22c55e"
    : configured
      ? T.warning
      : "#ef4444";
  const dotGlow = reachable ? `0 0 8px #22c55e` : "none";

  const statusLabel = isLoading
    ? "Checking..."
    : reachable
      ? "Connected"
      : configured
        ? "Configured — unreachable"
        : "Not configured";

  return (
    <div
      className="rounded-3xl border p-5"
      style={{
        backgroundColor: T.boxBg + "76",
        borderColor: T.borderColor + "24",
      }}
    >
      <div className="mb-4 flex items-center justify-between">
        <div>
          <div
            className="text-[10px] font-black uppercase tracking-[0.24em]"
            style={{ color: T.textMuted }}
          >
            Automation Gateway
          </div>
          <div className="mt-1 text-xl font-black">n8n Status</div>
        </div>
        <button
          onClick={checkHealth}
          disabled={isLoading}
          className="rounded-xl border px-3 py-1.5 text-xs font-bold transition-opacity disabled:opacity-50"
          style={{
            backgroundColor: T.accentColor + "12",
            borderColor: T.accentColor + "28",
            color: T.accentColor,
          }}
        >
          {isLoading ? "Checking..." : "Refresh"}
        </button>
      </div>

      {/* Status indicator */}
      <div className="flex items-center gap-3 rounded-2xl border p-3" style={{ borderColor: T.borderColor + "18" }}>
        <span
          className="inline-block h-3 w-3 rounded-full"
          style={{ backgroundColor: dotColor, boxShadow: dotGlow }}
        />
        <span className="text-sm font-bold" style={{ color: T.textColor }}>
          {statusLabel}
        </span>
      </div>

      {/* Detail rows */}
      <div className="mt-4 space-y-2">
        <StatusRow label="Configured" value={isLoading ? "—" : configured ? "Yes" : "No"} color={configured ? "#22c55e" : "#ef4444"} muted={T.textMuted} />
        <StatusRow
          label="Reachable"
          value={isLoading ? "—" : reachable ? "Yes" : configured ? "No" : "—"}
          color={reachable ? "#22c55e" : configured ? T.warning : T.textMuted}
          muted={T.textMuted}
        />
        <StatusRow
          label="Response time"
          value={responseTime != null ? `${responseTime}ms` : "—"}
          color={T.textColor}
          muted={T.textMuted}
        />
        <StatusRow
          label="Last check"
          value={lastCheck ? lastCheck.toLocaleTimeString() : "—"}
          color={T.textColor}
          muted={T.textMuted}
        />
      </div>

      {/* Error message */}
      {isError && (
        <div
          className="mt-4 rounded-2xl border p-3 text-xs"
          style={{
            borderColor: "#ef444433",
            backgroundColor: "#ef444408",
            color: T.textColor,
          }}
        >
          {health.message}
        </div>
      )}

      {/* Security note */}
      <div className="mt-4 text-[10px]" style={{ color: T.textMuted }}>
        n8n editor and credentials are never exposed. Status reflects a real
        health-check ping to the private automation gateway.
      </div>
    </div>
  );
}

function StatusRow({
  label,
  value,
  color,
  muted,
}: {
  label: string;
  value: string;
  color: string;
  muted: string;
}) {
  return (
    <div className="flex items-center justify-between text-xs">
      <span style={{ color: muted }}>{label}</span>
      <span className="font-bold" style={{ color }}>
        {value}
      </span>
    </div>
  );
}

// ── Sentinel Status Card ──

interface SentinelService {
  serviceId: string;
  label: string;
  level: "operational" | "degraded" | "down" | "unknown";
  detail: string;
  latencyMs: number | null;
  lastCheckedAt: string | null;
  consecutiveFailures: number;
}

interface SentinelIncident {
  id: string;
  serviceId: string;
  severity: "warning" | "critical";
  state: "open" | "resolved";
  summary: string;
  openedAt: string;
  resolvedAt: string | null;
}

interface RepairCandidate {
  id: string;
  serviceId: string;
  state: "proposed" | "approved" | "running" | "pr_open" | "resolved" | "rejected" | "cancelled" | "failed";
  severity: "warning" | "critical";
  summary: string;
  attemptCount: number;
  maxAttempts: number;
  prUrl: string | null;
  createdAt: string;
}

interface SentinelSnapshot {
  generatedAt: string;
  overall: "healthy" | "degraded" | "critical" | "unknown";
  services: SentinelService[];
  openIncidents: SentinelIncident[];
  recentIncidents: SentinelIncident[];
  lastPassAt: string | null;
  repairCandidates?: RepairCandidate[];
  heartbeat?: { lastPassAt: string | null; holder: string | null } | null;
}

type SentinelState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ok"; data: SentinelSnapshot; checkedAt: Date }
  | { status: "error"; message: string; checkedAt: Date };

const LEVEL_COLORS: Record<SentinelService["level"], string> = {
  operational: "#22c55e",
  degraded: "#f59e0b",
  down: "#ef4444",
  unknown: "#9ca3af",
};

const LEVEL_LABELS: Record<SentinelService["level"], string> = {
  operational: "Operational",
  degraded: "Degraded",
  down: "Down",
  unknown: "Unknown",
};

function SentinelStatusCard() {
  const { resolvedColors: T } = useTheme();
  const [state, setState] = useState<SentinelState>({ status: "idle" });

  const check = useCallback(async () => {
    setState({ status: "loading" });
    try {
      const res = await fetch("/api/owner/sentinel", { cache: "no-store" });
      if (!res.ok) {
        setState({
          status: "error",
          message: `Sentinel unavailable (${res.status})`,
          checkedAt: new Date(),
        });
        return;
      }
      const data = (await res.json()) as SentinelSnapshot;
      setState({ status: "ok", data, checkedAt: new Date() });
    } catch (err) {
      setState({
        status: "error",
        message: err instanceof Error ? err.message : "Request failed",
        checkedAt: new Date(),
      });
    }
  }, []);

  useEffect(() => {
    check();
  }, [check]);

  const transitionRepair = useCallback(
    async (id: string, action: "approve" | "cancel" | "reject") => {
      try {
        await fetch(`/api/owner/sentinel/repairs/${id}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action }),
        });
      } finally {
        void check();
      }
    },
    [check],
  );

  const data = state.status === "ok" ? state.data : null;
  const overallColor = data
    ? data.overall === "healthy"
      ? "#22c55e"
      : data.overall === "degraded"
        ? "#f59e0b"
        : data.overall === "critical"
          ? "#ef4444"
          : "#9ca3af"
    : "#9ca3af";

  return (
    <div
      className="rounded-3xl border p-5"
      style={{
        backgroundColor: T.boxBg + "76",
        borderColor: T.borderColor + "24",
      }}
    >
      <div className="mb-4 flex items-center justify-between">
        <div>
          <div
            className="text-[10px] font-black uppercase tracking-[0.24em]"
            style={{ color: T.textMuted }}
          >
            Sentinel
          </div>
          <div className="mt-1 text-xl font-black">Platform Health</div>
        </div>
        <button
          onClick={check}
          disabled={state.status === "loading"}
          className="rounded-xl border px-3 py-1.5 text-xs font-bold transition-opacity disabled:opacity-50"
          style={{
            backgroundColor: T.accentColor + "12",
            borderColor: T.accentColor + "28",
            color: T.accentColor,
          }}
        >
          {state.status === "loading" ? "Checking..." : "Refresh"}
        </button>
      </div>

      <div className="flex items-center gap-3 rounded-2xl border p-3" style={{ borderColor: T.borderColor + "18" }}>
        <span
          className="inline-block h-3 w-3 rounded-full"
          style={{ backgroundColor: overallColor, boxShadow: overallColor === "#22c55e" ? "0 0 8px #22c55e" : "none" }}
        />
        <span className="text-sm font-bold" style={{ color: T.textColor }}>
          {state.status === "loading"
            ? "Probing services..."
            : state.status === "error"
              ? state.message
              : data
                ? `${data.overall.toUpperCase()} — last pass ${data.lastPassAt ? new Date(data.lastPassAt).toLocaleTimeString() : "pending"}`
                : "No data"}
        </span>
      </div>

      {data && (
        <>
          <div className="mt-4 space-y-2">
            {data.services.map((svc) => (
              <div key={svc.serviceId} className="flex items-center justify-between text-xs">
                <span style={{ color: T.textMuted }}>{svc.label}</span>
                <span className="font-bold" style={{ color: LEVEL_COLORS[svc.level] }}>
                  {LEVEL_LABELS[svc.level]}
                  {svc.latencyMs != null ? ` · ${svc.latencyMs}ms` : ""}
                </span>
              </div>
            ))}
          </div>

          {(data.repairCandidates?.length ?? 0) > 0 && (
            <div className="mt-4 space-y-2">
              <div className="text-[10px] font-black uppercase tracking-[0.2em]" style={{ color: T.textMuted }}>
                Repair candidates
              </div>
              {data.repairCandidates!.map((rc) => (
                <div
                  key={rc.id}
                  className="rounded-2xl border p-3 text-xs"
                  style={{ borderColor: T.borderColor + "18", color: T.textColor }}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-bold">{rc.summary}</span>
                    <span className="font-bold" style={{ color: rc.state === "resolved" ? "#22c55e" : rc.state === "failed" || rc.state === "rejected" ? "#ef4444" : "#f59e0b" }}>
                      {rc.state}
                    </span>
                  </div>
                  <div className="mt-1" style={{ color: T.textMuted }}>
                    {rc.serviceId} · attempt {rc.attemptCount}/{rc.maxAttempts} · {new Date(rc.createdAt).toLocaleString()}
                    {rc.prUrl ? ` · PR: ${rc.prUrl}` : ""}
                  </div>
                  {(rc.state === "proposed" || rc.state === "approved") && (
                    <div className="mt-2 flex gap-2">
                      {rc.state === "proposed" && (
                        <button
                          onClick={() => transitionRepair(rc.id, "approve")}
                          className="rounded-lg border px-2 py-1 text-[10px] font-bold"
                          style={{ borderColor: "#22c55e44", color: "#22c55e" }}
                        >
                          Approve
                        </button>
                      )}
                      <button
                        onClick={() => transitionRepair(rc.id, "cancel")}
                        className="rounded-lg border px-2 py-1 text-[10px] font-bold"
                        style={{ borderColor: "#ef444444", color: "#ef4444" }}
                      >
                        Cancel
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {data.openIncidents.length > 0 && (
            <div className="mt-4 space-y-2">
              <div className="text-[10px] font-black uppercase tracking-[0.2em]" style={{ color: T.textMuted }}>
                Open incidents
              </div>
              {data.openIncidents.map((inc) => (
                <div
                  key={inc.id}
                  className="rounded-2xl border p-3 text-xs"
                  style={{
                    borderColor: inc.severity === "critical" ? "#ef444433" : "#f59e0b33",
                    backgroundColor: inc.severity === "critical" ? "#ef444408" : "#f59e0b08",
                    color: T.textColor,
                  }}
                >
                  <div className="font-bold">{inc.summary}</div>
                  <div style={{ color: T.textMuted }}>
                    {inc.serviceId} · opened {new Date(inc.openedAt).toLocaleString()}
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="mt-4 text-[10px]" style={{ color: T.textMuted }}>
            Sentinel probes platform services every 60s, opens incidents on sustained
            failure, applies bounded safe remediation, and escalates the rest here.
          </div>
        </>
      )}
    </div>
  );
}

// ── Owner Console Page ──

export default function OwnerConsole() {
  const { resolvedColors: T } = useTheme();
  const { isLoaded, isSignedIn } = useClerkAuth();

  // Authorization is enforced server-side by src/app/(app)/owner/layout.tsx
  // (requireOwnerAccess → 404); the check below only covers Clerk's client
  // resolution window so the console doesn't flash before the session loads.
  if (!isLoaded || !isSignedIn) {
    return (
      <div
        className="min-h-screen grid place-items-center"
        style={{ backgroundColor: T.bgColor, color: T.textMuted }}
      >
        Loading Owner Console...
      </div>
    );
  }

  return (
    <div
      className="min-h-screen p-4 sm:p-6"
      style={{
        background: `radial-gradient(circle at 10% 0%, ${T.accentColor}14, transparent 30%), radial-gradient(circle at 90% 10%, ${T.headerColor}12, transparent 28%), linear-gradient(180deg, ${T.bgColor}, ${T.boxBg})`,
        color: T.textColor,
      }}
    >
      <div className="mx-auto flex min-h-screen max-w-4xl flex-col gap-4">
        <header
          className="rounded-3xl border px-5 py-4 sm:px-6"
          style={{
            backgroundColor: T.boxBg + "78",
            borderColor: T.borderColor + "24",
          }}
        >
          <div className="text-[10px] font-black uppercase tracking-[0.24em]" style={{ color: T.textMuted }}>
            Owner Console
          </div>
          <div className="mt-1 text-2xl font-black sm:text-3xl">Automation & Integrations</div>
        </header>

        <N8nStatusCard />
        <SentinelStatusCard />
      </div>
    </div>
  );
}
