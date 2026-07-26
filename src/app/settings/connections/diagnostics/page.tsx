"use client";

import { useCallback, useEffect, useState } from "react";
import { useTheme } from "@/context/ThemeContext";
import Link from "next/link";
import { ArrowLeft, Activity, RefreshCw } from "lucide-react";
import { useIntegrationStatus } from "@/hooks/useIntegrationStatus";
import type { IntegrationStatus } from "@/lib/integrations/types";

type DiagResult = "PASS" | "WARNING" | "FAIL" | "NOT_REQUIRED";

interface DiagRow {
  label: string;
  result: DiagResult;
  detail?: string;
}

function buildDiagnostics(integrations: IntegrationStatus[]): DiagRow[] {
  const rows: DiagRow[] = [];

  for (const i of integrations) {
    const name = i.displayName;

    // Platform check
    rows.push({
      label: `${name} platform credentials`,
      result: i.platformConfigured ? "PASS" : i.category === "optional" ? "NOT_REQUIRED" : "FAIL",
      detail: i.platformConfigured ? undefined : "Missing env vars",
    });

    // User connection check
    if (i.category === "runtime") {
      rows.push({
        label: `${name} server reachable`,
        result: i.userConnected ? "PASS" : "FAIL",
        detail: i.details,
      });
    } else if (i.category !== "optional" || i.platformConfigured) {
      rows.push({
        label: `${name} account connection`,
        result: i.userConnected ? "PASS" : i.platformConfigured ? "WARNING" : "NOT_REQUIRED",
        detail: i.userConnected ? undefined : "Not connected",
      });
    }

    // Workspace check
    if (i.id === "github") {
      rows.push({
        label: "GitHub repository selected",
        result: i.workspaceReady ? "PASS" : i.userConnected ? "FAIL" : "WARNING",
        detail: i.workspaceReady ? undefined : "No repository selected",
      });
      rows.push({
        label: "GitHub workspace provisioned",
        result: i.workspaceReady ? "PASS" : "FAIL",
        detail: i.workspaceReady ? undefined : "Needs workspace",
      });
    } else if (i.id === "stripe") {
      rows.push({
        label: "Stripe webhook configured",
        result: i.workspaceReady ? "PASS" : i.platformConfigured ? "WARNING" : "FAIL",
        detail: i.workspaceReady ? undefined : "Webhook not configured",
      });
    } else if (i.category !== "optional" || i.platformConfigured) {
      rows.push({
        label: `${name} provider health`,
        result: i.workspaceReady ? "PASS" : i.platformConfigured ? "WARNING" : "FAIL",
        detail: i.details,
      });
    }
  }

  return rows;
}

const RESULT_COLORS: Record<DiagResult, string> = {
  PASS: "#22c55e",
  WARNING: "#f59e0b",
  FAIL: "#ef4444",
  NOT_REQUIRED: "#6b7280",
};

export default function DiagnosticsPage() {
  const T = useTheme().resolvedColors;
  const { status, loading, refresh } = useIntegrationStatus();
  const [rows, setRows] = useState<DiagRow[]>([]);

  const runDiagnostics = useCallback(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (status.integrations.length > 0) {
      setRows(buildDiagnostics(status.integrations));
    }
  }, [status]);

  const passCount = rows.filter((r) => r.result === "PASS").length;
  const warnCount = rows.filter((r) => r.result === "WARNING").length;
  const failCount = rows.filter((r) => r.result === "FAIL").length;

  return (
    <div className="min-h-screen" style={{ backgroundColor: T.bgColor, color: T.textColor }}>
      <div className="mx-auto w-full max-w-3xl p-4 lg:p-6">
        <Link
          href="/settings/connections"
          className="mb-4 inline-flex items-center gap-2 text-sm opacity-60 transition-all hover:opacity-100"
        >
          <ArrowLeft size={14} />
          Back to Connections
        </Link>

        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-black" style={{ color: T.headerColor }}>
              Connection Diagnostics
            </h1>
            <p className="mt-1 text-sm opacity-50">
              Sanitized results — no secrets are exposed.
            </p>
          </div>
          <button
            type="button"
            onClick={runDiagnostics}
            disabled={loading}
            className="flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-bold transition-all hover:opacity-80 disabled:opacity-40"
            style={{ borderColor: `${T.accentColor}30`, color: T.accentColor }}
          >
            <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
            Re-run
          </button>
        </div>

        {/* Summary */}
        {rows.length > 0 && (
          <div className="mb-4 grid grid-cols-4 gap-2">
            <div className="rounded-lg border border-white/5 bg-black/20 px-3 py-2">
              <div className="text-lg font-black" style={{ color: "#22c55e" }}>{passCount}</div>
              <div className="text-[10px] text-white/40">PASS</div>
            </div>
            <div className="rounded-lg border border-white/5 bg-black/20 px-3 py-2">
              <div className="text-lg font-black" style={{ color: "#f59e0b" }}>{warnCount}</div>
              <div className="text-[10px] text-white/40">WARNING</div>
            </div>
            <div className="rounded-lg border border-white/5 bg-black/20 px-3 py-2">
              <div className="text-lg font-black" style={{ color: "#ef4444" }}>{failCount}</div>
              <div className="text-[10px] text-white/40">FAIL</div>
            </div>
            <div className="rounded-lg border border-white/5 bg-black/20 px-3 py-2">
              <div className="text-lg font-black" style={{ color: "#6b7280" }}>
                {rows.length - passCount - warnCount - failCount}
              </div>
              <div className="text-[10px] text-white/40">N/A</div>
            </div>
          </div>
        )}

        {/* Diagnostic rows */}
        {loading && rows.length === 0 ? (
          <div className="flex items-center gap-2 text-sm opacity-50">
            <Activity size={14} className="animate-pulse" />
            Running diagnostics…
          </div>
        ) : (
          <div className="space-y-1.5">
            {rows.map((row, idx) => (
              <div
                key={idx}
                className="flex items-center justify-between rounded-lg border border-white/5 bg-black/20 px-4 py-3"
              >
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-semibold text-white/80">{row.label}</div>
                  {row.detail && (
                    <div className="mt-0.5 text-[10px] text-white/40">{row.detail}</div>
                  )}
                </div>
                <span
                  className="ml-3 shrink-0 rounded-full px-2.5 py-0.5 text-[10px] font-black"
                  style={{
                    backgroundColor: `${RESULT_COLORS[row.result]}15`,
                    color: RESULT_COLORS[row.result],
                  }}
                >
                  {row.result}
                </span>
              </div>
            ))}
          </div>
        )}

        {/* CLI hint */}
        <div className="mt-6 rounded-lg border border-white/5 bg-black/20 p-4">
          <div className="text-xs font-bold text-white/60">CLI Diagnostics</div>
          <p className="mt-1 text-[11px] text-white/40">
            Run <code className="rounded bg-white/10 px-1.5 py-0.5 text-[10px]">pnpm diagnose:connections</code> in your terminal for a full command-line diagnostic report.
          </p>
        </div>
      </div>
    </div>
  );
}
