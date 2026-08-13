/**
 * Dashboard widget components — each widget renders its own content.
 * Widget data comes from canonical APIs, never from localStorage.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { Icon } from "../../dashboard/v2/dashboard-v2-utils";
import { useMusicPlayer, type PlayerTrack } from "@/context/MusicPlayerContext";
import type { MissionControlResponse } from "@/lib/mission-control";
import type { GalleryWidgetItem } from "@/lib/dashboard/gallery-widget-data";
import type { DiscoverFeedItem } from "@/lib/dashboard/discover-widget-data";
import type { RecentCreation } from "@/lib/dashboard/recent-creations";
import { D } from "@/lib/dashboard/tokens";

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
      style={{ background: D.bg, borderColor: D.border, backdropFilter: "blur(16px)" }}
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
        <Link href={actionHref} className="mt-1 rounded-lg px-3 py-1.5 text-[10px] font-bold" style={{ background: D.accent, color: D.textOnAccent }}>
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
              <div className="mt-2 h-1 overflow-hidden rounded-full" style={{ background: D.skeleton }}>
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
          <Link href="/studio?tool=code" className="mt-auto rounded-lg px-3 py-2 text-center text-[10px] font-black" style={{ background: D.accent, color: D.textOnAccent }}>
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
        <WidgetEmpty icon="trending" message="No trending items" actionLabel="Browse Showcase" actionHref="/showcase" />
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
      <MusicPlayerWidgetInner />
    </WidgetShell>
  );
}

function MusicPlayerWidgetInner() {
  const player = useMusicPlayer();
  const [vaultTracks, setVaultTracks] = useState<PlayerTrack[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/music/tracks", { credentials: "include" });
        const data = await res.json();
        if (cancelled) return;
        const tracks: PlayerTrack[] = (data.tracks ?? []).map((t: Record<string, unknown>) => ({
          id: t.id as string,
          title: t.title as string,
          version_label: t.version_label as string | undefined,
          duration: t.duration as number | null,
          bpm: t.bpm as number | null,
          musical_key: t.musical_key as string | null,
          visibility: t.visibility as "private" | "unlisted" | "public",
          blueprint: t.blueprint as PlayerTrack["blueprint"],
          provider: t.provider as string,
          created_at: t.created_at as string,
        }));
        setVaultTracks(tracks);
      } catch {
        // ignore — empty state will show
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const track = player.current;
  const progress = player.duration > 0 ? (player.currentTime / player.duration) * 100 : 0;
  const accent = D.accentCyan;

  // ── No track: show track list ──────────────────────────────────
  if (!track) {
    if (loading) {
      return (
        <div className="flex flex-1 items-center justify-center">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-white/20 border-t-white/60" />
        </div>
      );
    }
    if (vaultTracks.length === 0) {
      return (
        <WidgetEmpty icon="music" message="No tracks yet — generate some in the Studio" actionLabel="Open Music Studio" actionHref="/studio?tool=music" />
      );
    }
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="mb-2 text-[10px] font-black uppercase tracking-[.14em]" style={{ color: D.textMuted }}>
          Your Tracks
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {vaultTracks.slice(0, 8).map((t, i) => (
            <button
              key={t.id}
              onClick={() => player.playTrack(t, vaultTracks)}
              className="flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left transition hover:bg-white/5"
            >
              <div
                className="grid h-9 w-9 shrink-0 place-items-center rounded-lg"
                style={{ background: `linear-gradient(135deg, ${accent}22, ${accent}08)`, border: `1px solid ${accent}30` }}
              >
                <Icon name="play" size={12} style={{ color: accent }} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-xs font-bold" style={{ color: D.textPrimary }}>{t.title}</div>
                <div className="truncate text-[10px]" style={{ color: D.textMuted }}>
                  {t.version_label ?? t.provider}
                  {t.bpm ? ` · ${t.bpm} BPM` : ""}
                </div>
              </div>
              <span className="text-[10px]" style={{ color: D.textDim }}>{i + 1}</span>
            </button>
          ))}
        </div>
        <Link
          href="/studio?tool=music"
          className="mt-2 shrink-0 rounded-lg px-3 py-2 text-center text-[10px] font-bold transition hover:opacity-80"
          style={{ background: `${accent}15`, border: `1px solid ${accent}30`, color: accent }}
        >
          Open Music Studio →
        </Link>
      </div>
    );
  }

  // ── Track playing: show full mini-player ───────────────────────
  const coverGradient = `linear-gradient(135deg, ${accent}40, ${accent}10)`;
  const instrumental = track.blueprint?.instrumental;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      {/* Cover + info */}
      <div className="flex items-start gap-3">
        <div
          className="relative grid h-16 w-16 shrink-0 place-items-center overflow-hidden rounded-xl"
          style={{ background: coverGradient, border: `1px solid ${accent}30` }}
        >
          <Icon name="music" size={22} style={{ color: accent }} />
          {player.isPlaying && (
            <div className="absolute bottom-1 right-1 flex items-end gap-0.5">
              {[0, 1, 2].map((i) => (
                <div
                  key={i}
                  className="w-0.5 rounded-full"
                  style={{
                    height: 8 + (i % 2) * 6,
                    background: accent,
                    animation: `dash-eq 0.${4 + i}s ease-in-out infinite alternate`,
                  }}
                />
              ))}
            </div>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-black" style={{ color: D.textPrimary }}>{track.title}</div>
          <div className="mt-0.5 truncate text-[11px]" style={{ color: D.textMuted }}>
            {track.version_label ?? track.provider}
          </div>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {track.bpm && (
              <span className="rounded px-1.5 py-0.5 text-[9px] font-bold" style={{ background: `${accent}15`, color: accent }}>
                {track.bpm} BPM
              </span>
            )}
            {track.musical_key && (
              <span className="rounded px-1.5 py-0.5 text-[9px] font-bold" style={{ background: `${D.accent}15`, color: D.accent }}>
                {track.musical_key}
              </span>
            )}
            {instrumental && (
              <span className="rounded px-1.5 py-0.5 text-[9px] font-bold" style={{ background: `${D.accentAmber}15`, color: D.accentAmber }}>
                INST
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Progress bar */}
      <div>
        <div
          className="group relative h-1.5 cursor-pointer rounded-full"
          style={{ background: D.border }}
          onClick={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            const frac = (e.clientX - rect.left) / rect.width;
            player.seek(frac * player.duration);
          }}
        >
          <div
            className="absolute left-0 top-0 h-full rounded-full transition-[width] duration-150"
            style={{ width: `${progress}%`, background: `linear-gradient(90deg, ${accent}, ${D.accent})` }}
          />
        </div>
        <div className="mt-1 flex justify-between text-[9px] tabular-nums" style={{ color: D.textDim }}>
          <span>{formatPlayTime(player.currentTime)}</span>
          <span>{formatPlayTime(player.duration)}</span>
        </div>
      </div>

      {/* Controls */}
      <div className="flex items-center justify-center gap-3">
        <button
          onClick={player.prev}
          className="grid h-8 w-8 place-items-center rounded-full transition hover:bg-white/10"
          style={{ color: D.textMuted }}
          aria-label="Previous"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor"><path d="M3 2h2v10H3zM6 7l7-5v10z"/></svg>
        </button>
        <button
          onClick={player.togglePlay}
          className="grid h-11 w-11 place-items-center rounded-full transition hover:scale-105"
          style={{
            background: `linear-gradient(135deg, ${accent}, ${D.accent})`,
            color: "#000",
            boxShadow: player.isPlaying ? `0 0 16px ${accent}44` : "none",
          }}
          aria-label={player.isPlaying ? "Pause" : "Play"}
        >
          {player.loadingUrl ? (
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-black/30 border-t-black" />
          ) : player.isPlaying ? (
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><rect x="3" y="2" width="4" height="12" rx="1"/><rect x="9" y="2" width="4" height="12" rx="1"/></svg>
          ) : (
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M4 2l10 6-10 6z"/></svg>
          )}
        </button>
        <button
          onClick={player.next}
          className="grid h-8 w-8 place-items-center rounded-full transition hover:bg-white/10"
          style={{ color: D.textMuted }}
          aria-label="Next"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor"><path d="M11 2H9v10h2zM8 7L1 2v10z"/></svg>
        </button>
      </div>

      {/* Footer link */}
      <Link
        href="/studio?tool=music"
        className="shrink-0 text-center text-[10px] font-bold transition hover:opacity-80"
        style={{ color: D.textDim }}
      >
        Open full Music Studio →
      </Link>
    </div>
  );
}

function formatPlayTime(s: number): string {
  if (!s || isNaN(s)) return "0:00";
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

export function LiTTBitsWidget({ data, collapsed, onToggleCollapse, onRemove }: WidgetProps & { data: MissionControlResponse | null }) {
  return (
    <WidgetShell title="AI Credits" icon="wallet" accent={D.accentGreen} collapsed={collapsed} onToggleCollapse={onToggleCollapse} onRemove={onRemove}>
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
