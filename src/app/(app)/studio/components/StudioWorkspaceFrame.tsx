"use client";

import { useEffect, useRef, useState } from "react";
import {
  PanelRightClose,
  PanelRightOpen,
  ClipboardList,
  GitPullRequest,
  Folder,
  Eye,
  CircleCheck,
  ShieldCheck,
  Globe,
  AlertTriangle,
} from "lucide-react";
import type { InspectorTab } from "../lib/studio-destinations";
import type { ConnectionCapabilities } from "../hooks/useConnectionSummary";
import { describeSourceRows } from "../lib/source-rows";
import type { ChatMessage } from "../stores/useStudioAgentStore";
import type { ProviderHealth } from "../stores/useStudioModelStore";
import StudioActivityTimeline from "./StudioActivityTimeline";
import StudioHealthPanel from "./StudioHealthPanel";
import StudioPreviewPanel from "./StudioPreviewPanel";
import StudioProjectFiles from "./StudioProjectFiles";
import StudioBrowserJobsPanel from "./StudioBrowserJobsPanel";
import { useClerkAuth } from "@/hooks/useClerkAuth";

interface DeploymentSummary {
  id: string;
  status: string;
  publicUrl: string | null;
  urlVerified: boolean;
  errorMessage: string | null;
}

interface HostingSummary {
  name: string;
  configured: boolean;
  reason?: string | null;
}

/**
 * Publish readiness — early warnings for the LiTT Hosting publish pipeline.
 *
 * Publish rejects non-static or oversized artifacts *after* the deploy
 * approval flow. This block surfaces the same failure modes beforehand,
 * next to the deploy affordance, so the user can fix them first.
 */
interface ReadinessWarning {
  code: string;
  message: string;
}

function PublishReadinessBlock({ projectId }: { projectId: string }) {
  const { getToken } = useClerkAuth();
  const [warnings, setWarnings] = useState<ReadinessWarning[] | null>(null);
  const [checkable, setCheckable] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const token = await getToken?.();
        const res = await fetch(
          `/api/studio-projects/${encodeURIComponent(projectId)}/publish-readiness`,
          {
            cache: "no-store",
            credentials: "include",
            headers: token ? { Authorization: `Bearer ${token}` } : {},
            signal: AbortSignal.timeout(20000),
          },
        );
        if (!res.ok) return;
        const data = (await res.json().catch(() => null)) as {
          checkable?: boolean;
          warnings?: ReadinessWarning[];
        } | null;
        if (!cancelled && data?.checkable) {
          setCheckable(true);
          setWarnings(data.warnings ?? []);
        }
      } catch {
        // Non-fatal — the readiness block simply doesn't render.
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [projectId, getToken]);

  if (!checkable || warnings === null) return null;

  if (warnings.length === 0) {
    return (
      <div className="flex items-center gap-1.5 py-2 text-[10px] leading-4" style={{ color: "#6ee7b7" }}>
        <CircleCheck size={12} style={{ flexShrink: 0 }} />
        Looks publishable — static files within publish limits.
      </div>
    );
  }

  return (
    <div
      className="my-2 rounded-lg border p-2.5"
      style={{ borderColor: "rgba(245,158,11,0.35)", background: "rgba(245,158,11,0.06)" }}
      role="alert"
    >
      <div className="mb-1.5 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider" style={{ color: "#fbbf24" }}>
        <AlertTriangle size={12} />
        Before you deploy
      </div>
      <ul className="space-y-1.5">
        {warnings.map((w) => (
          <li key={w.code} className="text-[10px] leading-4" style={{ color: "#fde68a" }}>
            {w.message}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Durable deployment status — the visible record of what project.deploy did.
 * Reads the deployment store (the same record the agent's deploy tool
 * writes), so a deploy that finished while the user was elsewhere still
 * shows up here with its verified public URL.
 */
function DeploymentStatusSection({ projectId }: { projectId: string | null }) {
  const { getToken } = useClerkAuth();
  const [deployment, setDeployment] = useState<DeploymentSummary | null>(null);
  const [hosting, setHosting] = useState<HostingSummary | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!projectId) {
      setDeployment(null);
      setHosting(null);
      return;
    }
    let cancelled = false;
    let interval: ReturnType<typeof setInterval> | null = null;
    const load = async () => {
      try {
        const token = await getToken?.();
        const res = await fetch(`/api/studio-projects/${encodeURIComponent(projectId)}/deployments`, {
          cache: "no-store",
          credentials: "include",
          headers: token ? { Authorization: `Bearer ${token}` } : {},
          signal: AbortSignal.timeout(15000),
        });
        if (!res.ok) return;
        const data = await res.json().catch(() => null) as { deployment?: DeploymentSummary | null; hosting?: HostingSummary | null } | null;
        if (!cancelled) {
          setDeployment(data?.deployment ?? null);
          setHosting(data?.hosting ?? null);
        }
      } catch {
        // Non-fatal — the section simply shows the last known state.
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    setLoading(true);
    void load();
    // A deploy runs server-side via the agent; poll lightly so a deploy
    // that finishes while the inspector is open appears without a refresh.
    interval = setInterval(() => { void load(); }, 30_000);
    return () => {
      cancelled = true;
      if (interval) clearInterval(interval);
    };
  }, [projectId, getToken]);

  if (!projectId) return null;

  const statusLabel =
    loading && !deployment ? "Checking…" :
    !deployment ? "Not deployed yet" :
    deployment.status === "ready" ? (deployment.urlVerified ? "Live" : "Ready — verifying") :
    deployment.status === "failed" ? "Failed" :
    deployment.status === "building" ? "Building…" :
    deployment.status === "deploying" ? "Deploying…" :
    deployment.status;
  const tone = deployment?.status === "ready" && deployment.urlVerified ? "ok"
    : deployment?.status === "failed" ? "warn" : "muted";

  return (
    <InspectorSection title="Deployment">
      <InspectorRow label="Status" value={statusLabel} tone={tone} />
      {hosting ? (
        <InspectorRow
          label="Hosting"
          value={hosting.configured ? hosting.name : `${hosting.name} — unavailable`}
          tone={hosting.configured ? "muted" : "warn"}
        />
      ) : null}
      {/* Early publish warnings — before the user goes through approval. */}
      {(!deployment || deployment.status !== "ready") ? (
        <PublishReadinessBlock projectId={projectId} />
      ) : null}
      {deployment?.publicUrl && deployment.urlVerified ? (
        <div className="flex items-start justify-between gap-3 border-b py-2 last:border-0" style={{ borderColor: "var(--studio-border)" }}>
          <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>Live URL</span>
          <a
            href={deployment.publicUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="max-w-[62%] truncate text-right text-[10px] font-bold underline"
            style={{ color: "var(--litt-primary)" }}
            title={deployment.publicUrl}
          >
            {deployment.publicUrl.replace(/^https?:\/\//, "")}
          </a>
        </div>
      ) : null}
      {deployment?.status === "failed" && deployment.errorMessage ? (
        <div className="py-2 text-[10px] leading-4" style={{ color: "#fca5a5" }} title={deployment.errorMessage}>
          {deployment.errorMessage.length > 140 ? `${deployment.errorMessage.slice(0, 140)}…` : deployment.errorMessage}
        </div>
      ) : null}
      {!deployment && !loading ? (
        hosting && !hosting.configured ? (
          <div className="py-2 text-[10px] leading-4" style={{ color: "#fca5a5" }}>
            {hosting.reason ?? "Publishing is unavailable right now."}
          </div>
        ) : (
          <div className="py-2 text-[10px] leading-4" style={{ color: "var(--text-muted)" }}>
            Ask LiTT in chat to deploy this project — you&apos;ll get a live public URL here when it&apos;s ready.
          </div>
        )
      ) : null}
    </InspectorSection>
  );
}

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
  { id: "browser", label: "Browser", icon: Globe },
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
          <InspectorRow label="GitHub" value={describeSourceRows(capabilities).github} tone={capabilities.repositoryName ? "ok" : "muted"} />
          <InspectorRow label="Branch" value={describeSourceRows(capabilities).branch} />
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

  if (tab === "browser") {
    return <StudioBrowserJobsPanel />;
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
        <InspectorRow label="Source" value={describeSourceRows(capabilities).source} />
        <InspectorRow label="Version control" value={describeSourceRows(capabilities).versionControl} />
        <InspectorRow label="GitHub" value={describeSourceRows(capabilities).github} />
        <InspectorRow label="Branch" value={describeSourceRows(capabilities).branch} />
        <InspectorRow label="Permission" value={capabilities.writeAccess ? "Writes allowed" : "Approval required"} tone={capabilities.writeAccess ? "ok" : "warn"} />
      </InspectorSection>
      <DeploymentStatusSection projectId={capabilities.projectId} />
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
  embedded = false,
}: {
  open: boolean;
  onToggle: () => void;
  activeTab: InspectorTab;
  onTabChange: (t: InspectorTab) => void;
  children?: React.ReactNode;
  data?: StudioInspectorData;
  /**
   * When true, skip this component's own collapse handle, mobile
   * backdrop, and mobile "Workspace inspector" header — the parent
   * (e.g. ContextDrawer) already owns open/close chrome and a backdrop.
   * Only the tab strip + content render. Used to avoid nested duplicate
   * close controls when Inspector is embedded elsewhere (Phase C2.1).
   */
  embedded?: boolean;
}) {
  const tabStripAndContent = (
    <>
      {!embedded && (
        <div className="flex shrink-0 items-center justify-between border-b px-2 md:hidden" style={{ borderColor: "var(--studio-border)" }}>
          <span className="text-[10px] font-black uppercase tracking-[0.16em]" style={{ color: "var(--text-secondary)" }}>Workspace inspector</span>
          <button type="button" onClick={onToggle} className="rounded-md px-2 py-1 text-xs" style={{ color: "var(--text-muted)" }} aria-label="Close inspector">×</button>
        </div>
      )}
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
      <div
        className={activeTab === "browser" ? "min-h-0 flex-1 overflow-hidden" : "min-h-0 flex-1 overflow-y-auto p-2.5"}
        role="region"
        aria-label={`${activeTab} inspector`}
      >
        {children ?? (data ? <InspectorContent tab={activeTab} data={data} /> : (
          <div className="flex h-full items-center justify-center text-[11px]" style={{ color: "var(--text-muted)" }} role="status">
            No {activeTab} yet
          </div>
        ))}
      </div>
    </>
  );

  if (embedded) {
    // No collapse handle, no mobile backdrop/header, no fixed positioning —
    // the parent (ContextDrawer) already provides all of that chrome.
    return <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden">{tabStripAndContent}</div>;
  }

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
            {tabStripAndContent}
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
  missionContent,
}: {
  messages: ChatMessage[];
  busy: boolean;
  modelLabel: string;
  projectName: string | null;
  terminalStatus: string;
  /** Operational project state (Mission / Checkpoints / Next actions)
      rendered between the workspace header and the activity feed. */
  missionContent?: React.ReactNode;
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
      {missionContent}
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
