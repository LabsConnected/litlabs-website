"use client";

/**
 * BrowserJobLiveView — the Phase 6 owner live view for a browser job.
 *
 * Replaces the old "iframe when available" block with a deterministic
 * rule, backed by the owner-checked endpoint
 * GET /api/browser/jobs/[id]/live-view:
 *
 *   - The endpoint says "live" (embeddable URL + active job +
 *     live-checked session + fresh row) → iframe the embed URL.
 *   - Anything else → honest fallback: latest labeled snapshot +
 *     snapshot timeline + the step log below. Snapshots are labeled
 *     as snapshots — a carousel is not a live browser (brief §B).
 *
 * Disconnect handling:
 *   - The endpoint is polled while the job is active; a live → not-live
 *     flip moves the view to "disconnected" immediately.
 *   - The iframe also listens for Browserbase's documented
 *     `browserbase-disconnected` postMessage (origin-validated) and
 *     flips immediately, then re-probes so the steady state always
 *     rests on the server's word — never a frozen "live" frame.
 *   - A failed probe never flips the state (a network blip is not a
 *     confident "disconnected").
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Globe,
  Camera,
  ExternalLink,
  Loader2,
  WifiOff,
} from "lucide-react";
import {
  LIVE_VIEW_REASON_COPY,
  LIVE_VIEW_DISCONNECTED_COPY,
  type LiveViewUnavailableReason,
} from "@/lib/browser-live-view";
import type { AgentJobEvent } from "../hooks/useBrowserJobEvents";
import type { BrowserJob } from "../hooks/useBrowserJobs";

const LIME = "var(--litt-primary)";
const POLL_MS = 5000;

const TERMINAL_JOB_STATUSES = new Set(["completed", "failed", "cancelled"]);

interface Snapshot {
  id: string;
  url: string;
  caption: string;
  createdAt: string;
}

function isDataImage(value: unknown): value is string {
  return typeof value === "string" && value.startsWith("data:image/");
}

/**
 * Collect labeled, timestamped snapshots for the timeline:
 *  - every job event carrying metadata.screenshotUrl (base64 data URL)
 *  - per-step screenshots recorded by the executor, captioned with the
 *    EXACT URL they were captured at — route-accurate by construction
 *    (the server prunes older step screenshots, so only the freshest
 *    frames are here)
 *  - the job result's screenshotUrl (final snapshot)
 * Identical frames emitted through multiple channels are shown once.
 * Sorted oldest → newest; the last one is the "latest snapshot".
 */
export function collectSnapshots(job: BrowserJob, events: AgentJobEvent[]): Snapshot[] {
  const snapshots: Snapshot[] = [];
  const seen = new Set<string>();
  const push = (s: Snapshot) => {
    if (seen.has(s.url)) return;
    seen.add(s.url);
    snapshots.push(s);
  };
  for (const event of events) {
    const url = (event.metadata as Record<string, unknown> | undefined)?.screenshotUrl;
    if (isDataImage(url)) {
      push({
        id: `event-${event.id}`,
        url,
        caption: event.message || "Snapshot",
        createdAt: event.createdAt,
      });
    }
  }
  for (let i = 0; i < job.progress.steps.length; i++) {
    const step = job.progress.steps[i];
    if (isDataImage(step.screenshotUrl)) {
      push({
        id: `step-${i}`,
        url: step.screenshotUrl,
        caption: step.url
          ? `Captured at ${step.url}`
          : `Screenshot from step ${i + 1} (“${step.label}”)`,
        createdAt: job.completedAt ?? job.createdAt,
      });
    }
  }
  const resultUrl = (job.result as Record<string, unknown> | null)?.screenshotUrl;
  if (isDataImage(resultUrl)) {
    push({
      id: "result",
      url: resultUrl,
      caption: "Final snapshot",
      createdAt: job.completedAt ?? job.createdAt,
    });
  }
  snapshots.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return snapshots;
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function isBrowserbaseOrigin(origin: string): boolean {
  try {
    const u = new URL(origin);
    return (
      u.protocol === "https:" &&
      (u.hostname === "browserbase.com" || u.hostname.endsWith(".browserbase.com"))
    );
  } catch {
    return false;
  }
}

// ─── Snapshot timeline ──────────────────────────────────────────

function SnapshotTimeline({ snapshots }: { snapshots: Snapshot[] }) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected =
    snapshots.find((s) => s.id === selectedId) ?? snapshots[snapshots.length - 1];

  if (!selected) {
    return (
      <div className="mt-2 rounded-lg border border-dashed px-3 py-4 text-center" style={{ borderColor: "var(--studio-border)" }}>
        <Camera size={16} className="mx-auto mb-1 opacity-40" style={{ color: "var(--text-muted)" }} />
        <div className="text-[9px]" style={{ color: "var(--text-muted)" }}>
          No snapshots captured yet
        </div>
      </div>
    );
  }

  return (
    <div className="mt-2" data-testid="snapshot-timeline">
      <div className="relative overflow-hidden rounded-lg border" style={{ borderColor: "var(--studio-border)" }}>
        <img src={selected.url} alt={`Snapshot: ${selected.caption}`} className="w-full" />
        <span
          className="absolute left-1.5 top-1.5 rounded px-1.5 py-0.5 text-[8px] font-black tracking-wider"
          style={{ backgroundColor: "rgba(0,0,0,0.7)", color: LIME }}
        >
          SNAPSHOT
        </span>
      </div>
      <div className="mt-1 flex items-center justify-between gap-2 text-[9px]" style={{ color: "var(--text-muted)" }}>
        <span className="truncate">{selected.caption}</span>
        <span className="shrink-0 font-mono">{formatTime(selected.createdAt)}</span>
      </div>
      {snapshots.length > 1 && (
        <div className="mt-1.5 flex gap-1.5 overflow-x-auto pb-1" role="list" aria-label="Snapshot timeline">
          {snapshots.map((s) => (
            <button
              key={s.id}
              type="button"
              role="listitem"
              onClick={() => setSelectedId(s.id)}
              className="relative shrink-0"
              aria-label={`Snapshot ${formatTime(s.createdAt)}: ${s.caption}`}
            >
              <img
                src={s.url}
                alt=""
                className="h-12 w-20 rounded border object-cover"
                style={{ borderColor: s.id === selected.id ? LIME : "var(--studio-border)" }}
              />
              <span
                className="absolute bottom-0.5 left-0.5 rounded px-1 text-[7px] font-black"
                style={{ backgroundColor: "rgba(0,0,0,0.7)", color: LIME }}
              >
                SNAPSHOT
              </span>
            </button>
          ))}
        </div>
      )}
      <div className="mt-1 text-[8px]" style={{ color: "var(--text-muted)" }}>
        Snapshots are still images captured during the session — not a live browser.
      </div>
    </div>
  );
}

// ─── Offline / fallback view ────────────────────────────────────

function OfflineView({
  disconnected,
  reason,
  snapshots,
  openUrl,
}: {
  disconnected: boolean;
  reason: LiveViewUnavailableReason;
  snapshots: Snapshot[];
  openUrl: string | null;
}) {
  const copy = disconnected
    ? LIVE_VIEW_DISCONNECTED_COPY
    : (LIVE_VIEW_REASON_COPY[reason] ?? LIVE_VIEW_REASON_COPY.session_not_found);
  return (
    <div data-testid={disconnected ? "live-view-disconnected" : "live-view-fallback"}>
      <div className="flex items-center gap-1.5 text-[9px] font-black uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>
        {disconnected ? <WifiOff size={10} /> : <Camera size={10} />}
        {copy.title}
      </div>
      <div className="mt-1 text-[9px] leading-snug" style={{ color: "var(--text-muted)" }}>
        {copy.detail}
      </div>
      <SnapshotTimeline snapshots={snapshots} />
      {openUrl && (
        <a
          href={openUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-1.5 inline-flex items-center gap-1 text-[9px] font-bold hover:underline"
          style={{ color: LIME }}
        >
          <ExternalLink size={9} />
          Open session page in new tab
        </a>
      )}
    </div>
  );
}

// ─── Main component ─────────────────────────────────────────────

interface LiveViewProbe {
  available: boolean;
  reason: LiveViewUnavailableReason | "live";
  embedUrl: string | null;
  openUrl: string | null;
  sessionStatus: string | null;
}

type Mode = "checking" | "live" | "offline";

export default function BrowserJobLiveView({
  job,
  events,
}: {
  job: BrowserJob;
  events: AgentJobEvent[];
}) {
  const [mode, setMode] = useState<Mode>("checking");
  const [probe, setProbe] = useState<LiveViewProbe | null>(null);
  const [disconnected, setDisconnected] = useState(false);
  const modeRef = useRef<Mode>("checking");

  const snapshots = useMemo(() => collectSnapshots(job, events), [job, events]);
  const jobActive = !TERMINAL_JOB_STATUSES.has(job.status);

  const applyProbe = useCallback((data: LiveViewProbe) => {
    setProbe(data);
    const prev = modeRef.current;
    if (data.available && data.embedUrl) {
      modeRef.current = "live";
      setMode("live");
      setDisconnected(false);
      return;
    }
    // Not available.
    if (prev === "live") {
      // Was live, now isn't. A finished job is an expected ending, not
      // a dropped stream — label it honestly either way.
      setDisconnected(data.reason !== "job_finished");
    }
    modeRef.current = "offline";
    setMode("offline");
  }, []);

  const runProbe = useCallback(async () => {
    try {
      const res = await fetch(`/api/browser/jobs/${job.jobId}/live-view`, {
        credentials: "same-origin",
        cache: "no-store",
      });
      // A failed probe is not "disconnected" — keep the current state.
      if (!res.ok) return;
      const data = (await res.json()) as LiveViewProbe;
      applyProbe(data);
    } catch {
      // Network blip — keep the current state.
    }
  }, [job.jobId, applyProbe]);

  // Poll while the job is active. Terminal jobs are probed once: the
  // session is closed, so the answer is stable.
  useEffect(() => {
    void runProbe();
    if (!jobActive) return;
    const timer = setInterval(() => void runProbe(), POLL_MS);
    return () => clearInterval(timer);
  }, [runProbe, jobActive]);

  // Browserbase's documented disconnect signal: the live view posts a
  // `browserbase-disconnected` message when it loses the browser. The
  // origin is validated — only Browserbase frames are trusted. Flip
  // immediately, then re-probe so the steady state always rests on the
  // server's word.
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      const data = typeof e.data === "string" ? e.data : "";
      if (!data.includes("browserbase-disconnected")) return;
      if (!isBrowserbaseOrigin(e.origin)) return;
      if (modeRef.current !== "live") return;
      modeRef.current = "offline";
      setMode("offline");
      setDisconnected(true);
      void runProbe();
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [runProbe]);

  const reason: LiveViewUnavailableReason =
    probe && probe.reason !== "live" ? probe.reason : "session_not_found";

  return (
    <div className="shrink-0 px-3 pt-2">
      <div className="flex items-center gap-1.5 text-[9px] font-black uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>
        <Globe size={10} />
        Browser View
        {mode === "live" && (
          <span
            className="ml-1 inline-flex items-center gap-0.5 rounded-full px-1 py-0 text-[7px]"
            style={{ backgroundColor: "rgba(163,230,53,0.15)", color: LIME }}
            data-testid="live-view-live-badge"
          >
            <span className="inline-block h-1 w-1 animate-pulse rounded-full" style={{ backgroundColor: LIME }} />
            LIVE
          </span>
        )}
      </div>

      {mode === "checking" && (
        <div className="mt-1 flex items-center gap-1.5 rounded-lg border px-3 py-4" style={{ borderColor: "var(--studio-border)" }}>
          <Loader2 size={12} className="animate-spin" style={{ color: "var(--text-muted)" }} />
          <span className="text-[9px]" style={{ color: "var(--text-muted)" }}>
            Checking live view…
          </span>
        </div>
      )}

      {mode === "live" && probe?.embedUrl && (
        <div data-testid="live-view-iframe-wrap">
          <div className="mt-1 overflow-hidden rounded-lg border" style={{ borderColor: "var(--studio-border)" }}>
            <iframe
              src={probe.embedUrl}
              className="aspect-video min-h-[220px] w-full md:min-h-[320px]"
              style={{ border: "none", backgroundColor: "#0a0b10" }}
              title="Live browser view — streaming the agent's browser"
              allow="clipboard-read; clipboard-write"
              sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
            />
          </div>
          {probe.openUrl && (
            <a
              href={probe.openUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-1 inline-flex min-h-[44px] items-center gap-1.5 px-2 text-[12px] font-bold hover:underline"
              style={{ color: LIME }}
            >
              <ExternalLink size={12} />
              Open in new tab
            </a>
          )}
        </div>
      )}

      {mode === "offline" && (
        <div className="mt-1">
          <OfflineView
            disconnected={disconnected}
            reason={reason}
            snapshots={snapshots}
            openUrl={probe?.openUrl ?? job.liveViewUrl}
          />
        </div>
      )}
    </div>
  );
}
