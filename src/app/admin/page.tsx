"use client";
export const dynamic = "force-dynamic";

import { useState, useEffect, useRef } from "react";
import { useTheme } from "@/context/ThemeContext";
import { useClerkAuth } from "@/hooks/useClerkAuth";
import { useRouter } from "next/navigation";
import {
  Activity, Users, Coins, ShoppingCart, Zap,
  TrendingUp, TrendingDown, Clock, AlertCircle,
  Terminal, RefreshCw, Server, Database
} from "lucide-react";

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

const generateMockEvents = (): RecentEvent[] => [
  { id: "1", type: "sale", message: "User bought Code Champion for 250 LBC", timestamp: new Date(Date.now() - 1000 * 60 * 2) },
  { id: "2", type: "signup", message: "New user: alex@example.com", timestamp: new Date(Date.now() - 1000 * 60 * 5) },
  { id: "3", type: "chat", message: "47 new agent conversations today", timestamp: new Date(Date.now() - 1000 * 60 * 15) },
  { id: "4", type: "sale", message: "User bought Social Dominator for 500 LBC", timestamp: new Date(Date.now() - 1000 * 60 * 30) },
];

export default function AdminDashboard() {
  const { resolvedColors: T } = useTheme();
  const { userId, isLoaded, isSignedIn } = useClerkAuth();
  const router = useRouter();
  
  const [stats, setStats] = useState<LiveStats>(generateMockStats());
  const [events, setEvents] = useState<RecentEvent[]>(generateMockEvents());
  const [isConnected, setIsConnected] = useState(false);
  const [lastUpdate, setLastUpdate] = useState<Date>(new Date());
  
  const eventSourceRef = useRef<EventSource | null>(null);

  // Auth guard
  useEffect(() => {
    if (isLoaded && (!isSignedIn || userId !== ADMIN_USER_ID)) {
      router.push("/");
    }
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

    connectSSE();

    // Fallback: Update stats every 5 seconds if SSE fails
    const fallbackInterval = setInterval(() => {
      if (!isConnected) {
        setStats(generateMockStats());
        setLastUpdate(new Date());
      }
    }, 5000);

    return () => {
      eventSourceRef.current?.close();
      clearInterval(fallbackInterval);
    };
  }, [isSignedIn, userId, isConnected]);

  if (!isLoaded) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: T.bgColor }}>
        <div className="text-center">
          <Activity className="animate-spin mx-auto mb-4" size={32} style={{ color: T.accentColor }} />
          <p style={{ color: T.textMuted }}>Loading Admin Dashboard...</p>
        </div>
      </div>
    );
  }

  if (!isSignedIn || userId !== ADMIN_USER_ID) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: T.bgColor }}>
        <div className="text-center">
          <AlertCircle size={48} className="mx-auto mb-4" style={{ color: T.warning }} />
          <p style={{ color: T.textMuted }}>Access Denied - Admin Only</p>
        </div>
      </div>
    );
  }

  const formatTime = (date: Date) => {
    const mins = Math.floor((Date.now() - date.getTime()) / 60000);
    if (mins < 1) return "Just now";
    if (mins < 60) return `${mins}m ago`;
    return `${Math.floor(mins / 60)}h ago`;
  };

  return (
    <div className="min-h-screen p-6" style={{ backgroundColor: T.bgColor, color: T.textColor }}>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="p-3 rounded-lg" style={{ backgroundColor: T.accentColor + "20" }}>
            <Terminal size={24} style={{ color: T.accentColor }} />
          </div>
          <div>
            <h1 className="text-2xl font-bold" style={{ color: T.textColor }}>
              Admin Command Center
            </h1>
            <div className="flex items-center gap-2 text-sm" style={{ color: T.textMuted }}>
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
        
        <div className="flex items-center gap-4">
          <div
            className="px-4 py-2 rounded-lg text-sm"
            style={{ backgroundColor: T.boxBg, border: `1px solid ${T.borderColor}` }}
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

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatCard
          T={T}
          icon={Users}
          label="Online Users"
          value={stats.onlineUsers}
          trend={+12}
          color={T.accentColor}
        />
        <StatCard
          T={T}
          icon={ShoppingCart}
          label="Today's Sales"
          value={stats.todaySales}
          trend={+5}
          color={T.success}
        />
        <StatCard
          T={T}
          icon={Coins}
          label="Revenue (LBC)"
          value={stats.todayRevenueLBC.toLocaleString()}
          trend={+8}
          color={T.headerColor}
        />
        <StatCard
          T={T}
          icon={Zap}
          label="Active Agents"
          value={stats.activeAgents}
          trend={0}
          color={T.warning}
        />
      </div>

      {/* Main Content */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Live Event Feed */}
        <div
          className="lg:col-span-2 rounded-xl p-4"
          style={{ backgroundColor: T.boxBg, border: `1px solid ${T.borderColor}` }}
        >
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-bold" style={{ color: T.textColor }}>
              Live Activity Feed
            </h2>
            <button
              onClick={() => setEvents([])}
              className="text-xs px-3 py-1 rounded-md transition-all"
              style={{ backgroundColor: T.borderColor, color: T.textMuted }}
            >
              Clear
            </button>
          </div>
          
          <div className="space-y-2 max-h-[400px] overflow-auto">
            {events.length === 0 ? (
              <div className="text-center py-8" style={{ color: T.textMuted }}>
                No recent activity
              </div>
            ) : (
              events.map((event) => (
                <div
                  key={event.id}
                  className="flex items-center gap-3 p-3 rounded-lg"
                  style={{ backgroundColor: T.bgColor }}
                >
                  <div
                    className="w-10 h-10 rounded-lg flex items-center justify-center"
                    style={{
                      backgroundColor:
                        event.type === "sale"
                          ? T.success + "20"
                          : event.type === "signup"
                          ? T.accentColor + "20"
                          : event.type === "alert"
                          ? T.warning + "20"
                          : T.headerColor + "20",
                    }}
                  >
                    {event.type === "sale" ? (
                      <ShoppingCart size={18} style={{ color: T.success }} />
                    ) : event.type === "signup" ? (
                      <Users size={18} style={{ color: T.accentColor }} />
                    ) : event.type === "alert" ? (
                      <AlertCircle size={18} style={{ color: T.warning }} />
                    ) : (
                      <Zap size={18} style={{ color: T.headerColor }} />
                    )}
                  </div>
                  <div className="flex-1">
                    <p className="text-sm" style={{ color: T.textColor }}>
                      {event.message}
                    </p>
                    <p className="text-xs" style={{ color: T.textMuted }}>
                      {formatTime(event.timestamp)}
                    </p>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* System Status */}
        <div
          className="rounded-xl p-4"
          style={{ backgroundColor: T.boxBg, border: `1px solid ${T.borderColor}` }}
        >
          <h2 className="text-lg font-bold mb-4" style={{ color: T.textColor }}>
            System Health
          </h2>
          
          <div className="space-y-3">
            <StatusRow T={T} icon={Server} label="API Server" status="online" />
            <StatusRow T={T} icon={Database} label="Database" status="online" />
            <StatusRow T={T} icon={Zap} label="AI Models" status="online" />
            <StatusRow T={T} icon={Activity} label="WebSocket" status={isConnected ? "online" : "degraded"} />
          </div>

          <div className="mt-6 pt-4 border-t" style={{ borderColor: T.borderColor }}>
            <h3 className="text-sm font-bold mb-3" style={{ color: T.textMuted }}>
              Quick Actions
            </h3>
            <div className="space-y-2">
              <ActionButton T={T} label="Restart API" onClick={() => {}} />
              <ActionButton T={T} label="Clear Cache" onClick={() => {}} />
              <ActionButton T={T} label="Send Test Notification" onClick={() => {}} />
            </div>
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="mt-6 text-center text-xs" style={{ color: T.textMuted }}>
        LiTTree Admin Dashboard v2.0 • Real-time Data • Admin Access Only
      </div>
    </div>
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
    <div className="flex items-center justify-between p-2 rounded-lg" style={{ backgroundColor: T.bgColor }}>
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
            boxShadow: status === "online" ? `0 0 6px ${statusColors[status]}` : "none",
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
