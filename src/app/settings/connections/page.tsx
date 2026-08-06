"use client";

import { useCallback, useEffect, useState } from "react";
import { useTheme } from "@/context/ThemeContext";
import { useIntegrationStatus } from "@/hooks/useIntegrationStatus";
import { IntegrationCard, IntegrationSummaryBar } from "@/components/settings/IntegrationCard";
import Link from "next/link";
import { Loader2, ArrowLeft, Activity, KeyRound, Check, AlertCircle } from "lucide-react";
import GitHubPATDrawer from "./GitHubPATDrawer";

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
  const { status, loading, error, refresh } = useIntegrationStatus();
  const [metaStatus, setMetaStatus] = useState<MetaStatus | null>(null);
  const [patDrawerOpen, setPatDrawerOpen] = useState(false);
  const [patStatus, setPatStatus] = useState<{ connected: boolean; accountName: string | null; scopes: string[] } | null>(null);

  const fetchMetaStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/integrations/meta-developer/status");
      const data = await res.json();
      setMetaStatus(data);
    } catch {
      setMetaStatus({ connected: false, configured: false, message: "Failed to load status" });
    }
  }, []);

  const fetchPATStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/github/pat", { credentials: "include" });
      if (res.ok) {
        const data = await res.json() as { connected: boolean; accountName?: string; scopes?: string[] };
        setPatStatus({ connected: data.connected, accountName: data.accountName ?? null, scopes: data.scopes ?? [] });
      } else {
        setPatStatus({ connected: false, accountName: null, scopes: [] });
      }
    } catch {
      setPatStatus({ connected: false, accountName: null, scopes: [] });
    }
  }, []);

  useEffect(() => {
    void fetchMetaStatus();
    void fetchPATStatus();
  }, [fetchMetaStatus, fetchPATStatus]);

  const handleAction = (actionId: string, actionType: string) => {
    if (actionType === "connect" && actionId === "install") {
      window.location.href = "/studio/github";
    } else if (actionType === "select_repository") {
      window.location.href = "/studio/github";
    } else if (actionType === "open_settings") {
      window.location.href = "/studio/github";
    } else if (actionType === "configure") {
      window.location.href = "/settings";
    } else if (actionType === "run_diagnostics") {
      window.location.href = "/settings/connections/diagnostics";
    } else if (actionType === "test") {
      void refresh();
    } else if (actionType === "connect_pat") {
      setPatDrawerOpen(true);
    }
  };

  const required = status.integrations.filter((i) => i.category === "required");
  const code = status.integrations.filter((i) => i.category === "code");
  const ai = status.integrations.filter((i) => i.category === "ai");
  const optional = status.integrations.filter((i) => i.category === "optional");
  const runtime = status.integrations.filter((i) => i.category === "runtime");

  return (
    <div className="min-h-screen" style={{ backgroundColor: T.bgColor, color: T.textColor }}>
      <div className="mx-auto w-full max-w-4xl p-4 lg:p-6">
        <Link
          href="/settings"
          className="mb-4 inline-flex items-center gap-2 text-sm opacity-60 transition-all hover:opacity-100"
        >
          <ArrowLeft size={14} />
          Back to Settings
        </Link>

        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-black" style={{ color: T.headerColor }}>
              Connections
            </h1>
            <p className="mt-1 text-sm opacity-50">
              Platform configuration, user connections, and workspace readiness.
            </p>
          </div>
          <Link
            href="/settings/connections/diagnostics"
            className="flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-bold transition-all hover:opacity-80"
            style={{
              borderColor: `${T.accentColor}30`,
              color: T.accentColor,
            }}
          >
            <Activity size={14} />
            Diagnostics
          </Link>
        </div>

        {loading ? (
          <div className="flex items-center gap-2 text-sm opacity-50">
            <Loader2 size={14} className="animate-spin" />
            Checking integration status…
          </div>
        ) : error && status.integrations.length === 0 ? (
          <div className="rounded-xl border border-red-400/20 bg-red-400/5 p-4 text-sm text-red-300">
            Failed to load integration status: {error}
          </div>
        ) : (
          <div className="space-y-6">
            {status.summary && <IntegrationSummaryBar summary={status.summary} />}

            {required.length > 0 && (
              <Section title="Platform services" description="Required for core Studio operation">
                {required.map((i) => (
                  <IntegrationCard key={i.id} integration={i} onAction={handleAction} />
                ))}
              </Section>
            )}

            {code.length > 0 && (
              <Section title="Code workspace" description="Required for repository and terminal features">
                {code.map((i) => (
                  <IntegrationCard key={i.id} integration={i} onAction={handleAction} />
                ))}
              </Section>
            )}

            {/* GitHub PAT — alternative to GitHub App */}
            <Section title="GitHub (API Key)" description="Connect with a Personal Access Token if the GitHub App isn't available">
              <div
                className="rounded-xl border p-4"
                style={{ background: T.boxBg, borderColor: `${T.borderColor}30` }}
              >
                <div className="mb-3 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div
                      className="flex h-9 w-9 items-center justify-center rounded-lg"
                      style={{ background: `${T.accentColor}15` }}
                    >
                      <KeyRound size={16} style={{ color: T.accentColor }} />
                    </div>
                    <div>
                      <h3 className="text-sm font-bold" style={{ color: T.headerColor }}>
                        Personal Access Token
                      </h3>
                      <span className="text-[10px] opacity-50">Alternative to GitHub App install</span>
                    </div>
                  </div>
                  {patStatus?.connected && (
                    <div
                      className="flex items-center gap-1.5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-[10px] font-bold text-emerald-400"
                    >
                      <Check size={10} /> Connected
                    </div>
                  )}
                </div>

                {patStatus?.connected && patStatus.accountName && (
                  <div className="mb-3 rounded-lg border px-3 py-2 text-[11px]" style={{ borderColor: `${T.borderColor}20`, background: T.bgColor }}>
                    <span className="opacity-50">Account:</span>{" "}
                    <span className="font-bold" style={{ color: T.textColor }}>{patStatus.accountName}</span>
                    {patStatus.scopes.length > 0 && (
                      <span className="ml-2 opacity-40">Scopes: {patStatus.scopes.join(", ")}</span>
                    )}
                  </div>
                )}

                <button
                  type="button"
                  onClick={() => setPatDrawerOpen(true)}
                  className="w-full rounded-lg border px-3 py-2 text-[11px] font-bold transition-all hover:opacity-80"
                  style={{
                    borderColor: `${T.accentColor}30`,
                    color: T.accentColor,
                    backgroundColor: `${T.accentColor}08`,
                  }}
                >
                  {patStatus?.connected ? "Manage API Key" : "Connect with API Key"}
                </button>
              </div>
            </Section>

            {runtime.length > 0 && (
              <Section title="Runtime" description="Terminal and workspace execution">
                {runtime.map((i) => (
                  <IntegrationCard key={i.id} integration={i} onAction={handleAction} />
                ))}
              </Section>
            )}

            {ai.length > 0 && (
              <Section title="AI providers" description="At least one required for chat and generation">
                {ai.map((i) => (
                  <IntegrationCard key={i.id} integration={i} onAction={handleAction} />
                ))}
              </Section>
            )}

            {optional.length > 0 && (
              <Section title="Optional services" description="Add-on integrations — not required for core operation">
                {optional.map((i) => (
                  <IntegrationCard key={i.id} integration={i} onAction={handleAction} />
                ))}
              </Section>
            )}

            {metaStatus?.configured && (
              <Section title="Meta Developer" description="Facebook Pages, Instagram, and Graph API">
                <div
                  className="rounded-xl border p-4"
                  style={{ background: T.boxBg, borderColor: `${T.borderColor}30` }}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div
                        className="flex h-9 w-9 items-center justify-center rounded-lg text-lg font-black"
                        style={{ background: "#1877F220", color: "#1877F2" }}
                      >
                        f
                      </div>
                      <div>
                        <h3 className="text-sm font-bold" style={{ color: T.headerColor }}>
                          Meta Developer
                        </h3>
                        <span className="text-[10px] font-bold" style={{ color: metaStatus.connected ? "#22c55e" : "#f59e0b" }}>
                          {metaStatus.connected ? "Connected" : "Needs account"}
                        </span>
                      </div>
                    </div>
                  </div>
                  {metaStatus.connected && metaStatus.app && (
                    <div className="mt-3 grid grid-cols-2 gap-3 text-xs">
                      <div>
                        <span className="opacity-40">App Name</span>
                        <div className="font-semibold">{metaStatus.app.name}</div>
                      </div>
                      <div>
                        <span className="opacity-40">Mode</span>
                        <div className="font-semibold uppercase">{metaStatus.app.mode}</div>
                      </div>
                    </div>
                  )}
                </div>
              </Section>
            )}
          </div>
        )}
      </div>

      <GitHubPATDrawer open={patDrawerOpen} onClose={() => setPatDrawerOpen(false)} onConnectionChange={fetchPATStatus} />
    </div>
  );
}

function Section({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  const T = useTheme().resolvedColors;
  return (
    <div>
      <h2 className="mb-2 text-sm font-black" style={{ color: T.headerColor }}>{title}</h2>
      <p className="mb-3 text-xs opacity-40">{description}</p>
      <div className="grid gap-3 sm:grid-cols-2">{children}</div>
    </div>
  );
}
