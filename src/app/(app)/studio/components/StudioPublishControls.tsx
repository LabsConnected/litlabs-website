"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, Copy, ExternalLink, Globe, Loader2, RotateCcw, Trash2, X } from "lucide-react";

/**
 * Publish controls for static projects — Publish / Republish / Unpublish.
 *
 * Follows the StudioPreviewPanel toolbar button patterns (same sizing,
 * colors, and data-testid conventions).
 *
 * States:
 *   idle        — not published, or status unknown (shows Publish)
 *   publishing  — publish/unpublish request in flight (spinner, disabled)
 *   published   — live deployment exists (shows URL + Republish + Unpublish)
 *   error       — last action failed (shows message, Publish still available)
 *   confirming  — unpublish confirmation inline (prevents accidents)
 *
 * Security: all actions hit /api/projects/[projectId]/publish, which
 * enforces Clerk auth + project ownership server-side. The component
 * never sees another user's data.
 */

type PublishState = "idle" | "loading" | "publishing" | "unpublishing" | "published" | "error" | "confirm-unpublish";

interface DeploymentInfo {
  id: string;
  status: string;
  publicUrl: string | null;
  urlVerified: boolean;
  fileCount: number;
}

export default function StudioPublishControls({
  projectId,
  compact = false,
}: {
  projectId: string | null;
  /** Compact mode: icon buttons only (for toolbar). Full mode: labeled buttons. */
  compact?: boolean;
}) {
  const [state, setState] = useState<PublishState>("idle");
  const [deployment, setDeployment] = useState<DeploymentInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [urlCopied, setUrlCopied] = useState(false);

  const loadStatus = useCallback(async () => {
    if (!projectId) {
      setState("idle");
      setDeployment(null);
      return;
    }
    setState((s) => (s === "idle" ? "loading" : s));
    try {
      const res = await fetch(`/api/projects/${projectId}/publish`);
      if (!res.ok) {
        // 404 = no project or not owned; treat as idle, not error.
        if (res.status === 404) {
          setState("idle");
          setDeployment(null);
          return;
        }
        throw new Error(`Status check failed (${res.status})`);
      }
      const data = await res.json();
      if (data.published && data.deployment?.publicUrl) {
        setDeployment(data.deployment);
        setState("published");
      } else {
        setDeployment(data.deployment ?? null);
        setState("idle");
      }
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to check publish status.");
      setState((s) => (s === "loading" ? "idle" : s));
    }
  }, [projectId]);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  const handlePublish = useCallback(async () => {
    if (!projectId || state === "publishing") return;
    setState("publishing");
    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/publish`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.detail || data.error || `Publish failed (${res.status})`);
      }
      setDeployment({
        id: data.deploymentId,
        status: "ready",
        publicUrl: data.publicUrl,
        urlVerified: true,
        fileCount: data.fileCount ?? 0,
      });
      setState("published");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Publish failed.");
      setState("error");
    }
  }, [projectId, state]);

  const handleUnpublish = useCallback(async () => {
    if (!projectId || !deployment || state === "unpublishing") return;
    setState("unpublishing");
    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/publish`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deploymentId: deployment.id }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || `Unpublish failed (${res.status})`);
      }
      setDeployment(null);
      setState("idle");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unpublish failed.");
      setState("error");
    }
  }, [projectId, deployment, state]);

  const handleCopyUrl = useCallback(async () => {
    if (!deployment?.publicUrl) return;
    try {
      await navigator.clipboard.writeText(deployment.publicUrl);
      setUrlCopied(true);
      setTimeout(() => setUrlCopied(false), 2000);
    } catch {
      // Clipboard unavailable — user can copy from the link directly.
    }
  }, [deployment?.publicUrl]);

  if (!projectId) return null;

  const busy = state === "publishing" || state === "unpublishing" || state === "loading";
  // Pre-computed flags avoid TS narrowing conflicts in JSX branches.
  const isPublishing = state === "publishing";
  const isUnpublishing = state === "unpublishing";
  const isConfirming = state === "confirm-unpublish";

  // ── Compact toolbar mode: icon buttons ──────────────────────────
  if (compact) {
    return (
      <>
        {/* Publish / Republish */}
        <button
          type="button"
          onClick={() => void handlePublish()}
          disabled={busy}
          className="grid min-h-9 min-w-9 shrink-0 place-items-center rounded-lg transition hover:bg-white/8 disabled:opacity-40"
          style={{
            backgroundColor: state === "published" ? "rgba(114,242,56,0.12)" : "transparent",
            color: state === "published" ? "var(--litt-primary)" : "var(--text-muted)",
          }}
          aria-label={state === "published" ? "Republish site" : "Publish site"}
          title={state === "published" ? "Republish site" : "Publish site to a public URL"}
          data-testid="publish-button"
        >
          {state === "publishing" ? (
            <Loader2 size={12} className="pointer-events-none animate-spin" />
          ) : state === "published" ? (
            <RotateCcw size={12} className="pointer-events-none" />
          ) : (
            <Globe size={12} className="pointer-events-none" />
          )}
        </button>
        {/* Unpublish */}
        {state === "published" && deployment && (
          <button
            type="button"
            onClick={() => setState("confirm-unpublish")}
            disabled={busy}
            className="grid min-h-9 min-w-9 shrink-0 place-items-center rounded-lg transition hover:bg-white/8 disabled:opacity-40"
            style={{ color: "var(--text-muted)" }}
            aria-label="Unpublish site"
            title="Unpublish site (removes public access)"
            data-testid="unpublish-button"
          >
            <Trash2 size={12} className="pointer-events-none" />
          </button>
        )}
        {/* Inline unpublish confirmation */}
        {state === "confirm-unpublish" && (
          <span className="flex shrink-0 items-center gap-1" data-testid="unpublish-confirm">
            <button
              type="button"
              onClick={() => void handleUnpublish()}
              disabled={busy}
              className="rounded-md px-2 py-1 text-[10px] font-bold transition disabled:opacity-40"
              style={{ backgroundColor: "rgba(239,68,68,0.15)", color: "#EF4444" }}
              data-testid="unpublish-confirm-yes"
            >
              {isUnpublishing ? "Removing…" : "Remove?"}
            </button>
            <button
              type="button"
              onClick={() => setState("published")}
              className="grid h-7 w-7 place-items-center rounded-md transition hover:bg-white/8"
              style={{ color: "var(--text-muted)" }}
              aria-label="Cancel unpublish"
              data-testid="unpublish-confirm-no"
            >
              <X size={11} className="pointer-events-none" />
            </button>
          </span>
        )}
      </>
    );
  }

  // ── Full mode: labeled buttons + URL display ────────────────────
  // Note: "confirm-unpublish" renders the published view (URL + buttons)
  // with the unpublish button replaced by the confirmation inline.
  const showPublishedView =
    (state === "published" || state === "confirm-unpublish" || state === "unpublishing") &&
    !!deployment?.publicUrl;
  // Narrowed by showPublishedView — safe to use directly in the published branch.
  const liveUrl = deployment?.publicUrl ?? undefined;
  return (
    <div className="flex flex-col gap-2" data-testid="publish-controls">
      {showPublishedView ? (
        <>
          <a
            href={liveUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 truncate text-[11px] font-medium underline decoration-dotted underline-offset-2"
            style={{ color: "var(--litt-primary)" }}
            data-testid="publish-live-url"
          >
            <ExternalLink size={11} className="shrink-0" />
            <span className="truncate">{deployment.publicUrl}</span>
          </a>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => void handlePublish()}
              disabled={busy}
              className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11px] font-bold transition disabled:opacity-40"
              style={{ backgroundColor: "rgba(114,242,56,0.12)", color: "var(--litt-primary)" }}
              data-testid="publish-republish"
            >
              {isPublishing ? <Loader2 size={11} className="animate-spin" /> : <RotateCcw size={11} />}
              {isPublishing ? "Republishing…" : "Republish"}
            </button>
            <button
              type="button"
              onClick={() => void handleCopyUrl()}
              className="grid h-8 w-8 place-items-center rounded-lg transition hover:bg-white/8"
              style={{ color: "var(--text-muted)" }}
              aria-label="Copy public URL"
              data-testid="publish-copy-url"
            >
              {urlCopied ? <Check size={12} style={{ color: "#48EE38" }} /> : <Copy size={12} />}
            </button>
            {isConfirming ? (
              <span className="flex items-center gap-1" data-testid="unpublish-confirm">
                <button
                  type="button"
                  onClick={() => void handleUnpublish()}
                  disabled={busy}
                  className="rounded-lg px-3 py-1.5 text-[11px] font-bold transition disabled:opacity-40"
                  style={{ backgroundColor: "rgba(239,68,68,0.15)", color: "#EF4444" }}
                  data-testid="unpublish-confirm-yes"
                >
                  {isUnpublishing ? "Removing…" : "Confirm remove"}
                </button>
                <button
                  type="button"
                  onClick={() => setState("published")}
                  className="rounded-lg px-2 py-1.5 text-[11px] transition hover:bg-white/8"
                  style={{ color: "var(--text-muted)" }}
                  data-testid="unpublish-confirm-no"
                >
                  Cancel
                </button>
              </span>
            ) : (
              <button
                type="button"
                onClick={() => setState("confirm-unpublish")}
                disabled={busy}
                className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11px] font-medium transition hover:bg-white/8 disabled:opacity-40"
                style={{ color: "var(--text-muted)" }}
                data-testid="publish-unpublish"
              >
                <Trash2 size={11} />
                Unpublish
              </button>
            )}
          </div>
        </>
      ) : (
        <button
          type="button"
          onClick={() => void handlePublish()}
          disabled={busy || !projectId}
          className="flex items-center justify-center gap-1.5 rounded-lg px-4 py-2 text-[12px] font-bold transition disabled:opacity-40"
          style={{ backgroundColor: "var(--litt-primary)", color: "#0a0a0a" }}
          data-testid="publish-button"
        >
          {state === "publishing" ? (
            <>
              <Loader2 size={13} className="animate-spin" />
              Publishing…
            </>
          ) : (
            <>
              <Globe size={13} />
              Publish site
            </>
          )}
        </button>
      )}
      {error && (
        <div
          className="rounded-lg px-3 py-2 text-[11px]"
          style={{ backgroundColor: "rgba(239,68,68,0.1)", color: "#EF4444" }}
          data-testid="publish-error"
          role="alert"
        >
          {error}
        </div>
      )}
    </div>
  );
}
