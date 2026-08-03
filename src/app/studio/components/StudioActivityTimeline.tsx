"use client";

import { useEffect, useState } from "react";
import { MessageSquare, Rocket, Clock } from "lucide-react";

/**
 * StudioActivityTimeline — live, truthful timeline of recent conversations
 * and deployments shown in the Studio empty state to fill dead space.
 *
 * Wired only to existing APIs (/api/conversations, /api/deployments).
 * No fabricated metrics: if a source fails or returns nothing, it is omitted.
 * Renders nothing if both sources are empty so the empty state stays clean.
 */

type TimelineEntry = {
  id: string;
  kind: "chat" | "deploy";
  title: string;
  detail: string;
  at: string; // ISO timestamp
  tone: "ok" | "warn" | "muted";
};

type LoadState = "loading" | "ready" | "error";

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

const DEPLOY_TONE: Record<string, TimelineEntry["tone"]> = {
  live: "ok",
  building: "muted",
  deploying: "muted",
  queued: "muted",
  failed: "warn",
  cancelled: "muted",
};

export default function StudioActivityTimeline() {
  const [entries, setEntries] = useState<TimelineEntry[]>([]);
  const [state, setState] = useState<LoadState>("loading");

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      try {
        const [convRes, depRes] = await Promise.allSettled([
          fetch("/api/conversations", { credentials: "include", signal: AbortSignal.timeout(8000) }),
          fetch("/api/deployments?limit=5", { credentials: "include", signal: AbortSignal.timeout(8000) }),
        ]);

        const merged: TimelineEntry[] = [];

        if (convRes.status === "fulfilled" && convRes.value.ok) {
          const json = await convRes.value.json();
          const convs: Array<{ id: string; title?: string; updated_at: string; agent?: { display_name?: string } | null }> =
            json.conversations ?? [];
          for (const c of convs.slice(0, 5)) {
            merged.push({
              id: `chat-${c.id}`,
              kind: "chat",
              title: c.title || "Untitled chat",
              detail: c.agent?.display_name ? `with ${c.agent.display_name}` : "Studio chat",
              at: c.updated_at,
              tone: "muted",
            });
          }
        }

        if (depRes.status === "fulfilled" && depRes.value.ok) {
          const json = await depRes.value.json();
          const deps: Array<{ id: string; branch: string; status: string; environment: string; updated_at: string }> =
            json.deployments ?? [];
          for (const d of deps.slice(0, 5)) {
            merged.push({
              id: `deploy-${d.id}`,
              kind: "deploy",
              title: `${d.branch} → ${d.environment}`,
              detail: d.status,
              at: d.updated_at,
              tone: DEPLOY_TONE[d.status] ?? "muted",
            });
          }
        }

        merged.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
        if (!cancelled) {
          setEntries(merged.slice(0, 6));
          setState("ready");
        }
      } catch {
        if (!cancelled) setState("error");
      }
    };
    void run();
    return () => { cancelled = true; };
  }, []);

  if (state === "loading") {
    return (
      <div className="mt-6 w-full max-w-md" data-testid="activity-timeline">
        <div className="mb-2 px-1 text-[10px] font-black uppercase tracking-[0.18em]" style={{ color: "var(--text-muted)" }}>
          Recent Activity
        </div>
        <div className="space-y-1.5">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="h-9 animate-pulse rounded-lg"
              style={{ backgroundColor: "var(--studio-card)", border: "1px solid var(--studio-border)" }}
            />
          ))}
        </div>
      </div>
    );
  }

  if (state === "error" || entries.length === 0) return null;

  const toneColor: Record<TimelineEntry["tone"], string> = {
    ok: "var(--litt-primary)",
    warn: "#e3b341",
    muted: "var(--text-muted)",
  };

  return (
    <div className="mt-6 w-full max-w-md" data-testid="activity-timeline">
      <div className="mb-2 px-1 text-[10px] font-black uppercase tracking-[0.18em]" style={{ color: "var(--text-muted)" }}>
        Recent Activity
      </div>
      <div className="space-y-1.5">
        {entries.map((e) => {
          const Icon = e.kind === "chat" ? MessageSquare : Rocket;
          const color = toneColor[e.tone];
          return (
            <div
              key={e.id}
              className="flex items-center gap-2.5 rounded-lg border px-3 py-2 transition-all hover:translate-x-0.5 hover:border-[rgba(114,242,56,0.25)]"
              style={{
                borderColor: "var(--studio-border)",
                backgroundColor: "var(--studio-card)",
              }}
            >
              <div
                className="grid h-6 w-6 shrink-0 place-items-center rounded-md"
                style={{ backgroundColor: `${color}14`, color }}
              >
                <Icon size={12} className="pointer-events-none" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[11px] font-bold" style={{ color: "var(--text-primary)" }}>
                  {e.title}
                </div>
                <div className="truncate text-[10px]" style={{ color: "var(--text-secondary)" }}>
                  {e.detail}
                </div>
              </div>
              <span
                className="flex shrink-0 items-center gap-1 text-[10px] font-medium"
                style={{ color: "var(--text-muted)" }}
              >
                <Clock size={9} className="pointer-events-none" />
                {timeAgo(e.at)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
