"use client";

/**
 * RecentWork — real user projects list.
 *
 * Each entry: icon, name, "Updated Xm ago", Live/Draft/Building/Failed state.
 * Context menu: Open, Preview, Terminal, Pin, Project Settings.
 * Pinned projects appear above normal recent work.
 */

import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { MoreVertical, Pin, Terminal, Settings, ExternalLink } from "lucide-react";
import type { DashboardProject } from "./types";
import { getPinnedProjects, togglePin } from "./types";

interface RecentWorkProps {
  projects: DashboardProject[];
  loading: boolean;
  onOpenTerminal: () => void;
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
  const diff = Date.now() - date.getTime();
  if (diff < 0) return "just now";
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function ProjectIcon({ type }: { type: string }) {
  if (type === "mission") {
    return (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 2L2 7l10 5 10-5-10-5z" />
        <path d="M2 17l10 5 10-5" />
        <path d="M2 12l10 5 10-5" />
      </svg>
    );
  }
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="16 18 22 12 16 6" />
      <polyline points="8 6 2 12 8 18" />
    </svg>
  );
}

export function RecentWork({ projects, loading, onOpenTerminal }: RecentWorkProps) {
  const [pinned, setPinned] = useState<Set<string>>(() => getPinnedProjects());
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

  useEffect(() => {
    if (!openMenu) return;
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpenMenu(null);
      }
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpenMenu(null);
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [openMenu]);

  // Sort: pinned first, then by updatedAt
  const sorted = [...projects].sort((a, b) => {
    const aPinned = pinned.has(a.id);
    const bPinned = pinned.has(b.id);
    if (aPinned !== bPinned) return aPinned ? -1 : 1;
    const aTime = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
    const bTime = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
    return bTime - aTime;
  });

  const handlePin = (projectId: string) => {
    togglePin(projectId);
    setPinned(new Set(getPinnedProjects()));
    setOpenMenu(null);
  };

  return (
    <section
      className="flex flex-col gap-3 rounded-xl border p-5"
      style={{
        background: "rgba(18,18,21,0.7)",
        borderColor: "rgba(255,255,255,0.06)",
        backdropFilter: "blur(12px)",
      }}
    >
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium uppercase tracking-widest" style={{ color: "#71717a" }}>
          Recent Work
        </h3>
        <Link
          href="/projects"
          className="text-xs transition-colors"
          style={{ color: "#a78bfa" }}
          onMouseEnter={(e) => (e.currentTarget.style.color = "#c4b5fd")}
          onMouseLeave={(e) => (e.currentTarget.style.color = "#a78bfa")}
        >
          View All
        </Link>
      </div>

      {loading ? (
        <div className="flex flex-col gap-2">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="flex items-center gap-3 rounded-md p-3"
              style={{ background: "rgba(255,255,255,0.02)" }}
            >
              <div className="h-8 w-8 animate-pulse rounded" style={{ background: "rgba(255,255,255,0.06)" }} />
              <div className="flex-1 space-y-1.5">
                <div className="h-3.5 w-32 animate-pulse rounded" style={{ background: "rgba(255,255,255,0.06)" }} />
                <div className="h-2.5 w-20 animate-pulse rounded" style={{ background: "rgba(255,255,255,0.04)" }} />
              </div>
            </div>
          ))}
        </div>
      ) : sorted.length === 0 ? (
        <div className="py-6 text-center">
          <p className="text-sm" style={{ color: "#71717a" }}>
            No projects yet. Create one to get started.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-1.5">
          {sorted.map((project) => {
            const status = STATUS_CONFIG[project.status];
            const isPinned = pinned.has(project.id);
            const studioHref = project.repository
              ? `/studio?project=${encodeURIComponent(project.id)}`
              : "/studio";

            return (
              <div
                key={project.id}
                className="group relative flex items-center justify-between rounded-md p-3 transition-colors"
                onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(24,24,27,0.5)")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
              >
                <Link href={studioHref} className="flex min-w-0 flex-1 items-center gap-3">
                  <div
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded"
                    style={{ background: "rgba(30,30,34,0.8)", color: "#a1a1aa" }}
                  >
                    <ProjectIcon type={project.type} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <h4
                      className="truncate text-sm font-medium transition-colors"
                      style={{ color: "#fafafa" }}
                    >
                      {project.name}
                      {isPinned && (
                        <Pin
                          size={10}
                          className="ml-1.5 inline shrink-0"
                          style={{ color: "#a78bfa", fill: "#a78bfa" }}
                        />
                      )}
                    </h4>
                    <p className="mt-0.5 font-mono text-xs" style={{ color: "#71717a" }}>
                      Updated {timeAgo(project.updatedAt)}
                    </p>
                  </div>
                </Link>

                <div className="flex items-center gap-2">
                  <div
                    className="flex items-center gap-1.5 rounded border px-2 py-1"
                    style={{ borderColor: "rgba(255,255,255,0.06)", background: "rgba(18,18,21,0.6)" }}
                  >
                    <span
                      className="h-1.5 w-1.5 rounded-full"
                      style={{
                        background: status.color,
                        animation: project.status === "building" ? "pulse 2s ease-in-out infinite" : undefined,
                      }}
                    />
                    <span className="font-mono text-[10px]" style={{ color: "#a1a1aa" }}>
                      {status.label}
                    </span>
                  </div>

                  {/* Context menu */}
                  <div ref={openMenu === project.id ? menuRef : undefined} className="relative">
                    <button
                      onClick={() => setOpenMenu(openMenu === project.id ? null : project.id)}
                      className="flex items-center justify-center rounded p-1 opacity-0 transition-opacity group-hover:opacity-100"
                      style={{ color: "#71717a" }}
                      aria-label="Project options"
                    >
                      <MoreVertical size={14} />
                    </button>
                    {openMenu === project.id && (
                      <div
                        className="absolute right-0 top-full z-50 mt-1 w-44 rounded-lg border p-1.5 shadow-2xl"
                        style={{
                          borderColor: "rgba(255,255,255,0.08)",
                          background: "rgba(12,12,15,0.98)",
                          backdropFilter: "blur(16px)",
                        }}
                      >
                        {[
                          { label: "Open", icon: ExternalLink, action: () => router.push(studioHref) },
                          { label: "Preview", icon: ExternalLink, action: () => router.push("/studio?tool=preview") },
                          { label: "Terminal", icon: Terminal, action: onOpenTerminal },
                          { label: isPinned ? "Unpin" : "Pin", icon: Pin, action: () => handlePin(project.id) },
                          { label: "Project Settings", icon: Settings, action: () => router.push("/settings") },
                        ].map((item) => {
                          const Icon = item.icon;
                          return (
                            <button
                              key={item.label}
                              onClick={() => {
                                item.action();
                                setOpenMenu(null);
                              }}
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
          })}
        </div>
      )}
    </section>
  );
}
