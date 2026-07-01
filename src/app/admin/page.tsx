"use client";
export const dynamic = "force-dynamic";

import { useState, useEffect, useRef } from "react";
import { useTheme } from "@/context/ThemeContext";
import { useClerkAuth } from "@/hooks/useClerkAuth";
import { useRouter } from "next/navigation";
import {
  Activity,
  Users,
  Coins,
  ShoppingCart,
  Zap,
  TrendingUp,
  TrendingDown,
  Clock,
  AlertCircle,
  Terminal,
  Server,
  Database,
  Key,
  Share2,
  Copy,
  Check,
  Plus,
  Trash2,
  Filter,
} from "lucide-react";
import GalaxyMap, { GalaxyNode } from "@/components/GalaxyMap";
import TelemetryPanel from "@/components/TelemetryPanel";
import EventStream, { Event } from "@/components/EventStream";
import ErrorBoundary from "@/components/ErrorBoundary";

// Admin-only guard
const ADMIN_USER_ID = "user_litbit";

interface LiveStats {
  onlineUsers: number;
  totalUsers: number;
  todaySignups: number;
  todaySales: number;
  todayRevenueLBC: number;
  activeAgents: number;
  totalConversations: number;
  systemHealth: "healthy" | "degraded" | "down";
}

interface RecentEvent {
  id: string;
  type: "sale" | "signup" | "chat" | "alert";
  message: string;
  timestamp: Date;
  data?: Record<string, unknown>;
}

// Mock data for now - will be replaced with real API calls
const generateMockStats = (): LiveStats => ({
  onlineUsers: Math.floor(Math.random() * 50) + 10,
  totalUsers: 1337,
  todaySignups: Math.floor(Math.random() * 10) + 1,
  todaySales: Math.floor(Math.random() * 20) + 5,
  todayRevenueLBC: Math.floor(Math.random() * 5000) + 1000,
  activeAgents: 6,
  totalConversations: 4521,
  systemHealth: "healthy",
});

const _now = Date.now();
const generateMockEvents = (): RecentEvent[] => [
  {
    id: "1",
    type: "sale",
    message: "User bought Code Champion for 250 LBC",
    timestamp: new Date(_now - 1000 * 60 * 2),
  },
  {
    id: "2",
    type: "signup",
    message: "New user: alex@example.com",
    timestamp: new Date(_now - 1000 * 60 * 5),
  },
  {
    id: "3",
    type: "chat",
    message: "47 new agent conversations today",
    timestamp: new Date(_now - 1000 * 60 * 15),
  },
  {
    id: "4",
    type: "sale",
    message: "User bought Social Dominator for 500 LBC",
    timestamp: new Date(Date.now() - 1000 * 60 * 30),
  },
];

export default function AdminDashboard() {
  const { resolvedColors: T } = useTheme();
  const { userId, isLoaded, isSignedIn } = useClerkAuth();
  const router = useRouter();

  const [stats, setStats] = useState<LiveStats>(generateMockStats());
  const [events, setEvents] = useState<RecentEvent[]>(generateMockEvents());
  const [galaxyNodes, setGalaxyNodes] = useState<GalaxyNode[]>([]);
  const [selectedNode, setSelectedNode] = useState<GalaxyNode | null>(null);
  const [filterType, setFilterType] = useState<string>("all");
  const [showFilters, setShowFilters] = useState(false);
  const [showTelemetry, setShowTelemetry] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [lastUpdate, setLastUpdate] = useState<Date>(new Date());

  // Invite codes state
  const [inviteCodes, setInviteCodes] = useState<{ id: string; label: string | null; max_uses: number; uses_count: number; expires_at: string | null; revoked_at: string | null; created_at: string }[]>([]);
  const [inviteLabel, setInviteLabel] = useState("");
  const [inviteMaxUses, setInviteMaxUses] = useState("5");
  const [newCode, setNewCode] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [inviteLoading, setInviteLoading] = useState(false);

  const copyText = (text: string, id: string) => {
    navigator.clipboard.writeText(text).catch(() => {});
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const loadInvites = async () => {
    try {
      const res = await fetch("/api/invites/list");
      if (res.ok) {
        const data = await res.json();
        setInviteCodes(data.codes || []);
      }
    } catch { /* silent */ }
  };

  const createInvite = async () => {
    setInviteLoading(true);
    try {
      const res = await fetch("/api/invites/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: inviteLabel.trim(), max_uses: Number(inviteMaxUses) || 1 }),
      });
      const data = await res.json();
      if (res.ok && data.code) {
        setNewCode(data.code);
        setInviteLabel("");
        await loadInvites();
      }
    } catch { /* silent */ } finally {
      setInviteLoading(false);
    }
  };

  const revokeInvite = async (id: string) => {
    try {
      await fetch("/api/invites/list", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      setInviteCodes((prev) => prev.filter((c) => c.id !== id));
    } catch { /* silent */ }
  };

  const eventSourceRef = useRef<EventSource | null>(null);

  // Auth guard
  useEffect(() => {
    if (isLoaded && (!isSignedIn || userId !== ADMIN_USER_ID)) {
      router.push("/");
    }
    if (isLoaded && isSignedIn && userId === ADMIN_USER_ID) {
      loadInvites();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoaded, isSignedIn, userId, router]);

  // Live data connection (SSE)
  useEffect(() => {
    if (!isSignedIn || userId !== ADMIN_USER_ID) return;

    const connectSSE = () => {
      const es = new EventSource("/api/admin/live");
      eventSourceRef.current = es;

      es.onopen = () => setIsConnected(true);

      es.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === "stats") {
            setStats(data.payload);
            setLastUpdate(new Date());
          } else if (data.type === "event") {
            setEvents((prev) => [data.payload, ...prev].slice(0, 50));
          } else if (data.type === "nodes") {
            setGalaxyNodes(data.payload);
          }
        } catch {
          // Ignore parse errors
        }
      };

      es.onerror = () => {
        setIsConnected(false);
        es.close();
        // Reconnect after 5 seconds
        setTimeout(connectSSE, 5000);
      };
    };

    const id = requestAnimationFrame(() => connectSSE());

    // Fallback: Update stats every 5 seconds if SSE fails
    const fallbackInterval = setInterval(() => {
      if (!isConnected) {
        setStats(generateMockStats());
        setLastUpdate(new Date());
      }
    }, 5000);

    return () => {
      cancelAnimationFrame(id);
      eventSourceRef.current?.close();
      clearInterval(fallbackInterval);
    };
  }, [isSignedIn, userId, isConnected]);

  if (!isLoaded) {
    return (
      <div
        className="min-h-screen flex items-center justify-center"
        style={{ backgroundColor: T.bgColor }}
      >
        <div className="text-center">
          <Activity
            className="animate-spin mx-auto mb-4"
            size={32}
            style={{ color: T.accentColor }}
          />
          <p style={{ color: T.textMuted }}>Loading Admin Dashboard...</p>
        </div>
      </div>
    );
  }

  if (!isSignedIn || userId !== ADMIN_USER_ID) {
    return (
      <div
        className="min-h-screen flex items-center justify-center"
        style={{ backgroundColor: T.bgColor }}
      >
        <div className="text-center">
          <AlertCircle
            size={48}
            className="mx-auto mb-4"
            style={{ color: T.warning }}
          />
          <p style={{ color: T.textMuted }}>Access Denied - Admin Only</p>
        </div>
      </div>
    );
  }

  const formatTime = (date: Date) => {
    const mins = Math.floor((_now - date.getTime()) / 60000);
    if (mins < 1) return "Just now";
    if (mins < 60) return `${mins}m ago`;
    return `${Math.floor(mins / 60)}h ago`;
  };

  return (
    <ErrorBoundary>
      <div
        className="min-h-screen p-6"
        style={{ backgroundColor: T.bgColor, color: T.textColor }}
      >
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div
            className="p-3 rounded-lg"
            style={{ backgroundColor: T.accentColor + "20" }}
          >
            <Terminal size={24} style={{ color: T.accentColor }} />
          </div>
          <div>
            <h1 className="text-xl md:text-2xl font-bold" style={{ color: T.textColor }}>
              Admin Command Center
            </h1>
            <div
              className="flex items-center gap-2 text-sm"
              style={{ color: T.textMuted }}
            >
              <span
                className="w-2 h-2 rounded-full"
                style={{
                  backgroundColor: isConnected ? T.success : T.warning,
                  boxShadow: isConnected ? `0 0 8px ${T.success}` : "none",
                }}
              />
              {isConnected ? "Live Connection" : "Disconnected"}
              <span className="mx-2">•</span>
              <Clock size={14} />
              Last update: {formatTime(lastUpdate)}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Mobile Filter Toggle */}
          <button
            onClick={() => setShowFilters(!showFilters)}
            className="md:hidden p-2 rounded-lg"
            style={{ backgroundColor: T.boxBg + "40", color: T.textMuted }}
          >
            <Filter size={16} />
          </button>
          
          {/* Mobile Telemetry Toggle */}
          <button
            onClick={() => setShowTelemetry(!showTelemetry)}
            className="md:hidden p-2 rounded-lg"
            style={{ backgroundColor: T.boxBg + "40", color: T.textMuted }}
          >
            <Activity size={16} />
          </button>
          
          <div
            className="hidden md:flex items-center gap-4 px-4 py-2 rounded-lg text-sm"
            style={{
              backgroundColor: T.boxBg,
              border: `1px solid ${T.borderColor}`,
            }}
          >
            <span style={{ color: T.textMuted }}>System Status:</span>{" "}
            <span
              style={{
                color: stats.systemHealth === "healthy" ? T.success : T.warning,
                fontWeight: "bold",
              }}
            >
              {stats.systemHealth.toUpperCase()}
            </span>
          </div>
        </div>
      </div>

      {/* Main Content - Galaxy Map + Telemetry */}
      <div className="flex-1 flex flex-col md:flex-row overflow-hidden" style={{ minHeight: "600px" }}>
        {/* Left Filter Rail - Collapsible on Mobile */}
        <div className={`${showFilters ? "block" : "hidden"} md:block w-full md:w-56 border-b md:border-r overflow-y-auto absolute md:relative z-20 h-full`}
          style={{ borderColor: T.borderColor + "20", backgroundColor: T.boxBg + "80" }}>
          <div className="p-4 space-y-4">
            {/* Mobile Close Button */}
            <div className="md:hidden flex items-center justify-between mb-4">
              <div className="text-sm font-black" style={{ color: T.textColor }}>Filters</div>
              <button
                onClick={() => setShowFilters(false)}
                className="p-2 rounded-lg"
                style={{ color: T.textMuted }}
              >
                ×
              </button>
            </div>
            
            {/* Search */}
            <div>
              <div className="text-[10px] font-bold uppercase tracking-widest mb-2" style={{ color: T.textMuted }}>
                Search
              </div>
              <input
                type="text"
                placeholder="Search nodes..."
                className="w-full px-3 py-2 rounded-lg text-sm outline-none"
                style={{ backgroundColor: T.bgColor + "40", border: "1px solid " + T.borderColor + "30", color: T.textColor }}
              />
            </div>

            {/* Zone Filters */}
            <div>
              <div className="text-[10px] font-bold uppercase tracking-widest mb-2" style={{ color: T.textMuted }}>
                Zones
              </div>
              <div className="space-y-1">
                {["All", "Studio", "Marketplace", "Social", "Agents"].map((zone) => (
                  <button
                    key={zone}
                    className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-bold transition-all hover:scale-105 text-left"
                    style={{
                      backgroundColor: "transparent",
                      color: T.textMuted,
                    }}
                  >
                    <div className="w-2 h-2 rounded-full" style={{ backgroundColor: T.accentColor }} />
                    {zone}
                  </button>
                ))}
              </div>
            </div>

            {/* Node Type Filters */}
            <div>
              <div className="text-[10px] font-bold uppercase tracking-widest mb-2" style={{ color: T.textMuted }}>
                Node Types
              </div>
              <div className="space-y-1">
                {[
                  { id: "all", label: "All Nodes", color: T.accentColor },
                  { id: "agent", label: "Agents", color: "#22c55e" },
                  { id: "user", label: "Users", color: "#8b5cf6" },
                  { id: "server", label: "Servers", color: "#f97316" },
                  { id: "database", label: "Databases", color: "#10b981" },
                ].map((type) => (
                  <button
                    key={type.id}
                    onClick={() => setFilterType(type.id)}
                    className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-bold transition-all hover:scale-105 text-left"
                    style={{
                      backgroundColor: filterType === type.id ? T.accentColor + "15" : "transparent",
                      color: filterType === type.id ? T.accentColor : T.textMuted,
                      border: filterType === type.id ? "1px solid " + T.accentColor + "30" : "transparent",
                    }}
                  >
                    <div className="w-2 h-2 rounded-full" style={{ backgroundColor: type.color }} />
                    {type.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Status Filters */}
            <div>
              <div className="text-[10px] font-bold uppercase tracking-widest mb-2" style={{ color: T.textMuted }}>
                Status
              </div>
              <div className="space-y-1">
                {[
                  { id: "all", label: "All Status" },
                  { id: "active", label: "Active", color: "#22c55e" },
                  { id: "idle", label: "Idle", color: "#f59e0b" },
                  { id: "offline", label: "Offline", color: "#6b7280" },
                ].map((status) => (
                  <button
                    key={status.id}
                    className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-bold transition-all hover:scale-105 text-left"
                    style={{
                      backgroundColor: "transparent",
                      color: T.textMuted,
                    }}
                  >
                    <div className="w-2 h-2 rounded-full" style={{ backgroundColor: status.color || T.accentColor }} />
                    {status.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Quick Stats */}
            <div className="pt-4 border-t" style={{ borderColor: T.borderColor + "20" }}>
              <div className="text-[10px] font-bold uppercase tracking-widest mb-2" style={{ color: T.textMuted }}>
                Quick Stats
              </div>
              <div className="space-y-2 text-xs" style={{ color: T.textMuted }}>
                <div className="flex justify-between">
                  <span>Total Nodes</span>
                  <span style={{ color: T.textColor }}>{galaxyNodes.length}</span>
                </div>
                <div className="flex justify-between">
                  <span>Active</span>
                  <span style={{ color: "#22c55e" }}>{galaxyNodes.filter(n => n.status === "active").length}</span>
                </div>
                <div className="flex justify-between">
                  <span>Agents</span>
                  <span style={{ color: T.textColor }}>{galaxyNodes.filter(n => n.type === "agent").length}</span>
                </div>
                <div className="flex justify-between">
                  <span>Users</span>
                  <span style={{ color: T.textColor }}>{galaxyNodes.filter(n => n.type === "user").length}</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Galaxy Map - Centerpiece */}
        <div className="flex-1 relative" style={{ backgroundColor: T.bgColor }}>
          <div className="absolute top-4 left-4 z-10 flex items-center gap-2">
            <div className="px-3 py-1.5 rounded-lg text-xs font-bold" style={{ backgroundColor: T.accentColor + "20", color: T.accentColor }}>
              Live Galaxy Map
            </div>
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs" style={{ backgroundColor: T.boxBg + "60", color: T.textMuted }}>
              <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
              <span>Real-time</span>
            </div>
          </div>
          
          <GalaxyMap 
            nodes={galaxyNodes} 
            interactive={true} 
            filterType={filterType}
            onNodeClick={setSelectedNode}
          />
          
          {/* Node Details Panel - Drill-Down Inspector */}
          {selectedNode && (
            <div className="absolute top-20 right-4 w-80 p-4 rounded-2xl border z-10"
              style={{ backgroundColor: T.boxBg + "90", borderColor: T.borderColor + "30" }}>
              <div className="flex items-center justify-between mb-3">
                <div className="text-sm font-black" style={{ color: T.textColor }}>{selectedNode.label}</div>
                <button
                  onClick={() => setSelectedNode(null)}
                  className="p-1 rounded-lg transition-all hover:scale-110"
                  style={{ color: T.textMuted }}
                >
                  ×
                </button>
              </div>
              
              {/* Node Info */}
              <div className="space-y-2 mb-4 pb-4 border-b" style={{ borderColor: T.borderColor + "20" }}>
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full" style={{ backgroundColor: selectedNode.color }} />
                  <span className="text-xs" style={{ color: T.textMuted }}>
                    {selectedNode.type.charAt(0).toUpperCase() + selectedNode.type.slice(1)}
                  </span>
                  <span className="text-xs" style={{ color: T.textMuted }}>•</span>
                  <span className="text-xs font-bold" style={{ 
                    color: selectedNode.status === "active" ? "#22c55e" : 
                          selectedNode.status === "idle" ? "#f59e0b" : "#6b7280" 
                  }}>
                    {selectedNode.status.toUpperCase()}
                  </span>
                </div>
                <div className="text-xs" style={{ color: T.textMuted }}>
                  Connections: {selectedNode.connections.length}
                </div>
                {selectedNode.data && (
                  <div className="mt-2 pt-2 border-t" style={{ borderColor: T.borderColor + "20" }}>
                    <div className="text-[10px] font-bold mb-1" style={{ color: T.textColor }}>Metadata:</div>
                    {Object.entries(selectedNode.data).map(([key, value]) => (
                  <div key={key} className="text-[10px]" style={{ color: T.textMuted }}>
                    {key}: {String(value)}
                  </div>
                ))}
                  </div>
                )}
              </div>

              {/* Recent Activity */}
              <div className="mb-4 pb-4 border-b" style={{ borderColor: T.borderColor + "20" }}>
                <div className="text-[10px] font-bold uppercase tracking-widest mb-2" style={{ color: T.textMuted }}>
                  Recent Activity
                </div>
                <div className="space-y-2">
                  {[
                    { time: "2m ago", action: "Task completed", status: "success" },
                    { time: "15m ago", action: "Connection established", status: "success" },
                    { time: "1h ago", action: "Status check", status: "info" },
                  ].map((activity, i) => (
                    <div key={i} className="flex items-center gap-2 text-[10px]">
                      <div className="w-1.5 h-1.5 rounded-full" style={{ 
                        backgroundColor: activity.status === "success" ? "#22c55e" : "#8b5cf6" 
                      }} />
                      <span style={{ color: T.textMuted }}>{activity.time}</span>
                      <span style={{ color: T.textColor }}>{activity.action}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Quick Actions */}
              <div>
                <div className="text-[10px] font-bold uppercase tracking-widest mb-2" style={{ color: T.textMuted }}>
                  Actions
                </div>
                <div className="space-y-2">
                  <button className="w-full py-2 rounded-lg text-xs font-bold transition-all hover:scale-105"
                    style={{ backgroundColor: T.accentColor + "15", color: T.accentColor, border: "1px solid " + T.accentColor + "30" }}>
                    View Logs
                  </button>
                  <button className="w-full py-2 rounded-lg text-xs font-bold transition-all hover:scale-105"
                    style={{ backgroundColor: T.boxBg + "40", color: T.textColor, border: "1px solid " + T.borderColor + "30" }}>
                    Manage
                  </button>
                  <button className="w-full py-2 rounded-lg text-xs font-bold transition-all hover:scale-105"
                    style={{ backgroundColor: T.boxBg + "40", color: T.textMuted, border: "1px solid " + T.borderColor + "30" }}>
                    Inspect Data
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Right Rail - Telemetry & Events - Collapsible on Mobile */}
        <div className={`${showTelemetry ? "block" : "hidden"} md:block w-full md:w-80 border-t md:border-l overflow-y-auto absolute md:relative z-20 h-full`}
          style={{ borderColor: T.borderColor + "20", backgroundColor: T.boxBg + "80" }}>
          <div className="p-4 space-y-6">
            {/* Mobile Close Button */}
            <div className="md:hidden flex items-center justify-between mb-4">
              <div className="text-sm font-black" style={{ color: T.textColor }}>Telemetry</div>
              <button
                onClick={() => setShowTelemetry(false)}
                className="p-2 rounded-lg"
                style={{ color: T.textMuted }}
              >
                ×
              </button>
            </div>
            
            <TelemetryPanel data={{
              activeUsers: stats.onlineUsers,
              totalUsers: stats.totalUsers,
              agentRequests: stats.activeAgents,
              systemLoad: 34,
              responseTime: 245,
              errorRate: 0.02,
              uptime: 99.9,
              totalConversations: stats.totalConversations,
            }} />
            <div className="border-t pt-4" style={{ borderColor: T.borderColor + "20" }}>
              <EventStream 
                events={events.map(e => ({
                  id: e.id,
                  type: e.type as any,
                  message: e.message,
                  timestamp: e.timestamp,
                }))}
                maxEvents={10}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Invite Codes Panel */}
      <div
        className="mt-6 rounded-xl p-4"
        style={{ backgroundColor: T.boxBg, border: `1px solid ${T.borderColor}` }}
      >
        <div className="flex items-center gap-2 mb-4">
          <Share2 size={18} style={{ color: T.accentColor }} />
          <h2 className="text-lg font-bold" style={{ color: T.textColor }}>Invite Codes</h2>
        </div>

        {/* New code alert */}
        {newCode && (
          <div
            className="flex items-center gap-3 p-3 rounded-lg mb-4"
            style={{ backgroundColor: T.success + "15", border: `1px solid ${T.success}40` }}
          >
            <Key size={16} style={{ color: T.success }} />
            <span className="font-mono font-bold text-sm flex-1" style={{ color: T.success }}>
              {newCode}
            </span>
            <button
              onClick={() => copyText(newCode, "admin-new-code")}
              className="flex items-center gap-1 text-xs px-2 py-1 rounded"
              style={{ backgroundColor: T.success + "30", color: T.success }}
            >
              {copiedId === "admin-new-code" ? <Check size={12} /> : <Copy size={12} />}
              {copiedId === "admin-new-code" ? "Copied" : "Copy"}
            </button>
            <button
              onClick={() => setNewCode(null)}
              className="text-xs opacity-50 hover:opacity-80"
              style={{ color: T.textMuted }}
            >
              ×
            </button>
          </div>
        )}

        {/* Generate form */}
        <div className="flex flex-wrap gap-2 mb-4">
          <input
            value={inviteLabel}
            onChange={(e) => setInviteLabel(e.target.value)}
            placeholder="Label (e.g. Beta Wave 1)"
            className="flex-1 min-w-[160px] px-3 py-2 rounded-lg text-sm outline-none"
            style={{ backgroundColor: T.bgColor, border: `1px solid ${T.borderColor}`, color: T.textColor }}
          />
          <select
            value={inviteMaxUses}
            onChange={(e) => setInviteMaxUses(e.target.value)}
            className="px-3 py-2 rounded-lg text-sm outline-none"
            style={{ backgroundColor: T.bgColor, border: `1px solid ${T.borderColor}`, color: T.textColor }}
          >
            {[1, 5, 10, 25, 100].map((n) => (
              <option key={n} value={n}>{n} use{n > 1 ? "s" : ""}</option>
            ))}
          </select>
          <button
            onClick={createInvite}
            disabled={inviteLoading}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold transition-all hover:opacity-90 disabled:opacity-50"
            style={{ backgroundColor: T.accentColor, color: T.bgColor }}
          >
            <Plus size={14} />
            {inviteLoading ? "Generating…" : "Generate"}
          </button>
        </div>

        {/* Codes table */}
        {inviteCodes.length === 0 ? (
          <p className="text-sm" style={{ color: T.textMuted }}>No invite codes yet.</p>
        ) : (
          <div className="space-y-2">
            {inviteCodes.map((code) => (
              <div
                key={code.id}
                className="flex flex-wrap items-center gap-3 p-3 rounded-lg"
                style={{ backgroundColor: T.bgColor, opacity: code.revoked_at ? 0.5 : 1 }}
              >
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-bold" style={{ color: T.textColor }}>
                    {code.label || "Unlabeled"}
                  </div>
                  <div className="text-xs font-mono" style={{ color: T.textMuted }}>
                    {code.uses_count}/{code.max_uses} uses
                    {code.expires_at ? ` · expires ${new Date(code.expires_at).toLocaleDateString()}` : ""}
                    {code.revoked_at ? " · REVOKED" : ""}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {!code.revoked_at && (
                    <button
                      onClick={() => revokeInvite(code.id)}
                      className="flex items-center gap-1 text-xs px-2 py-1 rounded-lg hover:opacity-80"
                      style={{ border: "1px solid #ef444440", color: "#ef4444" }}
                    >
                      <Trash2 size={11} /> Revoke
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="mt-6 text-center text-xs" style={{ color: T.textMuted }}>
        LiTTree Admin Dashboard v2.0 • Real-time Data • Admin Access Only
      </div>
    </div>
    </ErrorBoundary>
  );
}

// Sub-components
function StatCard({
  T,
  icon: Icon,
  label,
  value,
  trend,
  color,
}: {
  T: ReturnType<typeof useTheme>["resolvedColors"];
  icon: typeof Activity;
  label: string;
  value: number | string;
  trend: number;
  color: string;
}) {
  return (
    <div
      className="p-4 rounded-xl transition-all hover:scale-[1.02]"
      style={{ backgroundColor: T.boxBg, border: `1px solid ${T.borderColor}` }}
    >
      <div className="flex items-center justify-between mb-2">
        <Icon size={20} style={{ color }} />
        {trend !== 0 && (
          <span
            className="text-xs flex items-center gap-1"
            style={{ color: trend > 0 ? T.success : T.warning }}
          >
            {trend > 0 ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
            {Math.abs(trend)}%
          </span>
        )}
      </div>
      <div className="text-2xl font-bold" style={{ color: T.textColor }}>
        {value}
      </div>
      <div className="text-xs" style={{ color: T.textMuted }}>
        {label}
      </div>
    </div>
  );
}

function StatusRow({
  T,
  icon: Icon,
  label,
  status,
}: {
  T: ReturnType<typeof useTheme>["resolvedColors"];
  icon: typeof Activity;
  label: string;
  status: "online" | "degraded" | "down";
}) {
  const statusColors = {
    online: T.success,
    degraded: T.warning,
    down: "#ff4444",
  };

  return (
    <div
      className="flex items-center justify-between p-2 rounded-lg"
      style={{ backgroundColor: T.bgColor }}
    >
      <div className="flex items-center gap-2">
        <Icon size={16} style={{ color: T.textMuted }} />
        <span className="text-sm" style={{ color: T.textColor }}>
          {label}
        </span>
      </div>
      <div className="flex items-center gap-1.5">
        <span
          className="w-2 h-2 rounded-full"
          style={{
            backgroundColor: statusColors[status],
            boxShadow:
              status === "online" ? `0 0 6px ${statusColors[status]}` : "none",
          }}
        />
        <span
          className="text-xs uppercase font-bold"
          style={{ color: statusColors[status] }}
        >
          {status}
        </span>
      </div>
    </div>
  );
}

function ActionButton({
  T,
  label,
  onClick,
}: {
  T: ReturnType<typeof useTheme>["resolvedColors"];
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="w-full text-left px-3 py-2 rounded-lg text-sm transition-all hover:opacity-80"
      style={{ backgroundColor: T.bgColor, color: T.textColor }}
    >
      {label}
    </button>
  );
}
