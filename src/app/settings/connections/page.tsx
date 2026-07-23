"use client";

import { useCallback, useEffect, useState } from "react";
import { useTheme } from "@/context/ThemeContext";
import Link from "next/link";

function Icon({ name, size = 16, className = "" }: { name: string; size?: number; className?: string }) {
  const paths: Record<string, string> = {
    plug: "M12 22v-5 M9 7V2 M15 7V2 M6 7h12v3a6 6 0 0 1-12 0V7z",
    check: "M20 6L9 17l-5-5",
    x: "M18 6L6 18 M6 6l12 12",
    alert: "M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z M12 9v4 M12 17h.01",
    refresh: "M23 4v6h-6 M1 20v-6h6 M3.51 9a9 9 0 0 1 14.85-3.36L23 10 M1 14l4.64 4.36A9 9 0 0 0 20.49 15",
    external: "M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6 M15 3h6v6 M10 14L21 3",
    back: "M19 12H5 M12 19l-7-7 7-7",
    git: "M6 3v12 M18 9l-6 6-6-6 M3 9h6 M15 9h6",
    activity: "M22 12h-4l-3 9L9 3l-3 9H2",
    pulse: "M3 12h4l3 9 4-16 3 7h4",
  };
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d={paths[name] || ""} />
    </svg>
  );
}

type MetaStatus = {
  connected: boolean;
  configured: boolean;
  status?: string;
  app?: { id: string; name: string; category: string; mode: string; graph_api_version: string } | null;
  pages?: Array<{ id: string; name: string; category: string; has_instagram: boolean; instagram_account_id?: string }>;
  token_health?: { expires_at: string | null; is_expired: boolean; is_expiring_soon: boolean; scopes: string[] };
  webhook_configured?: boolean;
  last_synced_at?: string;
  message?: string;
};

export default function ConnectionsPage() {
  const T = useTheme().resolvedColors;
  const [metaStatus, setMetaStatus] = useState<MetaStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [authUrl, setAuthUrl] = useState<string | null>(null);

  const fetchMetaStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/integrations/meta-developer/status");
      const data = await res.json();
      setMetaStatus(data);
    } catch {
      setMetaStatus({ connected: false, configured: false, message: "Failed to load status" });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchMetaStatus();
  }, [fetchMetaStatus]);

  const handleConnectMeta = async () => {
    setConnecting(true);
    try {
      const res = await fetch("/api/integrations/meta-developer/connect");
      const data = await res.json();
      if (data.auth_url) {
        window.location.href = data.auth_url;
      } else {
        setAuthUrl(data.message || "Meta credentials not configured");
      }
    } catch {
      setAuthUrl("Failed to initiate Meta OAuth");
    } finally {
      setConnecting(false);
    }
  };

  const handleDisconnectMeta = async () => {
    try {
      await fetch("/api/integrations/meta-developer/status", { method: "DELETE" });
      await fetchMetaStatus();
    } catch {
      // Non-fatal
    }
  };

  const statusColor = (status: string) => {
    const colors: Record<string, string> = {
      connected: "#22c55e",
      degraded: "#f59e0b",
      expired: "#f97316",
      missing_permission: "#ef4444",
      offline: "#6b7280",
      disconnected: "#6b7280",
    };
    return colors[status] || "#6b7280";
  };

  return (
    <div className="min-h-screen" style={{ backgroundColor: T.bgColor, color: T.textColor }}>
      <div className="mx-auto max-w-4xl p-4 lg:p-6">
        {/* Back link */}
        <Link
          href="/settings"
          className="mb-4 inline-flex items-center gap-2 text-sm opacity-60 transition-all hover:opacity-100"
        >
          <Icon name="back" size={14} />
          Back to Settings
        </Link>

        <h1 className="mb-1 text-2xl font-black" style={{ color: T.headerColor }}>
          Connections
        </h1>
        <p className="mb-6 text-sm opacity-50">
          Manage your third-party integrations and API connections.
        </p>

        {/* GitHub */}
        <section
          className="mb-4 rounded-xl p-5"
          style={{ background: T.boxBg, border: `1px solid ${T.borderColor}30` }}
        >
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-3">
              <div
                className="flex h-10 w-10 items-center justify-center rounded-xl"
                style={{ background: "#33333320" }}
              >
                <Icon name="git" size={20} />
              </div>
              <div>
                <h2 className="text-sm font-bold" style={{ color: T.headerColor }}>GitHub</h2>
                <p className="text-xs opacity-50">GitHub App installation for repository sync</p>
              </div>
            </div>
            <Link
              href="/studio/github"
              className="rounded-lg px-3 py-1.5 text-xs font-bold transition-all hover:opacity-80"
              style={{ background: `${T.accentColor}20`, color: T.accentColor }}
            >
              Manage →
            </Link>
          </div>
        </section>

        {/* Meta Developer */}
        <section
          className="mb-4 rounded-xl p-5"
          style={{ background: T.boxBg, border: `1px solid ${T.borderColor}30` }}
        >
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-3">
              <div
                className="flex h-10 w-10 items-center justify-center rounded-xl"
                style={{ background: "#1877F220" }}
              >
                <span className="text-lg font-black" style={{ color: "#1877F2" }}>f</span>
              </div>
              <div>
                <h2 className="text-sm font-bold" style={{ color: T.headerColor }}>Meta Developer</h2>
                <p className="text-xs opacity-50">Facebook Pages, Instagram, and Graph API</p>
              </div>
            </div>
            {metaStatus?.connected && (
              <span
                className="rounded-full px-3 py-1 text-xs font-bold uppercase"
                style={{
                  background: `${statusColor(metaStatus.status || "connected")}20`,
                  color: statusColor(metaStatus.status || "connected"),
                }}
              >
                {metaStatus.status || "connected"}
              </span>
            )}
          </div>

          {loading ? (
            <div className="flex items-center gap-2 text-sm opacity-50">
              <Icon name="refresh" size={14} className="animate-spin" />
              Loading…
            </div>
          ) : metaStatus?.connected ? (
            <div className="space-y-4">
              {/* App details */}
              {metaStatus.app && (
                <div className="rounded-lg p-3" style={{ background: `${T.borderColor}15` }}>
                  <div className="grid grid-cols-2 gap-3 text-xs">
                    <div>
                      <span className="opacity-40">App Name</span>
                      <div className="font-semibold">{metaStatus.app.name}</div>
                    </div>
                    <div>
                      <span className="opacity-40">App ID</span>
                      <div className="font-mono">{metaStatus.app.id}</div>
                    </div>
                    <div>
                      <span className="opacity-40">Mode</span>
                      <div className="font-semibold uppercase">{metaStatus.app.mode}</div>
                    </div>
                    <div>
                      <span className="opacity-40">Graph API</span>
                      <div className="font-semibold">{metaStatus.app.graph_api_version}</div>
                    </div>
                  </div>
                </div>
              )}

              {/* Token health */}
              {metaStatus.token_health && (
                <div className="rounded-lg p-3" style={{ background: `${T.borderColor}15` }}>
                  <div className="mb-2 text-xs font-bold uppercase opacity-40">Token Health</div>
                  <div className="flex items-center gap-2 text-xs">
                    {metaStatus.token_health.is_expired ? (
                      <span style={{ color: "#ef4444" }}>
                        <Icon name="alert" size={12} className="inline mr-1" />
                        Token expired
                      </span>
                    ) : metaStatus.token_health.is_expiring_soon ? (
                      <span style={{ color: "#f59e0b" }}>
                        <Icon name="alert" size={12} className="inline mr-1" />
                        Expires soon
                      </span>
                    ) : (
                      <span style={{ color: "#22c55e" }}>
                        <Icon name="check" size={12} className="inline mr-1" />
                        Healthy
                      </span>
                    )}
                    {metaStatus.token_health.expires_at && (
                      <span className="opacity-40">
                        · Expires {new Date(metaStatus.token_health.expires_at).toLocaleDateString()}
                      </span>
                    )}
                  </div>
                  {metaStatus.token_health.scopes.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {metaStatus.token_health.scopes.map((scope) => (
                        <span
                          key={scope}
                          className="rounded-full px-2 py-0.5 text-xs"
                          style={{ background: `${T.accentColor}15`, color: T.accentColor }}
                        >
                          {scope}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Pages */}
              {metaStatus.pages && metaStatus.pages.length > 0 && (
                <div className="rounded-lg p-3" style={{ background: `${T.borderColor}15` }}>
                  <div className="mb-2 text-xs font-bold uppercase opacity-40">Connected Pages</div>
                  <div className="space-y-2">
                    {metaStatus.pages.map((page) => (
                      <div key={page.id} className="flex items-center justify-between text-xs">
                        <div>
                          <span className="font-semibold">{page.name}</span>
                          <span className="opacity-40 ml-2">{page.category}</span>
                        </div>
                        {page.has_instagram && (
                          <span style={{ color: "#C13584" }}>Instagram connected</span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Webhook status */}
              <div className="flex items-center gap-2 text-xs">
                <span className="opacity-40">Webhook:</span>
                {metaStatus.webhook_configured ? (
                  <span style={{ color: "#22c55e" }}>
                    <Icon name="check" size={12} className="inline mr-1" />
                    Configured
                  </span>
                ) : (
                  <span style={{ color: "#f59e0b" }}>
                    <Icon name="alert" size={12} className="inline mr-1" />
                    Not configured
                  </span>
                )}
              </div>

              {/* Actions */}
              <div className="flex gap-2">
                <button
                  onClick={handleConnectMeta}
                  disabled={connecting}
                  className="rounded-lg px-3 py-2 text-xs font-bold transition-all hover:opacity-80 disabled:opacity-40"
                  style={{ background: `${T.accentColor}20`, color: T.accentColor }}
                >
                  <Icon name="refresh" size={12} className="inline mr-1" />
                  Reconnect
                </button>
                <button
                  onClick={handleDisconnectMeta}
                  className="rounded-lg px-3 py-2 text-xs font-bold opacity-60 transition-all hover:opacity-80"
                  style={{ background: "#ef444415", color: "#ef4444" }}
                >
                  <Icon name="x" size={12} className="inline mr-1" />
                  Disconnect
                </button>
              </div>
            </div>
          ) : metaStatus?.configured ? (
            <div>
              <p className="text-sm opacity-50 mb-4">
                Connect your Meta Developer account to manage Facebook Pages and Instagram business accounts.
              </p>
              <button
                onClick={handleConnectMeta}
                disabled={connecting}
                className="rounded-xl px-4 py-2 text-sm font-bold transition-all hover:opacity-80 disabled:opacity-40"
                style={{ background: "#1877F220", color: "#1877F2", border: "1px solid #1877F240" }}
              >
                {connecting ? (
                  <><Icon name="refresh" size={14} className="inline mr-2 animate-spin" />Connecting…</>
                ) : (
                  <><Icon name="plug" size={14} className="inline mr-2" />Connect Meta Developer</>
                )}
              </button>
            </div>
          ) : (
            <div
              className="rounded-lg p-3 text-sm"
              style={{ background: "#f59e0b10", color: "#f59e0b" }}
            >
              <Icon name="alert" size={14} className="inline mr-2" />
              {metaStatus?.message || "Meta Developer credentials not configured. Set META_APP_ID, META_APP_SECRET, and META_REDIRECT_URI environment variables."}
            </div>
          )}
          {authUrl && (
            <div className="mt-2 text-xs opacity-50">{authUrl}</div>
          )}
        </section>

        {/* Vercel (placeholder) */}
        <section
          className="mb-4 rounded-xl p-5 opacity-50"
          style={{ background: T.boxBg, border: `1px solid ${T.borderColor}30` }}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div
                className="flex h-10 w-10 items-center justify-center rounded-xl"
                style={{ background: "#00000020" }}
              >
                <span className="text-lg font-black">▲</span>
              </div>
              <div>
                <h2 className="text-sm font-bold" style={{ color: T.headerColor }}>Vercel</h2>
                <p className="text-xs opacity-50">Deployment tracking and preview URLs</p>
              </div>
            </div>
            <span className="text-xs opacity-40">Coming soon</span>
          </div>
        </section>

        {/* Supabase (placeholder) */}
        <section
          className="mb-4 rounded-xl p-5 opacity-50"
          style={{ background: T.boxBg, border: `1px solid ${T.borderColor}30` }}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div
                className="flex h-10 w-10 items-center justify-center rounded-xl"
                style={{ background: "#3ECF8E20" }}
              >
                <span className="text-lg font-black" style={{ color: "#3ECF8E" }}>S</span>
              </div>
              <div>
                <h2 className="text-sm font-bold" style={{ color: T.headerColor }}>Supabase</h2>
                <p className="text-xs opacity-50">Database and backend management</p>
              </div>
            </div>
            <span className="text-xs opacity-40">Coming soon</span>
          </div>
        </section>
      </div>
    </div>
  );
}
