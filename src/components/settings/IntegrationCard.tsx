"use client";

import type { IntegrationStatus, IntegrationState, IntegrationStatusResponse } from "@/lib/integrations/types";
import { useTheme } from "@/context/ThemeContext";

const STATE_COLORS: Record<IntegrationState, string> = {
  checking: "#6b7280",
  platform_missing: "#6b7280",
  platform_configured: "#3b82f6",
  user_not_connected: "#f59e0b",
  user_connected: "#22c55e",
  needs_setup: "#f59e0b",
  ready: "#22c55e",
  error: "#ef4444",
};

const STATE_LABELS: Record<IntegrationState, string> = {
  checking: "Checking",
  platform_missing: "Not configured",
  platform_configured: "Configured",
  user_not_connected: "Needs account",
  user_connected: "Connected",
  needs_setup: "Needs setup",
  ready: "Ready",
  error: "Error",
};

const INTEGRATION_ICONS: Record<string, string> = {
  clerk: "🔐",
  supabase: "🗄️",
  github: "🐙",
  vercel: "▲",
  r2: "☁️",
  stripe: "💳",
  gemini: "✨",
  openrouter: "🧠",
  groq: "⚡",
  openai: "🤖",
  anthropic: "🧬",
  terminal: "🖥️",
};

export function IntegrationCard({
  integration,
  onAction,
}: {
  integration: IntegrationStatus;
  onAction?: (actionId: string, actionType: string) => void;
}) {
  const { resolvedColors: T } = useTheme();
  const color = STATE_COLORS[integration.state];
  const label = STATE_LABELS[integration.state];
  const icon = INTEGRATION_ICONS[integration.id] ?? "🔌";

  return (
    <div
      className="rounded-xl border p-4"
      style={{
        background: T.boxBg,
        borderColor: `${T.borderColor}30`,
      }}
    >
      {/* Header */}
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div
            className="flex h-9 w-9 items-center justify-center rounded-lg text-lg"
            style={{ background: `${color}15` }}
          >
            {icon}
          </div>
          <div>
            <h3 className="text-sm font-bold" style={{ color: T.headerColor }}>
              {integration.displayName}
            </h3>
            <div className="flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: color }} />
              <span className="text-[10px] font-bold" style={{ color }}>
                {label}
              </span>
              {integration.category === "optional" && (
                <span className="text-[9px] text-white/30">· Optional</span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Three rows: Platform / User / Workspace */}
      <div className="space-y-1.5">
        <StatusRow
          label="Platform"
          value={integration.platformConfigured ? "Configured" : "Not configured"}
          ok={integration.platformConfigured}
          color={color}
        />
        <StatusRow
          label={integration.category === "runtime" ? "Server" : "Account"}
          value={
            integration.category === "runtime"
              ? integration.userConnected
                ? "Reachable"
                : "Unreachable"
              : integration.userConnected
                ? "Connected"
                : integration.category === "optional" && !integration.platformConfigured
                  ? "Not required"
                  : "Not connected"
          }
          ok={integration.userConnected}
          color={color}
        />
        <StatusRow
          label="Workspace"
          value={
            integration.workspaceReady
              ? "Ready"
              : integration.state === "needs_setup"
                ? "Needs repository"
                : integration.state === "platform_configured"
                  ? "Health not verified"
                  : "Not ready"
          }
          ok={integration.workspaceReady}
          color={color}
        />
      </div>

      {/* Details */}
      {integration.details && (
        <p className="mt-2.5 text-[10px] leading-4 text-white/40">{integration.details}</p>
      )}

      {/* Actions */}
      {integration.actions.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {integration.actions.map((action) => (
            <button
              key={action.id}
              type="button"
              onClick={() => onAction?.(action.id, action.type)}
              className="rounded-lg border px-2.5 py-1.5 text-[10px] font-bold transition-all hover:opacity-80"
              style={{
                borderColor:
                  action.type === "disconnect" || action.type === "remove_key"
                    ? "rgba(239,68,68,0.2)"
                    : `${T.accentColor}30`,
                color:
                  action.type === "disconnect" || action.type === "remove_key"
                    ? "#ef4444"
                    : T.accentColor,
                backgroundColor:
                  action.type === "disconnect" || action.type === "remove_key"
                    ? "rgba(239,68,68,0.05)"
                    : `${T.accentColor}08`,
              }}
            >
              {action.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function StatusRow({
  label,
  value,
  ok,
  color,
}: {
  label: string;
  value: string;
  ok: boolean;
  color: string;
}) {
  return (
    <div className="flex items-center justify-between text-[11px]">
      <span className="text-white/40">{label}</span>
      <div className="flex items-center gap-1.5">
        <span
          className="h-1 w-1 rounded-full"
          style={{ backgroundColor: ok ? "#22c55e" : color }}
        />
        <span style={{ color: ok ? "#22c55e" : "rgba(255,255,255,0.6)" }}>{value}</span>
      </div>
    </div>
  );
}

export function IntegrationSummaryBar({
  summary,
}: {
  summary: IntegrationStatusResponse["summary"];
}) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      <SummaryItem label="Platform ready" value={summary.platformReady} color="#22c55e" />
      <SummaryItem label="Needs config" value={summary.platformNeedsConfig} color="#f59e0b" />
      <SummaryItem label="User connected" value={summary.userConnected} color="#3b82f6" />
      <SummaryItem label="Workspace ready" value={summary.workspaceReady} color="#22c55e" />
    </div>
  );
}

function SummaryItem({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="rounded-lg border border-white/5 bg-black/20 px-3 py-2">
      <div className="text-lg font-black" style={{ color }}>
        {value}
      </div>
      <div className="text-[10px] text-white/40">{label}</div>
    </div>
  );
}
