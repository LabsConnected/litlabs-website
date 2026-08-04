"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useTheme } from "@/context/ThemeContext";
import { ConnectionPulse, SkeletonCard } from "./DashboardV2Primitives";
import { Icon } from "./dashboard-v2-utils";
import type {
  AiProviderHealth,
  HealthState,
  PlatformService,
  SystemHealthResponse,
  WorkspaceConnection,
} from "./dashboard-v2-types";

const SETTINGS_CONNECTIONS = "/settings?section=connections&returnTo=/dashboard";

/**
 * Maps a HealthState to the ConnectionPulse status vocabulary.
 */
function pulseStatus(state: HealthState): "connected" | "degraded" | "disconnected" {
  const ok: HealthState[] = ["connected", "authorized", "linked", "live", "healthy", "operational"];
  const degraded: HealthState[] = ["degraded", "rate_limited", "reconnect_required", "checking", "configured"];
  if (ok.includes(state)) return "connected";
  if (degraded.includes(state)) return "degraded";
  return "disconnected";
}

function stateColor(state: HealthState): string {
  const ok: HealthState[] = ["connected", "authorized", "linked", "live", "healthy", "operational"];
  const degraded: HealthState[] = ["degraded", "rate_limited", "reconnect_required", "checking", "configured"];
  if (ok.includes(state)) return "#B6FF4A";
  if (degraded.includes(state)) return "#F97316";
  return "#ef4444";
}

function stateLabel(state: HealthState): string {
  const map: Partial<Record<HealthState, string>> = {
    connected: "Connected",
    authorized: "Authorized",
    linked: "Linked",
    live: "Live",
    configured: "Configured",
    checking: "Checking…",
    healthy: "Healthy",
    degraded: "Degraded",
    unauthorized: "Unauthorized",
    rate_limited: "Rate limited",
    unavailable: "Unavailable",
    reconnect_required: "Reconnect required",
    not_connected: "Not connected",
    missing: "Missing",
    operational: "Operational",
    disconnected: "Disconnected",
  };
  return map[state] ?? state;
}

/**
 * SystemHealthStrip — canonical 3-section health panel.
 *
 * Replaces the old "2/5 services connected" model that conflated workspace
 * integrations and AI providers into one meaningless score. Now fetches
 * from /api/system-health which resolves GitHub from ALL canonical sources
 * (not just integration_accounts) and probes AI providers with real
 * lightweight requests.
 */
export function SystemHealthStrip({ loading }: { loading?: boolean }) {
  const T = useTheme().resolvedColors;
  const [expanded, setExpanded] = useState(false);
  const [health, setHealth] = useState<SystemHealthResponse | null>(null);
  const [fetching, setFetching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchHealth = useCallback(async () => {
    setFetching(true);
    setError(null);
    try {
      const res = await fetch("/api/system-health", { credentials: "include" });
      if (!res.ok) {
        if (res.status === 401) {
          setError("Sign-in required to view system health.");
        } else {
          setError("System health is temporarily unavailable.");
        }
        return;
      }
      const data = await res.json();
      setHealth(data as SystemHealthResponse);
    } catch {
      setError("System health is temporarily unavailable.");
    } finally {
      setFetching(false);
    }
  }, []);

  useEffect(() => {
    void fetchHealth();
  }, [fetchHealth]);

  const summary = health?.summary;
  const color = !summary
    ? "#F97316"
    : summary.platformDegraded
      ? "#ef4444"
      : summary.optionalPending > 0 || summary.headline.includes("Terminal")
        ? "#F97316"
        : "#B6FF4A";

  if (loading || (fetching && !health)) return <SkeletonCard />;

  return (
    <div>
      {/* Summary header */}
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        aria-label="Toggle system health details"
        className="flex w-full items-center justify-between rounded-xl p-3 transition-all hover:opacity-80"
        style={{ background: `${color}08`, border: `1px solid ${color}20` }}
      >
        <div className="flex items-center gap-3">
          <ConnectionPulse
            status={
              summary?.platformDegraded
                ? "disconnected"
                : summary && (summary.optionalPending > 0 || summary.headline.includes("Terminal"))
                  ? "degraded"
                  : "connected"
            }
          />
          <span className="text-sm font-bold" style={{ color: T.headerColor }}>
            System Status
          </span>
        </div>
        <Icon
          name="chevron"
          size={14}
          style={{ transform: expanded ? "rotate(180deg)" : "none", opacity: 0.4 }}
        />
      </button>

      {/* Summary line */}
      {summary && (
        <div className="mt-1.5 px-1">
          <p className="text-xs font-medium" style={{ color: T.textMuted }}>
            {summary.headline}
          </p>
        </div>
      )}

      {error && (
        <div
          className="mt-2 rounded-lg px-3 py-2 text-xs"
          style={{ background: "#ef444408", border: "1px solid #ef444420", color: "#fca5a5" }}
          role="alert"
        >
          {error}
          <button
            type="button"
            onClick={() => void fetchHealth()}
            className="ml-2 rounded px-2 py-0.5 text-[10px] font-bold hover:bg-red-500/10"
          >
            Retry
          </button>
        </div>
      )}

      {expanded && health && (
        <div className="mt-2 space-y-3">
          {/* 1. Workspace Connections */}
          <HealthSection title="Workspace Connections">
            {health.workspace.map((c) => (
              <ConnectionRow key={c.id} item={c} />
            ))}
          </HealthSection>

          {/* 2. AI Providers */}
          <HealthSection title="AI Providers">
            {health.ai.map((c) => (
              <ConnectionRow key={c.id} item={c} />
            ))}
          </HealthSection>

          {/* 3. Platform Services */}
          <HealthSection title="Platform Services">
            {health.platform.map((c) => (
              <ConnectionRow key={c.id} item={c} />
            ))}
          </HealthSection>

          {/* Manage link — canonical Settings URL */}
          <Link
            href={SETTINGS_CONNECTIONS}
            className="inline-flex items-center gap-1 text-xs font-bold transition-all hover:opacity-80"
            style={{ color: T.accentColor }}
          >
            Manage Connections <Icon name="arrow" size={10} />
          </Link>
        </div>
      )}
    </div>
  );
}

/* ── Section wrapper ──────────────────────────────────────────────── */
function HealthSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1.5">
        <span
          className="text-[10px] font-black uppercase tracking-[0.15em]"
          style={{ color: "rgba(238,244,255,0.35)" }}
        >
          {title}
        </span>
      </div>
      <div className="space-y-1.5">{children}</div>
    </div>
  );
}

/* ── Row — works for workspace / ai / platform ────────────────────── */
type AnyHealthItem = (WorkspaceConnection | AiProviderHealth | PlatformService) & {
  action?: { label: string; href: string };
};

function ConnectionRow({ item }: { item: AnyHealthItem }) {
  const T = useTheme().resolvedColors;
  const sc = stateColor(item.state);
  const isAi = "latencyMs" in item;
  const lastChecked = item.lastChecked ? new Date(item.lastChecked) : null;
  const checkedStr = lastChecked
    ? `${lastChecked.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
    : null;

  return (
    <div
      className="flex items-center gap-3 rounded-lg p-2"
      style={{ background: "rgba(168,85,247,0.04)" }}
    >
      <ConnectionPulse status={pulseStatus(item.state)} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-bold truncate" style={{ color: T.headerColor }}>
            {item.label}
          </span>
          <span
            className="shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-bold"
            style={{ background: `${sc}15`, color: sc }}
          >
            {stateLabel(item.state)}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs opacity-50 truncate">{item.detail}</span>
          {isAi && (item as AiProviderHealth).latencyMs != null && (
            <span className="text-[9px] opacity-40 shrink-0">
              {(item as AiProviderHealth).latencyMs}ms
            </span>
          )}
          {checkedStr && (
            <span className="text-[9px] opacity-30 shrink-0">· {checkedStr}</span>
          )}
        </div>
      </div>
      {item.action && (
        <Link
          href={item.action.href}
          className="shrink-0 rounded-lg px-2 py-1 text-[10px] font-bold transition hover:opacity-80"
          style={{ background: `${sc}10`, color: sc }}
        >
          {item.action.label}
        </Link>
      )}
    </div>
  );
}
