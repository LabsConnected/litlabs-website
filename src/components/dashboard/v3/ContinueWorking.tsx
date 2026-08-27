"use client";

/**
 * ContinueWorking — hero card showing the user's actual last-active project.
 *
 * Shows: project name, type, branch, last edited, Live/Draft/etc status,
 * deployment state. Actions: Open Studio, Preview, and a More (•••) menu.
 */

import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { MoreHorizontal, Terminal, FolderOpen, Link2, Rocket, Settings } from "lucide-react";
import type { DashboardProject } from "./types";

interface ContinueWorkingProps {
  project: DashboardProject | null;
  loading: boolean;
  onOpenTerminal: () => void;
  onOpenDeveloperDrawer: () => void;
}

const STATUS_CONFIG: Record<DashboardProject["status"], { label: string; color: string }> = {
  live: { label: "Live", color: "#34d399" },
  building: { label: "Building", color: "#f59e0b" },
  failed: { label: "Failed", color: "#ef4444" },
  draft: { label: "Draft", color: "#71717a" },
  unknown: { label: "Unknown", color: "#71717a" },
};

function timeAgo(dateStr: string | null): string {
  if (!dateStr) return "—";
  const date = new Date(dateStr);
  const now = Date.now();
  const diff = now - date.getTime();
  if (diff < 0) return "just now";
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return date.toLocaleDateString();
}

export function ContinueWorking({
  project,
  loading,
  onOpenTerminal,
  onOpenDeveloperDrawer,
}: ContinueWorkingProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setMenuOpen(false);
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  if (loading) {
    return (
      <div
        className="relative overflow-hidden rounded-xl border p-6"
        style={{
          background: "rgba(18,18,21,0.7)",
          borderColor: "rgba(255,255,255,0.06)",
          backdropFilter: "blur(12px)",
        }}
      >
        <div className="h-4 w-32 animate-pulse rounded" style={{ background: "rgba(255,255,255,0.06)" }} />
        <div className="mt-3 h-8 w-48 animate-pulse rounded" style={{ background: "rgba(255,255,255,0.06)" }} />
        <div className="mt-4 flex gap-3">
          <div className="h-10 w-32 animate-pulse rounded-md" style={{ background: "rgba(255,255,255,0.06)" }} />
          <div className="h-10 w-28 animate-pulse rounded-md" style={{ background: "rgba(255,255,255,0.06)" }} />
        </div>
      </div>
    );
  }

  if (!project) {
    return (
      <div
        className="relative overflow-hidden rounded-xl border p-6"
        style={{
          background: "rgba(18,18,21,0.7)",
          borderColor: "rgba(255,255,255,0.06)",
          backdropFilter: "blur(12px)",
        }}
      >
        <h2 className="text-sm font-medium uppercase tracking-widest" style={{ color: "#71717a" }}>
          Continue Working
        </h2>
        <p className="mt-3 text-lg" style={{ color: "#a1a1aa" }}>
          Ready to build something? Start with a Quick Start option below.
        </p>
      </div>
    );
  }

  const status = STATUS_CONFIG[project.status];
  const studioHref = project.repository
    ? `/studio?project=${encodeURIComponent(project.id)}`
    : "/studio";

  const menuItems = [
    { label: "Open Terminal", icon: Terminal, action: () => { onOpenTerminal(); setMenuOpen(false); } },
    { label: "View Files", icon: FolderOpen, action: () => { router.push("/library/files"); setMenuOpen(false); } },
    { label: "Copy project link", icon: Link2, action: () => { void navigator.clipboard?.writeText(`${window.location.origin}/studio?project=${project.id}`); setMenuOpen(false); } },
    { label: "Deployment", icon: Rocket, action: () => { onOpenDeveloperDrawer(); setMenuOpen(false); } },
    { label: "Project settings", icon: Settings, action: () => { router.push("/settings"); setMenuOpen(false); } },
  ];

  return (
    <div
      className="group relative overflow-hidden rounded-xl border p-6 transition-colors"
      style={{
        background: "rgba(18,18,21,0.7)",
        borderColor: "rgba(255,255,255,0.06)",
        backdropFilter: "blur(12px)",
      }}
      onMouseEnter={(e) => (e.currentTarget.style.borderColor = "rgba(255,255,255,0.12)")}
      onMouseLeave={(e) => (e.currentTarget.style.borderColor = "rgba(255,255,255,0.06)")}
    >
      {/* Gradient overlay */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background: "linear-gradient(to bottom right, rgba(124,58,237,0.05), transparent)",
        }}
      />

      <div className="relative z-10 flex items-start justify-between">
        <div>
          <h2 className="text-sm font-medium uppercase tracking-widest" style={{ color: "#71717a" }}>
            Continue Working
          </h2>
          <h1 className="mt-2 text-2xl font-bold tracking-tight md:text-3xl" style={{ color: "#fafafa" }}>
            {project.name}
          </h1>
        </div>
        <div
          className="flex items-center gap-2 rounded-full border px-3 py-1"
          style={{ borderColor: "rgba(255,255,255,0.06)", background: "rgba(30,30,34,0.8)" }}
        >
          <span
            className="h-2 w-2 rounded-full"
            style={{
              background: status.color,
              boxShadow: project.status === "building" ? undefined : `0 0 4px ${status.color}80`,
              animation: project.status === "building" ? "pulse 2s ease-in-out infinite" : undefined,
            }}
          />
          <span className="font-mono text-xs" style={{ color: "#fafafa" }}>
            {status.label}
          </span>
        </div>
      </div>

      <div className="relative z-10 mt-4 flex items-center gap-4 font-mono text-sm" style={{ color: "#a1a1aa" }}>
        {project.branch && (
          <span className="flex items-center gap-1">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="6" y1="3" x2="6" y2="15" />
              <circle cx="18" cy="6" r="3" />
              <circle cx="6" cy="18" r="3" />
              <path d="M18 9a9 9 0 0 1-9 9" />
            </svg>
            {project.branch}
          </span>
        )}
        <span className="flex items-center gap-1">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <polyline points="12 6 12 12 16 14" />
          </svg>
          edited {timeAgo(project.updatedAt)}
        </span>
      </div>

      <div className="relative z-10 mt-5 flex items-center gap-3">
        <Link
          href={studioHref}
          className="flex items-center gap-2 rounded-md px-5 py-2.5 text-sm font-medium transition-colors"
          style={{
            background: "#a78bfa",
            color: "#0a0012",
            boxShadow: "0 0 15px rgba(167,139,250,0.3)",
          }}
          onMouseEnter={(e) => (e.currentTarget.style.background = "#c4b5fd")}
          onMouseLeave={(e) => (e.currentTarget.style.background = "#a78bfa")}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="2" y="2" width="20" height="8" rx="2" ry="2" />
            <rect x="2" y="14" width="20" height="8" rx="2" ry="2" />
            <line x1="6" y1="6" x2="6.01" y2="6" />
            <line x1="6" y1="18" x2="6.01" y2="18" />
          </svg>
          Open Studio
        </Link>

        {project.previewState === "ready" || project.deploymentState === "production" ? (
          <Link
            href="/studio?tool=preview"
            className="flex items-center gap-2 rounded-md border px-5 py-2.5 text-sm font-medium transition-all"
            style={{
              borderColor: "rgba(255,255,255,0.08)",
              color: "#fafafa",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = "rgba(255,255,255,0.15)";
              e.currentTarget.style.background = "rgba(24,24,27,0.5)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = "rgba(255,255,255,0.08)";
              e.currentTarget.style.background = "transparent";
            }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
            Preview
          </Link>
        ) : null}

        {/* More menu */}
        <div ref={menuRef} className="relative">
          <button
            onClick={() => setMenuOpen((v) => !v)}
            className="flex items-center justify-center rounded-md border p-2.5 transition-all"
            style={{
              borderColor: "rgba(255,255,255,0.08)",
              color: "#a1a1aa",
            }}
            aria-label="More options"
            onMouseEnter={(e) => (e.currentTarget.style.borderColor = "rgba(255,255,255,0.15)")}
            onMouseLeave={(e) => (e.currentTarget.style.borderColor = "rgba(255,255,255,0.08)")}
          >
            <MoreHorizontal size={16} />
          </button>
          {menuOpen && (
            <div
              className="absolute right-0 top-full z-50 mt-1.5 w-48 rounded-lg border p-1.5 shadow-2xl"
              style={{
                borderColor: "rgba(255,255,255,0.08)",
                background: "rgba(12,12,15,0.98)",
                backdropFilter: "blur(16px)",
              }}
            >
              {menuItems.map((item) => {
                const Icon = item.icon;
                return (
                  <button
                    key={item.label}
                    onClick={item.action}
                    className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-xs font-medium transition-colors"
                    style={{ color: "#a1a1aa" }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = "rgba(255,255,255,0.05)";
                      e.currentTarget.style.color = "#fafafa";
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = "transparent";
                      e.currentTarget.style.color = "#a1a1aa";
                    }}
                  >
                    <Icon size={14} />
                    {item.label}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
