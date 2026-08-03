"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useTheme } from "@/context/ThemeContext";
import { ConnectionPulse, SkeletonCard } from "./DashboardV2Primitives";
import { Icon } from "./dashboard-v2-utils";
import type { DashboardData, HealthCheck, LlmHealth } from "./dashboard-v2-types";

export function SystemHealthStrip({
  data,
  llmHealth,
  loading,
}: {
  data: DashboardData | null;
  llmHealth: LlmHealth | null;
  loading: boolean;
}) {
  const T = useTheme().resolvedColors;
  const [expanded, setExpanded] = useState(false);

  const checks = useMemo<HealthCheck[]>(() => {
    const result: HealthCheck[] = [];
    const providers = ["github", "vercel", "supabase"];
    for (const p of providers) {
      const acc = data?.accounts?.find((a) => a.provider === p);
      if (acc) {
        result.push({
          label: p.charAt(0).toUpperCase() + p.slice(1),
          status: acc.status,
          detail: acc.provider_account_name || acc.status,
        });
      } else {
        result.push({
          label: p.charAt(0).toUpperCase() + p.slice(1),
          status: "not configured",
          detail: "Not configured",
        });
      }
    }
    result.push({
      label: "Gemini",
      status: llmHealth?.gemini?.available ? "ready" : "disconnected",
      detail: llmHealth?.gemini?.available ? llmHealth.gemini.model : "API key required",
    });
    result.push({
      label: "OpenRouter",
      status: llmHealth?.openrouter?.available ? "ready" : "disconnected",
      detail: llmHealth?.openrouter?.available ? llmHealth.openrouter.model : "API key required",
    });
    return result;
  }, [data, llmHealth]);

  const okCount = checks.filter(
    (c) =>
      c.status === "connected" ||
      c.status === "synced" ||
      c.status === "ready",
  ).length;
  const totalCount = checks.length;
  const allOk = okCount === totalCount;
  const color = allOk ? "#B6FF4A" : okCount === 0 ? "#ef4444" : "#F97316";

  if (loading) return <SkeletonCard />;

  return (
    <div>
      <button
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        aria-label="Toggle system health details"
        className="flex w-full items-center justify-between rounded-xl p-3 transition-all hover:opacity-80"
        style={{ background: `${color}08`, border: `1px solid ${color}20` }}
      >
        <div className="flex items-center gap-3">
          <ConnectionPulse
            status={
              allOk ? "connected" : okCount === 0 ? "disconnected" : "degraded"
            }
          />
          <span className="text-sm font-bold" style={{ color: T.headerColor }}>
            System Health
          </span>
          <span className="text-xs opacity-50">
            {okCount}/{totalCount} services connected
          </span>
        </div>
        <Icon
          name="chevron"
          size={14}
          style={{ transform: expanded ? "rotate(180deg)" : "none", opacity: 0.4 }}
        />
      </button>
      {expanded && (
        <div className="mt-2 space-y-1.5">
          {checks.map((c) => (
            <div
              key={c.label}
              className="flex items-center gap-3 rounded-lg p-2"
              style={{ background: `${T.borderColor}10` }}
            >
              <ConnectionPulse status={c.status} />
              <span
                className="text-sm font-bold flex-1"
                style={{ color: T.headerColor }}
              >
                {c.label}
              </span>
              <span className="text-xs opacity-50 flex-1 truncate">{c.detail}</span>
            </div>
          ))}
          <Link
            href="/settings/connections"
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
