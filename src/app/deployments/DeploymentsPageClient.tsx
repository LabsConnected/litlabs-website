"use client";

import { useTheme } from "@/context/ThemeContext";
import { useClerkAuth } from "@/hooks/useClerkAuth";
import PageShell from "@/components/PageShell";
import { Rocket, ExternalLink, CheckCircle2, Clock, AlertTriangle, GitBranch } from "lucide-react";
import Link from "next/link";

const DEPLOYMENTS = [
  {
    id: "prod-1",
    name: "Production",
    url: "https://litlabs.net",
    status: "success",
    branch: "main",
    commit: "7d3a9f2",
    time: "2 hours ago",
  },
  {
    id: "preview-1",
    name: "Preview",
    url: "https://litlabs-git-litt-landing-page-larrys-projects.vercel.app",
    status: "building",
    branch: "litt/landing-page",
    commit: "a1b2c3d",
    time: "12 minutes ago",
  },
];

export default function DeploymentsPageClient() {
  const { resolvedColors: T } = useTheme();
  const { isLoaded, isSignedIn } = useClerkAuth();

  if (!isLoaded) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: T.bgColor }}>
        <div className="text-center">
          <div className="text-2xl mb-2 animate-pulse">🚀</div>
          <div>Loading deployments...</div>
        </div>
      </div>
    );
  }

  if (!isSignedIn) {
    return (
      <PageShell title="Sign In">
        <div className="min-h-[60vh] flex flex-col items-center justify-center gap-4">
          <p className="text-sm opacity-60">Please sign in to view deployments.</p>
          <Link
            href="/sign-in?redirect_url=/deployments"
            className="px-4 py-2 rounded-lg text-sm font-bold"
            style={{ backgroundColor: "#6366f1", color: "#fff" }}
          >
            Sign In
          </Link>
        </div>
      </PageShell>
    );
  }

  return (
    <PageShell title="Deployments" subtitle="Track previews and production releases" icon="🚀">
      <div className="px-4 sm:px-6 pt-4">
        <div
          className="rounded-3xl border p-4 sm:p-5 flex flex-col md:flex-row md:items-center md:justify-between gap-4"
          style={{
            background: "linear-gradient(135deg, rgba(34,211,238,0.12), rgba(59,130,246,0.08))",
            borderColor: `${T.borderColor}30`,
          }}
        >
          <div>
            <div className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.24em] mb-1" style={{ color: T.accentColor }}>
              <Rocket size={12} /> Deployment status
            </div>
            <p className="text-sm opacity-75 max-w-2xl">
              Deployments will be tracked per project once GitHub integration is live. For now, production is aliased from Vercel.
            </p>
          </div>
          <Link
            href="/studio"
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold"
            style={{ backgroundColor: T.accentColor, color: T.bgColor }}
          >
            Open Studio
          </Link>
        </div>
      </div>

      <div className="px-4 sm:px-6 py-6 space-y-4">
        {DEPLOYMENTS.map((d) => (
          <div
            key={d.id}
            className="rounded-2xl border p-4 flex flex-col md:flex-row md:items-center justify-between gap-4"
            style={{ backgroundColor: T.boxBg, borderColor: T.borderColor }}
          >
            <div className="flex items-center gap-3">
              {d.status === "success" ? (
                <CheckCircle2 size={20} style={{ color: "#22c55e" }} />
              ) : d.status === "building" ? (
                <Clock size={20} className="animate-pulse" style={{ color: "#f59e0b" }} />
              ) : (
                <AlertTriangle size={20} style={{ color: "#ef4444" }} />
              )}
              <div>
                <div className="font-bold text-sm" style={{ color: T.headerColor }}>
                  {d.name}
                </div>
                <div className="text-[10px] opacity-60 flex items-center gap-2">
                  <GitBranch size={10} /> {d.branch} • {d.commit} • {d.time}
                </div>
              </div>
            </div>
            <a
              href={d.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-bold border"
              style={{ borderColor: T.borderColor, color: T.textColor }}
            >
              <ExternalLink size={12} /> Visit
            </a>
          </div>
        ))}
      </div>
    </PageShell>
  );
}
