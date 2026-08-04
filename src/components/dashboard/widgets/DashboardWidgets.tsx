"use client";

/**
 * Dashboard widget components — each widget renders its own content.
 * Widget data comes from canonical APIs, never from localStorage.
 */

import Link from "next/link";
import { Icon } from "../../dashboard/v2/dashboard-v2-utils";
import type { MissionControlResponse } from "@/lib/mission-control";
import type { GalleryWidgetData, GalleryWidgetItem } from "@/lib/dashboard/gallery-widget-data";
import type { DiscoverFeedItem } from "@/lib/dashboard/discover-widget-data";
import type { RecentCreation } from "@/lib/dashboard/recent-creations";

const D = {
  surface: "rgba(255,255,255,0.025)",
  surfaceHover: "rgba(255,255,255,0.04)",
  border: "rgba(168,85,247,0.12)",
  accent: "#a970ff",
  accentGreen: "#B6FF4A",
  accentAmber: "#F97316",
  accentRed: "#ef4444",
  accentCyan: "#65f4ff",
  textPrimary: "#eef4ff",
  textMuted: "rgba(238,244,255,0.45)",
  textDim: "rgba(238,244,255,0.25)",
};

/* ── Widget shell ───────────────────────────────────────────────── */

export function WidgetShell({
  title,
  icon,
  accent = D.accent,
  collapsed,
  onToggleCollapse,
  onRemove,
  children,
}: {
  title: string;
  icon: string;
  accent?: string;
  collapsed: boolean;
  onToggleCollapse?: () => void;
  onRemove?: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      className="flex h-full flex-col rounded-2xl border"
      style={{ background: "rgba(0,0,0,0.3)", borderColor: D.border, backdropFilter: "blur(16px)" }}
    >
      <div className="flex shrink-0 items-center justify-between gap-2 border-b px-4 py-2.5" style={{ borderColor: D.border }}>
        <div className="flex min-w-0 items-center gap-2">
          <Icon name={icon} size={14} style={{ color: accent }} />
          <span className="truncate text-[11px] font-black uppercase tracking-[.14em]" style={{ color: D.textPrimary }}>
            {title}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {onToggleCollapse && (
            <button
              type="button"
              onClick={onToggleCollapse}
              className="grid h-6 w-6 place-items-center rounded-md transition hover:bg-white/10"
              style={{ color: D.textMuted }}
              aria-label={collapsed ? "Expand widget" : "Collapse widget"}
            >
              <Icon name={collapsed ? "chevron-down" : "chevron-up"} size={12} />
            </button>
          )}
          {onRemove && (
            <button
              type="button"
              onClick={onRemove}
              className="grid h-6 w-6 place-items-center rounded-md transition hover:bg-red-500/10"
              style={{ color: D.textMuted }}
              aria-label="Remove widget"
            >
              <Icon name="x" size={12} />
            </button>
          )}
        </div>
      </div>
      {!collapsed && <div className="flex min-h-0 flex-1 flex-col overflow-hidden p-4">{children}</div>}
    </div>
  );
}

/* ── Empty state ────────────────────────────────────────────────── */

function WidgetEmpty({ icon, message, actionLabel, actionHref }: { icon: string; message: string; actionLabel?: string; actionHref?: string }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center">
      <Icon name={icon} size={20} style={{ color: `${D.accent}66` }} />
      <div className="text-xs" style={{ color: D.textMuted }}>{message}</div>
      {actionLabel && actionHref && (
        <Link href={actionHref} className="mt-1 rounded-lg px-3 py-1.5 text-[10px] font-bold" style={{ background: D.accent, color: "#fff" }}>
          {actionLabel}
        </Link>
      )}
    </div>
  );
}

/* ── Individual widgets ─────────────────────────────────────────── */

export function LiTTQuickAskWidget({ collapsed, onToggleCollapse, onRemove }: WidgetProps) {
  return (
    <WidgetShell title="LiTT Quick Ask" icon="message" collapsed={collapsed} onToggleCollapse={onToggleCollapse} onRemove={onRemove}>
      <Link
        href="/studio?tool=chat"
        className="flex flex-1 flex-col items-center justify-center gap-3 rounded-xl border p-4 transition hover:opacity-90"
        style={{ borderColor: `${D.accent}33`, background: `${D.accent}0a` }}
      >
        <Icon name="sparkles" size={24} style={{ color: D.accent }} />
        <div className="text-sm font-black" style={{ color: D.textPrimary }}>Ask LiTT anything</div>
        <div className="text-xs" style={{ color: D.textMuted }}>Open Studio chat to start</div>
      </Link>
    </WidgetShell>
  );
}

export function MissionQueueWidget({ data, collapsed, onToggleCollapse, onRemove }: WidgetProps & { data: MissionControlResponse | null }) {
  const missions = (data?.missions ?? []).filter((m) => !["completed", "failed", "cancelled"].includes(m.state)).slice(0, 4);
  return (
    <WidgetShell title="Mission Queue" icon="zap" accent={D.accentGreen} collapsed={collapsed} onToggleCollapse={onToggleCollapse} onRemove={onRemove}>
      {missions.length === 0 ? (
        <WidgetEmpty icon="bot" message="No active missions" actionLabel="Start Mission" actionHref="/studio?tool=chat" />
      ) : (
        <div className="space-y-2 overflow-y-auto">
          {missions.map((m) => (
            <Link key={m.id} href={`/studio?mission=${encodeURIComponent(m.id)}`} className="block rounded-xl border p-3 transition hover:opacity-90" style={{ borderColor: D.border, background: D.surface }}>
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-xs font-bold" style={{ color: D.textPrimary }}>{m.title}</span>
                <span className="shrink-0 text-[9px] font-black uppercase" style={{ color: D.accentGreen }}>{m.state}</span>
              </div>
              <div className="mt-2 h-1 overflow-hidden rounded-full" style={{ background: "rgba(255,255,255,0.05)" }}>
                <div className="h-full rounded-full" style={{ width: `${Math.max(0, Math.min(100, m.progress))}%`, background: `linear-gradient(to right, ${D.accent}, ${D.accentGreen})` }} />
              </div>
            </Link>
          ))}
        </div>
      )}
    </WidgetShell>
  );
}

export function CurrentProjectWidget({ data, collapsed, onToggleCollapse, onRemove }: WidgetProps & { data: MissionControlResponse | null }) {
  const project = data?.project;
  return (
    <WidgetShell title="Current Project" icon="layers" collapsed={collapsed} onToggleCollapse={onToggleCollapse} onRemove={onRemove}>
      {!project ? (
        <WidgetEmpty icon="layers" message="No project connected" actionLabel="Connect Project" actionHref="/studio" />
      ) : (
        <div className="flex flex-1 flex-col gap-2">
          <div className="text-sm font-black truncate" style={{ color: D.textPrimary }}>{project.repository}</div>
          <div className="flex flex-wrap gap-1.5">
            <span className="rounded-full border px-2 py-0.5 text-[9px] font-bold" style={{ borderColor: `${D.accentGreen}40`, color: D.accentGreen }}>{project.workspaceState}</span>
            <span className="rounded-full border px-2 py-0.5 text-[9px] font-bold" style={{ borderColor: `${D.accentCyan}40`, color: D.accentCyan }}>{project.terminalState}</span>
            <span className="rounded-full border px-2 py-0.5 text-[9px] font-bold" style={{ borderColor: `${D.accentAmber}40`, color: D.accentAmber }}>{project.deploymentState}</span>
          </div>
          <Link href="/studio?tool=code" className="mt-auto rounded-lg px-3 py-2 text-center text-[10px] font-black" style={{ background: D.accent, color: "#fff" }}>
            Open in Studio
          </Link>
        </div>
      )}
    </WidgetShell>
  );
}

export function ProjectRuntimeWidget({ data, collapsed, onToggleCollapse, onRemove }: WidgetProps & { data: MissionControlResponse | null }) {
  const project = data?.project;
  const rows = project ? [
    { label: "Workspace", value: project.workspaceState },
    { label: "Terminal", value: project.terminalState },
    { label: "Preview", value: project.previewState },
    { label: "Deployment", value: project.deploymentState },
    { label: "Branch", value: project.branch ?? "—" },
  ] : [];
  return (
    <WidgetShell title="Project Runtime" icon="cpu" accent={D.accentCyan} collapsed={collapsed} onToggleCollapse={onToggleCollapse} onRemove={onRemove}>
      {!project ? (
        <WidgetEmpty icon="cpu" message="No runtime to display" />
      ) : (
        <div className="space-y-1.5">
          {rows.map((r) => (
            <div key={r.label} className="flex items-center justify-between border-b py-1.5 last:border-0" style={{ borderColor: D.border }}>
              <span className="text-[10px]" style={{ color: D.textMuted }}>{r.label}</span>
              <span className="text-[10px] font-bold capitalize" style={{ color: D.textPrimary }}>{r.value}</span>
            </div>
          ))}
        </div>
      )}
    </WidgetShell>
  );
}

export function PendingApprovalsWidget({ data, collapsed, onToggleCollapse, onRemove }: WidgetProps & { data: MissionControlResponse | null }) {
  const pending = (data?.missions ?? []).filter((m) => m.state === "awaiting_approval");
  return (
    <WidgetShell title="Pending Approvals" icon="shield" accent={D.accentAmber} collapsed={collapsed} onToggleCollapse={onToggleCollapse} onRemove={onRemove}>
      {pending.length === 0 ? (
        <WidgetEmpty icon="shield" message="No approvals needed" />
      ) : (
        <div className="space-y-2">
          {pending.map((m) => (
            <Link key={m.id} href={`/studio?mission=${encodeURIComponent(m.id)}`} className="block rounded-xl border p-3" style={{ borderColor: `${D.accentAmber}33`, background: `${D.accentAmber}0a` }}>
              <div className="text-xs font-bold" style={{ color: D.textPrimary }}>{m.title}</div>
              <div className="mt-1 text-[10px]" style={{ color: D.textMuted }}>{m.currentStep ?? "Awaiting your approval"}</div>
            </Link>
          ))}
        </div>
      )}
    </WidgetShell>
  );
}

export function RecentActivityWidget({ data, collapsed, onToggleCollapse, onRemove }: WidgetProps & { data: MissionControlResponse | null }) {
  const activity = (data?.activity ?? []).slice(0, 6);
  return (
    <WidgetShell title="Recent Activity" icon="activity" accent={D.accentCyan} collapsed={collapsed} onToggleCollapse={onToggleCollapse} onRemove={onRemove}>
      {activity.length === 0 ? (
        <WidgetEmpty icon="activity" message="No recent activity" />
      ) : (
        <div className="space-y-1.5 overflow-y-auto">
          {activity.map((e) => {
            const color = e.severity === "error" ? D.accentRed : e.severity === "warning" ? D.accentAmber : e.severity === "success" ? D.accentGreen : D.accentCyan;
            return (
              <div key={e.id} className="flex items-start gap-2 py-1.5">
                <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: color }} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[11px] font-bold" style={{ color: D.textPrimary }}>{e.title}</div>
                  {e.detail && <div className="truncate text-[10px]" style={{ color: D.textMuted }}>{e.detail}</div>}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </WidgetShell>
  );
}

export function RecentCreationsWidget({ creations, collapsed, onToggleCollapse, onRemove }: WidgetProps & { creations: RecentCreation[] }) {
  return (
    <WidgetShell title="Recent Creations" icon="sparkles" collapsed={collapsed} onToggleCollapse={onToggleCollapse} onRemove={onRemove}>
      {creations.length === 0 ? (
        <WidgetEmpty icon="sparkles" message="No creations yet" actionLabel="Create" actionHref="/studio?tool=image" />
      ) : (
        <div className="grid grid-cols-3 gap-2 overflow-y-auto">
          {creations.slice(0, 9).map((c) => (
            <Link key={c.id} href={`/gallery/${c.id}`} className="group relative aspect-square overflow-hidden rounded-lg border" style={{ borderColor: D.border }}>
              {c.thumbnailUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={c.thumbnailUrl} alt={c.title} className="h-full w-full object-cover transition group-hover:scale-105" />
              ) : (
                <div className="grid h-full w-full place-items-center" style={{ background: D.surface }}>
                  <Icon name={c.type === "video" ? "film" : c.type === "music" ? "music" : "image"} size={16} style={{ color: D.textMuted }} />
                </div>
              )}
            </Link>
          ))}
        </div>
      )}
    </WidgetShell>
  );
}

export function MyGalleryWidget({ items, collapsed, onToggleCollapse, onRemove }: WidgetProps & { items: GalleryWidgetItem[] }) {
  return (
    <WidgetShell title="My Gallery" icon="image" accent={D.accentGreen} collapsed={collapsed} onToggleCollapse={onToggleCollapse} onRemove={onRemove}>
      {items.length === 0 ? (
        <WidgetEmpty icon="image" message="No published items" actionLabel="Publish" actionHref="/gallery" />
      ) : (
        <div className="grid grid-cols-3 gap-2 overflow-y-auto">
          {items.map((item) => (
            <Link key={item.id} href={`/gallery/${item.id}`} className="group relative aspect-square overflow-hidden rounded-lg border" style={{ borderColor: D.border }}>
              {item.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={item.imageUrl} alt={item.title} className="h-full w-full object-cover transition group-hover:scale-105" />
              ) : (
                <div className="grid h-full w-full place-items-center" style={{ background: D.surface }}>
                  <Icon name="image" size={16} style={{ color: D.textMuted }} />
                </div>
              )}
            </Link>
          ))}
        </div>
      )}
    </WidgetShell>
  );
}

export function TrendingGalleryWidget({ items, collapsed, onToggleCollapse, onRemove }: WidgetProps & { items: GalleryWidgetItem[] }) {
  return (
    <WidgetShell title="Trending Gallery" icon="trending" accent={D.accentAmber} collapsed={collapsed} onToggleCollapse={onToggleCollapse} onRemove={onRemove}>
      {items.length === 0 ? (
        <WidgetEmpty icon="trending" message="No trending items" actionLabel="Browse Gallery" actionHref="/gallery" />
      ) : (
        <div className="grid grid-cols-3 gap-2 overflow-y-auto">
          {items.map((item) => (
            <Link key={item.id} href={`/gallery/${item.id}`} className="group relative aspect-square overflow-hidden rounded-lg border" style={{ borderColor: D.border }}>
              {item.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={item.imageUrl} alt={item.title} className="h-full w-full object-cover transition group-hover:scale-105" />
              ) : (
                <div className="grid h-full w-full place-items-center" style={{ background: D.surface }}>
                  <Icon name="image" size={16} style={{ color: D.textMuted }} />
                </div>
              )}
              <span className="absolute bottom-1 right-1 rounded-full bg-black/60 px-1.5 py-0.5 text-[8px] font-bold" style={{ color: D.accentAmber }}>
                {item.likes}
              </span>
            </Link>
          ))}
        </div>
      )}
    </WidgetShell>
  );
}

export function DiscoverFeedWidget({ posts, collapsed, onToggleCollapse, onRemove }: WidgetProps & { posts: DiscoverFeedItem[] }) {
  return (
    <WidgetShell title="Discover Feed" icon="users" accent={D.accentCyan} collapsed={collapsed} onToggleCollapse={onToggleCollapse} onRemove={onRemove}>
      {posts.length === 0 ? (
        <WidgetEmpty icon="users" message="No posts yet" actionLabel="Open Discover" actionHref="/discover" />
      ) : (
        <div className="space-y-2 overflow-y-auto">
          {posts.slice(0, 5).map((p) => (
            <div key={p.id} className="rounded-xl border p-3" style={{ borderColor: D.border, background: D.surface }}>
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-bold" style={{ color: D.accentCyan }}>{p.authorName}</span>
                <span className="text-[9px]" style={{ color: D.textDim }}>{new Date(p.createdAt).toLocaleDateString()}</span>
              </div>
              <p className="mt-1.5 line-clamp-2 text-[11px]" style={{ color: D.textPrimary }}>{p.content}</p>
              <div className="mt-2 flex gap-3 text-[9px]" style={{ color: D.textMuted }}>
                <span>{p.likesCount} likes</span>
                <span>{p.commentsCount} comments</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </WidgetShell>
  );
}

export function MusicPlayerWidget({ collapsed, onToggleCollapse, onRemove }: WidgetProps) {
  return (
    <WidgetShell title="Music Player" icon="music" accent={D.accentCyan} collapsed={collapsed} onToggleCollapse={onToggleCollapse} onRemove={onRemove}>
      <WidgetEmpty icon="music" message="No track loaded" actionLabel="Open Music" actionHref="/dashboard?app=music" />
    </WidgetShell>
  );
}

export function LiTTBitsWidget({ data, collapsed, onToggleCollapse, onRemove }: WidgetProps & { data: MissionControlResponse | null }) {
  return (
    <WidgetShell title="LiTTBits" icon="wallet" accent={D.accentGreen} collapsed={collapsed} onToggleCollapse={onToggleCollapse} onRemove={onRemove}>
      <div className="flex flex-1 flex-col items-center justify-center gap-1">
        <div className="text-2xl font-black" style={{ color: D.accentGreen }}>{(data?.billing.balance ?? 0).toLocaleString()}</div>
        <div className="text-[10px]" style={{ color: D.textMuted }}>{data?.billing.plan ?? "Free"} plan</div>
        <Link href="/wallet" className="mt-2 rounded-lg px-3 py-1.5 text-[10px] font-bold" style={{ background: D.surface, border: `1px solid ${D.border}`, color: D.textPrimary }}>
          Manage
        </Link>
      </div>
    </WidgetShell>
  );
}

export function NotificationsWidget({ collapsed, onToggleCollapse, onRemove }: WidgetProps) {
  return (
    <WidgetShell title="Notifications" icon="bell" accent={D.accentAmber} collapsed={collapsed} onToggleCollapse={onToggleCollapse} onRemove={onRemove}>
      <WidgetEmpty icon="bell" message="No new notifications" actionLabel="View All" actionHref="/notifications" />
    </WidgetShell>
  );
}

export function DeploymentsWidget({ collapsed, onToggleCollapse, onRemove }: WidgetProps) {
  return (
    <WidgetShell title="Deployments" icon="rocket" accent={D.accentAmber} collapsed={collapsed} onToggleCollapse={onToggleCollapse} onRemove={onRemove}>
      <WidgetEmpty icon="rocket" message="No recent deployments" actionLabel="View Deployments" actionHref="/deployments" />
    </WidgetShell>
  );
}

export function SavedItemsWidget({ collapsed, onToggleCollapse, onRemove }: WidgetProps) {
  return (
    <WidgetShell title="Saved Items" icon="bookmark" collapsed={collapsed} onToggleCollapse={onToggleCollapse} onRemove={onRemove}>
      <WidgetEmpty icon="bookmark" message="No saved items yet" />
    </WidgetShell>
  );
}

/* ── Owner-only widgets ─────────────────────────────────────────── */

export function OwnerMetricWidget({ title, icon, value, detail, collapsed, onToggleCollapse, onRemove }: WidgetProps & { title: string; icon: string; value: string | number; detail?: string }) {
  return (
    <WidgetShell title={title} icon={icon} accent={D.accentAmber} collapsed={collapsed} onToggleCollapse={onToggleCollapse} onRemove={onRemove}>
      <div className="flex flex-1 flex-col items-center justify-center gap-1">
        <div className="text-2xl font-black" style={{ color: D.accentAmber }}>{value}</div>
        {detail && <div className="text-[10px]" style={{ color: D.textMuted }}>{detail}</div>}
      </div>
    </WidgetShell>
  );
}

export function SystemHealthWidget({ data, collapsed, onToggleCollapse, onRemove }: WidgetProps & { data: MissionControlResponse | null }) {
  const services = (data?.health ?? []).slice(0, 6);
  return (
    <WidgetShell title="System Health" icon="heart" accent={D.accentGreen} collapsed={collapsed} onToggleCollapse={onToggleCollapse} onRemove={onRemove}>
      {services.length === 0 ? (
        <WidgetEmpty icon="heart" message="No health data" />
      ) : (
        <div className="space-y-1.5 overflow-y-auto">
          {services.map((s) => {
            const color = s.state === "healthy" || s.state === "connected" ? D.accentGreen : s.state === "degraded" ? D.accentAmber : D.accentRed;
            return (
              <div key={s.id} className="flex items-center justify-between border-b py-1.5 last:border-0" style={{ borderColor: D.border }}>
                <span className="truncate text-[10px]" style={{ color: D.textMuted }}>{s.label}</span>
                <span className="shrink-0 rounded-full border px-2 py-0.5 text-[9px] font-bold capitalize" style={{ borderColor: `${color}40`, color }}>{s.state.replaceAll("_", " ")}</span>
              </div>
            );
          })}
        </div>
      )}
    </WidgetShell>
  );
}

export function AuditEventsWidget({ collapsed, onToggleCollapse, onRemove }: WidgetProps) {
  return (
    <WidgetShell title="Audit Events" icon="shield" accent={D.accentAmber} collapsed={collapsed} onToggleCollapse={onToggleCollapse} onRemove={onRemove}>
      <WidgetEmpty icon="shield" message="No recent audit events" actionLabel="View Audit Log" actionHref="/owner" />
    </WidgetShell>
  );
}

/* ── Shared types ───────────────────────────────────────────────── */

interface WidgetProps {
  collapsed: boolean;
  onToggleCollapse?: () => void;
  onRemove?: () => void;
}
