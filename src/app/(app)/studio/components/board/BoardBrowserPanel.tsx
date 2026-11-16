"use client";

/**
 * BoardBrowserPanel — an embedded web view on the board (board-only
 * rebuild, 2026-11-14, checklist item 5), plus a live lookup bar wired
 * to LiTT's places/web-search tools (2026-11-16).
 *
 * The address bar drives a real iframe with a small local history
 * (back / forward / refresh) and an open-in-new-tab escape hatch.
 * Honest limits: many sites send X-Frame-Options / CSP frame-ancestors
 * and refuse to be embedded — the panel cannot detect that reliably, so
 * the empty state says so up front.
 *
 * The lookup bar is separate from navigation: it posts a question to
 * /api/studio/lookup (the same places/web-search tool functions Studio
 * chat's pre-LLM router uses) and renders only the real, sourced answer
 * or an honest error — no placeholder/fake result is ever shown.
 *
 * Token-bound surfaces; no pink.
 */

import { useState } from "react";
import { ArrowLeft, ArrowRight, ExternalLink, Globe, RefreshCw, Search } from "lucide-react";
import { useTheme } from "@/context/ThemeContext";
import { useLiveLookup } from "../../hooks/useLiveLookup";

/** Normalize a typed address into a loadable URL, or null if empty. */
export function normalizeBrowserUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (/^about:/i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

export default function BoardBrowserPanel() {
  const { tokens } = useTheme();
  const [input, setInput] = useState("");
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [reloadKey, setReloadKey] = useState(0);
  const currentUrl = historyIndex >= 0 ? history[historyIndex] : null;
  const [lookupInput, setLookupInput] = useState("");
  const { result: lookupResult, loading: lookupLoading, error: lookupError, search: runLookup } = useLiveLookup();

  const navigate = (raw: string) => {
    const url = normalizeBrowserUrl(raw);
    if (!url) return;
    const next = [...history.slice(0, historyIndex + 1), url];
    setHistory(next);
    setHistoryIndex(next.length - 1);
    setInput(url);
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
          void runLookup(lookupInput);
        }}
      >
        <Search size={12} style={{ color: tokens.textMuted }} aria-hidden />
        <input
          data-testid="board-browser-lookup-input"
          value={lookupInput}
          onChange={(e) => setLookupInput(e.target.value)}
          placeholder="Ask LiTT to look something up — e.g. “Best Buy hours”"
          className="min-w-0 flex-1 rounded-full border bg-transparent px-3 py-1 text-xs outline-none"
          style={{ borderColor: tokens.border, color: tokens.text }}
        />
        <button
          type="submit"
          data-testid="board-browser-lookup-submit"
          className="shrink-0 rounded-full border px-3 py-1 text-xs disabled:opacity-40"
          style={{ borderColor: tokens.border, color: tokens.text }}
          disabled={lookupLoading || !lookupInput.trim()}
        >
          {lookupLoading ? "Looking…" : "Look up"}
        </button>
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
          {lookupResult.formatted}
        </div>
      )}

      {currentUrl ? (
        <iframe
          key={`${currentUrl}:${reloadKey}`}
          data-testid="board-browser-frame"
          title="Board browser"
          src={currentUrl}
          className="min-h-0 flex-1 border-0"
          style={{ backgroundColor: "#FFFFFF" }}
          sandbox="allow-scripts allow-forms allow-popups allow-same-origin"
        />
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
