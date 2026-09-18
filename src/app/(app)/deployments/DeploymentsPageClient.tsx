"use client";

import { useCallback, useEffect, useState } from "react";
import { useTheme } from "@/context/ThemeContext";
import { useClerkAuth } from "@/hooks/useClerkAuth";
import PageShell from "@/components/PageShell";
import {
  Rocket,
  ExternalLink,
  CheckCircle2,
  Clock,
  AlertTriangle,
  GitBranch,
  Loader2,
  Folder,
  Lock,
  Sparkles,
} from "lucide-react";
import Link from "next/link";

type Deployment = {
  id: string;
  integration_project_id: string;
  provider: string;
  deployment_id: string | null;
  environment: "production" | "preview" | "development";
  status: "pending" | "building" | "ready" | "error" | "canceled";
  url: string | null;
  commit_sha: string | null;
  commit_message: string | null;
  branch: string | null;
  created_at: string;
};

type PublishedSite = {
  id: string;
  projectId: string;
  projectName: string;
  status: "building" | "deploying" | "ready" | "failed";
  hosting: string;
  liveUrl: string | null;
  urlVerified: boolean;
  errorMessage: string | null;
  fileCount: number;
};

function statusIcon(status: string) {
  if (status === "ready")
    return <CheckCircle2 size={18} style={{ color: "#22c55e" }} />;
  if (status === "building" || status === "pending")
    return (
      <Clock size={18} className="animate-pulse" style={{ color: "#f59e0b" }} />
    );
  if (status === "error")
    return <AlertTriangle size={18} style={{ color: "#ef4444" }} />;
  return <Clock size={18} style={{ color: "#6b7280" }} />;
}

export default function DeploymentsPageClient() {
  const { resolvedColors: T, tokens } = useTheme();
  const { isLoaded, isSignedIn } = useClerkAuth();
  const [deployments, setDeployments] = useState<Deployment[]>([]);
  const [sites, setSites] = useState<PublishedSite[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadDeployments = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/deployments", { cache: "no-store", signal });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "Deployments are unavailable");
      setDeployments(Array.isArray(payload.deployments) ? payload.deployments : []);
      setSites(Array.isArray(payload.sites) ? payload.sites : []);
    } catch (loadError) {
      if ((loadError as { name?: string })?.name !== "AbortError") {
        setError("We couldn’t load deployment history. Your projects are unaffected—try again in a moment.");
      }
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isLoaded || !isSignedIn) {
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    void loadDeployments(controller.signal);
    return () => controller.abort();
  }, [isLoaded, isSignedIn, loadDeployments]);

  if (!isLoaded) {
    return (
      <div
        className="relative flex min-h-screen items-center justify-center overflow-hidden"
        style={{ backgroundColor: tokens.background }}
      >
        <div className="pointer-events-none absolute inset-0">
          <div
            className="absolute left-1/2 top-1/2 h-64 w-64 -translate-x-1/2 -translate-y-1/2 rounded-full blur-[80px] opacity-20"
            style={{ backgroundColor: tokens.primary }}
          />
        </div>
        <div className="relative flex flex-col items-center gap-3">
          <Loader2
            size={24}
            className="animate-spin"
            style={{ color: tokens.primary }}
          />
          <span
            className="text-xs font-black uppercase tracking-widest"
            style={{ color: tokens.textMuted }}
          >
            Loading deployments
          </span>
        </div>
      </div>
    );
  }

  if (!isSignedIn) {
    return (
      <div
        className="relative flex min-h-screen items-center justify-center overflow-hidden p-6"
        style={{ backgroundColor: tokens.background }}
      >
        <div
          className="relative max-w-sm w-full rounded-2xl border p-8 text-center"
          style={{
            backgroundColor: tokens.surface,
            borderColor: `${tokens.primary}20`,
          }}
        >
          <div
            className="mb-5 inline-flex h-14 w-14 items-center justify-center rounded-2xl"
            style={{
              backgroundColor: `${tokens.primary}12`,
              boxShadow: `0 0 24px ${tokens.primary}20`,
            }}
          >
            <Lock size={24} style={{ color: tokens.primary }} />
          </div>
          <div
            className="mb-1 text-base font-black"
            style={{ color: tokens.text }}
          >
            Sign in to view deployments
          </div>
          <div className="mb-5 text-xs" style={{ color: tokens.textMuted }}>
            Track your project builds and live deploys.
          </div>
          <Link
            href="/sign-in?redirect_url=/deployments"
            className="flex items-center justify-center gap-2 rounded-xl px-5 py-2.5 text-sm font-black text-black"
            style={{
              backgroundColor: tokens.primary,
              boxShadow: `0 0 16px ${tokens.primary}30`,
            }}
          >
            <Sparkles size={14} /> Sign In
          </Link>
        </div>
      </div>
    );
  }

  return (
    <PageShell
      title="Deployments"
      subtitle="Verified build history, preview links, and production releases"
      icon="🚀"
    >
      {/* Header banner */}
      <div className="px-4 sm:px-6 pt-4">
        <div
          className="rounded-2xl border p-4 sm:p-5 flex flex-col md:flex-row md:items-center md:justify-between gap-4"
          style={{
            background: `linear-gradient(135deg, ${tokens.primary}12, ${tokens.primary}06)`,
            borderColor: `${tokens.primary}25`,
          }}
        >
          <div>
            <div
              className="flex items-center gap-2 text-xs font-black uppercase tracking-widest mb-1"
              style={{ color: tokens.primary }}
            >
              <Rocket size={12} /> Deployment tracker
            </div>
            <p
              className="text-sm leading-relaxed max-w-2xl"
              style={{ color: tokens.textMuted }}
            >
              This history contains only deployments associated with your account. Open a live URL, inspect a failed release, or return to Studio for the next change.
            </p>
          </div>
          <Link
            href="/projects"
            className="inline-flex shrink-0 items-center gap-2 rounded-xl px-4 py-2 text-sm font-black transition-all hover:opacity-90"
            style={{
              backgroundColor: tokens.primary,
              color: tokens.background,
              boxShadow: `0 0 16px ${tokens.primary}30`,
            }}
          >
            <Folder size={14} /> Manage projects
          </Link>
        </div>
      </div>

      {/* Content */}
      <div className="px-4 sm:px-6 py-6">
        {!loading && !error && sites.length > 0 ? (
          <div className="mb-8">
            <div
              className="mb-3 text-xs font-black uppercase tracking-widest"
              style={{ color: tokens.textMuted }}
            >
              Published sites
            </div>
            <div className="space-y-3">
              {sites.map((site) => {
                const live = site.status === "ready" && site.urlVerified && site.liveUrl;
                return (
                  <div
                    key={site.id}
                    className="rounded-2xl border p-4 flex flex-col md:flex-row md:items-center justify-between gap-4"
                    style={{ backgroundColor: T.boxBg, borderColor: T.borderColor }}
                  >
                    <div className="flex items-center gap-3">
                      <div className="shrink-0">{statusIcon(live ? "ready" : site.status === "failed" ? "error" : "building")}</div>
                      <div>
                        <div className="font-black text-sm" style={{ color: tokens.text }}>
                          {site.projectName}
                        </div>
                        <div className="flex items-center gap-2 text-[10px] mt-0.5" style={{ color: tokens.textMuted }}>
                          <span>{site.hosting}</span>
                          <span>·</span>
                          <span>{live ? "Live" : site.status === "failed" ? "Failed" : "Publishing…"}</span>
                          <span>·</span>
                          <span>{site.fileCount} files</span>
                        </div>
                        {site.status === "failed" && site.errorMessage ? (
                          <p className="mt-1 max-w-xl truncate text-[11px]" style={{ color: "#ef4444" }}>
                            {site.errorMessage}
                          </p>
                        ) : null}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {live && site.liveUrl ? (
                        <a
                          href={site.liveUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex min-h-11 items-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-bold transition-all hover:opacity-80"
                          style={{ borderColor: T.borderColor, color: tokens.text }}
                        >
                          <ExternalLink size={11} /> Open live site
                        </a>
                      ) : (
                        <Link
                          href="/studio"
                          className="inline-flex min-h-11 items-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-bold transition-all hover:opacity-80"
                          style={{ borderColor: T.borderColor, color: tokens.text }}
                        >
                          <Sparkles size={11} /> Continue in Studio
                        </Link>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ) : null}
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-12">
            <Loader2
              size={18}
              className="animate-spin"
              style={{ color: tokens.primary }}
            />
            <span className="text-sm" style={{ color: tokens.textMuted }}>
              Loading projects…
            </span>
          </div>
        ) : error ? (
          <div
            className="rounded-2xl border p-5 flex flex-col items-start gap-3"
            style={{ borderColor: "#ef444430", backgroundColor: "#ef444408" }}
            role="alert"
          >
            <div className="flex items-start gap-3">
              <AlertTriangle size={18} className="mt-0.5 shrink-0" style={{ color: "#ef4444" }} />
              <div className="text-sm" style={{ color: tokens.text }}><strong>Deployment history unavailable</strong><p className="mt-1 opacity-75">{error}</p></div>
            </div>
            <button type="button" onClick={() => void loadDeployments()} className="min-h-11 rounded-xl border px-4 text-sm font-bold" style={{ borderColor: "#ef444450", color: tokens.text }}>Try again</button>
          </div>
        ) : deployments.length === 0 && sites.length === 0 ? (
          <div
            className="rounded-2xl border p-10 text-center"
            style={{ backgroundColor: T.boxBg, borderColor: T.borderColor }}
          >
            <div
              className="mb-4 inline-flex h-14 w-14 items-center justify-center rounded-2xl"
              style={{ backgroundColor: `${tokens.primary}10` }}
            >
              <Rocket size={24} style={{ color: tokens.primary }} />
            </div>
            <div
              className="mb-1 font-black text-sm"
              style={{ color: tokens.text }}
            >
              No deployments yet
            </div>
            <p
              className="text-xs mb-5 max-w-xs mx-auto leading-relaxed"
              style={{ color: tokens.textMuted }}
            >
              When you deploy a project, its build state and verified URL will appear here. Start in Studio or connect a repository first.
            </p>
            <Link
              href="/studio"
              className="inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-black"
              style={{
                backgroundColor: tokens.primary,
                color: tokens.background,
              }}
            >
              <Sparkles size={14} /> Open Studio
            </Link>
          </div>
        ) : (
          <div className="space-y-3">
            {deployments.map((deployment) => (
              <div
                key={deployment.id}
                className="group rounded-2xl border p-4 flex flex-col md:flex-row md:items-center justify-between gap-4 transition-all hover:border-opacity-60"
                style={{ backgroundColor: T.boxBg, borderColor: T.borderColor }}
              >
                <div className="flex items-center gap-3">
                  <div className="shrink-0">{statusIcon(deployment.status)}</div>
                  <div>
                    <div
                      className="font-black text-sm"
                      style={{ color: tokens.text }}
                    >
                      {deployment.environment.charAt(0).toUpperCase() + deployment.environment.slice(1)} deployment
                    </div>
                    <div
                      className="flex items-center gap-2 text-[10px] mt-0.5"
                      style={{ color: tokens.textMuted }}
                    >
                      <GitBranch size={10} />
                      <span>{deployment.branch || "Branch unavailable"}</span>
                      <span>·</span>
                      <span
                        className="rounded-full px-1.5 py-0.5 font-bold"
                        style={{
                          backgroundColor:
                            deployment.status === "ready"
                              ? "#22c55e20"
                              : deployment.status === "error"
                                ? "#ef444420"
                                : `${tokens.primary}15`,
                          color:
                            deployment.status === "ready"
                              ? "#22c55e"
                              : deployment.status === "error"
                                ? "#ef4444"
                                : tokens.primary,
                        }}
                      >
                        {deployment.status}
                      </span>
                      <span>·</span>
                      <span>{deployment.provider}</span>
                    </div>
                    {deployment.commit_message && <p className="mt-1 max-w-xl truncate text-[11px]" style={{ color: tokens.textMuted }}>{deployment.commit_message}</p>}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {deployment.url && deployment.status === "ready" ? (
                    <a href={deployment.url} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-bold transition-all hover:opacity-80" style={{ borderColor: T.borderColor, color: tokens.text }}><ExternalLink size={11} /> Open deployment</a>
                  ) : (
                    <Link href="/studio" className="inline-flex min-h-11 items-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-bold transition-all hover:opacity-80" style={{ borderColor: T.borderColor, color: tokens.text }}><Sparkles size={11} /> Continue in Studio</Link>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </PageShell>
  );
}
