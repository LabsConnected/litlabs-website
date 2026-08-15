"use client";

export const dynamic = "force-dynamic";

import { useEffect, useMemo, useRef, useState } from "react";
import { useTheme } from "@/context/ThemeContext";
import { useClerkAuth } from "@/hooks/useClerkAuth";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  Activity,
  Database,
  Sparkles,
  Users,
  Wallet,
  BarChart3,
  Layers3,
} from "lucide-react";
import GalaxyMap, { type GalaxyNode } from "@/components/GalaxyMap";
import TelemetryPanel, { type TelemetryData } from "@/components/TelemetryPanel";
import EventStream, { type AdminEvent } from "@/components/EventStream";

const ADMIN_USER_ID = "user_litbit";

type LivePayload =
  | { type: "stats"; payload: TelemetryData }
  | { type: "event"; payload: AdminEvent }
  | { type: "ping" };

const DEFAULT_STATS: TelemetryData = {
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

export default function AdminDashboard() {
  const { resolvedColors: T } = useTheme();
  const { userId, isLoaded, isSignedIn } = useClerkAuth();
  const router = useRouter();

  const [stats, setStats] = useState<TelemetryData>(DEFAULT_STATS);
  const [events, setEvents] = useState<AdminEvent[]>([]);
  const [selectedNode, setSelectedNode] = useState<GalaxyNode | null>(null);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const eventSourceRef = useRef<EventSource | null>(null);

  useEffect(() => {
    if (isLoaded && (!isSignedIn || userId !== ADMIN_USER_ID)) router.push("/");
  }, [isLoaded, isSignedIn, userId, router]);

  useEffect(() => {
    if (!isSignedIn || userId !== ADMIN_USER_ID) return;

    const connect = () => {
      const es = new EventSource("/api/admin/live");
      eventSourceRef.current = es;

      es.onopen = () => setIsConnected(true);
      es.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data) as LivePayload;
          if (data.type === "stats") {
            setStats(data.payload);
            setLastUpdate(new Date());
            return;
          }
          if (data.type === "event") {
            setEvents((prev) => [data.payload, ...prev].slice(0, 24));
            setLastUpdate(new Date());
          }
        } catch {
          // ignore parse errors
        }
      };
      es.onerror = () => {
        setIsConnected(false);
        es.close();
        window.setTimeout(connect, 5000);
      };
    };

    connect();

    return () => eventSourceRef.current?.close();
  }, [isSignedIn, userId]);

  const topKpis = useMemo(
    () => [
      { label: "Online", value: stats.onlineUsers, icon: Users, color: T.accentColor },
      { label: "Signups", value: stats.todaySignups, icon: Sparkles, color: "#34d399" },
      { label: "Revenue", value: stats.todayRevenueLBC.toLocaleString(), icon: Wallet, color: "#f59e0b" },
      { label: "Agents", value: stats.activeAgents, icon: Layers3, color: "#a78bfa" },
    ],
    [stats, T.accentColor],
  );

  if (!isLoaded) {
    return (
      <div className="min-h-screen grid place-items-center" style={{ backgroundColor: T.bgColor, color: T.textMuted }}>
        Loading Admin Dashboard...
      </div>
    );
  }

  if (!isSignedIn || userId !== ADMIN_USER_ID) {
    return (
      <div className="min-h-screen grid place-items-center" style={{ backgroundColor: T.bgColor }}>
        <div className="text-center">
          <AlertCircle size={48} className="mx-auto mb-4" style={{ color: T.warning }} />
          <p style={{ color: T.textMuted }}>Access Denied - Admin Only</p>
        </div>
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
      <div className="mx-auto flex min-h-screen max-w-[1800px] flex-col gap-4">
        <header
          className="rounded-3xl border px-5 py-4 sm:px-6"
          style={{ backgroundColor: T.boxBg + "78", borderColor: T.borderColor + "24" }}
        >
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <div className="rounded-2xl border p-3" style={{ backgroundColor: T.accentColor + "12", borderColor: T.accentColor + "28" }}>
                <Activity size={22} style={{ color: T.accentColor }} />
              </div>
              <div>
                <div className="text-[10px] font-black uppercase tracking-[0.24em]" style={{ color: T.textMuted }}>
                  Live Admin Galaxy
                </div>
                <div className="mt-1 text-2xl font-black sm:text-3xl">Command center</div>
                <div className="mt-1 flex flex-wrap items-center gap-3 text-xs" style={{ color: T.textMuted }}>
                  <span className="inline-flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full" style={{ backgroundColor: isConnected ? "#22c55e" : T.warning, boxShadow: isConnected ? `0 0 8px #22c55e` : "none" }} />
                    {isConnected ? "Live connection" : "Reconnecting"}
                  </span>
                  <span>Last update: {lastUpdate ? lastUpdate.toLocaleTimeString() : "waiting..."}</span>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-3 rounded-2xl border px-4 py-3" style={{ backgroundColor: T.bgColor + "55", borderColor: T.borderColor + "22" }}>
              <Database size={16} style={{ color: T.accentColor }} />
              <div>
                <div className="text-[10px] uppercase tracking-[0.2em]" style={{ color: T.textMuted }}>System Health</div>
                <div className="text-sm font-black" style={{ color: stats.systemHealth === "healthy" ? "#22c55e" : stats.systemHealth === "degraded" ? T.warning : "#ef4444" }}>
                  {stats.systemHealth.toUpperCase()}
                </div>
              </div>
            </div>
          </div>
        </header>

        <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px] min-h-0 flex-1">
          <div className="flex min-h-0 flex-col gap-4">
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              {topKpis.map((kpi) => {
                const Icon = kpi.icon;
                return (
                  <div key={kpi.label} className="rounded-3xl border p-4" style={{ backgroundColor: T.boxBg + "76", borderColor: T.borderColor + "24" }}>
                    <div className="flex items-center justify-between">
                      <Icon size={16} style={{ color: kpi.color }} />
                      <span className="text-[10px] uppercase tracking-[0.2em]" style={{ color: T.textMuted }}>
                        {kpi.label}
                      </span>
                    </div>
                    <div className="mt-3 text-3xl font-black">{kpi.value}</div>
                  </div>
                );
              })}
            </div>

            <div className="grid min-h-0 flex-1 gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
              <div className="min-h-[34rem]">
                <GalaxyMap
                  onNodeClick={(node) => setSelectedNode(node)}
                  nodes={[]}
                />
              </div>

              <aside className="rounded-3xl border p-4" style={{ backgroundColor: T.boxBg + "76", borderColor: T.borderColor + "24" }}>
                <div className="mb-4 flex items-center justify-between">
                  <div>
                    <div className="text-[10px] uppercase tracking-[0.2em]" style={{ color: T.textMuted }}>Selected node</div>
                    <div className="mt-1 text-lg font-black">{selectedNode ? selectedNode.label : "Core"}</div>
                  </div>
                  <BarChart3 size={18} style={{ color: T.accentColor }} />
                </div>
                <div className="space-y-4">
                  {selectedNode ? (
                    <div className="rounded-2xl border p-4" style={{ backgroundColor: T.bgColor + "55", borderColor: T.borderColor + "22" }}>
                      <div className="text-sm font-bold" style={{ color: T.textColor }}>{selectedNode.label}</div>
                      <div className="mt-2 text-xs" style={{ color: T.textMuted }}>{selectedNode.subtitle}</div>
                      <div className="mt-4 grid grid-cols-2 gap-2 text-xs">
                        <Info label="Type" value={selectedNode.type} />
                        <Info label="Status" value={selectedNode.status} />
                        <Info label="Connections" value={selectedNode.connections.length} />
                        <Info label="Metric" value={selectedNode.metric ?? 0} />
                      </div>
                    </div>
                  ) : (
                    <div className="rounded-2xl border p-4 text-sm" style={{ backgroundColor: T.bgColor + "55", borderColor: T.borderColor + "22", color: T.textMuted }}>
                      Click a node in the galaxy to inspect that area.
                    </div>
                  )}
                  <TelemetryPanel data={stats} lastUpdate={lastUpdate} connected={isConnected} />
                </div>
              </aside>
            </div>
          </div>

          <aside className="min-h-0 rounded-3xl border p-4" style={{ backgroundColor: T.boxBg + "76", borderColor: T.borderColor + "24" }}>
            <EventStream
              events={events}
              onClear={() => setEvents([])}
            />
          </aside>
        </section>
      </div>
    </div>
  );
}

function Info({ label, value }: { label: string; value: number | string }) {
  const { resolvedColors: T } = useTheme();
  return (
    <div className="rounded-xl border px-3 py-2" style={{ backgroundColor: T.bgColor + "55", borderColor: T.borderColor + "22" }}>
      <div className="text-[10px] uppercase tracking-[0.18em]" style={{ color: T.textMuted }}>{label}</div>
      <div className="mt-1 text-sm font-black" style={{ color: T.textColor }}>{value}</div>
    </div>
  );
}
