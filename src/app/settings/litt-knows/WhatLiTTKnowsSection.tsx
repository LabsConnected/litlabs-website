"use client";

import { useCallback, useEffect, useState } from "react";
import { useTheme } from "@/context/ThemeContext";
import Link from "next/link";
import {
  Bot, MapPin, Clock, Thermometer, Globe, Mail,
  Check, X, Loader2, Trash2, Shield,
  Activity, Brain, Plug, ChevronRight,
} from "lucide-react";

// ── Types ──────────────────────────────────────────────────────────────

interface LittKnowsData {
  profile: {
    displayName: string | null;
    email: string | null;
    timezone: string | null;
    locale: string | null;
    temperatureUnit: string;
    distanceUnit: string;
    location: {
      city: string | null;
      region: string | null;
      country: string | null;
      mode: string;
    };
    newsInterests: string[];
    dailyBriefingEnabled: boolean;
    dailyBriefingTime: string | null;
  };
  memory: Array<{
    id: string;
    key: string;
    value: unknown;
    source: string;
    confidence: number;
    confirmed: boolean;
    updatedAt: string;
  }>;
  connections: Array<{
    provider: string;
    label: string;
    description: string;
    connected: boolean;
    status: string;
    accountEmail: string | null;
    grantedCapabilities: string[];
  }>;
}

type Tab = "profile" | "memory" | "connections" | "activity";

// ── Component ──────────────────────────────────────────────────────────

export function WhatLiTTKnowsSection({
  T,
}: {
  T: ReturnType<typeof useTheme>["resolvedColors"];
}) {
  const [data, setData] = useState<LittKnowsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>("profile");

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/settings/litt-knows", { credentials: "include" });
      if (!res.ok) throw new Error(`Failed: ${res.status}`);
      const json = await res.json();
      setData(json);
    } catch {
      setError("Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 p-8 text-sm opacity-50">
        <Loader2 size={14} className="animate-spin" />
        Loading what LiTT knows…
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl border border-red-400/20 bg-red-400/5 p-4 text-sm text-red-300">
        {error}
      </div>
    );
  }

  if (!data) return null;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="rounded-xl border p-4" style={{ background: T.boxBg, borderColor: `${T.borderColor}30` }}>
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg" style={{ background: `${T.accentColor}15` }}>
            <Bot size={18} style={{ color: T.accentColor }} />
          </div>
          <div>
            <h2 className="text-sm font-black" style={{ color: T.headerColor }}>What LiTT Knows</h2>
            <p className="text-[11px] opacity-50">Profile, memory, connections, and consent — you control what LiTT can access.</p>
          </div>
        </div>
      </div>

      {/* Tab navigation */}
      <div className="flex gap-1 rounded-lg border p-1" style={{ borderColor: `${T.borderColor}20`, background: T.bgColor }}>
        {([
          { id: "profile", label: "Profile", icon: MapPin },
          { id: "memory", label: "Memory", icon: Brain },
          { id: "connections", label: "Connections", icon: Plug },
          { id: "activity", label: "Activity", icon: Activity },
        ] as Array<{ id: Tab; label: string; icon: typeof MapPin }>).map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-2 text-[11px] font-bold transition-all"
              style={{
                background: isActive ? `${T.accentColor}15` : "transparent",
                color: isActive ? T.accentColor : "rgba(255,255,255,0.5)",
              }}
            >
              <Icon size={12} />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Tab content */}
      {activeTab === "profile" && <ProfileTab data={data} T={T} />}
      {activeTab === "memory" && <MemoryTab data={data} T={T} onChanged={fetchData} />}
      {activeTab === "connections" && <ConnectionsTab data={data} T={T} onChanged={fetchData} />}
      {activeTab === "activity" && <ActivityTab T={T} />}
    </div>
  );
}

// ── Profile Tab ────────────────────────────────────────────────────────

function ProfileTab({ data, T }: { data: LittKnowsData; T: ReturnType<typeof useTheme>["resolvedColors"] }) {
  const { profile } = data;
  const rows: Array<{ icon: typeof MapPin; label: string; value: string | null }> = [
    { icon: Bot, label: "Name", value: profile.displayName },
    { icon: Mail, label: "Email", value: profile.email },
    { icon: MapPin, label: "Home", value: [profile.location.city, profile.location.region, profile.location.country].filter(Boolean).join(", ") || null },
    { icon: Clock, label: "Timezone", value: profile.timezone },
    { icon: Thermometer, label: "Temperature", value: profile.temperatureUnit === "fahrenheit" ? "Fahrenheit" : "Celsius" },
    { icon: Globe, label: "Language", value: profile.locale },
  ];

  return (
    <div className="rounded-xl border" style={{ background: T.boxBg, borderColor: `${T.borderColor}30` }}>
      <div className="border-b px-4 py-3" style={{ borderColor: `${T.borderColor}20` }}>
        <h3 className="text-xs font-black uppercase tracking-wider opacity-60">Permanent Basics</h3>
        <p className="mt-1 text-[10px] opacity-40">What LiTT uses to personalize responses. Edit in Account settings.</p>
      </div>
      <div className="divide-y" style={{ borderColor: `${T.borderColor}10` }}>
        {rows.map((row) => {
          const Icon = row.icon;
          return (
            <div key={row.label} className="flex items-center justify-between px-4 py-3" style={{ borderColor: `${T.borderColor}10` }}>
              <div className="flex items-center gap-3">
                <Icon size={14} className="opacity-40" />
                <span className="text-[11px] font-bold opacity-60">{row.label}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-semibold" style={{ color: row.value ? T.textColor : "rgba(255,255,255,0.3)" }}>
                  {row.value || "Not set"}
                </span>
                {row.value && <Check size={12} style={{ color: "#22c55e" }} />}
              </div>
            </div>
          );
        })}
      </div>
      <div className="border-t px-4 py-3" style={{ borderColor: `${T.borderColor}20` }}>
        <Link
          href="/settings?section=account"
          className="inline-flex items-center gap-1.5 text-[11px] font-bold opacity-60 transition-all hover:opacity-100"
          style={{ color: T.accentColor }}
        >
          Edit profile <ChevronRight size={12} />
        </Link>
      </div>

      {/* Location source */}
      {profile.location.city && (
        <div className="border-t px-4 py-3" style={{ borderColor: `${T.borderColor}20` }}>
          <div className="flex items-center gap-2 text-[10px] opacity-40">
            <Shield size={10} />
            Location source: <span className="font-bold">{profile.location.mode}</span>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Memory Tab ─────────────────────────────────────────────────────────

function MemoryTab({
  data,
  T,
  onChanged,
}: {
  data: LittKnowsData;
  T: ReturnType<typeof useTheme>["resolvedColors"];
  onChanged: () => void;
}) {
  const [deleting, setDeleting] = useState<string | null>(null);

  const handleDelete = useCallback(
    async (key: string) => {
      if (!window.confirm(`Delete fact "${key}"? LiTT will forget this.`)) return;
      setDeleting(key);
      try {
        await fetch(`/api/settings/user-facts?key=${encodeURIComponent(key)}`, {
          method: "DELETE",
          credentials: "include",
        });
        onChanged();
      } catch {
        // Non-fatal
      } finally {
        setDeleting(null);
      }
    },
    [onChanged],
  );

  if (data.memory.length === 0) {
    return (
      <div className="rounded-xl border p-6 text-center" style={{ background: T.boxBg, borderColor: `${T.borderColor}30` }}>
        <Brain size={24} className="mx-auto mb-2 opacity-30" />
        <p className="text-sm opacity-50">LiTT hasn&apos;t learned any facts about you yet.</p>
        <p className="mt-1 text-[11px] opacity-30">Tell LiTT things like &quot;I prefer dark UI&quot; or &quot;My business is LiTTree LabStudios&quot; and they&apos;ll appear here.</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {data.memory.map((fact) => {
        const valueStr = typeof fact.value === "string" ? fact.value : JSON.stringify(fact.value);
        const sourceLabel: Record<string, string> = {
          user_explicit: "You told LiTT",
          profile: "From your profile",
          device: "From your device",
          connector: "From a connected app",
          conversation: "Learned in conversation",
        };
        return (
          <div
            key={fact.id}
            className="flex items-start justify-between rounded-xl border p-3"
            style={{ background: T.boxBg, borderColor: `${T.borderColor}30` }}
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-black" style={{ color: T.headerColor }}>{fact.key}</span>
                {fact.confirmed && (
                  <span className="flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-1.5 py-0.5 text-[8px] font-bold text-emerald-400">
                    <Check size={8} /> Confirmed
                  </span>
                )}
              </div>
              <p className="mt-1 text-[11px]" style={{ color: T.textColor }}>{valueStr}</p>
              <div className="mt-1.5 flex items-center gap-2 text-[9px] opacity-40">
                <span>{sourceLabel[fact.source] ?? fact.source}</span>
                <span>•</span>
                <span>Confidence: {Math.round(fact.confidence * 100)}%</span>
              </div>
            </div>
            <button
              type="button"
              onClick={() => void handleDelete(fact.key)}
              disabled={deleting === fact.key}
              className="ml-2 shrink-0 rounded-lg border p-1.5 transition-all hover:opacity-80 disabled:opacity-30"
              style={{ borderColor: "rgba(239,68,68,0.2)", color: "#ef4444" }}
              title="Delete this fact"
            >
              {deleting === fact.key ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
            </button>
          </div>
        );
      })}
    </div>
  );
}

// ── Connections Tab ────────────────────────────────────────────────────

function ConnectionsTab({
  data,
  T,
  onChanged,
}: {
  data: LittKnowsData;
  T: ReturnType<typeof useTheme>["resolvedColors"];
  onChanged: () => void;
}) {
  const [revoking, setRevoking] = useState<string | null>(null);

  const handleRevoke = useCallback(
    async (provider: string) => {
      if (!window.confirm(`Disconnect ${provider}? LiTT will lose access to all ${provider} data.`)) return;
      setRevoking(provider);
      try {
        await fetch(`/api/settings/connections?provider=${encodeURIComponent(provider)}`, {
          method: "DELETE",
          credentials: "include",
        });
        onChanged();
      } catch {
        // Non-fatal
      } finally {
        setRevoking(null);
      }
    },
    [onChanged],
  );

  return (
    <div className="space-y-3">
      {data.connections.map((conn) => (
        <div
          key={conn.provider}
          className="rounded-xl border p-4"
          style={{ background: T.boxBg, borderColor: `${T.borderColor}30` }}
        >
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div
                className="flex h-9 w-9 items-center justify-center rounded-lg text-sm font-black"
                style={{ background: conn.connected ? `${T.accentColor}15` : "rgba(255,255,255,0.05)", color: conn.connected ? T.accentColor : "rgba(255,255,255,0.3)" }}
              >
                {conn.label.charAt(0)}
              </div>
              <div>
                <h3 className="text-sm font-bold" style={{ color: T.headerColor }}>{conn.label}</h3>
                <span className="text-[10px] opacity-50">{conn.description}</span>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {conn.connected ? (
                <>
                  <span className="flex items-center gap-1.5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-[10px] font-bold text-emerald-400">
                    <Check size={10} /> Connected
                  </span>
                  <button
                    type="button"
                    onClick={() => void handleRevoke(conn.provider)}
                    disabled={revoking === conn.provider}
                    className="rounded-lg border border-red-400/20 px-2.5 py-1 text-[10px] font-bold text-red-400 transition-all hover:bg-red-400/10 disabled:opacity-30"
                  >
                    {revoking === conn.provider ? "Disconnecting…" : "Disconnect"}
                  </button>
                </>
              ) : (
                <span className="flex items-center gap-1.5 rounded-lg border border-white/10 px-2.5 py-1 text-[10px] font-bold opacity-40">
                  <X size={10} /> Not connected
                </span>
              )}
            </div>
          </div>

          {conn.connected && conn.accountEmail && (
            <div className="mb-3 rounded-lg border px-3 py-2 text-[11px]" style={{ borderColor: `${T.borderColor}20`, background: T.bgColor }}>
              <span className="opacity-50">Account:</span> <span className="font-bold">{conn.accountEmail}</span>
            </div>
          )}

          {conn.connected && conn.grantedCapabilities.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {conn.grantedCapabilities.map((cap) => (
                <span
                  key={cap}
                  className="rounded-full border px-2 py-0.5 text-[9px] font-bold"
                  style={{ borderColor: `${T.accentColor}30`, color: T.accentColor, background: `${T.accentColor}08` }}
                >
                  {cap.replace(/_/g, " ")}
                </span>
              ))}
            </div>
          )}

          {conn.connected && conn.grantedCapabilities.length === 0 && (
            <p className="text-[10px] opacity-40">No capabilities granted yet. LiTT will request access when needed.</p>
          )}
        </div>
      ))}

      <Link
        href="/settings/connections"
        className="block rounded-xl border p-3 text-center text-[11px] font-bold opacity-60 transition-all hover:opacity-100"
        style={{ background: T.boxBg, borderColor: `${T.borderColor}20`, color: T.accentColor }}
      >
        Manage all connections <ChevronRight size={12} className="inline" />
      </Link>
    </div>
  );
}

// ── Activity Tab ───────────────────────────────────────────────────────

function ActivityTab({ T }: { T: ReturnType<typeof useTheme>["resolvedColors"] }) {
  const [entries, setEntries] = useState<Array<{
    id: string;
    capabilityId: string;
    provider: string;
    action: string;
    status: string;
    createdAt: string;
  }>>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch("/api/settings/audit-log?limit=20", { credentials: "include" });
        if (res.ok) {
          const data = await res.json();
          setEntries(data.entries ?? []);
        }
      } catch {
        // Non-fatal
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center gap-2 p-4 text-sm opacity-50">
        <Loader2 size={14} className="animate-spin" />
        Loading activity…
      </div>
    );
  }

  if (entries.length === 0) {
    return (
      <div className="rounded-xl border p-6 text-center" style={{ background: T.boxBg, borderColor: `${T.borderColor}30` }}>
        <Activity size={24} className="mx-auto mb-2 opacity-30" />
        <p className="text-sm opacity-50">No activity yet.</p>
        <p className="mt-1 text-[11px] opacity-30">When LiTT accesses your connected apps, it will appear here.</p>
      </div>
    );
  }

  const statusColors: Record<string, string> = {
    success: "#22c55e",
    failed: "#ef4444",
    denied: "#f59e0b",
    pending_approval: "#3b82f6",
    approved: "#22c55e",
    revoked: "#ef4444",
  };

  return (
    <div className="space-y-1.5">
      {entries.map((entry) => {
        const color = statusColors[entry.status] ?? "rgba(255,255,255,0.5)";
        const time = new Date(entry.createdAt).toLocaleString();
        return (
          <div
            key={entry.id}
            className="flex items-center justify-between rounded-lg border px-3 py-2"
            style={{ background: T.boxBg, borderColor: `${T.borderColor}20` }}
          >
            <div className="flex items-center gap-2">
              <div className="h-2 w-2 rounded-full" style={{ background: color }} />
              <div>
                <p className="text-[11px] font-bold" style={{ color: T.textColor }}>
                  LiTT {entry.action} — {entry.capabilityId.replace(/_/g, " ")}
                </p>
                <p className="text-[9px] opacity-40">{entry.provider} • {time}</p>
              </div>
            </div>
            <span className="text-[9px] font-bold uppercase" style={{ color }}>{entry.status}</span>
          </div>
        );
      })}
    </div>
  );
}
