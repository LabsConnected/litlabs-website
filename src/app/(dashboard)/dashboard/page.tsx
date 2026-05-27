"use client";
import { useAuth } from "@/context/AuthContext";
import { useEffect, useState } from "react";
import { getHealth, getStatus } from "@/lib/api";

interface HealthData { status: string; uptime: number; time: string; }
interface StatusData { load: string[]; mem: { total_kb?: number; available_kb?: number }; node: string; }

function formatUptime(seconds: number) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h}h ${m}m`;
}

function formatKB(kb?: number) {
  if (!kb) return "N/A";
  return `${(kb / 1024 / 1024).toFixed(1)} GB`;
}

export default function DashboardPage() {
  const { user } = useAuth();
  const [health, setHealth] = useState<HealthData | null>(null);
  const [status, setStatus] = useState<StatusData | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    getHealth().then(setHealth).catch(() => setError("Backend unreachable"));
    getStatus().then(setStatus).catch(() => {});
    const interval = setInterval(() => {
      getHealth().then(setHealth).catch(() => {});
      getStatus().then(setStatus).catch(() => {});
    }, 10000);
    return () => clearInterval(interval);
  }, []);

  const memPercent = status?.mem?.total_kb && status?.mem?.available_kb
    ? Math.round(((status.mem.total_kb - status.mem.available_kb) / status.mem.total_kb) * 100)
    : 0;

  return (
    <div className="max-w-6xl mx-auto">
      <div className="mb-8">
        <h1 className="font-heading text-2xl font-bold mb-1">
          Welcome back, <span className="text-neon-cyan">{user?.name || user?.email?.split("@")[0] || "Builder"}</span>
        </h1>
        <p className="text-text-secondary">Here's your workspace overview.</p>
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/30 text-red-400 rounded-lg p-3 text-sm mb-4">
          {error} — Make sure the Cloudflared tunnel is running.
        </div>
      )}

      {/* Stats Grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <div className="card text-center">
          <div className="text-2xl mb-2">⚡</div>
          <div className="text-2xl font-bold font-heading text-neon-cyan text-glow-cyan">
            {health ? "ONLINE" : "—"}
          </div>
          <div className="text-xs text-text-muted tracking-widest mt-1">STATUS</div>
        </div>
        <div className="card text-center">
          <div className="text-2xl mb-2">◈</div>
          <div className="text-2xl font-bold font-heading text-neon-green text-glow-green">
            {health ? formatUptime(health.uptime) : "—"}
          </div>
          <div className="text-xs text-text-muted tracking-widest mt-1">UPTIME</div>
        </div>
        <div className="card text-center">
          <div className="text-2xl mb-2">💾</div>
          <div className="text-2xl font-bold font-heading text-neon-purple text-glow-purple">
            {memPercent}%
          </div>
          <div className="text-xs text-text-muted tracking-widest mt-1">MEMORY</div>
        </div>
        <div className="card text-center">
          <div className="text-2xl mb-2">⚙</div>
          <div className="text-2xl font-bold font-heading text-neon-gold text-glow-gold">
            {status?.load?.[0] || "—"}
          </div>
          <div className="text-xs text-text-muted tracking-widest mt-1">LOAD</div>
        </div>
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        {/* System Info */}
        <div className="card">
          <h2 className="font-heading text-lg font-semibold mb-4">System Info</h2>
          <div className="space-y-2 text-sm font-code">
            <div className="flex justify-between"><span className="text-text-muted">Node</span><span className="text-neon-green">{status?.node || "—"}</span></div>
            <div className="flex justify-between"><span className="text-text-muted">Total Memory</span><span className="text-text-primary">{formatKB(status?.mem?.total_kb)}</span></div>
            <div className="flex justify-between"><span className="text-text-muted">Available</span><span className="text-text-primary">{formatKB(status?.mem?.available_kb)}</span></div>
            <div className="flex justify-between"><span className="text-text-muted">Load (1/5/15)</span><span className="text-text-primary">{status?.load?.join(", ") || "—"}</span></div>
            <div className="flex justify-between"><span className="text-text-muted">Last Update</span><span className="text-text-primary">{health?.time ? new Date(health.time).toLocaleTimeString() : "—"}</span></div>
          </div>
        </div>

        {/* Quick Actions */}
        <div className="card">
          <h2 className="font-heading text-lg font-semibold mb-4">Quick Actions</h2>
          <div className="grid grid-cols-2 gap-3">
            <a href="/agent-chat" className="p-4 rounded-lg bg-cyber-surface-2 border border-cyber-border hover:border-neon-cyan/40 transition-all group">
              <div className="text-xl mb-1">⚡</div>
              <div className="text-sm font-medium group-hover:text-neon-cyan transition-colors">AI Chat</div>
              <div className="text-xs text-text-muted">Start a conversation</div>
            </a>
            <a href="/marketplace" className="p-4 rounded-lg bg-cyber-surface-2 border border-cyber-border hover:border-neon-purple/40 transition-all group">
              <div className="text-xl mb-1">◉</div>
              <div className="text-sm font-medium group-hover:text-neon-purple transition-colors">Bot Forge</div>
              <div className="text-xs text-text-muted">Browse AI agents</div>
            </a>
            <a href="/social" className="p-4 rounded-lg bg-cyber-surface-2 border border-cyber-border hover:border-neon-gold/40 transition-all group">
              <div className="text-xl mb-1">👥</div>
              <div className="text-sm font-medium group-hover:text-neon-gold transition-colors">Social</div>
              <div className="text-xs text-text-muted">Connect with builders</div>
            </a>
            <a href="/settings" className="p-4 rounded-lg bg-cyber-surface-2 border border-cyber-border hover:border-green-400/40 transition-all group">
              <div className="text-xl mb-1">⚙</div>
              <div className="text-sm font-medium group-hover:text-green-400 transition-colors">Settings</div>
              <div className="text-xs text-text-muted">Configure workspace</div>
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
