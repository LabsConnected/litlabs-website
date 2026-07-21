"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTheme } from "@/context/ThemeContext";

type LoopState = "checking" | "ok" | "degraded" | "down";

type CheckResult = {
  id: string;
  label: string;
  ok: boolean;
  detail?: string;
};

// Single source of truth for autonomic system health.
// Old per-endpoint probes are intentionally removed — they only proved "URL answered",
// not that the worker/leases/execution are alive.
const HEALTH_ENDPOINT = "/api/system/autonomic-health";

const POLL_INTERVAL_MS = 60_000;

/* ---------- Inline SVG icons (no external icon dependency) ---------- */

type IconProps = {
  size?: number;
  className?: string;
  style?: React.CSSProperties;
};

function IconWrap({
  size = 14,
  className,
  style,
  children,
}: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      style={style}
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

function ActivityIcon(props: IconProps) {
  return (
    <IconWrap {...props}>
      <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
    </IconWrap>
  );
}

function CheckIcon(props: IconProps) {
  return (
    <IconWrap {...props}>
      <circle cx="12" cy="12" r="10" />
      <polyline points="9 12 12 15 16 10" />
    </IconWrap>
  );
}

function AlertIcon(props: IconProps) {
  return (
    <IconWrap {...props}>
      <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </IconWrap>
  );
}

function SpinnerIcon(props: IconProps) {
  return (
    <IconWrap {...props}>
      <line x1="12" y1="2" x2="12" y2="6" />
      <line x1="12" y1="18" x2="12" y2="22" />
      <line x1="4.93" y1="4.93" x2="7.76" y2="7.76" />
      <line x1="16.24" y1="16.24" x2="19.07" y2="19.07" />
      <line x1="2" y1="12" x2="6" y2="12" />
      <line x1="18" y1="12" x2="22" y2="12" />
      <line x1="4.93" y1="19.07" x2="7.76" y2="16.24" />
      <line x1="16.24" y1="7.76" x2="19.07" y2="4.93" />
    </IconWrap>
  );
}

function CloseIcon(props: IconProps) {
  return (
    <IconWrap {...props}>
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </IconWrap>
  );
}

/* ---------- Component ---------- */

/**
 * AutonomicLoopBanner
 *
 * A non-intrusive sticky banner that pings the core orchestration
 * endpoints and surfaces whether the Director → Agent-Tasks → Worker
 * pipeline is healthy. This directly satisfies the "Verify the
 * Autonomic Loop setup" portion of the active Director task.
 *
 * Memory hygiene:
 * - AbortController cancels any in-flight fetch on unmount or remount.
 * - Polling pauses when the tab is hidden (visibilitychange listener).
 * - All timers + listeners are cleaned up on unmount.
 * - runChecks is stable via useCallback to avoid re-creating closures.
 */
export default function AutonomicLoopBanner() {
  const { tokens } = useTheme();
  const [state, setState] = useState<LoopState>("checking");
  const [checks, setChecks] = useState<CheckResult[]>([]);
  const [expanded, setExpanded] = useState(false);
  const [lastChecked, setLastChecked] = useState<Date | null>(null);
  const [dismissed, setDismissed] = useState(false);

  // AbortController lives in a ref so it survives across renders
  // without triggering re-renders. Cancelled on unmount.
  const abortRef = useRef<AbortController | null>(null);

  // Real health snapshot from the worker surface
  type HealthSnapshot = {
    status: "online" | "degraded" | "offline";
    api?: string;
    database?: string;
    queue?: string;
    worker?: string;
    memory?: string;
    queuedTasks?: number;
    runningTasks?: number;
    failedTasks?: number;
    lastWorkerHeartbeat?: string | null;
    lastSuccessfulTask?: string | null;
    version?: string;
  };

  const runChecks = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setState("checking");
    const signal = controller.signal;

    try {
      const res = await fetch(HEALTH_ENDPOINT, {
        method: "GET",
        signal,
        cache: "no-store",
      });

      if (signal.aborted) return;

      if (!res.ok) {
        // Treat non-2xx as degraded signal (endpoint itself is reachable but system unhappy)
        setChecks([{ id: "health", label: "Autonomic health", ok: false, detail: `${res.status}` }]);
        setState("degraded");
        setLastChecked(new Date());
        return;
      }

      const h = (await res.json()) as HealthSnapshot;

      // Map canonical status to banner state
      const mapped: LoopState =
        h.status === "online" ? "ok" : h.status === "degraded" ? "degraded" : "down";

      // Build a compact set of indicators for the expanded row
      const items: CheckResult[] = [
        { id: "worker", label: "Worker", ok: h.worker === "online", detail: h.worker || "unknown" },
        { id: "database", label: "Database", ok: h.database === "online", detail: h.database || "unknown" },
        { id: "queue", label: "Queue", ok: h.queue === "online", detail: h.queue || "unknown" },
        { id: "memory", label: "Memory", ok: h.memory === "online", detail: h.memory || "unconfigured" },
      ];

      setChecks(items);
      setState(mapped);
      setLastChecked(new Date());
    } catch (err) {
      if ((err as { name?: string })?.name === "AbortError") return;
      setChecks([{ id: "health", label: "Autonomic health", ok: false, detail: "unreachable" }]);
      setState("down");
      setLastChecked(new Date());
    }
  }, []);

  useEffect(() => {
    // Track whether the tab is visible so we can pause polling when
    // the user isn't watching — saves CPU + RAM for background tabs.
    let visible = typeof document === "undefined" ? true : !document.hidden;
    const onVisibility = () => {
      const next = !document.hidden;
      if (next === visible) return;
      visible = next;
      // Probe immediately on becoming visible again.
      if (visible) void runChecks();
    };
    document.addEventListener("visibilitychange", onVisibility);

    // Defer the initial probe so setState calls happen in a callback
    // (satisfies the react-hooks/set-state-in-effect lint rule).
    const initial = setTimeout(() => {
      if (visible) void runChecks();
    }, 0);

    const id = setInterval(() => {
      if (visible) void runChecks();
    }, POLL_INTERVAL_MS);

    return () => {
      clearTimeout(initial);
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisibility);
      abortRef.current?.abort();
      abortRef.current = null;
    };
  }, [runChecks]);

  if (dismissed) return null;

  const palette = {
    ok: { color: "#22c55e", label: "Systems Online" },
    degraded: { color: "#f59e0b", label: "Partial" },
    down: { color: "#ef4444", label: "Offline" },
    checking: { color: tokens.primary, label: "Checking" },
  }[state];

  const StatusIcon =
    state === "ok" ? CheckIcon : state === "checking" ? SpinnerIcon : AlertIcon;

  return (
    <div
      className="sticky top-0 z-40 w-full border-b backdrop-blur-md"
      style={{
        backgroundColor: `${tokens.surface}cc`,
        borderColor: `${palette.color}20`,
      }}
    >
      <div className="w-full flex items-center gap-2 px-4 py-1.5 text-xs font-bold">
        <button
          onClick={() => setExpanded((v) => !v)}
          className="flex items-center gap-2 flex-1 min-w-0 text-left transition-all hover:opacity-90"
          aria-expanded={expanded}
          aria-label={`Autonomic Loop status: ${palette.label}. ${expanded ? "Hide" : "Show"} details`}
        >
          <StatusIcon
            size={12}
            className={state === "checking" ? "animate-spin" : ""}
            style={{ color: palette.color }}
            aria-hidden="true"
          />
          <span
            className="uppercase tracking-[0.15em] text-[10px]"
            style={{ color: palette.color }}
          >
            {palette.label}
          </span>
          <span
            className="opacity-50 hidden sm:inline"
            style={{ color: tokens.textMuted }}
          >
            {lastChecked
              ? `· checked ${lastChecked.toLocaleTimeString()}`
              : "· probing..."}
          </span>
          <span className="ml-auto flex items-center gap-2">
            <ActivityIcon
              size={12}
              style={{ color: tokens.textMuted, opacity: expanded ? 1 : 0.4 }}
            />
            <span
              className="hidden sm:inline"
              style={{ color: tokens.textMuted, opacity: 0.6 }}
            >
              {expanded ? "hide details" : "show details"}
            </span>
          </span>
        </button>
        <button
          onClick={() => setDismissed(true)}
          className="ml-2 opacity-50 hover:opacity-100 transition-opacity"
          aria-label="Dismiss banner"
        >
          <CloseIcon size={12} style={{ color: tokens.textMuted }} />
        </button>
      </div>

      {expanded && (
        <div
          className="px-4 pb-3 pt-1 grid grid-cols-2 sm:grid-cols-4 gap-2"
          style={{ borderTop: `1px solid ${tokens.border}30` }}
        >
          {checks.length === 0
            ? [
                { id: "worker", label: "Worker" },
                { id: "database", label: "Database" },
                { id: "queue", label: "Queue" },
                { id: "memory", label: "Memory" },
              ].map((e) => (
                <div
                  key={e.id}
                  className="flex items-center gap-2 text-[10px] font-mono"
                  style={{ color: tokens.textMuted }}
                >
                  <SpinnerIcon size={10} className="animate-spin" />
                  {e.label}…
                </div>
              ))
            : checks.map((c) => (
                <div
                  key={c.id}
                  className="flex items-center gap-2 text-[10px] font-mono"
                  style={{ color: tokens.text }}
                >
                  <span
                    className="h-1.5 w-1.5 rounded-full"
                    style={{ backgroundColor: c.ok ? "#22c55e" : "#ef4444" }}
                  />
                  <span className="truncate">{c.label}</span>
                  <span style={{ color: tokens.textMuted, opacity: 0.6 }}>
                    {c.detail}
                  </span>
                </div>
              ))}
        </div>
      )}
    </div>
  );
}
