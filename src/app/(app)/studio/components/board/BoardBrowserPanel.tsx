"use client";

/**
 * BoardBrowserPanel — an embedded web view on the board (board-only
 * rebuild, 2026-11-14, checklist item 5), plus a live lookup bar wired
 * to LiTT's places/web-search tools (2026-11-16).
 *
 * A real iframe with a small local history (back / forward / refresh),
 * a URL bar, and an open-in-new-tab escape hatch.
 *
 * Embed-blocked handling (2026-11-17, Larry's screenshot defect):
 * Sites that send X-Frame-Options / CSP frame-ancestors refuse to be
 * framed. The browser gives a cross-origin parent NO reliable signal
 * for that refusal: the framed document cannot be inspected (same-origin
 * policy), and browsers differ on whether a blocked frame fires `load`,
 * `error`, or neither. The previous version left that case as an
 * unexplained blank white page with a sad-document icon.
 *
 * Detection approach — a bounded load watchdog, plus `onError`:
 *   - Every navigation / refresh / retry arms a generous watchdog
 *     (BROWSER_EMBED_WATCHDOG_MS, 8s).
 *   - A usable `load` event disarms it and the site renders as before.
 *   - An iframe `error` event, or the watchdog expiring with no load,
 *     moves the panel to the blocked state instead of a blank page.
 *   - While the watchdog is armed a plain loading note is shown, so the
 *     panel is never an unexplained blank even before the verdict.
 *
 * Honest limits of that approach (documented, not hidden):
 *   - This is a heuristic, not proof of X-Frame-Options. A site that is
 *     merely slower than the watchdog, or a network failure, can be
 *     shown the same blocked state. The copy therefore offers Try again
 *     and Open in a new tab rather than claiming certainty, and the
 *     bound is deliberately generous so a slow legitimate site is
 *     unlikely to be mislabeled.
 *   - Some browsers fire `load` for their own blocked-frame error page.
 *     In that case the watchdog is disarmed and this detection cannot
 *     catch the block — cross-origin rules forbid reading the framed
 *     document to confirm what actually rendered. No code inside this
 *     panel can fully close that gap without a server-side probe, which
 *     is out of scope for this file.
 *
 * The lookup bar (2026-11-16) is separate from navigation: it posts a
 * question to /api/studio/lookup (the same places/web-search tool
 * functions Studio chat's pre-LLM router uses) and renders only the
 * real, sourced answer or an honest error — no placeholder/fake result
 * is ever shown.
 *
 * Token-bound surfaces; no pink.
 */

import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, ExternalLink, Globe, RefreshCw, Search, Square } from "lucide-react";
import { useTheme } from "@/context/ThemeContext";
import { useLiveLookup } from "../../hooks/useLiveLookup";
import { useApplyLookupResult } from "../../hooks/useApplyLookupResult";
import LookupApplyDialog from "./LookupApplyDialog";

/**
 * Generous bound for a framed page to signal a usable load before the
 * panel presents the embed-blocked state. Exported for tests.
 */
export const BROWSER_EMBED_WATCHDOG_MS = 8000;

type EmbedStatus = "loading" | "loaded" | "blocked";

/** Normalize a typed address into a loadable URL, or null if empty. */
export function normalizeBrowserUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (/^about:/i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

export default function BoardBrowserPanel({ projectId = null }: { projectId?: string | null }) {
  const { tokens } = useTheme();
  const [input, setInput] = useState("");
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [reloadKey, setReloadKey] = useState(0);
  const [embedStatus, setEmbedStatus] = useState<EmbedStatus>("loading");
  const watchdogRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const currentUrl = historyIndex >= 0 ? history[historyIndex] : null;
  const [lookupInput, setLookupInput] = useState("");
  const [lastQuery, setLastQuery] = useState("");
  const {
    result: lookupResult,
    loading: lookupLoading,
    error: lookupError,
    search: runLookup,
    cancel: cancelLookup,
  } = useLiveLookup();
  const [applyDialogOpen, setApplyDialogOpen] = useState(false);
  const { apply, applying, error: applyError, appliedAt, resetError: resetApplyError, resetApplied } = useApplyLookupResult(projectId);

  const clearWatchdog = () => {
    if (watchdogRef.current !== null) {
      clearTimeout(watchdogRef.current);
      watchdogRef.current = null;
    }
  };

  // Arm the watchdog for every new attempt (navigation, back/forward to
  // a different URL, refresh, or retry — the last two change reloadKey
  // and remount the iframe via its key).
  useEffect(() => {
    if (!currentUrl) return;
    setEmbedStatus("loading");
    clearWatchdog();
    watchdogRef.current = setTimeout(() => {
      watchdogRef.current = null;
      setEmbedStatus("blocked");
    }, BROWSER_EMBED_WATCHDOG_MS);
    return clearWatchdog;
  }, [currentUrl, reloadKey]);

  const navigate = (raw: string) => {
    const url = normalizeBrowserUrl(raw);
    if (!url) return;
    const next = [...history.slice(0, historyIndex + 1), url];
    setHistory(next);
    setHistoryIndex(next.length - 1);
    setInput(url);
  };

  // React's onError prop alone is not reliably delivered for <iframe>
  // in every environment, so also attach the native onerror property
  // through a ref callback; either path lands in the blocked state.
  const handleFrameError = () => {
    clearWatchdog();
    setEmbedStatus("blocked");
  };
  const frameRef = (node: HTMLIFrameElement | null) => {
    if (node) node.onerror = handleFrameError;
  };

  const openExternally = () => {
    if (!currentUrl) return;
    window.open(currentUrl, "_blank", "noopener,noreferrer");
  };

  const barButton =
    "flex h-7 w-7 shrink-0 items-center justify-center rounded-md hover:bg-black/5 disabled:opacity-40";

  return (
    <div
      className="flex h-full min-h-0 flex-col"
      data-testid="board-browser-panel"
      style={{ backgroundColor: tokens.surface, color: tokens.text }}
    >
      <div
        className="flex shrink-0 items-center gap-1 border-b px-2 py-1.5"
        style={{ borderColor: tokens.border }}
      >
        <button
          type="button"
          aria-label="Back"
          data-testid="board-browser-back"
          className={barButton}
          style={{ color: tokens.text }}
          disabled={historyIndex <= 0}
          onClick={() => {
            const next = historyIndex - 1;
            setHistoryIndex(next);
            setInput(history[next] ?? "");
          }}
        >
          <ArrowLeft size={13} aria-hidden />
        </button>
        <button
          type="button"
          aria-label="Forward"
          data-testid="board-browser-forward"
          className={barButton}
          style={{ color: tokens.text }}
          disabled={historyIndex >= history.length - 1}
          onClick={() => {
            const next = historyIndex + 1;
            setHistoryIndex(next);
            setInput(history[next] ?? "");
          }}
        >
          <ArrowRight size={13} aria-hidden />
        </button>
        <button
          type="button"
          aria-label="Refresh"
          data-testid="board-browser-refresh"
          className={barButton}
          style={{ color: tokens.text }}
          disabled={!currentUrl}
          onClick={() => setReloadKey((k) => k + 1)}
        >
          <RefreshCw size={12} aria-hidden />
        </button>
        <input
          data-testid="board-browser-input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") navigate(input);
          }}
          placeholder="Enter a web address…"
          className="min-w-0 flex-1 rounded-full border bg-transparent px-3 py-1 text-xs outline-none"
          style={{ borderColor: tokens.border, color: tokens.text }}
        />
        {currentUrl && (
          <a
            data-testid="board-browser-open"
            href={currentUrl}
            target="_blank"
            rel="noreferrer"
            aria-label="Open in a new tab"
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md hover:bg-black/5"
            style={{ color: tokens.text }}
          >
            <ExternalLink size={12} aria-hidden />
          </a>
        )}
      </div>

      <form
        className="flex shrink-0 items-center gap-1.5 border-b px-2 py-1.5"
        style={{ borderColor: tokens.border }}
        onSubmit={(e) => {
          e.preventDefault();
          setLastQuery(lookupInput);
          resetApplied();
          void runLookup(lookupInput);
        }}
      >
        <Search size={12} style={{ color: tokens.textMuted }} aria-hidden />
        <input
          data-testid="board-browser-lookup-input"
          value={lookupInput}
          onChange={(e) => setLookupInput(e.target.value)}
          placeholder="Ask LiTT to look something up — e.g. “What time does Best Buy open?”"
          className="min-w-0 flex-1 rounded-full border bg-transparent px-3 py-1 text-xs outline-none"
          style={{ borderColor: tokens.border, color: tokens.text }}
        />
        {lookupLoading ? (
          <button
            key="cancel"
            type="button"
            data-testid="board-browser-lookup-cancel"
            onClick={(e) => {
              // Distinct `key`s (vs. the submit button below) are load-bearing,
              // not cosmetic: without them React reconciles both branches as
              // the SAME <button> DOM node (same tag, same tree position) and
              // just mutates its `type` attribute in place. That mutation can
              // land mid-click, so the browser's native click-completion sees
              // type="submit" and fires an unintended form resubmission —
              // i.e. clicking Cancel silently re-ran the search. preventDefault
              // is kept as a second, independent guard against that class of
              // bug even if the keys are ever removed.
              e.preventDefault();
              cancelLookup();
            }}
            className="shrink-0 flex items-center gap-1 rounded-full border px-3 py-1 text-xs"
            style={{ borderColor: tokens.border, color: tokens.text }}
          >
            <Square size={10} aria-hidden /> Cancel
          </button>
        ) : (
          <button
            key="submit"
            type="submit"
            data-testid="board-browser-lookup-submit"
            className="shrink-0 rounded-full border px-3 py-1 text-xs disabled:opacity-40"
            style={{ borderColor: tokens.border, color: tokens.text }}
            disabled={!lookupInput.trim()}
          >
            Look up
          </button>
        )}
      </form>

      {lookupError && (
        <div
          data-testid="board-browser-lookup-error"
          className="shrink-0 border-b px-3 py-2 text-xs leading-5"
          style={{ borderColor: tokens.border, color: tokens.text }}
        >
          {lookupError}
        </div>
      )}
      {lookupResult && (
        <div
          data-testid="board-browser-lookup-result"
          className="shrink-0 border-b px-3 py-2 text-xs leading-5"
          style={{ borderColor: tokens.border, color: tokens.text }}
        >
          <p>{lookupResult.formatted}</p>
          {projectId && (
            <div className="mt-1.5 flex items-center gap-2">
              <button
                type="button"
                data-testid="board-browser-lookup-apply"
                onClick={() => {
                  resetApplyError();
                  setApplyDialogOpen(true);
                }}
                className="rounded-full border px-2.5 py-0.5 text-[11px] font-medium"
                style={{ borderColor: tokens.border, color: tokens.text }}
              >
                Add to project
              </button>
              {appliedAt && !applyDialogOpen && (
                <span data-testid="board-browser-lookup-applied" className="text-[11px]" style={{ color: tokens.textMuted }}>
                  Saved ✓
                </span>
              )}
            </div>
          )}
        </div>
      )}

      <LookupApplyDialog
        open={applyDialogOpen}
        query={lastQuery}
        formatted={lookupResult?.formatted ?? ""}
        busy={applying}
        error={applyError}
        onCancel={() => setApplyDialogOpen(false)}
        onConfirm={() => {
          if (!lookupResult) return;
          void apply(lastQuery, lookupResult.formatted, lookupResult.source).then((ok) => {
            if (ok) setApplyDialogOpen(false);
          });
        }}
      />

      {currentUrl ? (
        embedStatus === "blocked" ? (
          <div
            className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center"
            data-testid="board-browser-blocked"
            role="alert"
            style={{ backgroundColor: tokens.surface, color: tokens.text }}
          >
            <Globe size={22} style={{ color: tokens.textMuted }} aria-hidden />
            <p className="max-w-80 text-xs leading-5" style={{ color: tokens.text }}>
              This site doesn&apos;t allow itself to be displayed inside other
              apps, so it can&apos;t be shown here.
            </p>
            <p
              className="max-w-full truncate text-xs"
              data-testid="board-browser-blocked-url"
              style={{ color: tokens.textMuted }}
              title={currentUrl}
            >
              {currentUrl}
            </p>
            <div className="flex flex-wrap items-center justify-center gap-2">
              <button
                type="button"
                data-testid="board-browser-blocked-open"
                onClick={openExternally}
                className="flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium"
                style={{ borderColor: tokens.border, color: tokens.secondary }}
              >
                <ExternalLink size={12} aria-hidden />
                Open in a new tab
              </button>
              <button
                type="button"
                data-testid="board-browser-blocked-retry"
                onClick={() => setReloadKey((k) => k + 1)}
                className="flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium"
                style={{ borderColor: tokens.border, color: tokens.text }}
              >
                <RefreshCw size={12} aria-hidden />
                Try again
              </button>
            </div>
          </div>
        ) : (
          <div className="relative flex min-h-0 flex-1 flex-col">
            {embedStatus === "loading" && (
              <p
                data-testid="board-browser-loading"
                className="shrink-0 px-3 py-1.5 text-center text-[11px]"
                style={{ color: tokens.textMuted }}
              >
                Loading {currentUrl}…
              </p>
            )}
            <iframe
              ref={frameRef}
              key={`${currentUrl}:${reloadKey}`}
              data-testid="board-browser-frame"
              title="Board browser"
              src={currentUrl}
              className="min-h-0 flex-1 border-0"
              style={{ backgroundColor: "#FFFFFF" }}
              sandbox="allow-scripts allow-forms allow-popups allow-same-origin"
              onLoad={() => {
                clearWatchdog();
                setEmbedStatus("loaded");
              }}
              onError={handleFrameError}
            />
          </div>
        )
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
          <Globe size={22} style={{ color: tokens.textMuted }} aria-hidden />
          <p className="max-w-60 text-xs leading-5" style={{ color: tokens.textMuted }}>
            Browse the web without leaving Studio. Some sites refuse to be
            embedded — if a page stays blank, open it in a new tab instead.
          </p>
        </div>
      )}
    </div>
  );
}
