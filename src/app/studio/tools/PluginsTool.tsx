"use client";

import { useState, useEffect, useCallback } from "react";
import { useTheme } from "@/context/ThemeContext";
import {
  PLUGIN_REGISTRY,
  type PluginDefinition,
  type PluginStatus,
} from "@/lib/plugin-registry";
import {
  Search,
  RefreshCw,
  Plug,
  ArrowRight,
} from "lucide-react";
import ProjectSourceSelector from "@/components/studio/ProjectSourceSelector";
import { useCapabilities } from "@/app/studio/hooks/useCapabilities";

type TabId = "Installed" | "Discover" | "Development" | "AI" | "Media" | "Social" | "Local";

const TABS: TabId[] = ["Installed", "Discover", "Development", "AI", "Media", "Social", "Local"];

const STATUS_COLORS: Record<PluginStatus, string> = {
  available: "#64748b",
  connecting: "#f59e0b",
  connected: "#22c55e",
  degraded: "#f59e0b",
  disconnected: "#64748b",
  expired: "#ef4444",
  offline: "#64748b",
  error: "#ef4444",
};

const STATUS_LABELS: Record<PluginStatus, string> = {
  available: "Available",
  connecting: "Connecting…",
  connected: "Connected",
  degraded: "Degraded",
  disconnected: "Disconnected",
  expired: "Expired",
  offline: "Offline",
  error: "Error",
};

const AUTH_LABELS: Record<string, string> = {
  "github-app": "GitHub App",
  oauth: "OAuth",
  "api-key": "API Key",
  endpoint: "Endpoint",
  none: "No auth",
};

export default function PluginsTool() {
  const { resolvedColors: T } = useTheme();
  const { summary: capSummary, refresh: refreshCaps } = useCapabilities();
  const [activeTab, setActiveTab] = useState<TabId>("Discover");
  const [search, setSearch] = useState("");
  const [plugins, setPlugins] = useState<PluginDefinition[]>(PLUGIN_REGISTRY);
  const [connecting, setConnecting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Fetch real connection status from /api/connections
  const refreshConnections = useCallback(async () => {
    try {
      const res = await fetch("/api/connections");
      if (!res.ok) return;
      const data = await res.json();
      const overview: Array<{
        provider: string;
        label: string;
        category: string;
        description: string;
        status: string;
        isConnected: boolean;
        externalAccountName?: string;
        connectUrl?: string;
      }> = data.overview || [];

      setPlugins((prev) =>
        prev.map((p) => {
          const ov = overview.find(
            (o) => o.provider === p.id || o.provider === p.id.replace("-", "_"),
          );
          if (!ov) return p;
          const isConnected = ov.isConnected || ov.status === "connected";
          const status = (ov.status as PluginStatus) || "available";
          return {
            ...p,
            status: isConnected ? "connected" : (status as PluginStatus),
            installed: isConnected || status === "degraded",
            enabled: isConnected,
            accountName: ov.externalAccountName,
            connectUrl: ov.connectUrl || p.connectUrl,
          };
        }),
      );
    } catch {
      // ignore — keep defaults
    }
  }, []);

  useEffect(() => {
    void refreshConnections();
  }, [refreshConnections]);

  // Merge capability registry status into plugins
  useEffect(() => {
    if (!capSummary.capabilities.length) return;
    const capMap = new Map(capSummary.capabilities.map((c) => [c.provider, c]));
    setPlugins((prev) =>
      prev.map((p) => {
        const cap = capMap.get(p.id) || capMap.get(p.id.replace("-", "_"));
        if (!cap) return p;
        const isConnected = cap.status === "ready" || cap.status === "running";
        return {
          ...p,
          status: isConnected ? "connected" : cap.status === "not_configured" ? "available" : cap.status === "degraded" ? "degraded" : p.status,
          installed: isConnected,
          enabled: isConnected,
          accountName: cap.accountName || p.accountName,
        };
      }),
    );
  }, [capSummary]);

  const handleRefresh = useCallback(async () => {
    await Promise.all([refreshConnections(), refreshCaps()]);
  }, [refreshConnections, refreshCaps]);

  const handleConnect = useCallback(
    async (plugin: PluginDefinition) => {
      // Use real connectUrl from API if available
      const realUrl = plugin.connectUrl;
      if (realUrl) {
        window.location.href = realUrl;
        return;
      }
      setConnecting(plugin.id);
      // For API key providers, route to settings
      if (plugin.authMethod === "api-key") {
        window.location.href = `/settings#keys`;
        setConnecting(null);
        return;
      }
      // For endpoint providers, route to settings
      if (plugin.authMethod === "endpoint") {
        window.location.href = `/settings#connections`;
        setConnecting(null);
        return;
      }
      setConnecting(null);
    },
    [],
  );

  const handleDisconnect = useCallback(async (pluginId: string) => {
    try {
      await fetch(`/api/connections/${pluginId}/disconnect`, { method: "POST" });
      setPlugins((prev) =>
        prev.map((p) =>
          p.id === pluginId
            ? { ...p, status: "available", installed: false, enabled: false, accountName: undefined, resourceCount: undefined, lastSync: undefined }
            : p,
        ),
      );
    } catch {
      // ignore
    }
  }, []);

  const handleSync = useCallback(async (pluginId: string) => {
    try {
      await fetch(`/api/connections/${pluginId}/sync`, { method: "POST" });
      void refreshConnections();
    } catch {
      // ignore
    }
  }, [refreshConnections]);

  const installedPlugins = plugins.filter((p) => p.installed);
  const needsAttention = plugins.filter((p) => p.status === "degraded" || p.status === "expired" || p.status === "error");

  const filteredPlugins = (() => {
    let list = plugins;
    if (activeTab === "Installed") {
      list = list.filter((p) => p.installed);
    } else if (activeTab === "Discover") {
      // All plugins, recommended first
      list = [...list].sort((a, b) => {
        const priority = ["github", "vercel", "supabase", "openrouter", "gemini"];
        const ai = priority.indexOf(a.id);
        const bi = priority.indexOf(b.id);
        return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
      });
    } else {
      list = list.filter((p) => p.category === activeTab);
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          p.description.toLowerCase().includes(q) ||
          p.capabilities.some((c) => c.includes(q)),
      );
    }
    return list;
  })();

  return (
    <div
      className="mx-auto flex h-full w-full max-w-5xl flex-col gap-4 overflow-auto p-4 sm:p-6"
      style={{ color: T.textColor }}
    >
      {/* Header */}
      <div className="shrink-0">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-black" style={{ color: T.headerColor }}>
              Connection Bay
            </h1>
            <p className="mt-1 text-sm" style={{ color: T.textMuted }}>
              Extend LiTT with services, AI providers, media tools and runtimes.
            </p>
          </div>
          <button
            onClick={() => void handleRefresh()}
            className="flex items-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-bold transition-all hover:opacity-80"
            style={{ borderColor: `${T.borderColor}40`, color: T.textMuted }}
          >
            <RefreshCw size={12} /> Refresh
          </button>
        </div>

        {/* Readiness bar */}
        {capSummary.readiness.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {capSummary.readiness.map((rg) => (
              <div
                key={rg.group.id}
                className="flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5"
                style={{
                  borderColor: rg.isReady ? "#22c55e30" : "#f59e0b30",
                  background: rg.isReady ? "#22c55e08" : "#f59e0b08",
                }}
              >
                <span
                  className="h-1.5 w-1.5 rounded-full"
                  style={{ background: rg.isReady ? "#22c55e" : "#f59e0b" }}
                />
                <span className="text-[10px] font-bold" style={{ color: rg.isReady ? "#22c55e" : "#f59e0b" }}>
                  {rg.group.name}
                </span>
                <span className="text-[9px]" style={{ color: T.textMuted }}>
                  {rg.satisfied.length}/{rg.group.requirements.length}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Search */}
      <div className="relative shrink-0">
        <Search
          size={16}
          className="absolute left-3 top-1/2 -translate-y-1/2"
          style={{ color: T.textMuted }}
        />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search connections…"
          className="w-full rounded-xl border py-2.5 pl-10 pr-4 text-sm outline-none transition-all focus:ring-1"
          style={{
            background: `${T.bgColor}80`,
            borderColor: `${T.borderColor}40`,
            color: T.textColor,
          }}
        />
      </div>

      {/* Stats */}
      <div className="flex shrink-0 gap-4 text-xs">
        <span style={{ color: T.textMuted }}>
          Installed <strong style={{ color: T.textColor }}>{installedPlugins.length}</strong>
        </span>
        <span style={{ color: T.textMuted }}>
          Available <strong style={{ color: T.textColor }}>{plugins.length - installedPlugins.length}</strong>
        </span>
        {needsAttention.length > 0 && (
          <span style={{ color: "#f59e0b" }}>
            Needs attention <strong>{needsAttention.length}</strong>
          </span>
        )}
      </div>

      {/* Tabs */}
      <div className="flex shrink-0 gap-1.5 overflow-x-auto pb-1">
        {TABS.map((tab) => {
          const active = activeTab === tab;
          const count =
            tab === "Installed"
              ? installedPlugins.length
              : tab === "Discover"
                ? plugins.length
                : plugins.filter((p) => p.category === tab).length;
          return (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className="flex shrink-0 items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-bold transition-all"
              style={{
                background: active ? `${T.accentColor}20` : `${T.bgColor}50`,
                border: `1px solid ${active ? `${T.accentColor}40` : `${T.borderColor}20`}`,
                color: active ? T.accentColor : T.textMuted,
              }}
            >
              {tab}
              {count > 0 && (
                <span
                  className="rounded-full px-1.5 py-0.5 text-[9px]"
                  style={{
                    background: active ? `${T.accentColor}30` : `${T.borderColor}20`,
                  }}
                >
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Empty installed state — project source selector */}
      {activeTab === "Installed" && installedPlugins.length === 0 && (
        <div className="rounded-2xl border border-dashed p-6" style={{ borderColor: `${T.borderColor}40` }}>
          <div className="mb-4 text-center">
            <Plug size={28} className="mx-auto" style={{ color: T.textMuted }} />
            <h3 className="mt-2 text-lg font-bold" style={{ color: T.textColor }}>
              Start a Project
            </h3>
            <p className="mt-1 text-sm" style={{ color: T.textMuted }}>
              GitHub is recommended for coding, but not required. Upload, use a template, or start blank.
            </p>
          </div>
          <ProjectSourceSelector
            onSelected={(src) => {
              if (src.type === "upload") {
                // Trigger file upload flow
                const input = document.createElement("input");
                input.type = "file";
                input.accept = ".zip,.tar,.tgz";
                input.onchange = async () => {
                  const file = input.files?.[0];
                  if (!file) return;
                  const formData = new FormData();
                  formData.append("file", file);
                  try {
                    const res = await fetch("/api/project-sources/upload", {
                      method: "POST",
                      body: formData,
                    });
                    if (!res.ok) {
                      const data = await res.json().catch(() => ({}));
                      throw new Error(data.error || "Upload failed");
                    }
                    void refreshConnections();
                  } catch (err) {
                    setError(err instanceof Error ? err.message : "Upload failed");
                  }
                };
                input.click();
                return;
              }
              void refreshConnections();
            }}
          />
          <div className="mt-4 flex justify-center gap-2">
            <button
              onClick={() => setActiveTab("Discover")}
              className="rounded-xl border px-4 py-2 text-sm font-bold transition-all hover:opacity-80"
              style={{ borderColor: `${T.borderColor}40`, color: T.textColor }}
            >
              Browse providers
            </button>
          </div>
          {error && (
            <div className="mt-3 rounded-xl border px-3 py-2 text-xs" style={{ borderColor: "#ef444430", color: "#ef4444" }}>
              {error}
            </div>
          )}
        </div>
      )}

      {/* Plugin grid */}
      {filteredPlugins.length > 0 && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {filteredPlugins.map((plugin) => (
            <PluginCard
              key={plugin.id}
              plugin={plugin}
              T={T}
              connecting={connecting === plugin.id}
              onConnect={() => void handleConnect(plugin)}
              onDisconnect={() => void handleDisconnect(plugin.id)}
              onSync={() => void handleSync(plugin.id)}
            />
          ))}
        </div>
      )}

      {filteredPlugins.length === 0 && activeTab !== "Installed" && (
        <div className="py-8 text-center text-sm" style={{ color: T.textMuted }}>
          No providers found{search ? ` for “${search}”` : ""}.
        </div>
      )}
    </div>
  );
}

function PluginCard({
  plugin,
  T,
  connecting,
  onConnect,
  onDisconnect,
  onSync,
}: {
  plugin: PluginDefinition;
  T: ReturnType<typeof useTheme>["resolvedColors"];
  connecting: boolean;
  onConnect: () => void;
  onDisconnect: () => void;
  onSync: () => void;
}) {
  const statusColor = STATUS_COLORS[plugin.status];
  const isInstalled = plugin.installed;

  return (
    <div
      className="flex flex-col gap-3 p-4 transition-all hover:scale-[1.01]"
      style={{
        background: `linear-gradient(135deg, ${T.boxBg} 0%, ${T.bgColor} 100%)`,
        border: `1px solid ${isInstalled ? statusColor + "30" : `${T.borderColor}25`}`,
        borderRadius: "16px",
      }}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <div
            className="grid h-10 w-10 shrink-0 place-items-center rounded-xl text-sm font-black"
            style={{
              background: `${T.accentColor}15`,
              color: T.accentColor,
            }}
          >
            {plugin.name.slice(0, 2).toUpperCase()}
          </div>
          <div>
            <div className="text-sm font-black" style={{ color: T.textColor }}>
              {plugin.name}
            </div>
            <div className="text-[10px]" style={{ color: T.textMuted }}>
              {AUTH_LABELS[plugin.authMethod]}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <span
            className="h-2 w-2 rounded-full"
            style={{ background: statusColor }}
          />
          <span className="text-[9px] font-bold uppercase" style={{ color: statusColor }}>
            {STATUS_LABELS[plugin.status]}
          </span>
        </div>
      </div>

      {/* Description */}
      <p className="text-xs" style={{ color: T.textMuted }}>
        {plugin.description}
      </p>

      {/* Capabilities */}
      <div className="flex flex-wrap gap-1">
        {plugin.capabilities.slice(0, 4).map((cap) => (
          <span
            key={cap}
            className="rounded-full px-2 py-0.5 text-[9px] font-bold"
            style={{
              background: `${T.borderColor}20`,
              color: T.textMuted,
            }}
          >
            {cap}
          </span>
        ))}
      </div>

      {/* Connection details (if connected) */}
      {isInstalled && (
        <div className="space-y-1 text-[10px]" style={{ color: T.textMuted }}>
          {plugin.accountName && (
            <div>Account: <strong style={{ color: T.textColor }}>{plugin.accountName}</strong></div>
          )}
          {plugin.resourceCount !== undefined && (
            <div>Resources: <strong style={{ color: T.textColor }}>{plugin.resourceCount}</strong></div>
          )}
          {plugin.lastSync && (
            <div>Last sync: <strong style={{ color: T.textColor }}>{plugin.lastSync}</strong></div>
          )}
        </div>
      )}

      {/* Actions */}
      <div className="mt-auto flex items-center gap-2 pt-2">
        {!isInstalled ? (
          <button
            onClick={onConnect}
            disabled={connecting}
            className="flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-bold transition-all hover:opacity-80 disabled:opacity-40"
            style={{
              background: `${T.accentColor}20`,
              color: T.accentColor,
              border: `1px solid ${T.accentColor}30`,
            }}
          >
            {connecting ? (
              <RefreshCw size={12} className="animate-spin" />
            ) : (
              <ArrowRight size={12} />
            )}
            Connect
          </button>
        ) : (
          <>
            <button
              onClick={onSync}
              className="flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-[10px] font-bold transition-all hover:opacity-80"
              style={{ borderColor: `${T.borderColor}40`, color: T.textMuted }}
            >
              <RefreshCw size={10} /> Sync
            </button>
            <button
              onClick={onDisconnect}
              className="flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-[10px] font-bold transition-all hover:opacity-80"
              style={{ borderColor: `${T.borderColor}40`, color: T.textMuted }}
            >
              Disconnect
            </button>
          </>
        )}
      </div>
    </div>
  );
}
