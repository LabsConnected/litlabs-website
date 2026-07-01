"use client";

import { useState, useEffect } from "react";
import { useTheme } from "@/context/ThemeContext";
import { Activity, Zap, Server, Database, TrendingUp, AlertCircle, Clock, Users, MessageSquare } from "lucide-react";
import LoadingSkeleton from "./LoadingSkeleton";

interface TelemetryData {
  activeUsers: number;
  totalUsers: number;
  agentRequests: number;
  systemLoad: number;
  responseTime: number;
  errorRate: number;
  uptime: number;
  totalConversations?: number;
  totalPosts?: number;
}

interface TelemetryPanelProps {
  data?: TelemetryData;
}

export default function TelemetryPanel({ data: externalData }: TelemetryPanelProps) {
  const { resolvedColors: T } = useTheme();
  const [loading, setLoading] = useState(true);
  const [telemetry, setTelemetry] = useState<TelemetryData>(externalData || {
    activeUsers: 1247,
    totalUsers: 5423,
    agentRequests: 89,
    systemLoad: 34,
    responseTime: 245,
    errorRate: 0.02,
    uptime: 99.9,
    totalConversations: 4521,
    totalPosts: 1234,
  });

  useEffect(() => {
    if (externalData) {
      setTelemetry(externalData);
      setLoading(false);
      return;
    }

    // Simulate loading
    setTimeout(() => setLoading(false), 500);

    // Simulate live updates if no external data
    const interval = setInterval(() => {
      setTelemetry(prev => ({
        ...prev,
        activeUsers: Math.max(0, prev.activeUsers + Math.floor(Math.random() * 10) - 5),
        agentRequests: prev.agentRequests + Math.floor(Math.random() * 3),
        systemLoad: 30 + Math.floor(Math.random() * 15),
        responseTime: 200 + Math.floor(Math.random() * 100),
      }));
    }, 2000);
    return () => clearInterval(interval);
  }, [externalData]);

  if (loading) {
    return (
      <div className="space-y-4">
        <LoadingSkeleton type="card" height="40px" />
        <div className="grid grid-cols-2 gap-3">
          <LoadingSkeleton type="card" height="80px" />
          <LoadingSkeleton type="card" height="80px" />
        </div>
        <LoadingSkeleton type="card" height="120px" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* System Status */}
      <div className="flex items-center gap-2 p-3 rounded-xl border"
        style={{ backgroundColor: T.boxBg + "40", borderColor: T.borderColor + "30" }}>
        <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
        <span className="text-xs font-bold" style={{ color: T.textColor }}>All Systems Operational</span>
      </div>

      {/* Key Metrics */}
      <div className="grid grid-cols-2 gap-3">
        <div className="p-3 rounded-xl border" style={{ backgroundColor: T.boxBg + "40", borderColor: T.borderColor + "30" }}>
          <div className="flex items-center gap-2 mb-1">
            <Activity size={14} style={{ color: T.accentColor }} />
            <span className="text-[10px]" style={{ color: T.textMuted }}>Active Users</span>
          </div>
          <div className="text-xl font-black" style={{ color: T.textColor }}>{telemetry.activeUsers.toLocaleString()}</div>
        </div>
        <div className="p-3 rounded-xl border" style={{ backgroundColor: T.boxBg + "40", borderColor: T.borderColor + "30" }}>
          <div className="flex items-center gap-2 mb-1">
            <Users size={14} style={{ color: "#8b5cf6" }} />
            <span className="text-[10px]" style={{ color: T.textMuted }}>Total Users</span>
          </div>
          <div className="text-xl font-black" style={{ color: T.textColor }}>{telemetry.totalUsers.toLocaleString()}</div>
        </div>
        <div className="p-3 rounded-xl border" style={{ backgroundColor: T.boxBg + "40", borderColor: T.borderColor + "30" }}>
          <div className="flex items-center gap-2 mb-1">
            <Zap size={14} style={{ color: "#f59e0b" }} />
            <span className="text-[10px]" style={{ color: T.textMuted }}>Requests/min</span>
          </div>
          <div className="text-xl font-black" style={{ color: T.textColor }}>{telemetry.agentRequests}</div>
        </div>
        <div className="p-3 rounded-xl border" style={{ backgroundColor: T.boxBg + "40", borderColor: T.borderColor + "30" }}>
          <div className="flex items-center gap-2 mb-1">
            <Server size={14} style={{ color: "#22c55e" }} />
            <span className="text-[10px]" style={{ color: T.textMuted }}>System Load</span>
          </div>
          <div className="text-xl font-black" style={{ color: T.textColor }}>{telemetry.systemLoad}%</div>
        </div>
      </div>

      {/* Additional Metrics */}
      {telemetry.totalConversations !== undefined && (
        <div className="grid grid-cols-2 gap-3">
          <div className="p-3 rounded-xl border" style={{ backgroundColor: T.boxBg + "40", borderColor: T.borderColor + "30" }}>
            <div className="flex items-center gap-2 mb-1">
              <MessageSquare size={14} style={{ color: "#06b6d4" }} />
              <span className="text-[10px]" style={{ color: T.textMuted }}>Conversations</span>
            </div>
            <div className="text-xl font-black" style={{ color: T.textColor }}>{telemetry.totalConversations.toLocaleString()}</div>
          </div>
          <div className="p-3 rounded-xl border" style={{ backgroundColor: T.boxBg + "40", borderColor: T.borderColor + "30" }}>
            <div className="flex items-center gap-2 mb-1">
              <TrendingUp size={14} style={{ color: "#ec4899" }} />
              <span className="text-[10px]" style={{ color: T.textMuted }}>Posts</span>
            </div>
            <div className="text-xl font-black" style={{ color: T.textColor }}>{telemetry.totalPosts?.toLocaleString() || 0}</div>
          </div>
        </div>
      )}

      {/* Performance Charts */}
      <div className="space-y-3">
        <div>
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-bold" style={{ color: T.textMuted }}>Response Time</span>
            <span className="text-xs font-mono" style={{ color: T.accentColor }}>{telemetry.responseTime}ms</span>
          </div>
          <div className="h-2 rounded-full overflow-hidden" style={{ backgroundColor: T.borderColor + "30" }}>
            <div 
              className="h-full rounded-full transition-all duration-500"
              style={{ 
                width: `${Math.min(100, (500 / telemetry.responseTime) * 100)}%`,
                backgroundColor: telemetry.responseTime < 300 ? "#22c55e" : telemetry.responseTime < 500 ? "#f59e0b" : "#ef4444"
              }}
            />
          </div>
        </div>
        <div>
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-bold" style={{ color: T.textMuted }}>Error Rate</span>
            <span className="text-xs font-mono" style={{ color: telemetry.errorRate < 0.05 ? "#22c55e" : "#ef4444" }}>{(telemetry.errorRate * 100).toFixed(2)}%</span>
          </div>
          <div className="h-2 rounded-full overflow-hidden" style={{ backgroundColor: T.borderColor + "30" }}>
            <div 
              className="h-full rounded-full transition-all duration-500"
              style={{ 
                width: `${telemetry.errorRate * 100}%`,
                backgroundColor: telemetry.errorRate < 0.05 ? "#22c55e" : "#ef4444"
              }}
            />
          </div>
        </div>
        <div>
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-bold" style={{ color: T.textMuted }}>Uptime</span>
            <span className="text-xs font-mono" style={{ color: "#8b5cf6" }}>{telemetry.uptime}%</span>
          </div>
          <div className="h-2 rounded-full overflow-hidden" style={{ backgroundColor: T.borderColor + "30" }}>
            <div 
              className="h-full rounded-full transition-all duration-500"
              style={{ 
                width: `${telemetry.uptime}%`,
                backgroundColor: telemetry.uptime > 99 ? "#22c55e" : telemetry.uptime > 95 ? "#f59e0b" : "#ef4444"
              }}
            />
          </div>
        </div>
      </div>

      {/* Database Status */}
      <div className="p-3 rounded-xl border" style={{ backgroundColor: T.boxBg + "40", borderColor: T.borderColor + "30" }}>
        <div className="flex items-center gap-2 mb-2">
          <Database size={14} style={{ color: T.accentColor }} />
          <span className="text-xs font-bold" style={{ color: T.textMuted }}>Database</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-green-500" />
          <span className="text-xs" style={{ color: T.textColor }}>Connected</span>
        </div>
      </div>
    </div>
  );
}
