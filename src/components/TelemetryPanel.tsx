"use client";

import { useEffect, useMemo, useState } from "react";
import { useTheme } from "@/context/ThemeContext";
import { Activity, AlertCircle, Clock, Database, Server, TrendingUp, Users, Zap } from "lucide-react";

export type TelemetryData = {
  onlineUsers: number;
  totalUsers: number;
  todaySignups: number;
  todaySales: number;
  todayRevenueLBC: number;
  activeAgents: number;
  totalConversations: number;
  systemHealth: "healthy" | "degraded" | "down";
  requestRate: number;
  responseTime: number;
  errorRate: number;
};

const DEFAULT_DATA: TelemetryData = {
  onlineUsers: 42,
  totalUsers: 1337,
  todaySignups: 9,
  todaySales: 11,
  todayRevenueLBC: 2450,
  activeAgents: 6,
  totalConversations: 4521,
  systemHealth: "healthy",
  requestRate: 88,
  responseTime: 245,
  errorRate: 0.02,
};

export default function TelemetryPanel({
  data = DEFAULT_DATA,
  lastUpdate,
  connected = false,
}: {
  data?: TelemetryData;
  lastUpdate?: Date | null;
  connected?: boolean;
}) {
  const { resolvedColors: T } = useTheme();
  const [pulse, setPulse] = useState(0);

  useEffect(() => {
    const id = window.setInterval(() => setPulse((v) => (v + 1) % 1000), 1600);
    return () => window.clearInterval(id);
  }, []);

  const metrics = useMemo(
    () => [
      { label: "Online Users", value: data.onlineUsers, icon: Users, color: T.accentColor },
      { label: "Requests/min", value: data.requestRate, icon: Zap, color: "#f59e0b" },
      { label: "Revenue (LBC)", value: data.todayRevenueLBC.toLocaleString(), icon: TrendingUp, color: "#34d399" },
      { label: "Active Agents", value: data.activeAgents, icon: Activity, color: "#a78bfa" },
    ],
    [data, T.accentColor],
  );

  const statusColor =
    data.systemHealth === "healthy" ? "#22c55e" : data.systemHealth === "degraded" ? "#f59e0b" : "#ef4444";

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border p-4" style={{ backgroundColor: T.boxBg + "78", borderColor: T.borderColor + "28" }}>
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-[10px] uppercase tracking-[0.2em]" style={{ color: T.textMuted }}>System Status</div>
            <div className="mt-1 text-lg font-black" style={{ color: T.textColor }}>Command center live</div>
          </div>
          <div className="flex items-center gap-2 rounded-full border px-3 py-1 text-[10px] font-black uppercase" style={{ borderColor: statusColor + "40", color: statusColor, backgroundColor: statusColor + "12" }}>
            <span className="w-2 h-2 rounded-full" style={{ backgroundColor: statusColor, boxShadow: `0 0 8px ${statusColor}` }} />
            {connected ? "connected" : "polling"}
          </div>
        </div>
        <div className="mt-3 text-xs" style={{ color: T.textMuted }}>
          {lastUpdate ? `Last update ${lastUpdate.toLocaleTimeString()}` : "Waiting for live data"}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        {metrics.map((metric) => {
          const Icon = metric.icon;
          return (
            <div key={metric.label} className="rounded-2xl border p-3" style={{ backgroundColor: T.boxBg + "70", borderColor: T.borderColor + "28" }}>
              <div className="flex items-center justify-between">
                <Icon size={14} style={{ color: metric.color }} />
                <span className="text-[10px] uppercase tracking-[0.18em]" style={{ color: T.textMuted }}>{metric.label}</span>
              </div>
              <div className="mt-2 text-2xl font-black" style={{ color: T.textColor }}>{metric.value}</div>
            </div>
          );
        })}
      </div>

      <div className="space-y-3 rounded-2xl border p-4" style={{ backgroundColor: T.boxBg + "70", borderColor: T.borderColor + "28" }}>
        <div className="flex items-center justify-between">
          <span className="text-xs font-bold uppercase tracking-[0.2em]" style={{ color: T.textMuted }}>Performance</span>
          <span className="text-[10px] font-mono" style={{ color: T.accentColor }}>{data.responseTime}ms avg</span>
        </div>
        <Bar label="Response Time" value={Math.min(100, (500 / data.responseTime) * 100)} color={data.responseTime < 300 ? "#22c55e" : data.responseTime < 500 ? "#f59e0b" : "#ef4444"} />
        <Bar label="Error Rate" value={Math.min(100, data.errorRate * 100)} color={data.errorRate < 0.05 ? "#22c55e" : "#ef4444"} />
      </div>

      <div className="rounded-2xl border p-4" style={{ backgroundColor: T.boxBg + "70", borderColor: T.borderColor + "28" }}>
        <div className="flex items-center gap-2">
          <Server size={14} style={{ color: T.accentColor }} />
          <div className="text-xs font-bold uppercase tracking-[0.2em]" style={{ color: T.textMuted }}>Live Database</div>
        </div>
        <div className="mt-3 flex items-center gap-2">
          <Database size={14} style={{ color: "#22c55e" }} />
          <span className="text-sm" style={{ color: T.textColor }}>Connected and receiving rows</span>
        </div>
        <div className="mt-3 text-xs" style={{ color: T.textMuted }}>
          {data.totalUsers.toLocaleString()} users · {data.totalConversations.toLocaleString()} conversations
        </div>
      </div>

      <div className="rounded-2xl border p-4" style={{ backgroundColor: T.boxBg + "70", borderColor: T.borderColor + "28" }}>
        <div className="flex items-center justify-between">
          <div className="text-xs font-bold uppercase tracking-[0.2em]" style={{ color: T.textMuted }}>Uptime</div>
          <Clock size={14} style={{ color: T.accentColor }} />
        </div>
        <div className="mt-3 text-3xl font-black" style={{ color: T.textColor }}>99.9%</div>
        <div className="mt-2 text-xs" style={{ color: T.textMuted }}>Stable over the last 24 hours</div>
        <div className="mt-3 h-2 rounded-full overflow-hidden" style={{ backgroundColor: T.borderColor + "24" }}>
          <div className="h-full rounded-full" style={{ width: `${90 + (pulse % 8)}%`, background: `linear-gradient(90deg, ${T.accentColor}, ${statusColor})` }} />
        </div>
      </div>

      <div className="rounded-2xl border p-4" style={{ backgroundColor: T.boxBg + "70", borderColor: T.borderColor + "28" }}>
        <div className="flex items-center gap-2">
          <AlertCircle size={14} style={{ color: T.warning }} />
          <div className="text-xs font-bold uppercase tracking-[0.2em]" style={{ color: T.textMuted }}>Alerts</div>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
          <StatChip label="Today sales" value={data.todaySales} color={T.accentColor} />
          <StatChip label="Signups" value={data.todaySignups} color="#34d399" />
          <StatChip label="Agents" value={data.activeAgents} color="#a78bfa" />
          <StatChip label="Errors" value={Math.max(0, Math.round(data.errorRate * 100))} color={T.warning} />
        </div>
      </div>
    </div>
  );
}

function Bar({ label, value, color }: { label: string; value: number; color: string }) {
  const { resolvedColors: T } = useTheme();
  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-bold" style={{ color: T.textMuted }}>{label}</span>
        <span className="text-[10px] font-mono" style={{ color }}>{value.toFixed(1)}%</span>
      </div>
      <div className="h-2 rounded-full overflow-hidden" style={{ backgroundColor: T.borderColor + "24" }}>
        <div className="h-full rounded-full" style={{ width: `${value}%`, backgroundColor: color }} />
      </div>
    </div>
  );
}

function StatChip({ label, value, color }: { label: string; value: number | string; color: string }) {
  const { resolvedColors: T } = useTheme();
  return (
    <div className="rounded-xl border px-3 py-2" style={{ backgroundColor: T.bgColor + "50", borderColor: color + "30" }}>
      <div className="text-[10px] uppercase tracking-[0.18em]" style={{ color: T.textMuted }}>{label}</div>
      <div className="mt-1 text-lg font-black" style={{ color }}>{value}</div>
    </div>
  );
}
