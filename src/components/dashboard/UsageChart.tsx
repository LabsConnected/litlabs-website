"use client";

import { useEffect, useRef, useState } from "react";
import { useTheme } from "@/context/ThemeContext";

type DailyBucket = {
  date: string;
  commands: number;
  agentTasks: number;
  generations: number;
};

type Summary = {
  totalCommands: number;
  totalAgentTasks: number;
  totalGenerations: number;
  hourlyUsed: number;
  hourlyLimit: number;
  role: string;
  plan: string;
};

type StatsResponse = {
  summary?: Summary;
  daily?: DailyBucket[];
  demo?: boolean;
  partial?: boolean;
  failedSources?: string[];
  error?: string;
};

type Series = {
  key: "commands" | "agentTasks" | "generations";
  label: string;
  color: string;
};

const SERIES: Series[] = [
  { key: "commands", label: "Commands", color: "#f97316" }, // volcanic orange
  { key: "agentTasks", label: "Agent tasks", color: "#7dd3fc" }, // sky
  { key: "generations", label: "Generations", color: "#a78bfa" }, // violet
];

/* ---------- Inline SVG icons (matches the rest of the project) ---------- */

function AlertIcon({
  size = 12,
  style,
}: {
  size?: number;
  style?: React.CSSProperties;
}) {
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
      style={style}
      aria-hidden="true"
    >
      <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  );
}

function SpinnerIcon({
  size = 12,
  className,
  style,
}: {
  size?: number;
  className?: string;
  style?: React.CSSProperties;
}) {
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
      <line x1="12" y1="2" x2="12" y2="6" />
      <line x1="12" y1="18" x2="12" y2="22" />
      <line x1="4.93" y1="4.93" x2="7.76" y2="7.76" />
      <line x1="16.24" y1="16.24" x2="19.07" y2="19.07" />
      <line x1="2" y1="12" x2="6" y2="12" />
      <line x1="18" y1="12" x2="22" y2="12" />
      <line x1="4.93" y1="19.07" x2="7.76" y2="16.24" />
      <line x1="16.24" y1="7.76" x2="19.07" y2="4.93" />
    </svg>
  );
}

/* ---------- Component ---------- */

function shortDate(iso: string): string {
  // "2026-07-12" -> "Jul 12"
  const d = new Date(iso + "T00:00:00");
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function formatHourlyLimit(limit: number): string {
  if (!Number.isFinite(limit)) return "∞";
  return limit.toLocaleString();
}

/**
 * UsageChart
 *
 * Fetches /api/usage/stats and renders a 14-day stacked bar chart
 * plus hourly usage + plan summary. Designed to slot into the
 * Dashboard Usage section, replacing the "beta" placeholder.
 *
 * Memory hygiene:
 * - AbortController on the fetch, cancelled on unmount + on remount.
 * - Polling is manual (refresh button) — no setInterval to manage.
 */
export default function UsageChart() {
  const { tokens } = useTheme();
  const [data, setData] = useState<StatsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const load = async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/usage/stats", {
        method: "GET",
        signal: controller.signal,
        cache: "no-store",
      });
      if (controller.signal.aborted) return;
      const json = (await res.json()) as StatsResponse;
      if (controller.signal.aborted) return;
      if (!res.ok) {
        setError(json.error || `Request failed (${res.status})`);
        setData(null);
        return;
      }
      setData(json);
    } catch (err) {
      if ((err as { name?: string })?.name === "AbortError") return;
      setError(err instanceof Error ? err.message : "Network error");
      setData(null);
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  };

  useEffect(() => {
    // Defer the initial load so setState calls happen in a callback
    // (satisfies the react-hooks/set-state-in-effect lint rule).
    const initial = setTimeout(() => {
      void load();
    }, 0);
    return () => {
      clearTimeout(initial);
      abortRef.current?.abort();
      abortRef.current = null;
    };
  }, []);

  const daily = data?.daily ?? [];
  const summary = data?.summary;
  // Find the tallest stack so we can scale bar heights.
  const max = Math.max(
    1,
    ...daily.map((b) => b.commands + b.agentTasks + b.generations),
  );

  return (
    <div
      className="rounded-lg border p-3 text-xs"
      style={{ borderColor: tokens.border, color: tokens.text }}
    >
      {/* Header row */}
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span
            className="text-[10px] font-black uppercase tracking-widest"
            style={{ color: tokens.textMuted }}
          >
            14-day activity
          </span>
          {data?.demo && (
            <span
              className="rounded-full border px-1.5 py-0.5 text-[9px] font-bold uppercase"
              style={{
                borderColor: tokens.border,
                color: tokens.textMuted,
                opacity: 0.7,
              }}
              title="Demo data shown because Supabase is not configured"
            >
              Demo
            </span>
          )}
          {data?.partial && (
            <span
              className="flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[9px] font-bold uppercase"
              style={{
                borderColor: "#f59e0b",
                color: "#f59e0b",
              }}
              title={`Some sources failed: ${(data.failedSources || []).join(", ")}`}
            >
              <AlertIcon size={9} /> Limited
            </span>
          )}
        </div>
        <button
          onClick={() => void load()}
          className="rounded px-1.5 py-0.5 text-[10px] font-bold transition-opacity hover:opacity-80 disabled:opacity-50"
          style={{ color: tokens.textMuted }}
          disabled={loading}
          aria-label="Refresh usage stats"
        >
          {loading ? <SpinnerIcon size={10} className="animate-spin" /> : "↻"}
        </button>
      </div>

      {/* Chart body */}
      {error ? (
        <div
          className="rounded border p-2 text-[10px]"
          style={{
            borderColor: "#ef4444",
            color: "#ef4444",
            backgroundColor: "#ef444410",
          }}
        >
          {error}
        </div>
      ) : loading && !data ? (
        <div
          className="flex h-24 items-center justify-center gap-2 text-[10px]"
          style={{ color: tokens.textMuted }}
        >
          <SpinnerIcon size={12} className="animate-spin" /> Loading usage…
        </div>
      ) : daily.length === 0 ? (
        <div
          className="flex h-24 items-center justify-center text-[10px]"
          style={{ color: tokens.textMuted }}
        >
          No activity yet.
        </div>
      ) : (
        <div
          className="flex h-24 items-end gap-[2px]"
          role="img"
          aria-label="14-day activity bar chart"
        >
          {daily.map((b) => {
            const total = b.commands + b.agentTasks + b.generations;
            const heightPct = (total / max) * 100;
            return (
              <div
                key={b.date}
                className="group relative flex h-full flex-1 flex-col justify-end"
                title={`${shortDate(b.date)} — ${b.commands} cmd · ${b.agentTasks} task · ${b.generations} gen`}
              >
                <div
                  className="flex w-full flex-col-reverse overflow-hidden rounded-t-sm"
                  style={{ height: `${Math.max(2, heightPct)}%` }}
                >
                  {SERIES.map((s) => {
                    const v = b[s.key];
                    if (!v) return null;
                    const segPct = (v / Math.max(1, total)) * 100;
                    return (
                      <div
                        key={s.key}
                        style={{
                          height: `${segPct}%`,
                          backgroundColor: s.color,
                          opacity: 0.85,
                        }}
                      />
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Legend + summary */}
      {summary && (
        <div
          className="mt-2 flex flex-wrap items-center gap-3 border-t pt-2 text-[10px]"
          style={{ borderColor: tokens.border + "30" }}
        >
          {SERIES.map((s) => (
            <div key={s.key} className="flex items-center gap-1.5">
              <span
                className="h-2 w-2 rounded-sm"
                style={{ backgroundColor: s.color }}
              />
              <span style={{ color: tokens.textMuted }}>{s.label}</span>
            </div>
          ))}
          <div className="ml-auto flex items-center gap-2">
            <span style={{ color: tokens.textMuted }}>
              {summary.hourlyUsed}/{formatHourlyLimit(summary.hourlyLimit)} /hr
            </span>
            <span
              className="rounded-full border px-1.5 py-0.5 text-[9px] font-black uppercase"
              style={{
                borderColor: tokens.border,
                color: tokens.textMuted,
                opacity: 0.7,
              }}
            >
              {summary.plan}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
