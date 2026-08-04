"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  PanelRightClose,
  PanelRightOpen,
  PanelBottomClose,
  PanelBottomOpen,
  ClipboardList,
  GitPullRequest,
  Folder,
  Eye,
  CircleCheck,
  ShieldCheck,
  Activity,
  Terminal,
  Music,
} from "lucide-react";
import type { InspectorTab, DrawerTab } from "../lib/studio-destinations";
import type { ConnectionCapabilities } from "../hooks/useConnectionSummary";
import type { ChatMessage } from "../stores/useStudioAgentStore";
import type { ProviderHealth } from "../stores/useStudioModelStore";
import StudioActivityTimeline from "./StudioActivityTimeline";
import StudioHealthPanel from "./StudioHealthPanel";
import StudioPreviewPanel from "./StudioPreviewPanel";
import StudioProjectFiles from "./StudioProjectFiles";

/**
 * StudioWorkspaceFrame — collapsible right inspector + bottom drawer.
 *
 * Right inspector tabs: Plan | Changes | Checks | Approvals
 * Bottom drawer tabs:   Activity | Terminal
 *
 * Both start collapsed. When open, the inspector overlays content on
 * mobile and splits the layout on desktop. The drawer never covers the
 * composer (it sits above it with a max-height).
 *
 * Phase 1 only renders the frame + tab chrome. Tab content is a slot so
 * Phase 2 can wire real run data without touching this component.
 */

const INSPECTOR_TABS: { id: InspectorTab; label: string; icon: typeof ClipboardList }[] = [
  { id: "plan", label: "Plan", icon: ClipboardList },
  { id: "changes", label: "Changes", icon: GitPullRequest },
  { id: "files", label: "Files", icon: Folder },
  { id: "preview", label: "Preview", icon: Eye },
  { id: "checks", label: "Checks", icon: CircleCheck },
  { id: "approvals", label: "Approvals", icon: ShieldCheck },
];

const DRAWER_TABS: { id: DrawerTab; label: string; icon: typeof Activity }[] = [
  { id: "terminal", label: "Terminal", icon: Terminal },
  { id: "media", label: "Media", icon: Music },
];

export interface StudioInspectorData {
  capabilities: ConnectionCapabilities;
  modelLabel: string;
  modelHealth?: ProviderHealth;
  activeAgentName: string;
  destination: string;
  surface: string;
  messages: ChatMessage[];
  busy: boolean;
  workspaceRevision: number;
  /** Incremented to trigger a run-all health check from outside the panel */
  healthRunTrigger?: number;
  onFilesSaved?: () => void;
  onWorkspacePrepared?: () => void;
}

function InspectorRow({ label, value, tone = "muted" }: { label: string; value: string; tone?: "ok" | "warn" | "muted" }) {
  const color = tone === "ok" ? "var(--litt-primary)" : tone === "warn" ? "#e3b341" : "var(--text-secondary)";
  return (
    <div className="flex items-start justify-between gap-3 border-b py-2 last:border-0" style={{ borderColor: "var(--studio-border)" }}>
      <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>{label}</span>
      <span className="max-w-[62%] truncate text-right text-[10px] font-bold" style={{ color }} title={value}>{value}</span>
    </div>
  );
}

function InspectorSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-1.5">
      <h3 className="px-0.5 text-[9px] font-black uppercase tracking-[0.18em]" style={{ color: "var(--text-muted)" }}>{title}</h3>
      <div className="rounded-xl border px-2.5" style={{ borderColor: "var(--studio-border)", backgroundColor: "var(--studio-card)" }}>
        {children}
      </div>
    </section>
  );
}

function InspectorContent({ tab, data }: { tab: InspectorTab; data: StudioInspectorData }) {
  const { capabilities, messages } = data;
  const lastMessage = messages[messages.length - 1];

  if (tab === "files") {
    return (
      <StudioProjectFiles
        projectId={capabilities.projectId}
        repositoryName={capabilities.repositoryName}
        branch={capabilities.activeBranch ?? capabilities.defaultBranch}
        workspaceStatus={capabilities.workspaceStatus}
        writeAccess={capabilities.writeAccess}
        onSaved={data.onFilesSaved}
        onMutation={data.onFilesSaved}
        onWorkspacePrepared={data.onWorkspacePrepared}
      />
    );
  }

  if (tab === "preview") {
    return (
      <StudioPreviewPanel
        projectId={capabilities.projectId}
        projectName={capabilities.projectName}
        repositoryName={capabilities.repositoryName}
        branch={capabilities.activeBranch ?? capabilities.defaultBranch}
        workspaceStatus={capabilities.workspaceStatus}
        refreshKey={data.workspaceRevision}
      />
    );
  }

  if (tab === "checks") {
    return <StudioHealthPanel mode="checks" projectId={capabilities.projectId} refreshKey={data.workspaceRevision} runTrigger={data.healthRunTrigger} />;
  }

  if (tab === "changes") {
    return (
      <div className="space-y-4">
        <InspectorSection title="Current surface">
          <InspectorRow label="Destination" value={data.destination} />
          <InspectorRow label="Surface" value={data.surface} />
          <InspectorRow label="Messages" value={String(messages.length)} />
          <InspectorRow label="Latest state" value={lastMessage?.status ?? "No messages yet"} tone={lastMessage?.status === "failed" ? "warn" : lastMessage ? "ok" : "muted"} />
        </InspectorSection>
        <InspectorSection title="Repository scope">
          <InspectorRow label="Repository" value={capabilities.repositoryName ?? "Not connected"} tone={capabilities.repositoryName ? "ok" : "muted"} />
          <InspectorRow label="Branch" value={capabilities.activeBranch ?? capabilities.defaultBranch ?? "Not available"} />
          <InspectorRow label="Index" value={capabilities.repositoryIndexed ? "Indexed" : "Not indexed"} tone={capabilities.repositoryIndexed ? "ok" : "muted"} />
        </InspectorSection>
        <div className="rounded-xl border px-3 py-2.5 text-[10px] leading-4" style={{ borderColor: "var(--studio-border)", backgroundColor: "rgba(114,242,56,0.04)", color: "var(--text-muted)" }}>
          File-level changes will appear here when a project write or checkpoint is available. The imported prototype showed sample files; this panel only reports real workspace state.
        </div>
      </div>
    );
  }

  if (tab === "approvals") {
    return <StudioHealthPanel mode="approvals" projectId={capabilities.projectId} refreshKey={data.workspaceRevision} />;
  }

  return (
    <div className="space-y-4">
      <InspectorSection title="Command center">
        <InspectorRow label="Project" value={capabilities.projectName ?? "No project selected"} tone={capabilities.projectId ? "ok" : "warn"} />
        <InspectorRow label="Agent" value={data.activeAgentName} />
        <InspectorRow label="Model" value={data.modelLabel} tone={data.modelHealth === "available" ? "ok" : data.modelHealth ? "warn" : "muted"} />
        <InspectorRow label="Status" value={data.busy ? "Agent working" : messages.length ? "Ready" : "Awaiting prompt"} tone={data.busy ? "ok" : "muted"} />
      </InspectorSection>
      <InspectorSection title="Project context">
        <InspectorRow label="Source" value={capabilities.sourceType ?? "Not selected"} />
        <InspectorRow label="Repository" value={capabilities.repositoryName ?? "Not connected"} />
        <InspectorRow label="Branch" value={capabilities.activeBranch ?? capabilities.defaultBranch ?? "Not available"} />
        <InspectorRow label="Permission" value={capabilities.writeAccess ? "Writes allowed" : "Approval required"} tone={capabilities.writeAccess ? "ok" : "warn"} />
      </InspectorSection>
      <div className="rounded-xl border px-3 py-2.5 text-[10px] leading-4" style={{ borderColor: "rgba(114,242,56,0.2)", backgroundColor: "rgba(114,242,56,0.04)", color: "var(--text-secondary)" }}>
        {data.busy ? "LiTT is working in the active workspace." : capabilities.projectId ? "Workspace context is attached to the next request." : "Start with a blank project or connect a repository to unlock project actions."}
      </div>
    </div>
  );
}

export function StudioInspector({
  open,
  onToggle,
  activeTab,
  onTabChange,
  children,
  data,
}: {
  open: boolean;
  onToggle: () => void;
  activeTab: InspectorTab;
  onTabChange: (t: InspectorTab) => void;
  children?: React.ReactNode;
  data?: StudioInspectorData;
}) {
  return (
    <>
      {/* Collapse/expand handle — always visible on desktop */}
      <button
        type="button"
        onClick={onToggle}
        className="hidden h-9 w-7 shrink-0 items-center justify-center border-l transition hover:bg-white/5 md:flex"
        style={{
          backgroundColor: "var(--studio-surface)",
          borderColor: "var(--studio-border)",
          color: "var(--text-muted)",
        }}
        aria-label={open ? "Collapse inspector" : "Open inspector"}
        title={open ? "Collapse inspector" : "Open inspector"}
      >
        {open ? <PanelRightClose size={14} className="pointer-events-none" /> : <PanelRightOpen size={14} className="pointer-events-none" />}
      </button>

      {open && (
        <>
          <button type="button" className="fixed inset-0 z-30 bg-black/45 md:hidden" onClick={onToggle} aria-label="Close inspector" />
          <aside
            className="fixed inset-y-0 right-0 z-40 flex w-[min(92vw,320px)] min-w-0 flex-col border-l md:relative md:inset-auto md:z-auto md:w-[min(320px,30vw)] md:pt-0"
            style={{
              backgroundColor: "var(--studio-surface)",
              borderColor: "var(--studio-border)",
              paddingTop: "env(safe-area-inset-top)",
            }}
          >
            <div className="flex shrink-0 items-center justify-between border-b px-2 md:hidden" style={{ borderColor: "var(--studio-border)" }}>
              <span className="text-[10px] font-black uppercase tracking-[0.16em]" style={{ color: "var(--text-secondary)" }}>Workspace inspector</span>
              <button type="button" onClick={onToggle} className="rounded-md px-2 py-1 text-xs" style={{ color: "var(--text-muted)" }} aria-label="Close inspector">×</button>
            </div>
            <div
              className="flex shrink-0 items-center gap-0.5 border-b px-1.5"
              style={{ borderColor: "var(--studio-border)" }}
            >
              {INSPECTOR_TABS.map((t) => {
                const Icon = t.icon;
                const isActive = activeTab === t.id;
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => onTabChange(t.id)}
                    className="flex flex-1 items-center justify-center gap-1.5 px-2 py-2.5 text-[10px] font-bold transition"
                    style={{
                      color: isActive ? "var(--litt-primary)" : "var(--text-muted)",
                      borderBottom: isActive ? "2px solid var(--litt-primary)" : "2px solid transparent",
                    }}
                    aria-label={t.label}
                    aria-current={isActive ? "page" : undefined}
                  >
                    <Icon size={12} className="pointer-events-none" />
                    <span className="hidden lg:inline">{t.label}</span>
                  </button>
                );
              })}
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-2.5" role="region" aria-label={`${activeTab} inspector`}>
              {children ?? (data ? <InspectorContent tab={activeTab} data={data} /> : (
                <div className="flex h-full items-center justify-center text-[11px]" style={{ color: "var(--text-muted)" }} role="status">
                  No {activeTab} yet
                </div>
              ))}
            </div>
          </aside>
        </>
      )}
    </>
  );
}

function activityTime(createdAt?: number) {
  if (!createdAt) return "now";
  const diff = Math.max(0, Date.now() - createdAt);
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  return `${Math.floor(diff / 3_600_000)}h ago`;
}

export function StudioActivityPanel({
  messages,
  busy,
  modelLabel,
  projectName,
  terminalStatus,
}: {
  messages: ChatMessage[];
  busy: boolean;
  modelLabel: string;
  projectName: string | null;
  terminalStatus: string;
}) {
  const recent = messages.slice(-8).reverse();
  const activityRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (busy) activityRef.current?.scrollIntoView({ block: "nearest" });
  }, [busy]);

  return (
    <div ref={activityRef} className="space-y-2" data-testid="studio-activity-panel" aria-live="polite" aria-label="Studio activity">
      <div className="grid grid-cols-2 gap-1.5">
        <div className="rounded-lg border px-2.5 py-2" style={{ borderColor: "var(--studio-border)", backgroundColor: "var(--studio-card)" }}>
          <div className="text-[9px] uppercase tracking-[0.14em]" style={{ color: "var(--text-muted)" }}>Workspace</div>
          <div className="mt-1 truncate text-[10px] font-bold" style={{ color: "var(--text-primary)" }}>{projectName ?? "No project"}</div>
        </div>
        <div className="rounded-lg border px-2.5 py-2" style={{ borderColor: "var(--studio-border)", backgroundColor: "var(--studio-card)" }}>
          <div className="text-[9px] uppercase tracking-[0.14em]" style={{ color: "var(--text-muted)" }}>Model</div>
          <div className="mt-1 truncate text-[10px] font-bold" style={{ color: "var(--text-primary)" }}>{modelLabel}</div>
        </div>
      </div>
      {busy && (
        <div className="flex items-center gap-2 rounded-lg border px-2.5 py-2 text-[10px]" style={{ borderColor: "rgba(167,139,250,0.25)", backgroundColor: "rgba(167,139,250,0.06)", color: "#c4b5fd" }}>
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-violet-400" aria-hidden />
          Agent working in the active conversation
        </div>
      )}
      {recent.length > 0 ? (
        <div className="space-y-1">
          {recent.map((message) => {
            const isUser = message.role === "user";
            const state = message.status === "failed" ? "Failed" : message.status === "streaming" ? "Streaming" : isUser ? "Prompt sent" : "Response";
            return (
              <div key={message.id ?? `${message.createdAt}-${message.content.slice(0, 12)}`} className="flex items-start gap-2 rounded-lg border px-2.5 py-2" style={{ borderColor: "var(--studio-border)", backgroundColor: "var(--studio-card)" }}>
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: message.status === "failed" ? "#ef4444" : isUser ? "#fb923c" : "var(--litt-primary)" }} aria-hidden />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[10px] font-bold" style={{ color: "var(--text-primary)" }}>{isUser ? "You" : "LiTT"} · {state}</span>
                    <span className="shrink-0 text-[9px]" style={{ color: "var(--text-muted)" }}>{activityTime(message.createdAt)}</span>
                  </div>
                  <div className="mt-0.5 truncate text-[9px]" style={{ color: "var(--text-secondary)" }}>{message.content || "Working…"}</div>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div
          className="flex min-h-24 items-center justify-center rounded-lg border px-3 text-center text-[10px]"
          style={{ borderColor: "var(--studio-border)", color: "var(--text-muted)" }}
          role="status"
        >
          No conversation activity yet.
        </div>
      )}
      <div className="flex items-center justify-between px-1 text-[9px]" style={{ color: "var(--text-muted)" }}>
        <span>Terminal: {terminalStatus}</span>
        <span>{messages.length} message{messages.length === 1 ? "" : "s"}</span>
      </div>
      <StudioActivityTimeline />
    </div>
  );
}

export function StudioDrawer({
  open,
  onToggle,
  activeTab,
  onTabChange,
  children,
}: {
  open: boolean;
  onToggle: () => void;
  activeTab: DrawerTab;
  onTabChange: (t: DrawerTab) => void;
  children?: React.ReactNode;
}) {
  // Resizable drawer height — persisted to localStorage so the user's
  // preferred terminal/activity size survives reloads.
  const DRAWER_MIN = 120;
  const DRAWER_MAX_DVH = 75;
  const DRAWER_STORAGE_KEY = "studio-drawer-height";
  const [drawerHeight, setDrawerHeight] = useState<number>(() => {
    if (typeof window === "undefined") return 240;
    const stored = window.localStorage.getItem(DRAWER_STORAGE_KEY);
    const parsed = stored ? Number(stored) : NaN;
    return Number.isFinite(parsed) && parsed >= DRAWER_MIN ? parsed : 240;
  });
  const draggingRef = useRef(false);
  const startYRef = useRef(0);
  const startHeightRef = useRef(0);

  const clampHeight = useCallback((h: number) => {
    const max = Math.round(window.innerHeight * (DRAWER_MAX_DVH / 100));
    return Math.max(DRAWER_MIN, Math.min(max, h));
  }, []);

  const onHandlePointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    // Only the resize grip initiates a drag (not the tab bar).
    if ((e.target as HTMLElement).dataset.resizeGrip !== "true") return;
    e.preventDefault();
    draggingRef.current = true;
    startYRef.current = e.clientY;
    startHeightRef.current = drawerHeight;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    document.body.style.cursor = "row-resize";
    document.body.style.userSelect = "none";
  }, [drawerHeight]);

  const onHandlePointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return;
    const delta = startYRef.current - e.clientY;
    const next = clampHeight(startHeightRef.current + delta);
    setDrawerHeight(next);
  }, [clampHeight]);

  const onHandlePointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
    try { (e.target as HTMLElement).releasePointerCapture(e.pointerId); } catch { /* noop */ }
    try { window.localStorage.setItem(DRAWER_STORAGE_KEY, String(drawerHeight)); } catch { /* noop */ }
  }, [drawerHeight]);

  // Lock body scroll when the drawer is open on mobile so the page
  // doesn't scroll behind it. Drawer never covers the composer — it
  // sits above it with a capped height.
  useEffect(() => {
    if (!open) return;
    const mobile = window.matchMedia("(max-width: 767px)").matches;
    if (!mobile) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  return (
    <>
      {/* Toggle handle — sits at the bottom edge above the composer */}
      <div
        className="flex shrink-0 items-center justify-center border-t"
        style={{
          height: 32,
          backgroundColor: "var(--studio-surface)",
          borderColor: "var(--studio-border)",
        }}
      >
        <button
          type="button"
          onClick={onToggle}
          className="flex h-full w-full items-center justify-center gap-1.5 text-[10px] font-bold transition hover:bg-white/5"
          style={{ color: "var(--text-muted)" }}
          aria-label={open ? "Close drawer" : "Open drawer"}
          aria-expanded={open}
        >
          {open ? <PanelBottomClose size={13} className="pointer-events-none" /> : <PanelBottomOpen size={13} className="pointer-events-none" />}
          <span>{open ? "Close" : "Terminal / Media"}</span>
        </button>
      </div>

      {open && (
        <div
          className="flex shrink-0 flex-col border-t"
          style={{
            backgroundColor: "var(--studio-surface)",
            borderColor: "var(--studio-border)",
            height: drawerHeight,
          }}
          onPointerDown={onHandlePointerDown}
          onPointerMove={onHandlePointerMove}
          onPointerUp={onHandlePointerUp}
          onPointerCancel={onHandlePointerUp}
        >
          {/* Drag-to-resize grip — drag up to enlarge, down to shrink */}
          <div
            data-resize-grip="true"
            className="group flex shrink-0 cursor-row-resize items-center justify-center border-b py-1 transition hover:bg-white/5"
            style={{ borderColor: "var(--studio-border)", touchAction: "none" }}
            role="separator"
            aria-orientation="horizontal"
            aria-label="Drag to resize panel"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === "ArrowUp") { e.preventDefault(); setDrawerHeight((h) => clampHeight(h + 32)); }
              if (e.key === "ArrowDown") { e.preventDefault(); setDrawerHeight((h) => clampHeight(h - 32)); }
            }}
          >
            <div
              data-resize-grip="true"
              className="h-1 w-10 rounded-full bg-white/15 transition group-hover:bg-white/30 group-active:bg-[var(--litt-primary)]"
            />
          </div>
          <div className="flex shrink-0 items-center gap-0.5 border-b px-1.5" style={{ borderColor: "var(--studio-border)" }}>
            {DRAWER_TABS.map((t) => {
              const Icon = t.icon;
              const isActive = activeTab === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => onTabChange(t.id)}
                  className="flex items-center gap-1.5 px-3 py-2 text-[10px] font-bold transition"
                  style={{
                    color: isActive ? "var(--litt-primary)" : "var(--text-muted)",
                    borderBottom: isActive ? "2px solid var(--litt-primary)" : "2px solid transparent",
                  }}
                  aria-label={t.label}
                >
                  <Icon size={12} className="pointer-events-none" />
                  {t.label}
                </button>
              );
            })}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-2">
            {children ?? (
              <div className="flex h-full items-center justify-center text-[11px]" style={{ color: "var(--text-muted)" }}>
                {activeTab === "terminal" ? "Terminal not connected" : activeTab === "media" ? "Media not loaded" : "No activity yet"}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
