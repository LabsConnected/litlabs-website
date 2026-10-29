"use client";

import { useState } from "react";
import { AlertTriangle, Loader2, RefreshCw } from "lucide-react";
import { useCanvasBuilderStore } from "./store";
import type { CanvasFileState } from "@/lib/studio/canvas-ssot";

/**
 * Surfaces the canvas↔file relationship for the active project and provides
 * the two explicit resolutions. Mounted on the Design surface (and anywhere
 * publish can be attempted) so a pending/conflict state is always visible
 * where it can be resolved — never silently.
 */
export function CanvasFileStateBanner({ projectId }: { projectId: string }) {
  const state = useCanvasBuilderStore((s) => s.canvasFileState);
  const syncConflict = useCanvasBuilderStore((s) => s.syncConflict);
  const setCanvasFileState = useCanvasBuilderStore((s) => s.setCanvasFileState);
  const [busy, setBusy] = useState<"apply" | "keep" | "reload" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const act = async (kind: "apply" | "keep" | "reload") => {
    setBusy(kind);
    setError(null);
    try {
      if (kind === "reload") {
        window.location.reload();
        return;
      }
      const resp = await fetch(`/api/studio-projects/${projectId}/canvas/apply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          kind === "keep" ? { resolution: "keep-files" } : { resolution: "apply-canvas" },
        ),
      });
      const data = (await resp.json().catch(() => ({}))) as { state?: CanvasFileState; error?: string };
      if (!resp.ok) {
        setError(data.error ?? `Request failed (${resp.status})`);
      }
      if (data.state) setCanvasFileState(data.state);
    } catch {
      setError("Network error — nothing was changed.");
    } finally {
      setBusy(null);
    }
  };

  const wrap = (children: React.ReactNode, tone: "amber" | "red") => (
    <div
      role="status"
      className={`flex flex-wrap items-center gap-x-3 gap-y-2 border-b px-4 py-2 text-[12px] ${
        tone === "amber"
          ? "border-amber-400/20 bg-amber-500/10 text-amber-100"
          : "border-red-400/25 bg-red-500/10 text-red-100"
      }`}
      data-testid="canvas-file-state-banner"
    >
      {children}
      {error && <span className="text-red-200">{error}</span>}
    </div>
  );

  const btn =
    "flex min-h-8 items-center gap-1.5 rounded-md border border-white/15 bg-white/5 px-3 font-semibold text-white transition hover:bg-white/10 disabled:opacity-50";

  if (syncConflict) {
    return wrap(
      <>
        <AlertTriangle size={14} aria-hidden="true" className="shrink-0" />
        <span className="min-w-0 flex-1">{syncConflict}</span>
        <button type="button" className={btn} onClick={() => act("reload")} disabled={busy !== null}>
          {busy === "reload" ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} aria-hidden="true" />}
          Reload to reconcile
        </button>
      </>,
      "red",
    );
  }

  if (state === "conflict") {
    return wrap(
      <>
        <AlertTriangle size={14} aria-hidden="true" className="shrink-0" />
        <span className="min-w-0 flex-1">
          The site files were changed outside the canvas. Nothing is overwritten until you choose.
        </span>
        <button type="button" className={btn} onClick={() => act("keep")} disabled={busy !== null}>
          {busy === "keep" ? <Loader2 size={12} className="animate-spin" /> : null}
          Keep files
        </button>
        <button type="button" className={btn} onClick={() => act("apply")} disabled={busy !== null}>
          {busy === "apply" ? <Loader2 size={12} className="animate-spin" /> : null}
          Apply canvas anyway
        </button>
      </>,
      "red",
    );
  }

  if (state === "pending" || state === "unapplied") {
    return wrap(
      <>
        <AlertTriangle size={14} aria-hidden="true" className="shrink-0" />
        <span className="min-w-0 flex-1">Canvas changes aren&apos;t on the site files yet — publish is blocked until they are.</span>
        <button type="button" className={btn} onClick={() => act("apply")} disabled={busy !== null}>
          {busy === "apply" ? <Loader2 size={12} className="animate-spin" /> : null}
          Apply canvas to site
        </button>
        <button type="button" className={btn} onClick={() => act("keep")} disabled={busy !== null}>
          {busy === "keep" ? <Loader2 size={12} className="animate-spin" /> : null}
          Keep files
        </button>
      </>,
      "amber",
    );
  }

  return null;
}
