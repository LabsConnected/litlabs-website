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
  Bot,
  Image as ImageIcon,
  MessageSquare,
  Shield,
  Terminal,
  RefreshCw,
  Power,
  Bell,
  ArrowUpRight,
  ArrowDownRight,
  UserPlus,
  PieChart,
} from "lucide-react";
import GalaxyMap, { type GalaxyNode } from "@/components/GalaxyMap";
import TelemetryPanel, { type TelemetryData } from "@/components/TelemetryPanel";
import EventStream, { type AdminEvent } from "@/components/EventStream";

type LivePayload =
  | { type: "stats"; payload: TelemetryData }
  | { type: "event"; payload: AdminEvent }
  | { type: "ping" };

type SnapshotUser = {
  id: string;
  display_name: string | null;
  username: string | null;
  avatar_url: string | null;
  created_at: string;
  plan?: string | null;
  signup_source?: string | null;
  signup_referrer?: string | null;
  signup_landing_path?: string | null;
  signup_utm?: Record<string, string> | null;
};

type SnapshotAgent = {
  id: string;
  slug: string;
  name: string;
  display_name: string | null;
  category: string | null;
  status: string | null;
  created_at: string;
};

type SnapshotImage = {
  id: string;
  prompt: string | null;
  image_url: string | null;
  created_at: string;
};

type SnapshotConversation = {
  id: string;
  message: string | null;
  level: string | null;
  created_at: string;
  agent_name: string | null;
};

type Snapshot = {
  recentUsers: SnapshotUser[];
  signupSources: Array<{ name: string; count: number; color: string }>;
  topReferrers: Array<{ name: string; count: number }>;
  topLandingPaths: Array<{ name: string; count: number }>;
  topUtmCampaigns: Array<{ name: string; count: number }>;
  agents: SnapshotAgent[];
  recentImages: SnapshotImage[];
  recentConversations: SnapshotConversation[];
};

const DEFAULT_STATS: TelemetryData = {
  onlineUsers: 0,
  totalUsers: 0,
  todaySignups: 0,
  todaySales: 0,
  todayRevenueLBC: 0,
  activeAgents: 0,
  totalConversations: 0,
  systemHealth: "healthy",
  requestRate: 0,
  responseTime: 0,
  errorRate: 0,
};

export default function AdminDashboard() {
  const { resolvedColors: T } = useTheme();
  const { isLoaded, isSignedIn } = useClerkAuth();
  const router = useRouter();

  const [isAdmin, setIsAdmin] = useState(false);
  const [adminChecked, setAdminChecked] = useState(false);
  const [stats, setStats] = useState<TelemetryData>(DEFAULT_STATS);
  const [statsHistory, setStatsHistory] = useState<TelemetryData[]>([]);
  const [events, setEvents] = useState<AdminEvent[]>([]);
  const [selectedNode, setSelectedNode] = useState<GalaxyNode | null>(null);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [now, setNow] = useState<Date | null>(null);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);

  useEffect(() => {
    if (!isLoaded || !isSignedIn) return;
    fetch("/api/usage/check")
      .then((r) => r.json())
      .then((data) => {
        setIsAdmin(data?.role === "admin");
        setAdminChecked(true);
      })
      .catch(() => setAdminChecked(true));
  }, [isLoaded, isSignedIn]);

  useEffect(() => {
    if (!isAdmin) return;
    fetch("/api/admin/snapshot")
      .then((r) => r.json())
      .then((data: Snapshot) => setSnapshot(data))
      .catch(() => {});
  }, [isAdmin]);

  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    if (adminChecked && (!isSignedIn || !isAdmin)) router.push("/");
  }, [adminChecked, isSignedIn, isAdmin, router]);

  useEffect(() => {
    if (!isAdmin) return;

    const connect = () => {
      const es = new EventSource("/api/admin/live");
      eventSourceRef.current = es;

      es.onopen = () => setIsConnected(true);
      es.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data) as LivePayload;
          if (data.type === "stats") {
            const next = data.payload;
            setStats(next);
            setStatsHistory((history) => [...history, next].slice(-20));
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
  }, [isAdmin]);

  const topKpis = useMemo(
    () => [
      { label: "Online", value: stats.onlineUsers, icon: Users, color: T.accentColor, key: "onlineUsers" as const },
      { label: "Total Users", value: stats.totalUsers.toLocaleString(), icon: UserPlus, color: "#60a5fa", key: "totalUsers" as const },
      { label: "Signups", value: stats.todaySignups, icon: Sparkles, color: "#34d399", key: "todaySignups" as const },
      { label: "Revenue", value: stats.todayRevenueLBC.toLocaleString(), icon: Wallet, color: "#f59e0b", key: "todayRevenueLBC" as const },
      { label: "Agents", value: stats.activeAgents, icon: Bot, color: "#a78bfa", key: "activeAgents" as const },
      { label: "Conversations", value: stats.totalConversations.toLocaleString(), icon: MessageSquare, color: "#f472b6", key: "totalConversations" as const },
    ],
    [stats, T.accentColor],
  );

  const trendFor = (key: keyof TelemetryData) => {
    if (statsHistory.length < 2) return 0;
    const values = statsHistory.map((s) => Number(s[key]) || 0);
    const first = values[0];
    const last = values[values.length - 1];
    if (!first) return 0;
    return Math.round(((last - first) / first) * 100);
  };

  if (!isLoaded) {
    return (
      <div className="min-h-screen grid place-items-center" style={{ backgroundColor: T.bgColor, color: T.textMuted }}>
        Loading Admin Dashboard...
      </div>
    );
  }

  if (!adminChecked || !isSignedIn || !isAdmin) {
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
                <div className="mt-1 text-2xl font-black sm:text-3xl">Command Center</div>
                <div className="mt-1 flex flex-wrap items-center gap-3 text-xs" style={{ color: T.textMuted }}>
                  <span className="inline-flex items-center gap-2 rounded-full border px-2.5 py-1" style={{ borderColor: isConnected ? "#22c55e40" : T.warning + "40", backgroundColor: isConnected ? "#22c55e12" : T.warning + "12" }}>
                    <span className="w-2 h-2 rounded-full animate-pulse" style={{ backgroundColor: isConnected ? "#22c55e" : T.warning, boxShadow: isConnected ? `0 0 8px #22c55e` : "none" }} />
                    <span style={{ color: isConnected ? "#22c55e" : T.warning }}>{isConnected ? "Live connection" : "Reconnecting"}</span>
                  </span>
                  <span>Last update: {lastUpdate ? lastUpdate.toLocaleTimeString() : "waiting..."}</span>
                  <span className="font-mono">{now ? now.toLocaleTimeString() : "--:--:--"}</span>
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

        <div className="rounded-2xl border px-4 py-3" style={{ backgroundColor: T.boxBg + "60", borderColor: T.borderColor + "24" }}>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[10px] font-black uppercase tracking-[0.2em] mr-2" style={{ color: T.textMuted }}>Quick Actions</span>
            <QuickAction icon={Terminal} label="Terminal" href="/admin/terminal" color={T.accentColor} />
            <QuickAction icon={RefreshCw} label="Refresh Data" onClick={() => window.location.reload()} color="#34d399" />
            <QuickAction icon={Bell} label="Broadcast" onClick={() => alert("Broadcast feature coming soon")} color="#f59e0b" />
            <QuickAction icon={Shield} label="Admin Settings" href="/settings" color="#a78bfa" />
            <QuickAction icon={Power} label="Studio" href="/studio" color="#f472b6" />
          </div>
        </div>

        <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px] min-h-0 flex-1">
          <div className="flex min-h-0 flex-col gap-4">
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
              {topKpis.map((kpi) => {
                const Icon = kpi.icon;
                const trend = trendFor(kpi.key);
                const spark = statsHistory.map((s) => Number(s[kpi.key]) || 0);
                return (
                  <div key={kpi.label} className="rounded-3xl border p-4" style={{ backgroundColor: T.boxBg + "76", borderColor: T.borderColor + "24" }}>
                    <div className="flex items-center justify-between">
                      <Icon size={16} style={{ color: kpi.color }} />
                      <span className="text-[10px] uppercase tracking-[0.2em]" style={{ color: T.textMuted }}>{kpi.label}</span>
                    </div>
                    <div className="mt-2 flex items-end justify-between gap-3">
                      <div className="text-3xl font-black">{kpi.value}</div>
                      {trend !== 0 && (
                        <div className="flex items-center gap-1 text-[10px] font-black" style={{ color: trend > 0 ? "#22c55e" : "#ef4444" }}>
                          {trend > 0 ? <ArrowUpRight size={12} /> : <ArrowDownRight size={12} />}
                          {Math.abs(trend)}%
                        </div>
                      )}
                    </div>
                    <div className="mt-3 h-8">
                      <Sparkline data={spark} color={kpi.color} />
                    </div>
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

        <section className="grid gap-4 lg:grid-cols-4">
          {/* Signup Sources */}
          <div className="rounded-3xl border p-4" style={{ backgroundColor: T.boxBg + "76", borderColor: T.borderColor + "24" }}>
            <div className="mb-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <PieChart size={14} style={{ color: "#60a5fa" }} />
                <div className="text-xs font-black uppercase tracking-[0.2em]" style={{ color: T.textMuted }}>Signup Sources</div>
              </div>
              <span className="text-[10px] font-mono" style={{ color: T.textMuted }}>{snapshot?.recentUsers.length ?? 0}</span>
            </div>
            <div className="space-y-2 max-h-64 overflow-auto pr-1">
              {!snapshot?.signupSources.length ? (
                <div className="rounded-2xl border p-4 text-sm text-center" style={{ backgroundColor: T.bgColor + "55", borderColor: T.borderColor + "22", color: T.textMuted }}>No attribution data yet</div>
              ) : (
                <>
                  <div className="space-y-1.5">
                    {snapshot.signupSources.map((source) => (
                      <div key={source.name} className="flex items-center gap-2">
                        <div className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: source.color }} />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between text-xs">
                            <span className="font-bold truncate" style={{ color: T.textColor }}>{source.name}</span>
                            <span className="font-mono" style={{ color: T.textMuted }}>{source.count}</span>
                          </div>
                          <div className="h-1.5 w-full rounded-full overflow-hidden" style={{ backgroundColor: T.bgColor + "55" }}>
                            <div
                              className="h-full rounded-full"
                              style={{ width: `${Math.max(8, (source.count / Math.max(...snapshot.signupSources.map((s) => s.count))) * 100)}%`, backgroundColor: source.color }}
                            />
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>

                  {snapshot.topReferrers.length > 0 && (
                    <div className="pt-2 border-t" style={{ borderColor: T.borderColor + "22" }}>
                      <div className="text-[10px] font-black uppercase tracking-[0.2em] mb-1.5" style={{ color: T.textMuted }}>Top Referrers</div>
                      <div className="space-y-1">
                        {snapshot.topReferrers.slice(0, 3).map((ref) => (
                          <div key={ref.name} className="flex items-center justify-between text-[11px]">
                            <span className="truncate" style={{ color: T.textColor }}>{ref.name}</span>
                            <span className="font-mono" style={{ color: T.textMuted }}>{ref.count}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {snapshot.topLandingPaths.length > 0 && (
                    <div className="pt-2 border-t" style={{ borderColor: T.borderColor + "22" }}>
                      <div className="text-[10px] font-black uppercase tracking-[0.2em] mb-1.5" style={{ color: T.textMuted }}>Top Landing Pages</div>
                      <div className="space-y-1">
                        {snapshot.topLandingPaths.slice(0, 3).map((lp) => (
                          <div key={lp.name} className="flex items-center justify-between text-[11px]">
                            <span className="truncate font-mono" style={{ color: T.textColor }}>{lp.name}</span>
                            <span className="font-mono" style={{ color: T.textMuted }}>{lp.count}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>

          <div className="rounded-3xl border p-4" style={{ backgroundColor: T.boxBg + "76", borderColor: T.borderColor + "24" }}>
            <div className="mb-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <UserPlus size={14} style={{ color: "#60a5fa" }} />
                <div className="text-xs font-black uppercase tracking-[0.2em]" style={{ color: T.textMuted }}>Recent Users</div>
              </div>
              <span className="text-[10px] font-mono" style={{ color: T.textMuted }}>{snapshot?.recentUsers.length ?? 0}</span>
            </div>
            <div className="space-y-2 max-h-64 overflow-auto pr-1">
              {!snapshot?.recentUsers.length ? (
                <div className="rounded-2xl border p-4 text-sm text-center" style={{ backgroundColor: T.bgColor + "55", borderColor: T.borderColor + "22", color: T.textMuted }}>No recent users</div>
              ) : (
                snapshot.recentUsers.map((user) => (
                  <div key={user.id} className="flex items-center gap-3 rounded-2xl border p-3" style={{ backgroundColor: T.bgColor + "55", borderColor: T.borderColor + "22" }}>
                    <div className="w-9 h-9 rounded-full flex items-center justify-center text-sm font-black" style={{ backgroundColor: T.accentColor + "20", color: T.accentColor }}>
                      {user.display_name?.[0] ?? user.username?.[0] ?? "U"}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-bold truncate" style={{ color: T.textColor }}>{user.display_name || user.username || "User"}</div>
                      <div className="text-[10px]" style={{ color: T.textMuted }}>{formatTimeAgo(user.created_at)} · {user.plan || "free"}</div>
                      <div className="mt-1 flex flex-wrap gap-1">
                        <MiniTag label={user.signup_source || "direct"} color="#60a5fa" />
                        {user.signup_landing_path && <MiniTag label={user.signup_landing_path} color="#34d399" />}
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="rounded-3xl border p-4" style={{ backgroundColor: T.boxBg + "76", borderColor: T.borderColor + "24" }}>
            <div className="mb-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Bot size={14} style={{ color: "#a78bfa" }} />
                <div className="text-xs font-black uppercase tracking-[0.2em]" style={{ color: T.textMuted }}>Agent Fleet</div>
              </div>
              <span className="text-[10px] font-mono" style={{ color: T.textMuted }}>{snapshot?.agents.length ?? 0}</span>
            </div>
            <div className="space-y-2 max-h-64 overflow-auto pr-1">
              {!snapshot?.agents.length ? (
                <div className="rounded-2xl border p-4 text-sm text-center" style={{ backgroundColor: T.bgColor + "55", borderColor: T.borderColor + "22", color: T.textMuted }}>No agents found</div>
              ) : (
                snapshot.agents.map((agent) => (
                  <div key={agent.id} className="flex items-center justify-between rounded-2xl border p-3" style={{ backgroundColor: T.bgColor + "55", borderColor: T.borderColor + "22" }}>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-bold truncate" style={{ color: T.textColor }}>{agent.display_name || agent.name}</div>
                      <div className="text-[10px]" style={{ color: T.textMuted }}>{agent.category || "general"}</div>
                    </div>
                    <span className="w-2 h-2 rounded-full" style={{ backgroundColor: agent.status === "active" ? "#22c55e" : "#f59e0b", boxShadow: agent.status === "active" ? "0 0 6px #22c55e" : "none" }} />
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="rounded-3xl border p-4" style={{ backgroundColor: T.boxBg + "76", borderColor: T.borderColor + "24" }}>
            <div className="mb-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <ImageIcon size={14} style={{ color: "#f472b6" }} />
                <div className="text-xs font-black uppercase tracking-[0.2em]" style={{ color: T.textMuted }}>Recent Media</div>
              </div>
              <span className="text-[10px] font-mono" style={{ color: T.textMuted }}>{snapshot?.recentImages.length ?? 0}</span>
            </div>
            <div className="grid grid-cols-3 gap-2 max-h-64 overflow-auto pr-1">
              {!snapshot?.recentImages.length ? (
                <div className="col-span-3 rounded-2xl border p-4 text-sm text-center" style={{ backgroundColor: T.bgColor + "55", borderColor: T.borderColor + "22", color: T.textMuted }}>No recent media</div>
              ) : (
                snapshot.recentImages.map((img) => (
                  <div key={img.id} className="group relative aspect-square rounded-2xl border overflow-hidden" style={{ backgroundColor: T.bgColor + "55", borderColor: T.borderColor + "22" }}>
                    {img.image_url ? (
                      <img src={img.image_url} alt={img.prompt ?? ""} className="h-full w-full object-cover transition group-hover:scale-105" loading="lazy" />
                    ) : (
                      <div className="h-full w-full flex items-center justify-center">
                        <ImageIcon size={18} style={{ color: T.textMuted }} />
                      </div>
                    )}
                    <div className="absolute inset-x-0 bottom-0 bg-linear-to-t from-black/80 to-transparent p-2 opacity-0 group-hover:opacity-100 transition">
                      <div className="text-[9px] line-clamp-2" style={{ color: "#fff" }}>{img.prompt || "Generated image"}</div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
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

function MiniTag({ label, color }: { label: string; color: string }) {
  return (
    <span className="max-w-[10rem] truncate rounded-full border px-2 py-0.5 text-[9px] font-bold" style={{ borderColor: color + "40", color, backgroundColor: color + "10" }} title={label}>
      {label}
    </span>
  );
}

function QuickAction({ icon: Icon, label, href, onClick, color }: { icon: React.ComponentType<{ size?: number; className?: string }>; label: string; href?: string; onClick?: () => void; color: string }) {
  const className = "flex items-center gap-2 rounded-xl border px-3 py-2 text-[10px] font-black uppercase transition hover:scale-[1.02]";
  const style = { backgroundColor: color + "12", borderColor: color + "40", color };
  const children = (
    <>
      <Icon size={12} />
      {label}
    </>
  );
  if (href) {
    return (
      <a href={href} className={className} style={style}>
        {children}
      </a>
    );
  }
  return (
    <button onClick={onClick} className={className} style={style}>
      {children}
    </button>
  );
}

function Sparkline({ data, color }: { data: number[]; color: string }) {
  const { resolvedColors: T } = useTheme();
  if (data.length < 2) {
    return <div className="h-full w-full rounded-lg" style={{ backgroundColor: T.borderColor + "16" }} />;
  }
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const width = 100;
  const height = 32;
  const points = data.map((v, i) => {
    const x = (i / (data.length - 1)) * width;
    const y = height - ((v - min) / range) * height;
    return `${x},${y}`;
  }).join(" ");
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="h-full w-full" preserveAspectRatio="none">
      <polyline fill="none" stroke={color} strokeWidth="2" points={points} strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={width} cy={height - ((data[data.length - 1] - min) / range) * height} r="2.5" fill={color} />
    </svg>
  );
}

function formatTimeAgo(value: string | Date) {
  const date = value instanceof Date ? value : new Date(value);
  const diff = Math.floor((Date.now() - date.getTime()) / 60000);
  if (diff < 1) return "Just now";
  if (diff < 60) return `${diff}m ago`;
  return `${Math.floor(diff / 60)}h ago`;
}
