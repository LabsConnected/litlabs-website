"use client";

import { useEffect, useState, useCallback } from "react";
import {
  CheckCircle2,
  XCircle,
  AlertCircle,
  RefreshCw,
  Server,
  Database,
  CreditCard,
  Bot,
} from "lucide-react";

function GitHubIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 2C6.477 2 2 6.477 2 12c0 4.42 2.87 8.17 6.84 9.5.5.08.66-.23.66-.5v-1.69c-2.77.6-3.36-1.34-3.36-1.34-.46-1.16-1.11-1.47-1.11-1.47-.91-.62.07-.6.07-.6 1 .07 1.53 1.03 1.53 1.03.87 1.52 2.34 1.07 2.91.83.09-.65.35-1.07.63-1.31-2.22-.25-4.55-1.11-4.55-4.92 0-1.11.38-2 1.03-2.71-.1-.25-.45-1.29.1-2.64 0 0 .84-.27 2.75 1.02.79-.22 1.65-.33 2.5-.33.85 0 1.71.11 2.5.33 1.91-1.29 2.75-1.02 2.75-1.02.55 1.35.2 2.39.1 2.64.65.71 1.03 1.6 1.03 2.71 0 3.82-2.34 4.66-4.57 4.91.36.31.69.92.69 1.85V21c0 .27.16.59.67.5C19.14 20.16 22 16.42 22 12A10 10 0 0 0 12 2z" />
    </svg>
  );
}

export type HealthCheck = {
  name: string;
  status: "ok" | "error" | "not_configured";
  message: string;
  latencyMs?: number;
};

type HealthResponse = {
  ok: boolean;
  checks: HealthCheck[];
  timestamp: string;
};

const ICONS: Record<string, React.ReactNode> = {
  github: <GitHubIcon size={14} />,
  supabase: <Database size={14} />,
  stripe: <CreditCard size={14} />,
  openrouter: <Bot size={14} />,
};

export default function StudioHealthPanel() {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/health/studio");
      if (!res.ok) throw new Error(`Health API ${res.status}`);
      const data = (await res.json()) as HealthResponse;
      setHealth(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load health");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="rounded-xl border border-white/10 bg-black/40 p-3 backdrop-blur-sm">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2 text-xs font-semibold text-white/80">
          <Server size={13} />
          Studio connections
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="text-white/50 hover:text-white transition-colors disabled:opacity-50"
          aria-label="Refresh health"
          title="Refresh"
        >
          <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
        </button>
      </div>

      {error && (
        <div className="text-[11px] text-rose-400 mb-2 flex items-center gap-1">
          <XCircle size={11} /> {error}
        </div>
      )}

      <div className="grid grid-cols-1 gap-1.5">
        {(health?.checks ?? []).map((check) => {
          const ok = check.status === "ok";
          const missing = check.status === "not_configured";
          const Icon = ok ? CheckCircle2 : missing ? AlertCircle : XCircle;
          const color = ok ? "text-emerald-400" : missing ? "text-amber-400" : "text-rose-400";
          return (
            <div
              key={check.name}
              className="flex items-center justify-between gap-2 text-[11px] rounded-md px-2 py-1.5 bg-white/3"
            >
              <div className="flex items-center gap-2">
                <span className="text-white/40">{ICONS[check.name] ?? <Server size={14} />}</span>
                <span className="capitalize text-white/70">{check.name}</span>
              </div>
              <div className={`flex items-center gap-1 ${color}`}>
                <Icon size={11} />
                <span className="hidden sm:inline">{check.message}</span>
                {check.latencyMs !== undefined && (
                  <span className="text-white/30 ml-1">{check.latencyMs}ms</span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {health && (
        <div className="mt-2 text-[10px] text-white/30 text-right">
          Checked {new Date(health.timestamp).toLocaleTimeString()}
        </div>
      )}
    </div>
  );
}
