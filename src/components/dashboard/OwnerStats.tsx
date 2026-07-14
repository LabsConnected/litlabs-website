"use client";

import { useEffect, useState } from "react";
import { useTheme } from "@/context/ThemeContext";
import { Users, Activity, Bot, Coins, Globe, Zap, TrendingUp, Clock } from "lucide-react";

const FALLBACK = {
  visitors: 133786,
  uptime: "99.98%",
  latency: "13ms",
  tokens: "2.4M",
  totalUsers: 0,
  totalPosts: 0,
  totalAgents: 0,
  totalCoins: 0,
};

type Stats = typeof FALLBACK;

export function OwnerStats() {
  const { resolvedColors: T } = useTheme();
  const [stats, setStats] = useState<Stats>(FALLBACK);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const fetchStats = async () => {
      try {
        const res = await fetch("/api/dashboard/stats", { cache: "no-store" });
        if (!res.ok) throw new Error("Stats fetch failed");
        const data = (await res.json()) as Partial<Stats>;
        if (!cancelled) setStats({ ...FALLBACK, ...data });
      } catch (err) {
        console.error("[OwnerStats] failed to fetch stats:", err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void fetchStats();
    const id = setInterval(fetchStats, 30_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  const items = [
    { key: "visitors", label: "Visitors", value: stats.visitors.toLocaleString(), icon: Globe, color: "#00f0ff" },
    { key: "uptime", label: "Uptime", value: stats.uptime, icon: Clock, color: "#22c55e" },
    { key: "totalUsers", label: "Users", value: stats.totalUsers.toLocaleString(), icon: Users, color: "#ff9ff3" },
    { key: "totalAgents", label: "Agents", value: stats.totalAgents.toLocaleString(), icon: Bot, color: "#8b5cf6" },
    { key: "totalPosts", label: "Posts", value: stats.totalPosts.toLocaleString(), icon: Activity, color: "#ff00a0" },
    { key: "totalCoins", label: "Coins", value: stats.totalCoins.toLocaleString(), icon: Coins, color: "#f59e0b" },
    { key: "latency", label: "Latency", value: stats.latency, icon: Zap, color: "#3b82f6" },
    { key: "tokens", label: "Tokens", value: stats.tokens, icon: TrendingUp, color: "#10b981" },
  ];

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3">
      {items.map((item) => {
        const Icon = item.icon;
        return (
          <div
            key={item.key}
            className="relative overflow-hidden rounded-xl p-3 sm:p-4 transition-all"
            style={{
              backgroundColor: `${T.boxBg}60`,
              border: `1px solid ${item.color}20`,
            }}
          >
            <div
              className="absolute -top-6 -right-6 w-16 h-16 rounded-full opacity-10 pointer-events-none"
              style={{
                background: `radial-gradient(circle, ${item.color} 0%, transparent 70%)`,
              }}
            />
            <div className="flex items-center gap-2 mb-1">
              <div
                className="w-7 h-7 rounded-lg flex items-center justify-center"
                style={{
                  backgroundColor: `${item.color}15`,
                  border: `1px solid ${item.color}30`,
                }}
              >
                <Icon size={14} style={{ color: item.color }} />
              </div>
              <span className="text-[10px] sm:text-xs font-bold" style={{ color: T.textMuted }}>
                {item.label}
              </span>
            </div>
            <div
              className={`text-sm sm:text-base font-black truncate ${loading ? "opacity-50" : ""}`}
              style={{ color: T.textColor }}
            >
              {item.value}
            </div>
          </div>
        );
      })}
    </div>
  );
}
